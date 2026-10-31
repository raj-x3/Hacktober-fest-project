"""
PaperTrail — FastAPI backend
"""
from __future__ import annotations

import asyncio
import logging
import shutil
import tempfile
import uuid
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from services.gemma_service import get_gemma_service, DEFAULT_MODEL
from services.pdf_service import extract_claims_from_pdf
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
    "Cloning repository",
    "Indexing source files",
    "Connecting claims to evidence",
    "Generating the report",
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
    if pdf.content_type != "application/pdf":
        raise HTTPException(400, "Only PDF files are accepted.")
    if not repo_url.startswith("https://github.com/"):
        raise HTTPException(400, "Only public GitHub URLs are accepted.")

    job_id = str(uuid.uuid4())
    _jobs[job_id] = _new_job(job_id)

    tmp_dir = Path(tempfile.mkdtemp(prefix="pt_pdf_"))
    pdf_path = tmp_dir / "paper.pdf"
    with open(pdf_path, "wb") as f:
        content = await pdf.read()
        f.write(content)

    asyncio.create_task(_run_analysis(job_id, pdf_path, tmp_dir, repo_url))
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
        claims = await extract_claims_from_pdf(pdf_path, gemma)
        if not claims:
            raise RuntimeError("No research claims could be extracted from the PDF.")
        _log(job, f"Extracted {len(claims)} claims from PDF")

        # ── Stage 1: Clone repo ────────────────────────────────────────────
        _advance(job, 1, repo_url)
        repo_root = await clone_repo(repo_url)

        # ── Stage 2: Index files ───────────────────────────────────────────
        _advance(job, 2)
        # Build index ONCE — reused for every claim below
        repo_index = RepoIndex(repo_root)
        all_paths = repo_index.file_paths
        py_paths = [p for p in all_paths if p.endswith(".py")]
        _log(job, f"Indexed {len(all_paths)} files ({len(py_paths)} Python source files)")
        if py_paths:
            _log(job, f"Python files: {', '.join(py_paths[:15])}" +
                 (" …" if len(py_paths) > 15 else ""))

        # ── Stage 3: Connect claims → evidence ────────────────────────────
        _advance(job, 3, f"{len(claims)} claims to process")
        results: list[dict[str, Any]] = []

        for claim_num, claim in enumerate(claims, 1):
            _log(job, f"  [{claim_num}/{len(claims)}] Analysing: {claim['text'][:80]}…")

            # Retrieve snippets from the SHARED index (no repeated disk walks)
            snippets = repo_index.get_snippets_for_claim(claim["text"])

            if not snippets:
                _log(job, f"    → No code snippets found in {len(all_paths)} indexed files")
                evidence = {
                    "claim_id": claim["id"],
                    "status": "missing",
                    "file_path": None,
                    "line_start": None,
                    "line_end": None,
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
                        "line_start": None,
                        "line_end": None,
                        "code_snippet": None,
                        "explanation": (
                            f"Snippets were found ({len(snippets)} from {snippet_summary}) "
                            f"but Gemma analysis failed: {exc}"
                        ),
                        "limitations": "Retry may succeed if the model was temporarily unavailable.",
                    }

            # Validate: reject invented file paths
            fp = evidence.get("file_path")
            if fp and not repo_index.path_exists(fp):
                logger.warning("Hallucinated file path rejected: %s", fp)
                _log(job, f"    ⚠ Hallucinated path rejected: {fp}")
                evidence["file_path"] = None
                evidence["line_start"] = None
                evidence["line_end"] = None
                evidence["code_snippet"] = None
                if evidence.get("status") == "supported":
                    evidence["status"] = "ambiguous"
                evidence["limitations"] = (
                    (evidence.get("limitations") or "") +
                    " (File path returned by model could not be verified in the repository.)"
                )

            results.append({
                "claim": claim,
                "status": evidence.get("status", "missing"),
                "file_path": evidence.get("file_path"),
                "line_start": evidence.get("line_start"),
                "line_end": evidence.get("line_end"),
                "code_snippet": evidence.get("code_snippet"),
                "explanation": evidence.get("explanation", ""),
                "limitations": evidence.get("limitations", ""),
            })

            # Yield to the event loop between claims
            await asyncio.sleep(0)

        # ── Stage 4: Build report ──────────────────────────────────────────
        _advance(job, 4)
        supported = sum(1 for r in results if r["status"] == "supported")
        ambiguous = sum(1 for r in results if r["status"] == "ambiguous")
        missing   = sum(1 for r in results if r["status"] == "missing")

        _log(job, f"Report: {supported} supported, {ambiguous} ambiguous, {missing} missing")

        import datetime
        job["report"] = {
            "id": job_id,
            "paper_title": pdf_path.parent.name or "Unknown paper",
            "repo_url": repo_url,
            "created_at": datetime.datetime.utcnow().isoformat() + "Z",
            "model_used": gemma.model,
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
