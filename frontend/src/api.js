const BASE = "/api";

export async function postQuery(question, model = null) {
  const r = await fetch(`${BASE}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, model }),
  });
  if (!r.ok) throw new Error(`query failed: ${r.status}`);
  return r.json();
}

export async function listModels() {
  const r = await fetch(`${BASE}/models`);
  if (!r.ok) return { current: null, available: [] };
  return r.json();
}

/**
 * Streaming version. Consumes Server-Sent Events from /api/query/stream.
 * Callbacks fire in this order:
 *   onPlan({route, rationale, sql_query, sql_rationale, docs_query,
 *           clarification, clarification_options})                     — step 1 done (early UI render)
 *   onStep({kind, status, ...})                                        — per-phase progress (sql/docs start/done)
 *   onMeta({route, rationale, citations, evidence})                    — after SQL exec + Qdrant search
 *   onToken(text)                                                      — answer fragments
 *   onDone({confidence, latency_ms, fast_path?, gated?, clarification_required?})
 *   onFollowups({questions: [...]})                                    — optional, after done
 *   onError(err)
 */
export async function streamQuery(question, { model = null, signal, onPlan, onStep, onMeta, onToken, onDone, onFollowups, onError } = {}) {
  let r;
  try {
    r = await fetch(`${BASE}/query/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, model }),
      signal,
    });
  } catch (e) {
    // Don't treat user-initiated cancel as an error.
    if (e?.name === "AbortError") return;
    onError?.(e);
    return;
  }
  if (!r.ok) {
    onError?.(new Error(`stream failed: ${r.status}`));
    return;
  }
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  // Parse SSE: events separated by blank lines, lines start with "event:" or "data:"
  const handleEvent = (block) => {
    const lines = block.split("\n");
    let event = "message";
    let data = "";
    for (const line of lines) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data += line.slice(5).trim();
    }
    if (!data) return;
    let parsed;
    try { parsed = JSON.parse(data); } catch { return; }
    if (event === "plan") onPlan?.(parsed);
    else if (event === "step") onStep?.(parsed);
    else if (event === "meta") onMeta?.(parsed);
    else if (event === "token") onToken?.(parsed.text || "");
    else if (event === "done") onDone?.(parsed);
    else if (event === "followups") onFollowups?.(parsed);
    else if (event === "error") onError?.(new Error(parsed.error || "stream error"));
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (block) handleEvent(block);
      }
    }
    if (buffer.trim()) handleEvent(buffer);
  } catch (e) {
    // Reader throws AbortError when the AbortController is triggered.
    if (e?.name !== "AbortError") onError?.(e);
  }
}

export async function ingestPdf(file) {
  const fd = new FormData();
  fd.append("file", file);
  const r = await fetch(`${BASE}/ingest`, { method: "POST", body: fd });
  if (!r.ok) throw new Error(`ingest failed: ${r.status}`);
  return r.json();
}

export async function listDocuments() {
  const r = await fetch(`${BASE}/documents`);
  return r.json();
}

export async function getHealth() {
  const r = await fetch(`${BASE}/health`);
  return r.json();
}

export async function getSchema() {
  const r = await fetch(`${BASE}/schema`);
  return r.json();
}
