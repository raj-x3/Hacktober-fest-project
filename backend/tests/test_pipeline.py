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

    def test_modeling_py_is_indexed_before_readme(self, bert_index):
        paths = bert_index.file_paths
        if "README.md" not in paths:
            pytest.skip("README.md not in index")
        py_pos  = next((i for i, p in enumerate(paths) if p == "modeling.py"), None)
        md_pos  = next((i for i, p in enumerate(paths) if p == "README.md"), None)
        assert py_pos is not None, "modeling.py not indexed"
        assert py_pos < md_pos, \
            f"modeling.py (pos {py_pos}) should come before README.md (pos {md_pos})"


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
