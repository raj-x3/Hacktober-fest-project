"""
PaperTrail — PDF extraction service
Extracts text from PDF using PyMuPDF, then asks Gemma to identify research claims.
"""
from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Any

import fitz  # PyMuPDF

logger = logging.getLogger(__name__)

# ── Constants ──────────────────────────────────────────────────────────────
MAX_PAGES = 40          # cap to avoid sending huge docs to Gemma
CHUNK_CHARS = 6000      # characters per chunk sent to Gemma for claim extraction


def extract_text(pdf_path: Path) -> str:
    """Extract plain text from all pages of a PDF."""
    doc = fitz.open(str(pdf_path))
    pages = min(len(doc), MAX_PAGES)
    text_parts: list[str] = []
    for i in range(pages):
        text_parts.append(doc[i].get_text())
    doc.close()
    return "\n".join(text_parts)


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
