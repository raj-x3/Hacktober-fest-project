# PaperTrail Sample Input Description

This directory contains a real, publicly accessible machine-learning research paper and its corresponding open-source repository configuration.

---

## 1. Research Paper

- **Paper Title**: *BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding*
- **Authors**: Jacob Devlin, Ming-Wei Chang, Kenton Lee, Kristina Toutanova (Google AI Language)
- **Publication**: NAACL-HLT 2019 / arXiv:1810.04805
- **Canonical PDF Source**: [https://arxiv.org/pdf/1810.04805](https://arxiv.org/pdf/1810.04805)
- **Bundled File**: [`examples/sample_input/bert_paper.pdf`](file:///Users/raj/Documents/Hacktober-fest-project/examples/sample_input/bert_paper.pdf) (757 KB)

### Why this paper?
BERT is a foundational benchmark in NLP research. The paper details concrete, verifiable experimental claims:
- Bidirectional Transformer encoder architecture.
- 15% masked language modeling (MLM) probability objective.
- Next Sentence Prediction (NSP) task with 50% positive/negative sentence pairs.
- Optimizer settings (Adam with weight decay, warmup, learning rates).
- Fine-tuning procedures and classification heads.

---

## 2. GitHub Repository

- **Repository URL**: `https://github.com/google-research/bert`
- **Default Branch**: `master`
- **Primary Source Modules**:
  - `modeling.py` (Transformer architecture, multi-head attention, BertModel, BertConfig)
  - `create_pretraining_data.py` (Masked LM token masking, next sentence pair generation)
  - `optimization.py` (AdamWeightDecayOptimizer, polynomial warmup learning rate schedule)
  - `run_pretraining.py` (Pre-training loop, loss calculation, masked LM prediction head)
  - `extract_features.py` (Feature extraction from pre-trained representations)
  - `tokenization.py` (WordPiece tokenization, vocabulary loading)

---

## 3. How to Provide This Input to PaperTrail

### Option A: Web User Interface (Recommended)
1. Ensure the backend (`http://localhost:8000`) and frontend (`http://localhost:5173`) are running.
2. Open **[http://localhost:5173/app](http://localhost:5173/app)** in your browser.
3. In the **Research Paper (PDF)** section:
   - Click to browse or drag and drop [`examples/sample_input/bert_paper.pdf`](file:///Users/raj/Documents/Hacktober-fest-project/examples/sample_input/bert_paper.pdf).
4. In the **GitHub Repository URL** field:
   - Enter `https://github.com/google-research/bert`.
5. Click **Analyse**.

### Option B: REST API (`curl`)
You can submit the paper directly to the FastAPI backend using `multipart/form-data`:

```bash
curl -X POST "http://localhost:8000/api/analyse" \
  -F "pdf=@examples/sample_input/bert_paper.pdf;type=application/pdf" \
  -F "repo_url=https://github.com/google-research/bert"
```

**Response**:
```json
{
  "job_id": "1b1a0d47-12a3-4109-9122-b82fe1aa916e"
}
```

### Option C: Python Script

```python
import httpx
import time

BASE_URL = "http://localhost:8000/api"

with open("examples/sample_input/bert_paper.pdf", "rb") as f:
    pdf_bytes = f.read()

# 1. Start Analysis
resp = httpx.post(
    f"{BASE_URL}/analyse",
    data={"repo_url": "https://github.com/google-research/bert"},
    files={"pdf": ("bert_paper.pdf", pdf_bytes, "application/pdf")},
    timeout=30.0,
)
job_id = resp.json()["job_id"]
print(f"Submitted analysis job: {job_id}")

# 2. Poll Status
while True:
    time.sleep(2)
    status_resp = httpx.get(f"{BASE_URL}/analyse/{job_id}/status").json()
    print(f"Stage [{status_resp['stage_index'] + 1}/5]: {status_resp['stage']}")
    if status_resp["done"]:
        if status_resp.get("error"):
            print(f"Error: {status_resp['error']}")
        break

# 3. Retrieve Report
report = httpx.get(f"{BASE_URL}/analyse/{job_id}/report").json()
print(f"Analysis complete: {report['summary']}")
```

---

## 4. Input Validation Criteria

| Field | Accepted Format | Rejection Conditions |
|---|---|---|
| **PDF File** | MIME type `application/pdf` or filename ending in `.pdf` | Non-PDF files (e.g. `.docx`, `.txt`, `.png`), 0-byte files |
| **Repo URL** | `https://github.com/<owner>/<repo>` (optional `.git`, trailing `/`) | Non-GitHub hosts (GitLab, Bitbucket), private/inaccessible repos, empty input, invalid schemes |
