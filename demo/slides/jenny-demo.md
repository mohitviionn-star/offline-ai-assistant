---
marp: true
theme: default
size: 16:9
paginate: true
header: 'Grounded Offline AI Assistant — Jenny demo'
footer: 'Built by Mohit · mohit-star.netlify.app'
style: |
  section {
    font-family: 'Inter', -apple-system, system-ui, sans-serif;
    color: #0b1220;
    background: #ffffff;
    padding: 60px 70px;
  }
  h1 { font-size: 44px; letter-spacing: -0.01em; color: #0b1220; margin-bottom: 8px; }
  h2 { font-size: 30px; letter-spacing: -0.01em; color: #0b1220; margin-top: 0; margin-bottom: 16px; }
  h3 { font-size: 18px; color: #1c2a44; margin-bottom: 6px; }
  p, li { font-size: 18px; line-height: 1.55; color: #1c2a44; }
  ul { margin-top: 6px; }
  li { margin-bottom: 4px; }
  strong { color: #0b1220; }
  code { background: #f1f5f9; color: #0b1220; padding: 2px 6px; border-radius: 4px; font-size: 15px; }
  pre { background: #f8fafc; border: 1px solid #e2e8f0; padding: 14px; border-radius: 8px; font-size: 14px; line-height: 1.45; }
  pre code { background: transparent; padding: 0; }
  blockquote { border-left: 3px solid #1d4ed8; color: #334155; font-style: normal; padding-left: 14px; font-size: 17px; }
  table { font-size: 16px; border-collapse: collapse; }
  th, td { border: 1px solid #cbd5e1; padding: 8px 12px; text-align: left; }
  th { background: #f1f5f9; }
  .eyebrow { font-size: 12px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #1d4ed8; margin-bottom: 8px; }
  .pill { display: inline-block; padding: 4px 10px; border-radius: 999px; background: #eef2ff; color: #3730a3; font-size: 14px; font-weight: 600; margin-right: 6px; }
  .pill-good { background: #ecfdf5; color: #047857; }
  .pill-warn { background: #fffbeb; color: #b45309; }
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
  .card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px 18px; }
  .card h3 { margin-top: 0; }
  .muted { color: #64748b; font-size: 14px; }
  .center { text-align: center; }
  .ascii { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 14px; line-height: 1.35; white-space: pre; background: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 10px; color: #1e293b; }
  footer { color: #94a3b8; font-size: 11px; }
  header { color: #94a3b8; font-size: 11px; }
  section.title-slide { padding: 80px 70px; }
  section.title-slide h1 { font-size: 56px; margin-bottom: 12px; }
  section.title-slide .tag { font-size: 22px; color: #475569; margin-bottom: 32px; }
---

<!-- _class: title-slide -->
<!-- _paginate: false -->

<div class="eyebrow">Hybrid intelligence demo</div>

# Grounded Offline AI Assistant

<div class="tag">Answers your team can trust — built on your documents and your data.</div>

**Demo prepared for:** Jenny
**Verticals shown:** Healthcare (SNF) · Property Management · Legal (Divorce + PI)
**Stack:** 100% on-premise — your data never leaves your hardware.

---

## The problem with off-the-shelf AI

<div class="grid-2">
<div class="card">

### Cloud LLMs leak data

Sending tenant ledgers, resident MAR sheets, or client alimony records to OpenAI is a non-starter for most regulated businesses.
</div>
<div class="card">

### Plain RAG hallucinates

A pure-document chatbot can read a SOP but cannot tell you *who* missed an alimony payment or *which* leases are expiring.
</div>
<div class="card">

### Generic chatbots can't cite

Without a citation back to the *exact* PDF page or *exact* SQL row, the answer is unverifiable — and unusable in your workflow.
</div>
<div class="card">

### Knowledge lives in two places

Your team needs the **policy** (in docs) **and** the **records** (in the database) — at the same time, in one answer.
</div>
</div>

---

## What this assistant does — one sentence

> It routes each question to **SQL**, **document search**, or **both**, executes them in parallel, and writes a short answer where **every claim is a clickable citation**.

<div class="grid-2" style="margin-top: 20px;">
<div class="card">

### Grounded
Every sentence cites either a PDF page or a SQL row. No silent hallucinations.
</div>
<div class="card">

### Hybrid
Combines unstructured docs (SOPs, handbooks) with structured tables (residents, leases, cases).
</div>
<div class="card">

### Offline
Runs entirely on your hardware — Ollama + local embeddings + local vector store.
</div>
<div class="card">

### Auditable
Every query logged, every citation traceable, every routing decision exposed.
</div>
</div>

---

## Architecture at a glance

<div class="ascii">
        ┌─────────────────────────────────────────────────────────┐
        │                    Your question                         │
        └──────────────────────────┬──────────────────────────────┘
                                   ▼
                         ┌──────────────────┐
                         │   Planner LLM    │   one call →  {route, sql, docs_query}
                         │  (llama3 / qwen) │
                         └────────┬─────────┘
                                  │
              ┌───────────────────┼───────────────────┐
              ▼                                       ▼
   ┌────────────────────┐                  ┌────────────────────┐
   │  SQLite (records)  │   ◀── parallel ─▶│ Qdrant (PDF chunks)│
   │  residents, cases, │                  │  bge-small embeds  │
   │  leases, filings…  │                  │  per-doc diversify │
   └─────────┬──────────┘                  └─────────┬──────────┘
             │                                       │
             └───────────────────┬───────────────────┘
                                 ▼
                       ┌──────────────────┐
                       │   Answer LLM     │   composes prose
                       │   (grounded)     │   inserts [doc:…]/[sql:…]
                       └────────┬─────────┘
                                ▼
        ┌────────────────────────────────────────────────────────┐
        │    Streamed answer + clickable evidence panel          │
        └────────────────────────────────────────────────────────┘
</div>

---

## Three verticals — all running in one demo

<div class="grid-2">
<div class="card">

### ◐ Healthcare (SNF)
- **Database:** residents, medications, allergies, PT approvals, falls, admissions
- **Docs:** insulin protocol, fall-risk SOP, HIPAA Security Rule (NIST 800-66r2)
- **Sample asks:** *"What is Robert Miller allergic to?"* · *"What is our insulin admin policy?"*
</div>
<div class="card">

### ◓ Property Management
- **Database:** tenants, leases, properties, payments
- **Docs:** tenant handbook, Ohio landlord-tenant law
- **Sample asks:** *"Which leases expire in 6 months and what does the handbook say about renewal notices?"*
</div>
<div class="card">

### ◑ Legal — Divorce
- **Database:** clients, cases, alimony_payments, filings
- **Docs:** settlement enforcement SOP, custody-violation memo
- **Sample asks:** *"Show all missed alimony payments for Michael Rosenberg and retrieve the enforcement procedure."*
</div>
<div class="card">

### ◑ Legal — Personal Injury
- **Database:** clients, cases, treatments, filings (SOL deadlines)
- **Docs:** case-strategy memo on treatment gaps
- **Sample asks:** *"Did Robert Diaz miss any treatment appointments, and what does our memo say about gaps?"*
</div>
</div>

<p class="muted">All entities (Robert Miller, Devon Patel, Michael Rosenberg, Robert Diaz, etc.) are pre-seeded in the sample database so the demo answers feel real, not abstract.</p>

---

## The routing decision — live, on every question

<div class="ascii">
Q: "Show all missed alimony payments for Michael Rosenberg
    and retrieve the enforcement procedure from our settlement SOP."

Planner LLM (in one call):
{
  "route":         "hybrid",                ◀── needs BOTH DB + docs
  "sql_query":     "SELECT due_date, amount, status
                    FROM alimony_payments
                    WHERE client = 'Michael Rosenberg'
                      AND status = 'missed' LIMIT 50",
  "docs_query":    "settlement enforcement procedure",
  "rationale":     "records + policy memo"
}

→ SQL runs in parallel with Qdrant vector search (~10× faster than sequential)
→ Both evidence sets are handed to the answer LLM with a strict grounding prompt
→ Streamed answer cites [sql:…] for the missed payments and [doc:…] for the SOP
</div>

---

## Key differentiator #1 — Grounded citations

Every claim in the answer carries one of two markers:

- `[doc:tenant_handbook.pdf p.2]` — clickable; opens the PDF at the right page with the matching passage highlighted in yellow
- `[sql:SELECT … FROM …]` — clickable; opens the actual SQL + the rows returned

<div class="card" style="margin-top: 14px;">

**Why this matters for Jenny's clients:**
- Lawyers/nurses/property managers don't trust AI by default. A clickable citation turns "trust me" into **"see for yourself."**
- Compliance-grade: every answer is reproducible from the evidence panel.
- If the LLM tries to make a claim without evidence, the **refusal gate** kicks in — it returns *"I don't have enough grounded information"* instead of guessing.
</div>

---

## Key differentiator #2 — Hybrid SQL + RAG (with parallel execution)

Most "AI search" tools are either pure-RAG or pure-text2SQL. This one runs **both** when the question needs it:

<div class="grid-2">
<div class="card">

### Pure-SQL questions
*"How many residents are at the facility?"*
*"What medications is Robert allergic to?"*

→ Fast path: skip the answer LLM, return a deterministic sentence directly. **~5–20s end-to-end.**
</div>
<div class="card">

### Pure-docs questions
*"What is our insulin policy?"*
*"What does the handbook say about pets?"*

→ Vector search → LLM composes a grounded paragraph with PDF citations.
</div>
<div class="card">

### Hybrid questions
*"Has Robert missed treatments, and what does our memo say about gaps?"*

→ SQL + Qdrant run **in parallel**, then a single LLM call weaves the two evidence streams together. **~30–70s on 8B local LLM.**
</div>
<div class="card">

### Domain glossary
*"Which clients have upcoming **SOL** deadlines?"*

→ Acronym detected → glossary PDF retrieved → router translates "SOL" → `filings.filing_type LIKE 'Statute%'` automatically.
</div>
</div>

---

## Key differentiator #3 — 100% on-premise

<div class="grid-2">
<div class="card">

### What's local
- **LLM** runs on Ollama (Llama 3.1 8B / Llama 3.2 3B / Qwen 2.5 7B)
- **Embeddings** — BAAI/bge-small-en-v1.5 (384-dim, MTEB-ranked)
- **Vector store** — Qdrant container, all chunks stay on your disk
- **Database** — SQLite, never leaves the host
- **PDFs** — uploaded once, ingested once, never re-uploaded anywhere

</div>
<div class="card">

### What's NOT in the picture
- ❌ No OpenAI / Anthropic API calls
- ❌ No HIPAA-blocking cloud LLMs
- ❌ No vendor data residency questions
- ❌ No per-token billing surprises
- ❌ No internet required after install

→ **Air-gap deployable** for the most sensitive verticals.
</div>
</div>

---

## Demo UX — what Jenny will see

<div class="grid-2">
<div class="card">

### Phase-aware streaming
The UI shows what the assistant is doing in real time:
- **Planning** — reading question, loading schema
- **Gathering** — querying database, searching docs
- **Composing** — weaving evidence into the answer

Live row counts, doc chunk counts, and top match scores appear inline.

</div>
<div class="card">

### Evidence panel
Click any `[doc:…]` chip → side panel opens with the **exact PDF passage highlighted**.
Click any `[sql:…]` chip → side panel shows the **SQL query and rows returned**.

The full PDF is one more click away — opens with the cited region scrolled into view.

</div>
<div class="card">

### Model picker
Switch on the fly between **Fast (1B)**, **Balanced (3B)**, and **Smart (8B/7B)** for different quality/latency trade-offs.

</div>
<div class="card">

### Upload a new PDF
Drop a new policy/SOP/handbook into the composer — it ingests in seconds and is immediately available to every future question.

</div>
</div>

---

## Quality safeguards under the hood

| Safeguard | What it does | Why it matters |
|---|---|---|
| **Few-shot router prompt** | 10+ worked examples cover the 3 verticals | Routing accuracy 93%+ across the eval suite |
| **Refusal gate** | If neither SQL nor docs have strong evidence → refuse with a clear message | No silent hallucinations |
| **SQL repair loop** | On error or zero rows, LLM is asked to fix the query (up to 2 retries) | Recovers from typos and overly-specific filters |
| **Per-document diversification** | Top-K is round-robin'd across files | A 500-page PDF can't drown out a 5-page SOP |
| **Domain glossary** | Acronyms (SOL, PT, DKA, MAR, ePHI) auto-map to schema | Users can speak naturally, no jargon training needed |
| **Audit log** | Every query + answer + route stored in SQLite | Compliance, debugging, future fine-tuning data |

---

## Performance — measured, not promised

15-case eval suite covering all 3 verticals (SQL, docs, hybrid, refusal):

<div class="grid-2">
<div class="card">

### Local Mac (Llama 3.1 8B)
- **Pass rate:** 11/15 (73%)
- **Routing OK:** 14/15 (93%)
- **Citations OK:** 15/15 (100%)
- **Latency p50:** ~40s
- **Latency p95:** ~71s

<span class="pill pill-good">Production-quality on a developer Mac</span>

</div>
<div class="card">

### Hostinger VPS (Llama 3.2 3B, CPU-only)
- **Pass rate:** 9/15 (60%)
- **Routing OK:** 13/15 (87%)
- **Citations OK:** 14/15 (93%)
- **Latency p50:** ~124s

<span class="pill pill-warn">Slower but demos cleanly — public URL for stakeholder review</span>

</div>
</div>

<p class="muted">Eval suite is reproducible: <code>python scripts/eval.py</code>. New verticals = ~10 new test cases, scored automatically.</p>

---

## Three deploys, three audiences

<div class="grid-2">
<div class="card">

### Hugging Face Space
Public URL, anyone can try the demo. Auto-ingests the baked SOPs on startup.
<span class="pill">stakeholders</span>
</div>
<div class="card">

### Local Mac (Docker Compose)
The dev environment — fastest, has GPU/MPS acceleration via Ollama.
<span class="pill">development</span>
</div>
<div class="card">

### Hostinger VPS
Private URL on your own VPS — CPU-only but proves on-prem deployment.
<span class="pill">production POC</span>
</div>
<div class="card">

### What scales from here
Same Docker Compose stack drops onto: a clinic NUC, a law firm tower, an office Mac mini, a private Kubernetes cluster. **No rewrite.**

</div>
</div>

---

## What's next — for production

<div class="grid-2">
<div class="card">

### Short-term polish
- Per-message copy / regenerate actions
- Light/dark mode
- Mobile responsive composer
- Stream the **planner** call too for instant "thinking" feedback

</div>
<div class="card">

### Vertical depth
- Pull from real ledgers (QuickBooks / Yardi / Clio adapters)
- Connect to a clinic EHR sandbox (FHIR)
- Add document-watch on a SharePoint / Google Drive folder

</div>
<div class="card">

### Trust + audit
- Per-user role enforcement (who can see whose cases)
- Exportable PDF report from any answer (for case files)
- Detector for sensitive PII before composing — redact on the fly

</div>
<div class="card">

### Model strategy
- Fine-tune a smaller model on vertical-specific Q&A
- Plug in a domain-specific reranker
- Add a "second-opinion" pass for high-stakes answers (legal, clinical)

</div>
</div>

---

<!-- _class: title-slide -->
<!-- _paginate: false -->

<div class="eyebrow">Ready when you are</div>

# Thanks, Jenny.

<div class="tag">Happy to walk through any vertical live, on any data you'd like to send over.</div>

**Mohit**
mohit-star.netlify.app

Public demo: HF Space · Private demo: Hostinger VPS · Source: local Mac
