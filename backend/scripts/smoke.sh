#!/usr/bin/env bash
# Quick end-to-end smoke test. Requires: docker compose up running, Ollama up, model pulled.
set -euo pipefail

BASE="${BASE:-http://localhost:8000}"
PDF="${PDF:-sample_data/tenant_handbook.pdf}"

echo "== health =="
curl -sS "$BASE/health" | python3 -m json.tool

echo
echo "== ingest $PDF =="
curl -sS -F "file=@${PDF}" "$BASE/ingest" | python3 -m json.tool

ask() {
    local q="$1"
    echo
    echo "== Q: $q =="
    curl -sS -H 'Content-Type: application/json' \
        -d "{\"question\": \"$q\"}" \
        "$BASE/query" | python3 -m json.tool
}

ask "Which leases expire in the next 6 months and what does the handbook say about renewal notice?"
ask "How much rent did Devon Patel pay in the last 3 months, and what is the late fee policy?"
ask "Are pets allowed and how many active tenants do we have?"
ask "What is the security deposit policy for a 2-year lease?"
ask "What is the policy on cryptocurrency rent payments?"
