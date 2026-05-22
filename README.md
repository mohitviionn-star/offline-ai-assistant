# Offline AI Knowledge Assistant — MVP

A fully-offline AI business assistant that answers questions by combining **document evidence (PDF)** and **structured data (SQLite)** with **inline citations** for every claim. Built for compliance-leaning use cases (real estate, accounting, HIPAA-style workflows) where traceability and trust matter.

> Stack: Ollama (Llama 3.1 8B) · Qdrant · bge-small-en-v1.5 · SQLite · FastAPI · React · Docker

---

## What it does

- **Upload PDFs** → chunked, embedded, stored in Qdrant with full citation metadata (file, page, chunk).
- **Ask anything** → an LLM router decides whether to hit the documents, the database, or both.
- **Hybrid answers** → results from PDFs and SQL are integrated into one grounded answer.
- **Citation-first UI** → every claim has a clickable chip → side panel shows the exact PDF page or SQL + rows.
- **Hallucination guards** → refusal when evidence is missing, confidence indicator, audit log of every query.

---

## Quickstart

### Prereqs
- Docker Desktop (Mac/Linux/Windows)
- [Ollama](https://ollama.com) installed and running on the host machine
- ~6 GB free RAM for the 8B model

### 1. Pull the model

```bash
ollama pull llama3.1:8b
# (optional) test it
ollama run llama3.1:8b "say hi"
```

Leave Ollama running — the container will reach it via `host.docker.internal:11434`.

### 2. Build sample data (once)

```bash
cd backend
python -m pip install -r requirements.txt   # only needed for the sample-data script
python scripts/build_sample_data.py
```

This writes `sample_data/business.db` (5 properties, 5 tenants, leases, payments) and `sample_data/tenant_handbook.pdf` (4-page handbook covering rent, deposits, pets, termination, etc.).

> If you have your own PDF + `.db`, drop them into `sample_data/` as `business.db` and whatever PDFs you like — they'll be picked up automatically.

### 3. Launch the stack

```bash
docker compose up --build
```

When the build finishes:
- UI:        http://localhost:5173
- API:       http://localhost:8000/health
- Qdrant UI: http://localhost:6333/dashboard

### 4. Ingest the sample PDF

In the UI, click **+ Upload PDF** and pick `sample_data/tenant_handbook.pdf`. You'll see chunk count appear in a few seconds.

### 5. Ask the demo questions

Click any of the suggested prompts on the empty chat screen:

| Question | What it shows |
|---|---|
| "Which leases expire in the next 6 months and what does the handbook say about renewal notice?" | Hybrid: SQL + docs |
| "How much rent did Devon Patel pay in the last 3 months, and what's the late fee policy?" | Hybrid: SQL + docs |
| "Are pets allowed and how many active tenants do we have?" | Hybrid: SQL + docs |
| "What's the security deposit policy for a 2-year lease?" | Docs-only with grounded refusal if not present |

Each answer shows:
- Inline citation chips like `📄 tenant_handbook.pdf p.2` and `⚙ SQL: SELECT ...`
- Click any chip to open the side panel: PDF snippet (with link to the actual page) or full SQL + rows
- Route badge (`docs` / `sql` / `hybrid`), confidence (`high` / `medium` / `low` / `refused`), and latency

---

## Architecture

```
┌──────────────┐     ┌──────────────────────────────────────────┐
│  React UI    │ ⇄ │  FastAPI                                   │
│  (chat,      │     │   ├ /ingest   PDF → chunks → embeddings  │
│  upload,     │     │   ├ /query    router → tools → answer    │
│  citations)  │     │   ├ /schema   live DB schema for router  │
└──────────────┘     │   └ /audit    audit log                  │
                     └──────────────────────────────────────────┘
                                  │
            ┌──────────────────┬──┴──────────────┐
            ▼                  ▼                  ▼
      ┌───────────┐      ┌───────────┐      ┌───────────┐
      │  Qdrant   │      │  SQLite   │      │  Ollama   │
      │ (vectors  │      │ (business │      │ (Llama    │
      │  + meta)  │      │  data)    │      │  3.1 8B)  │
      └───────────┘      └───────────┘      └───────────┘
```

### Routing

The router is an LLM call (`backend/app/router.py`) that returns a JSON plan:

```json
{ "route": "hybrid", "docs_query": "...", "sql_question": "...", "rationale": "..." }
```

`hybrid` runs both retrievers in the same turn. The answer prompt then sees document chunks **and** SQL rows together, and is required to cite both.

### Citation strategy

1. **Retrieval-time:** every vector hit carries `{doc_id, filename, page, chunk_idx, char_start/end}`; every SQL result carries the executed query.
2. **Answer-time:** the answer prompt requires inline `[doc:filename p.N]` and `[sql:...]` markers. Confidence drops to `low` if missing.
3. **UI:** markers render as colored chips → click → side panel with snippet + page link or SQL + result rows.

### Hallucination handling

- System prompt forbids using model memory; only the retrieved context is allowed.
- If nothing relevant comes back, the model is instructed to reply with the explicit refusal line and confidence drops to `refused`.
- SQL is parsed by `sqlglot` and rejected if it's anything other than `SELECT` / set ops — no writes possible from natural language.

### Audit log

Every query (question, route, answer, citations, latency) is logged to `sample_data/audit.db` (`queries` table). `GET /audit` returns the last N. Critical for compliance demos.

---

## Project layout

```
.
├── backend/
│   ├── app/
│   │   ├── main.py           FastAPI endpoints
│   │   ├── router.py         LLM router + answer synthesis
│   │   ├── tool_docs.py      vector search tool
│   │   ├── tool_sql.py       NL→SQL tool (with SELECT-only guard)
│   │   ├── ingestion.py      PDF chunking + embedding
│   │   ├── vector_store.py   Qdrant client
│   │   ├── embeddings.py     bge-small loader
│   │   ├── ollama_client.py  Ollama HTTP client
│   │   ├── audit.py          query log
│   │   └── config.py         settings
│   ├── scripts/build_sample_data.py
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── api.js
│   │   └── components/{Chat,Sidebar,SourcePanel}.jsx
│   ├── package.json
│   ├── vite.config.js
│   ├── tailwind.config.js
│   ├── nginx.conf
│   └── Dockerfile
├── sample_data/          mounted into the backend at /data
├── docker-compose.yml
└── zoom-prep.md          (call prep notes, not part of the demo)
```

---

## Tuning & swap points

- **Model:** change `OLLAMA_MODEL` in `.env` / compose. `qwen2.5:7b-instruct` is a strong alt for tool-use.
- **Embedding:** swap `EMBEDDING_MODEL` in `backend/app/config.py` (remember to set `EMBEDDING_DIM` to match — bge-small=384, bge-base=768).
- **Vector store:** Qdrant is wrapped in `vector_store.py`; replacing with Chroma is ~30 lines.
- **DB:** SQLite is wrapped in `tool_sql.py`; pointing at Postgres is a connection-string change.
- **Chunking:** `chunk_size` / `chunk_overlap` in `config.py`.

---

## Demo recording checklist (Loom)

For the mini-demo handoff to Jenny:

1. Open the UI at http://localhost:5173 — show empty state with the 4 sample prompts.
2. Show the sidebar: uploaded `tenant_handbook.pdf`, the live SQL schema, Ollama status.
3. Click the first sample prompt (hybrid lease/renewal question).
4. While it runs, narrate: "Router decides docs+sql, runs them in parallel, then synthesizes."
5. Hover the route badge → "hybrid · high · ~Xms".
6. Click a 📄 chip → side panel shows the matched PDF snippet + link to page.
7. Click a ⚙ chip → side panel shows the executed SQL and the rows.
8. Ask the unanswerable one: "What's the policy on cryptocurrency rent payments?" → refusal + low confidence. Mention that's the hallucination guard.
9. Optional: open http://localhost:8000/audit → show the audit log entry for the query.

Keep it under 5 minutes. The "click a citation, see the evidence" beat is the one that sells it.

---

## What's intentionally OUT of this MVP

Mentioned in the original Upwork pitch — deliberately deferred so V1 ships fast:
- auth / multi-user / tenant isolation
- image / audio / OCR ingestion
- fine-tuning
- admin UI / dashboards
- cloud deployment / autoscaling
- integrations (Slack, email, Drive)
- streaming token output (block answers for now)
