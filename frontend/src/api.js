const BASE = "/api";

export async function postQuery(question) {
  const r = await fetch(`${BASE}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
  });
  if (!r.ok) throw new Error(`query failed: ${r.status}`);
  return r.json();
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
