# PaperTrail — AI Research-to-Code Traceability

Connect ML research papers with their GitHub implementations. Trace experimental claims to source-code evidence using Gemma 4 running locally.

---

## Quick Start

### Prerequisites

| Tool    | Version |
| ------- | ------- |
| Node.js | ≥ 18    |
| Python  | ≥ 3.9   |
| Ollama  | latest  |
| Git     | any     |

### 1. Pull the model (one-time)

```
ollama pull gemma4:e4b
# Lower-resource alternative:
# ollama pull gemma4:e2b
```

### 2. Start Ollama

```
ollama serve
```

### 3. Start the backend

```
cd backend
python3 -m venv .venv
source .venv/bin/activate       # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --port 8000 --reload
```

Or simply:

```
cd backend && ./start.sh
```

### 4. Start the frontend

```
cd frontend
npm install
npm run dev
```

Open **[http://localhost:5173](http://localhost:5173/)**

---

## Architecture

```
frontend/   Vite + React + TypeScript + Three.js + Framer Motion
backend/    FastAPI + PyMuPDF + GitPython + Ollama (Gemma 4)
```

### Routes

| Path               | Description               |
| ------------------ | ------------------------- |
| `/`                | Cinematic 3D scroll intro |
| `/app`             | Analysis workspace        |
| `/app/results/:id` | Results dashboard         |

### API endpoints

| Method | Path                      | Description             |
| ------ | ------------------------- | ----------------------- |
| GET    | `/api/health/ollama`      | Ollama + model status   |
| POST   | `/api/analyse`            | Submit PDF + GitHub URL |
| GET    | `/api/analyse/:id/status` | Poll job progress       |
| GET    | `/api/analyse/:id/report` | Fetch completed report  |

---

## Models

| Model        | Use                                |
| ------------ | ---------------------------------- |
| `gemma4:e4b` | Primary — best quality             |
| `gemma4:e2b` | Alternative — lower resource usage |

To switch models, change `DEFAULT_MODEL` in `backend/services/gemma_service.py`.

**Privacy and execution:** Gemma 4 runs locally through Ollama. PaperTrail does not rely on cloud AI APIs for its core claim analysis.

---

## AI-Assisted Development

DeepSeek was used as a coding assistant during PaperTrail's development.

It supported the development process through coding assistance and implementation guidance.

**Core application AI:** Gemma 4, running locally through Ollama, powers PaperTrail's research claim analysis and evidence evaluation.

DeepSeek is acknowledged as a development assistant; it is not the AI model powering PaperTrail's analysis.

---

## Design

The application has two distinct visual modes:

- **Intro** — dark, cinematic, scroll-driven 3D spiral built with Three.js. Represents a GitHub repository as a rotating helix. Four scroll milestones: Evidence → Interpretation → Traceability → Report.
- **App** — clean, professional light theme. White sidebar, soft grey surfaces, brand-indigo and violet accents.

### Accessibility

- `prefers-reduced-motion` respected — 3D intro is replaced with a static screen.
- WebGL unavailable — graceful fallback with text-only intro.
- Skip button always visible in the intro.
- Session storage prevents repeat visitors from sitting through the intro again.

---

## Preservation

`HACKATHON.md`, `README.md`, and `LICENSE` are unchanged.
