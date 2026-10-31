"""
PaperTrail — Gemma 4 service (Ollama API)
Handles all communication with the locally-running Ollama server.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any, Optional

import httpx

OLLAMA_BASE = "http://localhost:11434"
DEFAULT_MODEL = "gemma4:e4b"
ALT_MODEL = "gemma4:e2b"

logger = logging.getLogger(__name__)


class OllamaUnavailableError(RuntimeError):
    pass


class ModelNotFoundError(RuntimeError):
    pass


class GemmaService:
    def __init__(self, model: str = DEFAULT_MODEL, timeout: float = 300.0):
        self.model = model
        self.timeout = timeout

    # ── Health checks ──────────────────────────────────────────────────────

    async def check_ollama(self) -> dict[str, Any]:
        """Return running/model_available status without raising."""
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                r = await client.get(f"{OLLAMA_BASE}/api/tags")
                r.raise_for_status()
                tags = r.json()
                model_names = [m["name"] for m in tags.get("models", [])]
                return {
                    "running": True,
                    "model": self.model,
                    "model_available": self.model in model_names,
                }
        except httpx.ConnectError:
            return {"running": False, "model": self.model, "model_available": False,
                    "error": "Ollama is not running. Start it with: ollama serve"}
        except Exception as exc:
            return {"running": False, "model": self.model, "model_available": False,
                    "error": str(exc)}

    async def assert_ready(self) -> None:
        status = await self.check_ollama()
        if not status["running"]:
            raise OllamaUnavailableError(status.get("error", "Ollama is not running."))
        if not status["model_available"]:
            raise ModelNotFoundError(
                f"Model '{self.model}' is not installed. "
                f"Run: ollama pull {self.model}"
            )

    # ── Core generation ───────────────────────────────────────────────────

    async def generate(self, prompt: str, system: str = "") -> str:
        """Send a prompt to Ollama and return the full response text."""
        await self.assert_ready()
        payload: dict[str, Any] = {
            "model": self.model,
            "prompt": prompt,
            "stream": False,
            "options": {
                "temperature": 0.1,
                "top_p": 0.9,
                "num_predict": 4096,
            },
        }
        if system:
            payload["system"] = system

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            try:
                r = await client.post(f"{OLLAMA_BASE}/api/generate", json=payload)
                r.raise_for_status()
                data = r.json()
                return data.get("response", "").strip()
            except httpx.ReadTimeout:
                raise RuntimeError("Gemma timed out. Try the gemma4:e2b model.")
            except httpx.HTTPStatusError as exc:
                raise RuntimeError(f"Ollama API error: {exc.response.text}") from exc

    # ── Structured JSON generation ─────────────────────────────────────────

    async def generate_json(self, prompt: str, system: str = "") -> Any:
        """Generate and parse JSON from Gemma. Raises on invalid JSON."""
        raw = await self.generate(prompt, system)
        # Strip markdown fences if present
        raw = re.sub(r"^```(?:json)?\s*", "", raw.strip())
        raw = re.sub(r"\s*```$", "", raw.strip())
        try:
            return json.loads(raw, strict=False)
        except json.JSONDecodeError:
            pass

        # If model returned text around the JSON object, extract the JSON portion
        match = re.search(r"(\{[\s\S]*\}|\[[\s\S]*\])", raw)
        if match:
            try:
                return json.loads(match.group(1), strict=False)
            except json.JSONDecodeError:
                pass

        logger.error("Gemma returned non-JSON: %s", raw[:400])
        raise ValueError(f"Gemma returned invalid JSON: {raw[:200]}")

    # ── PaperTrail analysis prompt ─────────────────────────────────────────

    SYSTEM_PROMPT = (
        "You are a precise research-to-code traceability assistant. "
        "Your task is to map research claims to code evidence found in the provided repository files. "
        "You MUST only reference file paths and line numbers that are explicitly provided to you. "
        "You MUST NOT invent file names, code lines, or experiment results. "
        "Distinguish between code that implements a method and proof that an experiment succeeded. "
        "Return ONLY valid JSON. Do not add explanation outside the JSON."
    )

    async def analyse_claim(
        self,
        claim_text: str,
        claim_id: str,
        file_snippets: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """
        Map a single research claim to evidence in the provided file snippets.

        file_snippets: [{"path": str, "line_start": int, "line_end": int, "content": str}]

        Returns a dict with status, file_path, code_snippet, explanation, limitations.

        IMPORTANT: Gemma does NOT return line numbers.  Line numbers are derived
        by the backend by locating Gemma's code_snippet verbatim in the actual file.
        This prevents off-by-one errors caused by Gemma counting lines relative to
        the snippet window rather than the whole file.
        """
        snippets_block = ""
        for s in file_snippets:
            snippets_block += (
                f"\n--- FILE: {s['path']} (lines {s['line_start']}–{s['line_end']}) ---\n"
                f"{s['content']}\n"
            )

        provided_paths = "\n".join(
            f"  - {s['path']} (lines {s['line_start']}–{s['line_end']})"
            for s in file_snippets
        )

        prompt = f"""
Research claim (from a machine-learning paper):
"{claim_text}"

The following {len(file_snippets)} file snippet(s) were retrieved from the GitHub repository.
These are the ONLY files you may reference. Do not invent or assume any other files exist.

Files provided:
{provided_paths}

Full content of each snippet:
{snippets_block}

Return a JSON object with exactly these fields:
{{
  "claim_id": "{claim_id}",
  "status": "supported" | "ambiguous" | "missing",
  "file_path": "<exact path from the list above, or null>",
  "code_snippet": "<copy the single most relevant block of code VERBATIM from the provided content, preserving exact indentation and line breaks, or null if not applicable>",
  "explanation": "<2-4 sentences: how does this code implement or relate to the research claim? Name specific functions, classes or parameters you found.>",
  "limitations": "<1-2 sentences: what cannot be verified from this code alone?>"
}}

Strict rules:
- "supported": clear implementation code for the claim exists in the provided snippets.
- "ambiguous": code exists but only partially supports the claim, or the connection is indirect.
- "missing": no relevant code was found in the provided snippets.
- code_snippet must be COPIED VERBATIM from the provided content. Do NOT paraphrase, summarise or invent it.
- file_path must be exactly one of the paths listed above, or null.
- Do NOT include line_start or line_end — the system derives line numbers from your code_snippet automatically.
- Do NOT assert that paper experiments were reproduced or that numerical results match.
- If the snippets show only documentation (README, release notes), set status to "missing" unless
  the documentation explicitly describes a verifiable implementation detail with code.
"""
        try:
            result = await self.generate_json(prompt, self.SYSTEM_PROMPT)
            if not isinstance(result, dict):
                raise ValueError(f"Expected dict, got {type(result)}")
            # Strip any line numbers Gemma may have hallucinated despite instructions
            result.pop("line_start", None)
            result.pop("line_end", None)
            return result
        except (ValueError, json.JSONDecodeError) as exc:
            logger.warning("JSON parse failed for claim %s: %s", claim_id, exc)
            raise


# ── Module-level singleton ────────────────────────────────────────────────
_service: Optional[GemmaService] = None


def get_gemma_service(model: str = DEFAULT_MODEL) -> GemmaService:
    global _service
    if _service is None or _service.model != model:
        _service = GemmaService(model=model)
    return _service
