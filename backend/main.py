"""
PaperTrail — FastAPI backend
"""
from __future__ import annotations

import asyncio
import logging
import re
import shutil
import tempfile
import uuid
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from services.gemma_service import get_gemma_service, DEFAULT_MODEL
from services.pdf_service import extract_claims_from_pdf, extract_title
from services.github_service import clone_repo, RepoIndex

# ── App setup ──────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s | %(name)s | %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

app = FastAPI(title="PaperTrail API", version="1.1.0")

app.add_middleware(
    CORSMiddleware,
    # Accept requests from any localhost Vite port (5173, 5174, …)
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:5175",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
        "http://127.0.0.1:5175",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── In-memory job store ────────────────────────────────────────────────────
_jobs: dict[str, dict[str, Any]] = {}

STAGE_NAMES = [
    "Extracting research claims",
    "Indexing repository",
    "Retrieving code evidence",
    "Running Gemma 4 analysis",
    "Validating citations",
]


def _new_job(job_id: str) -> dict[str, Any]:
    return {
        "job_id": job_id,
        "stage": STAGE_NAMES[0],
        "stage_index": 0,
        "total_stages": len(STAGE_NAMES),
        "done": False,
        "error": None,
        "report": None,
        "log": [],          # human-readable progress lines surfaced to client
    }


def _advance(job: dict[str, Any], idx: int, detail: str = "") -> None:
    job["stage_index"] = idx
    job["stage"] = STAGE_NAMES[idx] if idx < len(STAGE_NAMES) else "Done"
    msg = f"[{idx+1}/{len(STAGE_NAMES)}] {job['stage']}"
    if detail:
        msg += f" — {detail}"
    job["log"].append(msg)
    logger.info(msg)


def _log(job: dict[str, Any], msg: str) -> None:
    job["log"].append(msg)
    logger.info(msg)


# ── Routes ─────────────────────────────────────────────────────────────────

@app.get("/")
async def root():
    return {
        "status": "ok",
        "service": "PaperTrail Backend API",
        "docs": "/docs",
        "health": "/api/health/ollama",
    }


@app.get("/api/health/ollama")
async def health_ollama():
    gemma = get_gemma_service()
    return await gemma.check_ollama()


@app.post("/api/analyse")
async def start_analysis(
    pdf: UploadFile = File(...),
    repo_url: str = Form(...),
):
    """Accept PDF + GitHub URL. Start async analysis job. Return job_id immediately."""
    clean_url = repo_url.strip()
    # Normalize github URL and check format
    clean_base = clean_url.rstrip("/").removesuffix(".git")
    if not re.match(r"^https://github\.com/[\w\-]+/[\w\-.]+$", clean_base):
        raise HTTPException(
            400,
            "Please provide a valid public GitHub repository URL (e.g. https://github.com/owner/repo)."
        )

    # Check content type and extension
    is_pdf = (
        pdf.content_type in ("application/pdf", "application/x-pdf")
        or (pdf.filename and pdf.filename.lower().endswith(".pdf"))
    )
    if not is_pdf:
        raise HTTPException(400, "Only PDF files are accepted.")

    content = await pdf.read()
    if not content or len(content) < 10:
        raise HTTPException(400, "The uploaded PDF file is empty or invalid.")

    job_id = str(uuid.uuid4())
    _jobs[job_id] = _new_job(job_id)

    tmp_dir = Path(tempfile.mkdtemp(prefix="pt_pdf_"))
    pdf_path = tmp_dir / "paper.pdf"
    with open(pdf_path, "wb") as f:
        f.write(content)

    asyncio.create_task(_run_analysis(job_id, pdf_path, tmp_dir, clean_url))
    return {"job_id": job_id}


@app.get("/api/analyse/{job_id}/status")
async def get_status(job_id: str):
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found.")
    return {
        "job_id": job_id,
        "stage": job["stage"],
        "stage_index": job["stage_index"],
        "total_stages": job["total_stages"],
        "done": job["done"],
        "error": job["error"],
        "log": job["log"],
    }


@app.get("/api/analyse/{job_id}/report")
async def get_report(job_id: str):
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found.")
    if not job["done"]:
        raise HTTPException(400, "Analysis is not complete yet.")
    if job["error"]:
        raise HTTPException(500, job["error"])
    return job["report"]


# ── Background analysis task ───────────────────────────────────────────────

async def _run_analysis(
    job_id: str,
    pdf_path: Path,
    pdf_tmp: Path,
    repo_url: str,
) -> None:
    job = _jobs[job_id]
    repo_root: Path | None = None

    try:
        gemma = get_gemma_service(DEFAULT_MODEL)

        # ── Stage 0: Extract claims ────────────────────────────────────────
        _advance(job, 0)
        paper_title = extract_title(pdf_path)
        _log(job, f"Paper title: {paper_title}")
        claims = await extract_claims_from_pdf(pdf_path, gemma)
        if not claims:
            raise RuntimeError("No research claims could be extracted from the PDF.")
        _log(job, f"Extracted {len(claims)} claims from PDF")

        # ── Stage 1: Index repository ──────────────────────────────────────
        _advance(job, 1, repo_url)
        repo_root = await clone_repo(repo_url)
        repo_index = RepoIndex(repo_root)
        all_paths = repo_index.file_paths
        py_paths = [p for p in all_paths if p.endswith(".py")]
        _log(job, f"Indexed {len(all_paths)} files ({len(py_paths)} Python source files)")
        if py_paths:
            _log(job, f"Python files: {', '.join(py_paths[:15])}" +
                 (" …" if len(py_paths) > 15 else ""))

        # ── Stage 2: Retrieve code evidence ────────────────────────────────
        _advance(job, 2, f"Searching repository for {len(claims)} claims")
        claim_snippets: list[tuple[dict[str, Any], list[dict[str, Any]]]] = []
        for claim in claims:
            snippets = repo_index.get_snippets_for_claim(claim["text"])
            claim_snippets.append((claim, snippets))
        _log(job, f"Retrieved candidate code snippets for {len(claims)} claims from {len(all_paths)} indexed files")

        # ── Stage 3: Running Gemma 4 analysis ──────────────────────────────
        _advance(job, 3, f"{len(claims)} claims to process with Gemma 4")
        raw_evidences: list[tuple[dict[str, Any], list[dict[str, Any]], dict[str, Any]]] = []

        for claim_num, (claim, snippets) in enumerate(claim_snippets, 1):
            _log(job, f"  [{claim_num}/{len(claims)}] Analysing: {claim['text'][:80]}…")

            if not snippets:
                _log(job, f"    → No code snippets found in {len(all_paths)} indexed files")
                evidence: dict[str, Any] = {
                    "claim_id": claim["id"],
                    "status": "missing",
                    "file_path": None,
                    "code_snippet": None,
                    "explanation": (
                        f"No relevant code was found in the {len(all_paths)} indexed files "
                        f"({len(py_paths)} Python source files inspected). "
                        "This may mean the claim relates to a training procedure not reflected "
                        "in the released code, or the keyword matching did not find a match."
                    ),
                    "limitations": (
                        "Evidence was not retrieved — this is different from evidence not existing. "
                        "Manual inspection of the repository may reveal relevant code."
                    ),
                }
            else:
                snippet_summary = ", ".join(
                    f"{s['path']}:L{s['line_start']}-{s['line_end']}" for s in snippets
                )
                _log(job, f"    → {len(snippets)} snippet(s) from: {snippet_summary}")
                try:
                    evidence = await gemma.analyse_claim(
                        claim_text=claim["text"],
                        claim_id=claim["id"],
                        file_snippets=snippets,
                    )
                    _log(job, f"    → Gemma verdict: {evidence.get('status', '?')}")
                except Exception as exc:
                    logger.warning("Claim %s Gemma analysis failed: %s", claim["id"], exc)
                    evidence = {
                        "claim_id": claim["id"],
                        "status": "ambiguous",
                        "file_path": None,
                        "code_snippet": None,
                        "explanation": (
                            f"Snippets were found ({len(snippets)} from {snippet_summary}) "
                            f"but Gemma analysis failed: {exc}"
                        ),
                        "limitations": "Retry may succeed if the model was temporarily unavailable.",
                    }

            raw_evidences.append((claim, snippets, evidence))
            # Yield to the event loop between claims
            await asyncio.sleep(0)

        # ── Stage 4: Validating citations ──────────────────────────────────
        _advance(job, 4, "Verifying citations, file paths and line numbers")
        results: list[dict[str, Any]] = []

        for claim, snippets, evidence in raw_evidences:
            # ── Step 1: Validate file path (reject hallucinated paths) ─────
            fp: Optional[str] = evidence.get("file_path") or None
            if fp and not repo_index.path_exists(fp):
                logger.warning("Hallucinated file path rejected: %s", fp)
                _log(job, f"    ⚠ Hallucinated path rejected: {fp}")
                evidence["file_path"] = None
                evidence["code_snippet"] = None
                if evidence.get("status") == "supported":
                    evidence["status"] = "ambiguous"
                evidence["limitations"] = (
                    (evidence.get("limitations") or "")
                    + " (File path returned by model could not be verified in the repository.)"
                )
                fp = None

            # ── Step 2: Derive line numbers from actual file content ───────
            # Gemma is NOT trusted to emit line numbers — it counts relative to
            # the snippet window it was shown, not the whole file.
            # We locate the verbatim code_snippet in the actual indexed file
            # to get authoritative 1-indexed line numbers.
            code_snippet: Optional[str] = evidence.get("code_snippet") or None
            line_start: Optional[int] = None
            line_end: Optional[int] = None

            if fp and code_snippet:
                located = repo_index.locate_snippet(fp, code_snippet)
                if located:
                    line_start, line_end = located
                    _log(job, f"    ✓ Validated citation: {fp} L{line_start}–{line_end}")
                else:
                    _log(job, f"    ⚠ code_snippet not found verbatim in {fp} — line numbers unavailable")
                    logger.warning(
                        "code_snippet for claim %s not found verbatim in %s — possibly paraphrased",
                        claim["id"], fp,
                    )
                    # Keep the snippet visible but downgrade confidence
                    if evidence.get("status") == "supported":
                        evidence["status"] = "ambiguous"
                    evidence["limitations"] = (
                        (evidence.get("limitations") or "")
                        + " (Exact code excerpt could not be located in the file;"
                        " line numbers are unavailable.)"
                    )

            results.append({
                "claim": claim,
                "status": evidence.get("status", "missing"),
                "file_path": fp,
                "line_start": line_start,
                "line_end": line_end,
                "code_snippet": code_snippet,
                "explanation": evidence.get("explanation", ""),
                "limitations": evidence.get("limitations", ""),
            })

        # ── Stage 4: Build report ──────────────────────────────────────────
        _advance(job, 4)
        supported = sum(1 for r in results if r["status"] == "supported")
        ambiguous = sum(1 for r in results if r["status"] == "ambiguous")
        missing   = sum(1 for r in results if r["status"] == "missing")

        _log(job, f"Report: {supported} supported, {ambiguous} ambiguous, {missing} missing")

        import datetime
        job["report"] = {
            "id": job_id,
            "paper_title": paper_title,
            "repo_url": repo_url,
            "created_at": datetime.datetime.utcnow().isoformat() + "Z",
            "model_used": gemma.model,
            "default_branch": repo_index.default_branch,
            "repo_files_indexed": len(all_paths),
            "repo_python_files": len(py_paths),
            "results": results,
            "summary": {
                "total_claims": len(results),
                "supported": supported,
                "ambiguous": ambiguous,
                "missing": missing,
            },
        }
        job["done"] = True
        logger.info("Job %s complete: %d claims analysed", job_id, len(results))

    except Exception as exc:
        logger.error("Job %s failed: %s", job_id, exc, exc_info=True)
        job["error"] = str(exc)
        job["done"] = True
    finally:
        shutil.rmtree(pdf_tmp, ignore_errors=True)
        if repo_root:
            shutil.rmtree(repo_root, ignore_errors=True)
