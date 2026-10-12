# SentriCORE Island Resilience AI

Operations assistant for a **fictional** island's linked water and power systems (all data is synthetic).
Deterministic analytics detect a disruption; **Gemini** produces an evidence-cited assessment; a **second Gemini model verifies every claim**
(plus code checks for IDs and numbers); an operator approves actions; recovery is **simulated**; a report is exported.

```
Browser (React) --/api/**--> Firebase Hosting --> Cloud Run (FastAPI) --> Firestore
                                                       \--> Gemini API (key in Secret Manager)
```

## Run locally (no Google account needed)
```bash
cd backend && pip install -r requirements-dev.txt
FAKE_AI=1 STORE=memory python -m pytest -q
cd ../frontend && npm install && npm run build
cd ../backend && FAKE_AI=1 STORE=memory SERVE_FRONTEND=1 uvicorn app.main:app --port 8080   # open http://localhost:8080
# real Gemini locally: export GEMINI_API_KEY=...; STORE=memory SERVE_FRONTEND=1 uvicorn app.main:app --port 8080
# frontend dev server: cd frontend && npm run dev   (http://localhost:5173, proxies /api to :8080)
```
`FAKE_AI=1` is a deterministic stand-in used only by tests. Never set it in the deployed service.

## Layout
`backend/app/sim` stateless simulator; `analytics` reserve horizon, detection, evidence registry; `ai` Gemini client, prompts, schemas, code checks, Q&A tools;
`pipeline.py` one-LLM-call-per-request state machine; `runs.py` sandbox runs and approve/simulate; `report.py`; `sop_docs/` five demo SOPs; `scripts/` smoke test and judge evaluation.

## Models and settings
`ASSESS_MODEL=gemini-3.8-flash`, `JUDGE_MODEL=gemini-3.6-flash`, thinking level `low`, prompt version `v1` (see `backend/app/config.py`).
Pin the `google-genai` version you tested in `requirements.txt` before submission.

## Limitations
Synthetic scenarios only; thresholds are scenario settings, not safety limits; the reserve forecast assumes constant rates; SOPs are demo text;
keyword retrieval, not semantic search. No claim is made about field accuracy. Production would add sign-in, roles and real telemetry adapters.
