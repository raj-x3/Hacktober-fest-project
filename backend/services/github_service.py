"""
PaperTrail — GitHub repository ingestion and evidence retrieval.

Key design decisions:
- Python source files are always prioritised over docs/configs.
- Large files (up to 300 KB) are accepted for source code.
- The file index is built once per job and reused for all claims.
- Keyword search is supplemented with identifier extraction (CamelCase, snake_case).
- Every skipped file is logged with its reason.
- All returned snippets carry real line numbers from the actual file.
"""
from __future__ import annotations

import asyncio
import logging
import re
import shutil
import tempfile
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

# ── File priorities ────────────────────────────────────────────────────────
# Priority 0 = highest. Files are sorted by priority then path so that source
# files are always indexed before docs when the cap is hit.

_PRIORITY: dict[str, int] = {
    ".py":   0,   # Python source — top priority
    ".sh":   1,   # Shell training / eval scripts
    ".yaml": 2,
    ".yml":  2,
    ".toml": 2,
    ".cfg":  2,
    ".json": 3,
    ".txt":  4,   # requirements.txt, etc.
    ".md":   5,   # README last — least code-dense
}

RELEVANT_EXTENSIONS = set(_PRIORITY.keys())

EXCLUDED_DIRS = {
    ".git", "__pycache__", "node_modules", ".tox", "venv", ".venv",
    "dist", "build", "eggs", ".eggs", "htmlcov", ".mypy_cache",
    ".pytest_cache", "site-packages",
}

# Per-file size caps — larger for source code, tighter for docs
_SIZE_CAP: dict[int, int] = {
    0: 300_000,  # .py  — up to 300 KB (covers large model files like modeling.py)
    1: 100_000,  # .sh
    2:  80_000,  # config files
    3:  80_000,
    4:  40_000,
    5:  40_000,  # markdown
}

MAX_FILES = 120           # total files to index
SNIPPET_LINES = 50        # context lines around a keyword hit
MAX_SNIPPETS_PER_CLAIM = 6
MAX_CLAIMS_FOR_FULL_INDEX = 30  # reuse one index for all claims in a job


# ── Indexing ───────────────────────────────────────────────────────────────

def _file_priority(rel: Path) -> int:
    return _PRIORITY.get(rel.suffix.lower(), 99)


def _is_relevant(path: Path) -> bool:
    """Return True if the file should be indexed."""
    for part in path.parts:
        if part in EXCLUDED_DIRS:
            return False
    return path.suffix.lower() in RELEVANT_EXTENSIONS


def index_repo(repo_root: Path) -> list[dict[str, Any]]:
    """
    Walk the repo and return a prioritised list of
    ``{path, content, priority, size}`` dicts.

    Source files (.py, .sh) come before docs (.md) so that the MAX_FILES
    cap never ejects them in favour of README files.
    """
    candidates: list[tuple[int, str, Path]] = []  # (priority, rel_str, abs_path)

    for p in repo_root.rglob("*"):
        if not p.is_file():
            continue
        rel = p.relative_to(repo_root)
        if not _is_relevant(rel):
            continue
        candidates.append((_file_priority(rel), str(rel), p))

    # Sort: priority asc, then path asc (deterministic)
    candidates.sort(key=lambda x: (x[0], x[1]))

    files: list[dict[str, Any]] = []
    skipped_large = 0
    skipped_cap = 0

    for priority, rel_str, abs_path in candidates:
        if len(files) >= MAX_FILES:
            skipped_cap += 1
            continue
        cap = _SIZE_CAP.get(priority, 40_000)
        try:
            size = abs_path.stat().st_size
        except OSError:
            continue
        if size > cap:
            skipped_large += 1
            logger.debug("SKIP (too large %d B > %d B): %s", size, cap, rel_str)
            continue
        try:
            content = abs_path.read_text(errors="replace")
        except OSError as exc:
            logger.debug("SKIP (read error %s): %s", exc, rel_str)
            continue
        files.append({
            "path": rel_str,
            "content": content,
            "priority": priority,
            "size": size,
        })

    py_count = sum(1 for f in files if f["path"].endswith(".py"))
    logger.info(
        "Indexed %d files (%d .py) | skipped %d too-large, %d over cap",
        len(files), py_count, skipped_large, skipped_cap,
    )
    if files:
        logger.info(
            "Top 10 indexed files: %s",
            [f["path"] for f in files[:10]],
        )
    return files


# ── Keyword extraction ─────────────────────────────────────────────────────

def _claim_keywords(claim_text: str) -> list[str]:
    """
    Extract search tokens from a claim.

    Strategy:
    1. Quoted strings  → high-value exact terms
    2. CamelCase identifiers  → class / function names researchers describe
    3. snake_case identifiers
    4. Numbers with units
    5. Ordinary long words (>4 chars)

    All tokens are lowercased for matching; identifiers are also kept as-is
    for case-sensitive matching in code.
    """
    tokens: list[str] = []
    seen: set[str] = set()

    def add(t: str) -> None:
        t = t.strip().strip('"\'')
        if len(t) > 2 and t not in seen:
            seen.add(t)
            tokens.append(t)

    # Quoted strings
    for m in re.finditer(r'"([^"]{3,})"', claim_text):
        add(m.group(1))

    # CamelCase / PascalCase → also split into parts
    for m in re.finditer(r'\b([A-Z][a-z]+(?:[A-Z][a-z]+)+)\b', claim_text):
        ident = m.group(1)
        add(ident)
        # Also add snake_case equivalent
        snake = re.sub(r'(?<!^)(?=[A-Z])', '_', ident).lower()
        add(snake)
        # And lowercase parts
        for part in re.findall(r'[A-Z][a-z]+', ident):
            if len(part) > 3:
                add(part.lower())

    # snake_case identifiers
    for m in re.finditer(r'\b([a-z][a-z0-9]+(?:_[a-z0-9]+){1,})\b', claim_text):
        add(m.group(1))

    # Numbers with optional units (e.g. "110M", "0.0001", "128")
    for m in re.finditer(r'\b(\d+\.?\d*[MBKk]?)\b', claim_text):
        add(m.group(1))

    # Ordinary long words
    for m in re.finditer(r'\b([a-zA-Z]{5,})\b', claim_text):
        add(m.group(1).lower())

    logger.debug("Keywords for claim: %s", tokens[:20])
    return tokens[:30]


# ── Snippet extraction ─────────────────────────────────────────────────────

def _extract_snippets(
    content: str,
    keywords: list[str],
    path: str,
    snippet_lines: int = SNIPPET_LINES,
) -> list[dict[str, Any]]:
    """
    Return line-numbered snippets from `content` where any keyword matches.
    Merges overlapping windows so adjacent hits produce one snippet.
    """
    lines = content.splitlines()
    kw_lower = [k.lower() for k in keywords if len(k) > 2]

    # Find all hit line indices
    hit_lines: list[int] = []
    for i, line in enumerate(lines):
        ll = line.lower()
        if any(kw in ll for kw in kw_lower):
            hit_lines.append(i)

    if not hit_lines:
        return []

    # Merge overlapping windows
    half_before = snippet_lines // 3
    half_after = snippet_lines - half_before

    windows: list[tuple[int, int]] = []
    current_start = max(0, hit_lines[0] - half_before)
    current_end = min(len(lines), hit_lines[0] + half_after)

    for hit in hit_lines[1:]:
        new_start = max(0, hit - half_before)
        new_end = min(len(lines), hit + half_after)
        if new_start <= current_end:
            # Overlapping — extend
            current_end = max(current_end, new_end)
        else:
            windows.append((current_start, current_end))
            current_start = new_start
            current_end = new_end
    windows.append((current_start, current_end))

    snippets: list[dict[str, Any]] = []
    for start, end in windows[:MAX_SNIPPETS_PER_CLAIM]:
        snippets.append({
            "path": path,
            "line_start": start + 1,   # 1-indexed for humans
            "line_end": end,
            "content": "\n".join(lines[start:end]),
        })

    return snippets


# ── Public API ─────────────────────────────────────────────────────────────

class RepoIndex:
    """
    Holds the indexed files for one repo. Created once per analysis job
    and passed to all claim-evidence calls so we never re-walk the disk.
    """

    def __init__(self, repo_root: Path):
        self.repo_root = repo_root
        self._files: list[dict[str, Any]] = index_repo(repo_root)
        self._file_paths: set[str] = {f["path"] for f in self._files}

    @property
    def file_paths(self) -> list[str]:
        return [f["path"] for f in self._files]

    def path_exists(self, path: str) -> bool:
        return path in self._file_paths

    def get_snippets_for_claim(self, claim_text: str) -> list[dict[str, Any]]:
        """
        Search all indexed files for snippets relevant to `claim_text`.

        Files are already sorted by priority (Python first), so we naturally
        surface source-code evidence before docs.
        """
        keywords = _claim_keywords(claim_text)
        all_snippets: list[dict[str, Any]] = []
        files_searched = 0
        files_with_hits = 0

        for f in self._files:
            files_searched += 1
            snippets = _extract_snippets(f["content"], keywords, f["path"])
            if snippets:
                files_with_hits += 1
                logger.debug(
                    "  HIT  %-50s  →  %d snippet(s)", f["path"], len(snippets)
                )
                all_snippets.extend(snippets)
            # Keep searching all files — don't break early — so we find
            # evidence across multiple source files (e.g. modeling.py AND
            # run_pretraining.py may both be relevant).

        logger.info(
            "Claim snippet search: searched %d files, hits in %d, %d snippet(s) total | claim: %.80s",
            files_searched, files_with_hits, len(all_snippets), claim_text,
        )

        # Return best snippets: source files first (already sorted by priority),
        # capped at MAX_SNIPPETS_PER_CLAIM
        return all_snippets[:MAX_SNIPPETS_PER_CLAIM]


async def clone_repo(repo_url: str) -> Path:
    """
    Shallow-clone the repo into a temp directory and return the root path.
    Caller is responsible for cleanup (shutil.rmtree).
    """
    if not re.match(r"^https://github\.com/[\w\-./]+$", repo_url):
        raise ValueError(f"Invalid GitHub URL: {repo_url!r}")

    tmp = Path(tempfile.mkdtemp(prefix="pt_repo_"))
    logger.info("Cloning %s → %s", repo_url, tmp)
    try:
        proc = await asyncio.create_subprocess_exec(
            "git", "clone", "--depth", "1", "--single-branch",
            repo_url, str(tmp),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await asyncio.wait_for(proc.communicate(), timeout=180)
        if proc.returncode != 0:
            err = stderr.decode(errors="replace")[:600]
            raise RuntimeError(f"git clone failed (exit {proc.returncode}): {err}")
        logger.info("Clone complete: %s", repo_url)
        return tmp
    except Exception:
        shutil.rmtree(tmp, ignore_errors=True)
        raise


# ── Legacy helpers kept for backward compatibility with main.py ────────────

def get_relevant_snippets(repo_root: Path, claim_text: str) -> list[dict[str, Any]]:
    """Thin wrapper used by legacy call sites. Prefer RepoIndex directly."""
    idx = RepoIndex(repo_root)
    return idx.get_snippets_for_claim(claim_text)


def list_repo_files(repo_root: Path) -> list[str]:
    """Return relative paths of all indexed files (legacy helper)."""
    idx = RepoIndex(repo_root)
    return idx.file_paths
