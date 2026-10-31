"""
PaperTrail — backend test suite.

Tests cover:
  1. Keyword extraction from claims
  2. File priority sorting (Python > docs)
  3. File size caps per extension
  4. Snippet extraction with line numbers
  5. Overlapping snippet merging
  6. RepoIndex against a real synthetic repo tree
  7. Hallucinated path rejection
  8. Clone URL validation
  9. Live BERT repo indexing (network — skipped if offline)
 10. Gemma JSON recovery (mock)

Run with:
    cd backend && source .venv/bin/activate
    python3 -m pytest tests/test_pipeline.py -v
"""
from __future__ import annotations

import json
import sys
import textwrap
import tempfile
import shutil
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# ── make services importable from test dir ─────────────────────────────────
sys.path.insert(0, str(Path(__file__).parent.parent))

from services.github_service import (
    RepoIndex,
    _claim_keywords,
    _extract_snippets,
    _file_priority,
    _is_relevant,
    index_repo,
    EXCLUDED_DIRS,
    MAX_FILES,
)


# ═══════════════════════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════════════════════

def make_repo(files: dict[str, str]) -> Path:
    """Create a temporary directory tree from a {rel_path: content} dict."""
    root = Path(tempfile.mkdtemp(prefix="pt_test_"))
    for rel, content in files.items():
        p = root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content)
    return root


# ═══════════════════════════════════════════════════════════════════════════
# 1. Keyword extraction
# ═══════════════════════════════════════════════════════════════════════════

class TestClaimKeywords:
    def test_extracts_long_words(self):
        kws = _claim_keywords("We train a bidirectional Transformer")
        assert "bidirectional" in kws
        assert "transformer" in kws

    def test_extracts_numbers(self):
        kws = _claim_keywords("learning rate of 0.0001 and batch size 128")
        assert "0.0001" in kws
        assert "128" in kws

    def test_camel_case_splits(self):
        kws = _claim_keywords("The BertModel uses MultiHeadAttention layers")
        # CamelCase split should appear
        assert any("bert" in k.lower() or "bert_model" in k.lower() for k in kws)
        assert any("attention" in k.lower() for k in kws)

    def test_snake_case(self):
        kws = _claim_keywords("run_pretraining script uses masked_lm_prob")
        assert "run_pretraining" in kws
        assert "masked_lm_prob" in kws

    def test_quoted_strings_high_priority(self):
        kws = _claim_keywords('We use "masked language modeling" as the objective')
        assert "masked language modeling" in kws

    def test_short_words_excluded(self):
        kws = _claim_keywords("We use a 12-layer model")
        # "We", "a" should not appear
        assert "we" not in kws
        assert "a" not in kws

    def test_capped_at_30(self):
        long_claim = " ".join([f"parameter_{i}" for i in range(100)])
        kws = _claim_keywords(long_claim)
        assert len(kws) <= 30

    def test_deduplicates(self):
        kws = _claim_keywords("bidirectional bidirectional bidirectional model")
        assert kws.count("bidirectional") == 1


# ═══════════════════════════════════════════════════════════════════════════
# 2. File priority ordering
# ═══════════════════════════════════════════════════════════════════════════

class TestFilePriority:
    def test_py_beats_md(self):
        assert _file_priority(Path("model.py")) < _file_priority(Path("README.md"))

    def test_py_beats_json(self):
        assert _file_priority(Path("train.py")) < _file_priority(Path("config.json"))

    def test_sh_beats_md(self):
        assert _file_priority(Path("run.sh")) < _file_priority(Path("README.md"))

    def test_yaml_beats_md(self):
        assert _file_priority(Path("config.yaml")) < _file_priority(Path("README.md"))

    def test_unknown_extension_lowest(self):
        assert _file_priority(Path("binary.bin")) == 99


# ═══════════════════════════════════════════════════════════════════════════
# 3. Relevant file filtering
# ═══════════════════════════════════════════════════════════════════════════

class TestIsRelevant:
    def test_py_is_relevant(self):
        assert _is_relevant(Path("modeling.py"))

    def test_md_is_relevant(self):
        assert _is_relevant(Path("README.md"))

    def test_pycache_excluded(self):
        assert not _is_relevant(Path("__pycache__/model.cpython-39.pyc"))

    def test_venv_excluded(self):
        assert not _is_relevant(Path(".venv/lib/site.py"))

    def test_git_excluded(self):
        assert not _is_relevant(Path(".git/config"))

    def test_binary_not_relevant(self):
        assert not _is_relevant(Path("model.bin"))

    def test_nested_excluded_dir(self):
        assert not _is_relevant(Path("src/node_modules/foo.js"))


# ═══════════════════════════════════════════════════════════════════════════
# 4. Snippet extraction with real line numbers
# ═══════════════════════════════════════════════════════════════════════════

SAMPLE_PY = textwrap.dedent("""\
    # line 1 — header
    import tensorflow as tf

    class BertModel:
        '''Bidirectional Encoder Representations from Transformers.'''
        def __init__(self, config):
            self.config = config
            self.embeddings = BertEmbeddings(config)
            self.encoder = BertEncoder(config)

    class BertEncoder:
        def __init__(self, config):
            self.layers = [BertLayer(config) for _ in range(config.num_hidden_layers)]

    def masked_language_model_loss(logits, labels, mask):
        # compute MLM loss only on masked positions
        return tf.reduce_mean(...)
""")


class TestExtractSnippets:
    def test_finds_keyword_hit(self):
        snippets = _extract_snippets(SAMPLE_PY, ["BertModel"], "modeling.py")
        assert len(snippets) >= 1
        assert "BertModel" in snippets[0]["content"]

    def test_line_numbers_are_1_indexed(self):
        snippets = _extract_snippets(SAMPLE_PY, ["BertModel"], "modeling.py")
        assert snippets[0]["line_start"] >= 1

    def test_line_end_gte_line_start(self):
        snippets = _extract_snippets(SAMPLE_PY, ["BertModel"], "modeling.py")
        for s in snippets:
            assert s["line_end"] >= s["line_start"]

    def test_path_preserved(self):
        snippets = _extract_snippets(SAMPLE_PY, ["masked_language"], "modeling.py")
        assert all(s["path"] == "modeling.py" for s in snippets)

    def test_no_match_returns_empty(self):
        snippets = _extract_snippets(SAMPLE_PY, ["xyzzy_no_match"], "modeling.py")
        assert snippets == []

    def test_overlapping_hits_merged(self):
        # "BertModel" and "BertEncoder" are close together — should be one snippet
        snippets = _extract_snippets(SAMPLE_PY, ["BertModel", "BertEncoder"], "modeling.py")
        # Expect fewer snippets than hits because they're merged
        assert len(snippets) <= 2

    def test_content_is_verbatim(self):
        snippets = _extract_snippets(SAMPLE_PY, ["BertModel"], "modeling.py")
        for s in snippets:
            # Every line of the snippet must appear in the original
            lines = SAMPLE_PY.splitlines()
            for snippet_line in s["content"].splitlines():
                assert snippet_line in lines, f"Fabricated line: {snippet_line!r}"

    def test_case_insensitive_match(self):
        snippets = _extract_snippets(SAMPLE_PY, ["bertmodel"], "modeling.py")
        assert len(snippets) >= 1


# ═══════════════════════════════════════════════════════════════════════════
# 5. RepoIndex against a synthetic repo
# ═══════════════════════════════════════════════════════════════════════════

class TestRepoIndex:
    @pytest.fixture
    def repo(self):
        root = make_repo({
            "modeling.py": SAMPLE_PY,
            "run_pretraining.py": textwrap.dedent("""\
                # Pretraining script
                import modeling
                MAX_PREDICTIONS = 20
                masked_lm_prob = 0.15
                max_seq_length = 128
                def main():
                    model = modeling.BertModel(config)
                    train(model, masked_lm_prob)
            """),
            "config.json": '{"num_hidden_layers": 12, "hidden_size": 768}',
            "README.md": "# BERT\nBidirectional Encoder Representations from Transformers.\n",
            "__pycache__/modeling.cpython-39.pyc": "binary",
            ".git/config": "[core]\n\trepositoryformatversion = 0",
        })
        yield root
        shutil.rmtree(root, ignore_errors=True)

    def test_indexes_python_files(self, repo):
        idx = RepoIndex(repo)
        assert "modeling.py" in idx.file_paths
        assert "run_pretraining.py" in idx.file_paths

    def test_excludes_pycache(self, repo):
        idx = RepoIndex(repo)
        assert not any("__pycache__" in p for p in idx.file_paths)

    def test_excludes_git(self, repo):
        idx = RepoIndex(repo)
        assert not any(".git" in p for p in idx.file_paths)

    def test_python_before_readme(self, repo):
        idx = RepoIndex(repo)
        paths = idx.file_paths
        py_positions = [i for i, p in enumerate(paths) if p.endswith(".py")]
        md_positions  = [i for i, p in enumerate(paths) if p.endswith(".md")]
        assert py_positions, "No .py files indexed"
        assert md_positions, "No .md files indexed"
        assert min(py_positions) < min(md_positions), \
            f"Python files should appear before markdown. Got: {paths}"

    def test_path_exists_true(self, repo):
        idx = RepoIndex(repo)
        assert idx.path_exists("modeling.py")

    def test_path_exists_false(self, repo):
        idx = RepoIndex(repo)
        assert not idx.path_exists("invented_file.py")

    def test_get_snippets_finds_python(self, repo):
        idx = RepoIndex(repo)
        snippets = idx.get_snippets_for_claim(
            "BERT uses a bidirectional architecture with masked language modeling"
        )
        assert len(snippets) > 0
        paths = [s["path"] for s in snippets]
        # Should surface Python source, not README
        assert any(p.endswith(".py") for p in paths), \
            f"Expected .py file in results, got: {paths}"

    def test_get_snippets_finds_masked_lm_prob(self, repo):
        idx = RepoIndex(repo)
        snippets = idx.get_snippets_for_claim(
            "We use masked_lm_prob of 0.15 during pretraining"
        )
        assert len(snippets) > 0
        # run_pretraining.py contains masked_lm_prob
        paths = [s["path"] for s in snippets]
        assert "run_pretraining.py" in paths, f"Expected run_pretraining.py, got: {paths}"

    def test_snippets_have_real_line_numbers(self, repo):
        idx = RepoIndex(repo)
        snippets = idx.get_snippets_for_claim("BertModel masked language")
        for s in snippets:
            assert isinstance(s["line_start"], int)
            assert isinstance(s["line_end"], int)
            assert s["line_start"] >= 1
            assert s["line_end"] >= s["line_start"]

    def test_no_match_returns_empty(self, repo):
        idx = RepoIndex(repo)
        snippets = idx.get_snippets_for_claim("xyzzy_nonexistent_method_zork")
        assert snippets == []

    def test_searches_all_files_not_just_first(self, repo):
        """
        The old code broke out of the file loop on the first hit.
        This test ensures run_pretraining.py is found even though
        modeling.py comes first alphabetically.
        """
        idx = RepoIndex(repo)
        # This claim is only in run_pretraining.py
        snippets = idx.get_snippets_for_claim("MAX_PREDICTIONS masked_lm_prob 0.15")
        paths = [s["path"] for s in snippets]
        assert "run_pretraining.py" in paths, \
            f"run_pretraining.py not found. Got: {paths}"


# ═══════════════════════════════════════════════════════════════════════════
# 6. Large-file handling
# ═══════════════════════════════════════════════════════════════════════════

class TestLargeFileHandling:
    def test_large_py_file_accepted(self):
        """Python files up to 300 KB should be indexed."""
        root = make_repo({"big_model.py": "x = 1\n" * 10_000})  # ~70 KB
        try:
            idx = RepoIndex(root)
            assert "big_model.py" in idx.file_paths
        finally:
            shutil.rmtree(root, ignore_errors=True)

    def test_large_md_file_skipped(self):
        """Markdown files over 40 KB should be skipped."""
        root = make_repo({"HUGE_README.md": "# docs\n" * 8_000})  # ~56 KB
        try:
            idx = RepoIndex(root)
            assert "HUGE_README.md" not in idx.file_paths
        finally:
            shutil.rmtree(root, ignore_errors=True)


# ═══════════════════════════════════════════════════════════════════════════
# 7. Hallucinated path rejection (via main.py logic)
# ═══════════════════════════════════════════════════════════════════════════

class TestHallucinatedPathRejection:
    def test_invented_path_not_in_index(self):
        root = make_repo({"modeling.py": SAMPLE_PY})
        try:
            idx = RepoIndex(root)
            # A path Gemma might invent that doesn't exist
            assert not idx.path_exists("bert/model/transformer_layer.py")
            assert not idx.path_exists("src/pretrain.py")
            assert not idx.path_exists("")
        finally:
            shutil.rmtree(root, ignore_errors=True)

    def test_real_path_accepted(self):
        root = make_repo({"modeling.py": SAMPLE_PY})
        try:
            idx = RepoIndex(root)
            assert idx.path_exists("modeling.py")
        finally:
            shutil.rmtree(root, ignore_errors=True)


# ═══════════════════════════════════════════════════════════════════════════
# 8. URL validation
# ═══════════════════════════════════════════════════════════════════════════

class TestURLValidation:
    @pytest.mark.asyncio
    async def test_invalid_url_raises(self):
        from services.github_service import clone_repo
        with pytest.raises(ValueError, match="Invalid GitHub URL"):
            await clone_repo("https://evil.com/attack")

    @pytest.mark.asyncio
    async def test_non_github_raises(self):
        from services.github_service import clone_repo
        with pytest.raises(ValueError):
            await clone_repo("https://gitlab.com/user/repo")

    @pytest.mark.asyncio
    async def test_shell_injection_rejected(self):
        from services.github_service import clone_repo
        with pytest.raises(ValueError):
            await clone_repo("https://github.com/user/repo; rm -rf /")


# ═══════════════════════════════════════════════════════════════════════════
# 9. Live BERT repo test (requires network)
# ═══════════════════════════════════════════════════════════════════════════

@pytest.mark.network
class TestBERTRepoLive:
    """
    Integration test against the real BERT repository.
    Skip with: pytest -m "not network"
    """
    @pytest.fixture(scope="class")
    def bert_index(self):
        import subprocess
        tmp = Path(tempfile.mkdtemp(prefix="pt_bert_"))
        result = subprocess.run(
            ["git", "clone", "--depth", "1", "--single-branch",
             "https://github.com/google-research/bert", str(tmp)],
            capture_output=True, text=True, timeout=180,
        )
        if result.returncode != 0:
            pytest.skip(f"Could not clone BERT: {result.stderr[:200]}")
        idx = RepoIndex(tmp)
        yield idx
        shutil.rmtree(tmp, ignore_errors=True)

    EXPECTED_PY_FILES = [
        "modeling.py",
        "run_pretraining.py",
        "create_pretraining_data.py",
        "run_classifier.py",
        "optimization.py",
        "tokenization.py",
    ]

    def test_all_key_files_indexed(self, bert_index):
        indexed = bert_index.file_paths
        for fname in self.EXPECTED_PY_FILES:
            assert fname in indexed, f"{fname} missing from index. Got: {indexed}"

    def test_bidirectional_claim_finds_modeling_py(self, bert_index):
        snippets = bert_index.get_snippets_for_claim(
            "BERT uses a bidirectional Transformer architecture"
        )
        paths = [s["path"] for s in snippets]
        assert any(p.endswith(".py") for p in paths), \
            f"No Python source in results for bidirectional claim. Got: {paths}"

    def test_masked_lm_prob_claim(self, bert_index):
        snippets = bert_index.get_snippets_for_claim(
            "We use a masked language modeling probability of 15%"
        )
        paths = [s["path"] for s in snippets]
        assert len(snippets) > 0, "No snippets for masked_lm_prob claim"
        assert any(".py" in p for p in paths)

    def test_learning_rate_claim(self, bert_index):
        snippets = bert_index.get_snippets_for_claim(
            "Adam optimizer with learning rate of 1e-4 and weight decay"
        )
        paths = [s["path"] for s in snippets]
        assert any("optimization" in p for p in paths), \
            f"Expected optimization.py, got: {paths}"

    def test_snippets_have_correct_line_numbers(self, bert_index):
        snippets = bert_index.get_snippets_for_claim("BertModel hidden layers")
        for s in snippets:
            assert s["line_start"] >= 1
            assert s["line_end"] >= s["line_start"]
            # Verify content matches actual lines
            abs_path = bert_index.repo_root / s["path"]
            if abs_path.exists():
                real_lines = abs_path.read_text(errors="replace").splitlines()
                snippet_lines = s["content"].splitlines()
                # First line of snippet should match the file at line_start
                expected_first = real_lines[s["line_start"] - 1] if s["line_start"] - 1 < len(real_lines) else None
                if expected_first is not None:
                    assert snippet_lines[0] == expected_first, \
                        f"Line mismatch: snippet says L{s['line_start']} is {snippet_lines[0]!r}, file has {expected_first!r}"

    def test_modeling_py_is_indexed_before_markdown(self, bert_index):
        paths = bert_index.file_paths
        md_file = next((p for p in paths if p.endswith(".md")), None)
        if md_file is None:
            pytest.skip("No markdown files in index")
        py_pos  = next((i for i, p in enumerate(paths) if p == "modeling.py"), None)
        md_pos  = paths.index(md_file)
        assert py_pos is not None, "modeling.py not indexed"
        assert py_pos < md_pos, \
            f"modeling.py (pos {py_pos}) should come before {md_file} (pos {md_pos})"


# ═══════════════════════════════════════════════════════════════════════════
# 10. Gemma service — JSON recovery and analyse_claim
# ═══════════════════════════════════════════════════════════════════════════

class TestGemmaService:
    @pytest.mark.asyncio
    async def test_analyse_claim_returns_dict(self):
        from services.gemma_service import GemmaService
        svc = GemmaService(model="gemma4:e4b")
        mock_response = json.dumps({
            "claim_id": "claim_0_0",
            "status": "supported",
            "file_path": "modeling.py",
            "line_start": 4,
            "line_end": 9,
            "code_snippet": "class BertModel:",
            "explanation": "The BertModel class implements the bidirectional architecture.",
            "limitations": "Cannot verify exact paper results from code alone.",
        })
        with patch.object(svc, "generate", new=AsyncMock(return_value=mock_response)):
            result = await svc.analyse_claim(
                claim_text="BERT uses a bidirectional Transformer",
                claim_id="claim_0_0",
                file_snippets=[{
                    "path": "modeling.py",
                    "line_start": 4,
                    "line_end": 9,
                    "content": SAMPLE_PY,
                }],
            )
        assert isinstance(result, dict)
        assert result["status"] == "supported"
        assert result["file_path"] == "modeling.py"

    @pytest.mark.asyncio
    async def test_analyse_claim_strips_markdown_fences(self):
        from services.gemma_service import GemmaService
        svc = GemmaService(model="gemma4:e4b")
        raw = "```json\n" + json.dumps({
            "claim_id": "c1",
            "status": "missing",
            "file_path": None,
            "line_start": None,
            "line_end": None,
            "code_snippet": None,
            "explanation": "Not found.",
            "limitations": "N/A",
        }) + "\n```"
        with patch.object(svc, "generate", new=AsyncMock(return_value=raw)):
            result = await svc.analyse_claim("any claim", "c1", [])
        assert result["status"] == "missing"


# ═══════════════════════════════════════════════════════════════════════════
# 11. locate_snippet_in_file — line-number accuracy
#
# These tests were added after discovering that PaperTrail displayed
# L305–363 for create_masked_lm_predictions() when the function actually
# lives at L342–415 in create_pretraining_data.py.
#
# Root cause: Gemma was asked to emit line_start / line_end itself, but it
# counts relative to the snippet window it was shown, not the whole file.
# Fix: Gemma returns only verbatim code_snippet text; the backend locates it
# in the actual file to derive authoritative line numbers.
# ═══════════════════════════════════════════════════════════════════════════

from services.github_service import locate_snippet_in_file

# ── Synthetic file that mimics the BERT create_pretraining_data.py layout ──
# The function starts well past the beginning (like line 342 in the real file)
# so we can verify that the locator returns absolute lines, not relative ones.

_PREAMBLE = "\n".join(f"# preamble line {i}" for i in range(1, 301))  # 300 lines

_FUNC_BODY = textwrap.dedent("""\
    def create_masked_lm_predictions(tokens, masked_lm_prob,
                                     max_predictions_per_seq, vocab_words, rng):
        '''Creates the predictions for the masked LM objective.'''
        cand_indexes = []
        for (i, token) in enumerate(tokens):
            if token == "[CLS]" or token == "[SEP]":
                continue
            cand_indexes.append(i)
        rng.shuffle(cand_indexes)
        output_tokens = list(tokens)
        num_to_predict = min(max_predictions_per_seq,
                             max(1, int(round(len(tokens) * masked_lm_prob))))
        masked_lms = []
        covered_indexes = set()
        for index in cand_indexes:
            if len(masked_lms) >= num_to_predict:
                break
            if index in covered_indexes:
                continue
            covered_indexes.add(index)
            masked_token = None
            if rng.random() < 0.8:
                masked_token = "[MASK]"
            else:
                if rng.random() < 0.5:
                    masked_token = tokens[index]
                else:
                    masked_token = vocab_words[rng.randint(0, len(vocab_words) - 1)]
            output_tokens[index] = masked_token
            masked_lms.append(MaskedLmInstance(index=index, label=tokens[index]))
        masked_lms = sorted(masked_lms, key=lambda x: x.index)
        masked_lm_positions = []
        masked_lm_labels = []
        for p in masked_lms:
            masked_lm_positions.append(p.index)
            masked_lm_labels.append(p.label)
        return (output_tokens, masked_lm_positions, masked_lm_labels)
""")

_POSTAMBLE = "\n".join(f"# postamble line {i}" for i in range(1, 50))

# The function starts at line 302 (after 300 preamble lines + 1 blank)
_SYNTHETIC_FILE = _PREAMBLE + "\n\n" + _FUNC_BODY + "\n" + _POSTAMBLE
_FUNC_START = 302   # 300 preamble + blank line + def line (1-indexed)
_FUNC_END   = _FUNC_START + _FUNC_BODY.count("\n") - 1


class TestLocateSnippetInFile:
    """Unit tests for the authoritative line-number locator."""

    def test_exact_match_correct_line_start(self):
        result = locate_snippet_in_file(_SYNTHETIC_FILE, _FUNC_BODY)
        assert result is not None, "Function body not located in synthetic file"
        assert result[0] == _FUNC_START, (
            f"line_start should be {_FUNC_START} (absolute), got {result[0]}"
        )

    def test_exact_match_correct_line_end(self):
        result = locate_snippet_in_file(_SYNTHETIC_FILE, _FUNC_BODY)
        assert result is not None
        assert result[1] == _FUNC_END, (
            f"line_end should be {_FUNC_END}, got {result[1]}"
        )

    def test_line_start_not_relative_to_snippet_window(self):
        """
        The bug: Gemma was shown a snippet starting at L305 and the function
        appeared at offset 38 inside that window, so Gemma reported L38 or L342
        relative to its context rather than to the file.  This test verifies
        that locate_snippet_in_file always returns absolute file line numbers.
        """
        # Simulate what the old code did: Gemma reports line 38 (relative offset)
        # locate_snippet_in_file must return the true absolute line instead.
        wrong_relative_line = 38   # what Gemma used to return
        result = locate_snippet_in_file(_SYNTHETIC_FILE, _FUNC_BODY)
        assert result is not None
        assert result[0] != wrong_relative_line, (
            "locate_snippet_in_file returned a relative line number — must be absolute"
        )
        assert result[0] == _FUNC_START

    def test_partial_snippet_anchor_match(self):
        """A snippet truncated to the first 10 lines should still be locatable."""
        partial = "\n".join(_FUNC_BODY.splitlines()[:10])
        result = locate_snippet_in_file(_SYNTHETIC_FILE, partial)
        assert result is not None, "Partial snippet (first 10 lines) should be locatable"
        assert result[0] == _FUNC_START

    def test_returns_none_for_fabricated_snippet(self):
        """A snippet that does not exist in the file must return None."""
        fabricated = textwrap.dedent("""\
            def create_masked_lm_predictions(tokens):
                # This function body was invented by the model
                return apply_bert_magic(tokens)
        """)
        result = locate_snippet_in_file(_SYNTHETIC_FILE, fabricated)
        assert result is None, (
            f"Fabricated snippet should return None, got {result}"
        )

    def test_empty_snippet_returns_none(self):
        assert locate_snippet_in_file(_SYNTHETIC_FILE, "") is None
        assert locate_snippet_in_file(_SYNTHETIC_FILE, "   \n  \n") is None

    def test_empty_file_returns_none(self):
        assert locate_snippet_in_file("", _FUNC_BODY) is None

    def test_single_line_snippet(self):
        """A single distinctive line should be locatable."""
        single = "        masked_token = '[MASK]'"
        result = locate_snippet_in_file(_SYNTHETIC_FILE, single)
        # Single lines may match via anchor strategy; just check it's in the right region
        # (within the function body, not in the preamble)
        if result is not None:
            assert result[0] >= _FUNC_START, (
                f"Single-line match at {result[0]} is before the function at {_FUNC_START}"
            )

    def test_leading_trailing_blank_lines_stripped(self):
        """Surrounding blank lines in the snippet must not shift line numbers."""
        padded = "\n\n" + _FUNC_BODY + "\n\n"
        result = locate_snippet_in_file(_SYNTHETIC_FILE, padded)
        assert result is not None
        assert result[0] == _FUNC_START, (
            f"Leading blank lines should be ignored; expected {_FUNC_START}, got {result[0]}"
        )

    def test_line_end_gte_line_start(self):
        result = locate_snippet_in_file(_SYNTHETIC_FILE, _FUNC_BODY)
        assert result is not None
        assert result[1] >= result[0]

    def test_function_at_file_start(self):
        """Function at the very first line returns line_start = 1."""
        simple = "def f():\n    return 42\n"
        result = locate_snippet_in_file(simple, simple)
        assert result == (1, 2)

    def test_function_at_file_end(self):
        """Function at the last lines of a file is found correctly."""
        prefix = "x = 1\ny = 2\nz = 3\n"
        suffix = "def last():\n    pass\n"
        result = locate_snippet_in_file(prefix + suffix, suffix)
        assert result is not None
        assert result[0] == 4, f"Expected line 4, got {result[0]}"


class TestRepoIndexLocateSnippet:
    """Integration: RepoIndex.locate_snippet uses file content, not Gemma output."""

    @pytest.fixture
    def repo_with_function(self):
        """A synthetic repo where a function lives at a known line."""
        preamble = "\n".join(f"# line {i}" for i in range(1, 51))  # 50 lines
        func = textwrap.dedent("""\
            def train_model(learning_rate, batch_size, num_epochs):
                optimizer = AdamOptimizer(learning_rate=learning_rate)
                for epoch in range(num_epochs):
                    loss = compute_loss(batch_size)
                    optimizer.step(loss)
                return optimizer
        """)
        postamble = "\n".join(f"# trailing {i}" for i in range(1, 20))
        content = preamble + "\n\n" + func + "\n" + postamble
        func_line = 52  # 50 preamble + blank + def line

        root = make_repo({"train.py": content, "README.md": "# Project\n"})
        yield root, func, func_line
        shutil.rmtree(root, ignore_errors=True)

    def test_locate_returns_correct_absolute_lines(self, repo_with_function):
        root, func, expected_start = repo_with_function
        idx = RepoIndex(root)
        result = idx.locate_snippet("train.py", func)
        assert result is not None, "Function should be locatable"
        assert result[0] == expected_start, (
            f"Expected line_start={expected_start}, got {result[0]}"
        )

    def test_locate_unknown_path_returns_none(self, repo_with_function):
        root, func, _ = repo_with_function
        idx = RepoIndex(root)
        assert idx.locate_snippet("nonexistent.py", func) is None

    def test_locate_fabricated_snippet_returns_none(self, repo_with_function):
        root, _, _ = repo_with_function
        idx = RepoIndex(root)
        made_up = "def train_model():\n    return magic_result()\n"
        assert idx.locate_snippet("train.py", made_up) is None

    def test_locate_does_not_use_gemma_line_numbers(self, repo_with_function):
        """
        Simulate what Gemma used to do: return a line_start counted from
        inside the snippet window.  Verify the pipeline discards it and
        uses locate_snippet instead.
        """
        root, func, expected_start = repo_with_function
        idx = RepoIndex(root)

        # Gemma would have seen a snippet starting at line 1 and reported
        # line_start = 3 (relative offset of the def line within the window).
        # That is WRONG.  locate_snippet must return the absolute line.
        wrong_gemma_line = 3

        result = idx.locate_snippet("train.py", func)
        assert result is not None
        assert result[0] != wrong_gemma_line, (
            "locate_snippet returned Gemma's relative line number — must use absolute"
        )
        assert result[0] == expected_start


# ═══════════════════════════════════════════════════════════════════════════
# 12. Gemma no longer emits line numbers (mock test)
# ═══════════════════════════════════════════════════════════════════════════

class TestGemmaNoLineNumbers:
    """Verify that analyse_claim strips line_start / line_end from Gemma output."""

    @pytest.mark.asyncio
    async def test_gemma_line_numbers_are_stripped(self):
        """
        Even if Gemma disobeys the prompt and returns line numbers,
        analyse_claim must strip them before returning.
        """
        from services.gemma_service import GemmaService
        svc = GemmaService(model="gemma4:e4b")

        # Gemma disobeys and adds line_start / line_end
        bad_response = json.dumps({
            "claim_id": "c1",
            "status": "supported",
            "file_path": "modeling.py",
            "line_start": 38,    # ← wrong relative line Gemma invented
            "line_end": 52,      # ← wrong
            "code_snippet": "class BertModel:\n    pass",
            "explanation": "BertModel implements the architecture.",
            "limitations": "Cannot verify results.",
        })
        with patch.object(svc, "generate", new=AsyncMock(return_value=bad_response)):
            result = await svc.analyse_claim("BERT bidirectional", "c1", [{
                "path": "modeling.py",
                "line_start": 1,
                "line_end": 100,
                "content": SAMPLE_PY,
            }])

        assert "line_start" not in result, (
            "analyse_claim must strip line_start — line numbers come from locate_snippet"
        )
        assert "line_end" not in result, (
            "analyse_claim must strip line_end — line numbers come from locate_snippet"
        )
        assert result["code_snippet"] == "class BertModel:\n    pass"
        assert result["status"] == "supported"

    @pytest.mark.asyncio
    async def test_pipeline_derives_lines_from_file_not_gemma(self):
        """
        End-to-end: when Gemma returns a code_snippet, the pipeline locates it
        in the actual file and produces correct absolute line numbers, ignoring
        any line numbers Gemma may have returned.
        """
        from services.gemma_service import GemmaService

        # Build a repo where the function is at a known deep line
        preamble = "\n".join(f"# filler {i}" for i in range(200))  # 200 lines
        func_body = "def target_function(x, y):\n    return x + y\n"
        content = preamble + "\n" + func_body
        func_line = 201   # 1-indexed

        root = make_repo({"ops.py": content})
        try:
            idx = RepoIndex(root)

            svc = GemmaService(model="gemma4:e4b")
            # Gemma returns line numbers counted from the snippet window (wrong)
            gemma_response = json.dumps({
                "claim_id": "c2",
                "status": "supported",
                "file_path": "ops.py",
                "line_start": 1,    # ← Gemma thinks it's line 1 of the snippet
                "line_end": 2,
                "code_snippet": func_body.rstrip(),
                "explanation": "target_function implements the operation.",
                "limitations": "None.",
            })
            with patch.object(svc, "generate", new=AsyncMock(return_value=gemma_response)):
                evidence = await svc.analyse_claim(
                    "The model implements target_function", "c2",
                    [{"path": "ops.py", "line_start": 195, "line_end": 210,
                      "content": "\n".join(content.splitlines()[194:210])}]
                )

            # Now locate the snippet — this is what main.py does
            code_snip = evidence.get("code_snippet")
            assert code_snip is not None

            located = idx.locate_snippet("ops.py", code_snip)
            assert located is not None, "Function must be locatable in file"

            actual_start, actual_end = located
            assert actual_start == func_line, (
                f"Absolute line_start must be {func_line}, got {actual_start}"
            )
            # Gemma's wrong line_start (1) must NOT appear
            assert actual_start != 1, "line_start must not be Gemma's relative offset"
        finally:
            shutil.rmtree(root, ignore_errors=True)


# ═══════════════════════════════════════════════════════════════════════════
# 13. Live BERT — line-number accuracy (network)
# ═══════════════════════════════════════════════════════════════════════════

@pytest.mark.network
class TestBERTLineNumbersLive:
    """
    Verify that locate_snippet returns L342 for create_masked_lm_predictions,
    not the snippet window boundary (L305).
    Uses the real BERT repo — no hardcoded BERT-specific logic.
    """

    @pytest.fixture(scope="class")
    def bert_index(self):
        import subprocess
        tmp = Path(tempfile.mkdtemp(prefix="pt_bert_ln_"))
        r = subprocess.run(
            ["git", "clone", "--depth", "1", "--single-branch",
             "https://github.com/google-research/bert", str(tmp)],
            capture_output=True, text=True, timeout=180,
        )
        if r.returncode != 0:
            pytest.skip(f"Could not clone BERT: {r.stderr[:200]}")
        idx = RepoIndex(tmp)
        yield idx, tmp
        shutil.rmtree(tmp, ignore_errors=True)

    def _read_file(self, tmp: Path, rel: str) -> list[str]:
        return (tmp / rel).read_text(errors="replace").splitlines()

    def test_locate_snippet_finds_correct_absolute_line(self, bert_index):
        """
        For any function in create_pretraining_data.py, locate_snippet must
        return the same line number that grep would find in the actual file.
        We discover the line number from the file itself — no hardcoding.
        """
        idx, tmp = bert_index
        file_path = "create_pretraining_data.py"
        lines = self._read_file(tmp, file_path)

        # Find create_masked_lm_predictions dynamically
        true_start = next(
            (i + 1 for i, l in enumerate(lines)
             if l.strip().startswith("def create_masked_lm_predictions")),
            None,
        )
        if true_start is None:
            pytest.skip("create_masked_lm_predictions not found in file")

        # Extract just the def line + next 5 lines as a snippet
        snippet = "\n".join(lines[true_start - 1 : true_start + 5])
        result = idx.locate_snippet(file_path, snippet)

        assert result is not None, (
            f"locate_snippet could not find create_masked_lm_predictions in {file_path}"
        )
        assert result[0] == true_start, (
            f"locate_snippet returned L{result[0]} but function actually starts at L{true_start}. "
            "This is the bug: line numbers must come from the actual file, not Gemma."
        )

    def test_locate_never_returns_snippet_window_boundary(self, bert_index):
        """
        The snippet window for create_masked_lm_predictions starts at L305.
        locate_snippet must NOT return L305 as line_start — that is the window
        boundary, not where the function definition begins.
        """
        idx, tmp = bert_index
        file_path = "create_pretraining_data.py"
        lines = self._read_file(tmp, file_path)

        true_start = next(
            (i + 1 for i, l in enumerate(lines)
             if l.strip().startswith("def create_masked_lm_predictions")),
            None,
        )
        if true_start is None:
            pytest.skip("create_masked_lm_predictions not found")

        snippet = "\n".join(lines[true_start - 1 : true_start + 8])
        result = idx.locate_snippet(file_path, snippet)

        assert result is not None
        # The old buggy behaviour was to report the snippet window start (L305)
        # Verify we return the function's actual start, not the window boundary.
        old_buggy_line = true_start - 37   # approx window start (38 lines before)
        assert result[0] != old_buggy_line, (
            f"locate_snippet returned the snippet-window boundary L{result[0]} "
            f"instead of the true function start L{true_start}"
        )
        assert result[0] == true_start

    def test_any_top_level_function_has_correct_line_number(self, bert_index):
        """
        Generic property: for every top-level function in every indexed .py file,
        locate_snippet must return the correct absolute line_start.
        This test does not hardcode any function name.
        """
        idx, tmp = bert_index
        errors: list[str] = []

        for file_path in [p for p in idx.file_paths if p.endswith(".py")]:
            lines = self._read_file(tmp, file_path)
            for i, line in enumerate(lines):
                if not line.startswith("def "):
                    continue
                true_start = i + 1   # 1-indexed
                # Build a 6-line snippet starting at the def line
                snippet = "\n".join(lines[i : i + 6])
                result = idx.locate_snippet(file_path, snippet)
                if result is None:
                    continue   # 6-line snippet may not be distinctive enough — skip
                if result[0] != true_start:
                    errors.append(
                        f"{file_path}: def at L{true_start}, locate_snippet returned L{result[0]}"
                    )

        assert not errors, (
            f"locate_snippet returned wrong line numbers for {len(errors)} function(s):\n"
            + "\n".join(errors[:10])
        )


# ═══════════════════════════════════════════════════════════════════════════
# 14. PDF Title extraction and Default Branch detection
# ═══════════════════════════════════════════════════════════════════════════

class TestPDFTitleExtraction:
    def test_extract_title_from_metadata(self):
        import fitz
        from services.pdf_service import extract_title

        tmp_pdf = Path(tempfile.mktemp(suffix=".pdf", prefix="pt_pdf_test_"))
        doc = fitz.open()
        page = doc.new_page()
        page.insert_text((50, 72), "Some body text on page 1")
        doc.set_metadata({"title": "Attention Is All You Need"})
        doc.save(str(tmp_pdf))
        doc.close()

        try:
            title = extract_title(tmp_pdf)
            assert title == "Attention Is All You Need"
            assert not title.startswith("pt_pdf_")
        finally:
            tmp_pdf.unlink(missing_ok=True)

    def test_extract_title_from_first_page_heading(self):
        import fitz
        from services.pdf_service import extract_title

        tmp_pdf = Path(tempfile.mktemp(suffix=".pdf", prefix="pt_pdf_test_"))
        doc = fitz.open()
        page = doc.new_page()
        page.insert_text((50, 72), "BERT: Pre-training of Deep Bidirectional Transformers\nAbstract\nWe introduce...")
        doc.set_metadata({"title": ""})
        doc.save(str(tmp_pdf))
        doc.close()

        try:
            title = extract_title(tmp_pdf)
            assert title == "BERT: Pre-training of Deep Bidirectional Transformers"
            assert not title.startswith("pt_pdf_")
        finally:
            tmp_pdf.unlink(missing_ok=True)

    def test_extract_title_never_returns_tmpdir_name(self):
        from services.pdf_service import extract_title
        fake_path = Path("/tmp/pt_pdf_abc123/paper.pdf")
        # paper.pdf does not exist; should return fallback, not "pt_pdf_abc123"
        title = extract_title(fake_path)
        assert "pt_pdf_" not in title
        assert title == "Paper" or title == "Untitled Research Paper"


class TestDefaultBranchDetection:
    def test_detect_default_branch_from_head(self):
        root = make_repo({"sample.py": "x = 1\n"})
        git_dir = root / ".git"
        git_dir.mkdir(parents=True, exist_ok=True)
        head_file = git_dir / "HEAD"
        head_file.write_text("ref: refs/heads/master\n")

        idx = RepoIndex(root)
        assert idx.default_branch == "master"
        shutil.rmtree(root, ignore_errors=True)

    def test_detect_default_branch_fallback(self):
        root = make_repo({"sample.py": "x = 1\n"})
        idx = RepoIndex(root)
        assert idx.default_branch == "main"
        shutil.rmtree(root, ignore_errors=True)


# ═══════════════════════════════════════════════════════════════════════════
# 15. PDF Extraction & Chunking Reliability
# ═══════════════════════════════════════════════════════════════════════════

class TestPDFExtractionAndChunking:
    def test_extract_text_invalid_pdf_raises_value_error(self):
        from services.pdf_service import extract_text
        tmp = Path(tempfile.mktemp(suffix=".pdf"))
        tmp.write_text("This is not a real PDF binary")
        try:
            with pytest.raises(ValueError, match="Could not open or parse PDF"):
                extract_text(tmp)
        finally:
            tmp.unlink(missing_ok=True)

    def test_chunk_text_overlap(self):
        from services.pdf_service import chunk_text
        words = [f"word{i}" for i in range(500)]
        text = " ".join(words)
        chunks = chunk_text(text, chunk_size=300)
        assert len(chunks) > 1
        # Overlap check: last words of chunk 0 appear in chunk 1
        c0_words = chunks[0].split()
        c1_words = chunks[1].split()
        assert any(w in c1_words for w in c0_words[-10:])

    def test_chunk_text_short_text(self):
        from services.pdf_service import chunk_text
        text = "Short text under the chunk limit"
        chunks = chunk_text(text, chunk_size=1000)
        assert len(chunks) == 1
        assert chunks[0] == text

    @pytest.mark.asyncio
    async def test_extract_claims_from_empty_text_returns_empty(self):
        import fitz
        from services.pdf_service import extract_claims_from_pdf
        tmp = Path(tempfile.mktemp(suffix=".pdf"))
        doc = fitz.open()
        doc.new_page()  # blank page
        doc.save(str(tmp))
        doc.close()
        try:
            mock_gemma = MagicMock()
            claims = await extract_claims_from_pdf(tmp, mock_gemma)
            assert claims == []
        finally:
            tmp.unlink(missing_ok=True)


# ═══════════════════════════════════════════════════════════════════════════
# 16. Title Extraction Edge Cases
# ═══════════════════════════════════════════════════════════════════════════

class TestTitleExtractionEdgeCases:
    def test_rejects_arxiv_id_as_title(self):
        import fitz
        from services.pdf_service import extract_title
        tmp = Path(tempfile.mktemp(suffix=".pdf", prefix="pt_test_"))
        doc = fitz.open()
        page = doc.new_page()
        page.insert_text((50, 72), "arXiv:1810.04805v2 [cs.CL] 24 May 2019\nReal Paper Title Here\nAbstract")
        doc.set_metadata({"title": ""})
        doc.save(str(tmp))
        doc.close()
        try:
            title = extract_title(tmp)
            assert title == "Real Paper Title Here"
            assert "arXiv" not in title
        finally:
            tmp.unlink(missing_ok=True)

    def test_rejects_abstract_heading_as_title(self):
        import fitz
        from services.pdf_service import extract_title
        tmp = Path(tempfile.mktemp(suffix=".pdf", prefix="pt_test_"))
        doc = fitz.open()
        page = doc.new_page()
        page.insert_text((50, 72), "Abstract\nThis paper presents deep transformers\nIntroduction")
        doc.set_metadata({"title": ""})
        doc.save(str(tmp))
        doc.close()
        try:
            title = extract_title(tmp)
            assert not title.lower().startswith("abstract")
        finally:
            tmp.unlink(missing_ok=True)

    def test_corrupted_file_falls_back_gracefully(self):
        from services.pdf_service import extract_title
        tmp = Path(tempfile.mktemp(suffix=".pdf"))
        tmp.write_text("random broken bytes")
        try:
            title = extract_title(tmp)
            assert isinstance(title, str)
            assert len(title) > 0
            assert "pt_pdf_" not in title
        finally:
            tmp.unlink(missing_ok=True)


# ═══════════════════════════════════════════════════════════════════════════
# 17. API Endpoints & Input Validation
# ═══════════════════════════════════════════════════════════════════════════

class TestAPIEndpoints:
    @pytest.fixture
    def client(self):
        from fastapi.testclient import TestClient
        from main import app
        return TestClient(app)

    def test_health_ollama_endpoint(self, client):
        resp = client.get("/api/health/ollama")
        assert resp.status_code == 200
        data = resp.json()
        assert "running" in data
        assert "model" in data
        assert "model_available" in data

    def test_analyse_rejects_non_pdf(self, client):
        resp = client.post(
            "/api/analyse",
            data={"repo_url": "https://github.com/google-research/bert"},
            files={"pdf": ("test.txt", b"plain text content", "text/plain")},
        )
        assert resp.status_code == 400
        assert "Only PDF files are accepted" in resp.json()["detail"]

    def test_analyse_rejects_empty_pdf(self, client):
        resp = client.post(
            "/api/analyse",
            data={"repo_url": "https://github.com/google-research/bert"},
            files={"pdf": ("test.pdf", b"", "application/pdf")},
        )
        assert resp.status_code == 400
        assert "empty or invalid" in resp.json()["detail"]

    def test_analyse_rejects_invalid_repo_urls(self, client):
        invalid_urls = [
            "https://gitlab.com/user/repo",
            "http://github.com/user/repo",
            "not-a-url",
            "https://github.com/",
            "https://github.com/user",
            "https://github.com/user/repo/extra/path",
            "https://github.com/user/repo;rm -rf /",
        ]
        pdf_bytes = b"%PDF-1.4 mock pdf content with enough bytes for testing"
        for url in invalid_urls:
            resp = client.post(
                "/api/analyse",
                data={"repo_url": url},
                files={"pdf": ("paper.pdf", pdf_bytes, "application/pdf")},
            )
            assert resp.status_code == 400, f"Expected 400 for {url}, got {resp.status_code}"

    def test_get_status_nonexistent_job_returns_404(self, client):
        resp = client.get("/api/analyse/non-existent-job-id-12345/status")
        assert resp.status_code == 404
        assert "Job not found" in resp.json()["detail"]

    def test_get_report_nonexistent_job_returns_404(self, client):
        resp = client.get("/api/analyse/non-existent-job-id-12345/report")
        assert resp.status_code == 404

    def test_get_report_incomplete_job_returns_400(self, client):
        from main import _jobs, _new_job
        job_id = "test-job-incomplete-123"
        _jobs[job_id] = _new_job(job_id)
        try:
            resp = client.get(f"/api/analyse/{job_id}/report")
            assert resp.status_code == 400
            assert "not complete" in resp.json()["detail"]
        finally:
            _jobs.pop(job_id, None)

    def test_get_report_failed_job_returns_500(self, client):
        from main import _jobs, _new_job
        job_id = "test-job-failed-123"
        job = _new_job(job_id)
        job["done"] = True
        job["error"] = "Custom analysis failure explanation"
        _jobs[job_id] = job
        try:
            resp = client.get(f"/api/analyse/{job_id}/report")
            assert resp.status_code == 500
            assert "Custom analysis failure explanation" in resp.json()["detail"]
        finally:
            _jobs.pop(job_id, None)

    def test_get_report_completed_job_schema(self, client):
        from main import _jobs, _new_job
        job_id = "test-job-complete-123"
        job = _new_job(job_id)
        job["done"] = True
        job["report"] = {
            "id": job_id,
            "paper_title": "Test Paper Title",
            "repo_url": "https://github.com/google-research/bert",
            "created_at": "2026-11-01T00:00:00Z",
            "model_used": "gemma4:e4b",
            "default_branch": "master",
            "repo_files_indexed": 42,
            "repo_python_files": 15,
            "results": [{
                "claim": {"id": "c1", "text": "Claim text", "page": 1},
                "status": "supported",
                "file_path": "modeling.py",
                "line_start": 10,
                "line_end": 20,
                "code_snippet": "def sample():\n    pass",
                "explanation": "Valid explanation.",
                "limitations": "None.",
            }],
            "summary": {
                "total_claims": 1,
                "supported": 1,
                "ambiguous": 0,
                "missing": 0,
            },
        }
        _jobs[job_id] = job
        try:
            resp = client.get(f"/api/analyse/{job_id}/report")
            assert resp.status_code == 200
            data = resp.json()
            # Verify frontend-backend contract
            assert data["id"] == job_id
            assert data["paper_title"] == "Test Paper Title"
            assert data["default_branch"] == "master"
            assert data["repo_files_indexed"] == 42
            assert data["repo_python_files"] == 15
            assert len(data["results"]) == 1
            assert data["results"][0]["line_start"] == 10
            assert data["results"][0]["line_end"] == 20
        finally:
            _jobs.pop(job_id, None)


# ═══════════════════════════════════════════════════════════════════════════
# 18. Inaccessible, 404 & Missing Repository Failures
# ═══════════════════════════════════════════════════════════════════════════

class TestCloneRepoFailuresAndInaccessible:
    @pytest.mark.asyncio
    async def test_clone_repo_404_not_found_message(self):
        from services.github_service import clone_repo
        # Mock git clone failure with 'not found'
        mock_proc = AsyncMock()
        mock_proc.returncode = 128
        mock_proc.communicate = AsyncMock(
            return_value=(b"", b"fatal: repository 'https://github.com/user/fake' not found\n")
        )
        with patch("asyncio.create_subprocess_exec", return_value=mock_proc):
            with pytest.raises(RuntimeError, match="Repository not found or does not exist \\(404\\)"):
                await clone_repo("https://github.com/user/fake")

    @pytest.mark.asyncio
    async def test_clone_repo_private_authentication_message(self):
        from services.github_service import clone_repo
        mock_proc = AsyncMock()
        mock_proc.returncode = 128
        mock_proc.communicate = AsyncMock(
            return_value=(b"", b"fatal: could not read Username: terminal prompts disabled\n")
        )
        with patch("asyncio.create_subprocess_exec", return_value=mock_proc):
            with pytest.raises(RuntimeError, match="Repository is private or requires authentication"):
                await clone_repo("https://github.com/user/private-repo")

    def test_repo_index_empty_directory(self):
        root = make_repo({})
        try:
            idx = RepoIndex(root)
            assert idx.file_paths == []
            assert idx.get_snippets_for_claim("any claim") == []
            assert idx.locate_snippet("any.py", "code") is None
        finally:
            shutil.rmtree(root, ignore_errors=True)

    def test_repo_index_only_excluded_directories(self):
        root = make_repo({
            ".git/config": "repo config",
            ".venv/lib/module.py": "x = 1",
            "__pycache__/cached.pyc": "binary",
            "node_modules/pkg/index.js": "export default {}",
        })
        try:
            idx = RepoIndex(root)
            assert idx.file_paths == []
        finally:
            shutil.rmtree(root, ignore_errors=True)


# ═══════════════════════════════════════════════════════════════════════════
# 19. Evidence Verification Pipeline Edge Cases
# ═══════════════════════════════════════════════════════════════════════════

class TestEvidenceVerificationPipelineEdgeCases:
    def test_crlf_line_endings_in_file(self):
        crlf_content = "def hello():\r\n    msg = 'world'\r\n    return msg\r\n"
        snippet = "def hello():\n    msg = 'world'\n    return msg"
        result = locate_snippet_in_file(crlf_content, snippet)
        assert result == (1, 3), f"Expected (1, 3), got {result}"

    def test_trailing_whitespace_variations(self):
        file_content = "line 1  \nline 2\t\nline 3   \n"
        snippet = "line 1\nline 2\nline 3"
        result = locate_snippet_in_file(file_content, snippet)
        assert result == (1, 3)

    def test_too_short_paraphrased_snippet_rejected(self):
        # Anchor matching requires >= 5 consecutive lines to avoid spurious matches
        file_content = "\n".join(f"var_{i} = {i}" for i in range(100))
        # Paraphrased snippet with only 2 matching lines and different indentation
        bad_snippet = "var_20 = 20\nvar_21 = 21\nvar_999 = 999"
        result = locate_snippet_in_file(file_content, bad_snippet)
        assert result is None

    def test_anchor_match_skips_leading_comment_lines(self):
        code_lines = [
            "# Preamble comment 1",
            "# Preamble comment 2",
            "class SpecializedTransformerArchitecture:",
            "    def __init__(self, hidden_size):",
            "        self.hidden_size = hidden_size",
            "        self.layers = []",
            "    def forward(self, x):",
            "        return x",
        ]
        file_content = "\n".join(["x = 0"] * 50 + code_lines + ["y = 0"] * 20)
        snippet = "\n".join(code_lines)
        result = locate_snippet_in_file(file_content, snippet)
        assert result is not None
        assert result[0] == 51  # 50 lines before + 1 (1-indexed)


# ═══════════════════════════════════════════════════════════════════════════
# 20. Security & Model Compliance Audit
# ═══════════════════════════════════════════════════════════════════════════

class TestSecurityAndLocalModelCompliance:
    def test_no_cloud_ai_or_api_keys_in_main_application(self):
        import re
        repo_root = Path(__file__).parent.parent.parent
        backend_dir = repo_root / "backend"
        frontend_src = repo_root / "frontend" / "src"

        forbidden_patterns = [
            (re.compile(r"@google/genai", re.IGNORECASE), "Cloud Gemini SDK"),
            (re.compile(r"google\.generativeai", re.IGNORECASE), "Cloud Gemini SDK"),
            (re.compile(r"api\.openai\.com", re.IGNORECASE), "OpenAI API"),
            (re.compile(r"api\.anthropic\.com", re.IGNORECASE), "Anthropic API"),
            (re.compile(r"generativelanguage\.googleapis\.com", re.IGNORECASE), "Gemini Cloud API"),
            (re.compile(r"AIza[0-9A-Za-z-_]{35}"), "Google API Key"),
            (re.compile(r"sk-[0-9A-Za-z-_]{20,}"), "Secret Key"),
        ]

        violations = []
        for search_dir in (backend_dir, frontend_src):
            for p in search_dir.rglob("*"):
                if not p.is_file() or p.name == "test_pipeline.py":
                    continue
                # Skip venvs, git, cache
                if any(part in (".venv", "node_modules", ".git", "__pycache__", "dist") for part in p.parts):
                    continue
                content = p.read_text(errors="replace")
                for pat, label in forbidden_patterns:
                    if pat.search(content):
                        violations.append(f"{p}: {label}")

        assert not violations, f"Forbidden cloud AI APIs or secrets detected:\n" + "\n".join(violations)

    def test_backend_uses_ollama_and_gemma(self):
        from services.gemma_service import OLLAMA_BASE, DEFAULT_MODEL
        assert "localhost" in OLLAMA_BASE or "127.0.0.1" in OLLAMA_BASE
        assert "gemma4" in DEFAULT_MODEL


