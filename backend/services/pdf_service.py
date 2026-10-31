"""
PaperTrail — PDF extraction service
Extracts text from PDF using PyMuPDF, then asks Gemma to identify research claims.
"""
from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Any, Optional

import fitz  # PyMuPDF

logger = logging.getLogger(__name__)

# ── Constants ──────────────────────────────────────────────────────────────
MAX_PAGES = 40          # cap to avoid sending huge docs to Gemma
CHUNK_CHARS = 6000      # characters per chunk sent to Gemma for claim extraction

# Lines shorter than this won't be used as a title fallback
_MIN_TITLE_CHARS = 8
# Lines longer than this are probably an abstract or paragraph, not a title
_MAX_TITLE_CHARS = 200


def extract_title(pdf_path: Path) -> str:
    """
    Return the paper title using the following priority:

    1. PDF document metadata ``/Title`` field (populated by most LaTeX / Word tools).
    2. First non-trivial line on page 1 that looks like a heading: not too short,
       not too long, and doesn't start with typical boilerplate words
       ("Abstract", "arXiv", "Published", "Copyright", "Submitted", …).
    3. Stem of the file name (the last resort fallback).

    Never returns a temporary directory name such as ``pt_pdf_xxxxxx``.
    """
    doc: Optional[fitz.Document] = None
    try:
        doc = fitz.open(str(pdf_path))

        # ── Strategy 1: PDF metadata title ────────────────────────────────
        meta = doc.metadata or {}
        meta_title: str = (meta.get("title") or "").strip()
        if (
            meta_title
            and _MIN_TITLE_CHARS <= len(meta_title) <= _MAX_TITLE_CHARS
            and not _looks_like_boilerplate(meta_title)
        ):
            logger.info("PDF title from metadata: %r", meta_title)
            return meta_title

        # ── Strategy 2: First-page heading heuristic ──────────────────────
        if len(doc) > 0:
            page_text = doc[0].get_text()
            lines = [l.strip() for l in page_text.splitlines() if l.strip()]
            for idx, line in enumerate(lines):
                if (
                    _MIN_TITLE_CHARS <= len(line) <= _MAX_TITLE_CHARS
                    and not _looks_like_boilerplate(line)
                ):
                    # If the heading wraps onto a continuation line, join them
                    if (
                        line.rstrip().lower().endswith(("for", "of", "and", "in", "with", "to", "on", ":", "-"))
                        and idx + 1 < len(lines)
                    ):
                        next_line = lines[idx + 1]
                        if not _looks_like_boilerplate(next_line) and len(next_line) < 100:
                            combined = f"{line} {next_line}".strip()
                            logger.info("PDF title from combined heading: %r", combined)
                            return combined

                    logger.info("PDF title from first-page heading: %r", line)
                    return line

        # ── Strategy 3: file stem (never a tmpdir) ────────────────────────
        stem = pdf_path.stem
        if not stem.startswith("pt_pdf_"):
            logger.info("PDF title from file stem: %r", stem)
            return stem.replace("_", " ").replace("-", " ").title()

        return "Untitled Research Paper"

    except Exception as exc:
        logger.warning("extract_title failed: %s", exc)
        return "Untitled Research Paper"
    finally:
        if doc:
            doc.close()


_BOILERPLATE_PREFIXES = (
    "abstract", "arxiv", "published", "copyright", "submitted",
    "preprint", "proceedings", "workshop", "conference", "journal",
    "doi:", "http", "figure", "table", "appendix",
)


def _looks_like_boilerplate(text: str) -> bool:
    """Return True if the text is unlikely to be a paper title."""
    lower = text.lower()
    # Starts with a known boilerplate word
    if any(lower.startswith(p) for p in _BOILERPLATE_PREFIXES):
        return True
    # Looks like a pure number / code / arXiv ID
    if re.match(r'^[\d\s\.\-:]+$', text):
        return True
    # Contains an email address (likely an author line)
    if "@" in text:
        return True
    return False


def extract_text(pdf_path: Path) -> str:
    """Extract plain text from all pages of a PDF."""
    try:
        doc = fitz.open(str(pdf_path))
    except Exception as exc:
        logger.error("Failed to open PDF %s: %s", pdf_path, exc)
        raise ValueError(f"Could not open or parse PDF file: {exc}") from exc

    try:
        pages = min(len(doc), MAX_PAGES)
        text_parts: list[str] = []
        for i in range(pages):
            text_parts.append(doc[i].get_text())
        return "\n".join(text_parts)
    finally:
        doc.close()


def chunk_text(text: str, chunk_size: int = CHUNK_CHARS) -> list[str]:
    """Split text into overlapping chunks for claim extraction."""
    words = text.split()
    chunks: list[str] = []
    current: list[str] = []
    length = 0
    for word in words:
        current.append(word)
        length += len(word) + 1
        if length >= chunk_size:
            chunks.append(" ".join(current))
            # Overlap: keep last 20% of words
            keep = len(current) // 5
            current = current[-keep:]
            length = sum(len(w) + 1 for w in current)
    if current:
        chunks.append(" ".join(current))
    return chunks


async def extract_claims_from_pdf(
    pdf_path: Path,
    gemma,  # GemmaService instance
) -> list[dict[str, Any]]:
    """
    Use Gemma to extract research claims from a PDF.
    Returns list of {"id": str, "text": str, "page": int|None}.
    """
    full_text = extract_text(pdf_path)
    chunks = chunk_text(full_text)

    all_claims: list[dict[str, Any]] = []
    seen: set[str] = set()

    for chunk_idx, chunk in enumerate(chunks[:6]):  # limit chunks
        prompt = f"""
You are reading a section of a machine-learning research paper.
Extract every distinct experimental claim — statements about model performance,
dataset sizes, training procedures, hyperparameters, evaluation results,
or architectural choices that could be verified in source code.

Paper excerpt:
---
{chunk}
---

Return a JSON array. Each item must have:
- "id": "claim_{chunk_idx}_<index>"  (unique string)
- "text": "<the exact claim as stated or closely paraphrased>"
- "page": null

Return ONLY the JSON array, no extra text. Example:
[{{"id":"claim_0_0","text":"We train for 100 epochs with a learning rate of 0.001","page":null}}]

If no verifiable claims exist in this excerpt, return [].
"""
        try:
            result = await gemma.generate_json(prompt)
            if isinstance(result, list):
                for item in result:
                    text = item.get("text", "").strip()
                    if text and text not in seen and len(text) > 15:
                        seen.add(text)
                        all_claims.append({
                            "id": item.get("id", f"claim_{len(all_claims)}"),
                            "text": text,
                            "page": item.get("page"),
                        })
        except (ValueError, Exception) as exc:
            logger.warning("Claim extraction chunk %d failed: %s", chunk_idx, exc)
            continue

    logger.info("Extracted %d claims from PDF", len(all_claims))
    return all_claims[:30]  # cap at 30 claims per analysis
