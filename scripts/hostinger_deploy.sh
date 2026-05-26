#!/usr/bin/env bash
# One-shot deploy of the Offline AI Assistant on a fresh Hostinger KVM VPS.
# Idempotent — safe to re-run.
#
# Usage (on the VPS, as root):
#   curl -fsSL https://raw.githubusercontent.com/mohitviionn-star/offline-ai-assistant/main/scripts/hostinger_deploy.sh | bash
#
# Or:
#   wget -O deploy.sh https://raw.githubusercontent.com/mohitviionn-star/offline-ai-assistant/main/scripts/hostinger_deploy.sh
#   bash deploy.sh

set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

OLLAMA_MODEL_NAME="${OLLAMA_MODEL:-qwen2.5:3b}"
REPO_URL="https://github.com/mohitviionn-star/offline-ai-assistant.git"
REPO_DIR="/root/offline-ai-assistant"

say() { printf "\n\033[1;36m▶ %s\033[0m\n" "$*"; }

# ---------- 1. System deps ----------
say "Updating apt + installing prerequisites"
apt-get update -y
apt-get install -y curl ca-certificates gnupg lsb-release git ufw

# ---------- 2. Docker (official convenience script) ----------
if ! command -v docker >/dev/null; then
  say "Installing Docker"
  curl -fsSL https://get.docker.com | sh
else
  say "Docker already installed: $(docker --version)"
fi

# ---------- 3. docker-compose plugin ----------
if ! docker compose version >/dev/null 2>&1; then
  say "Installing docker-compose plugin"
  apt-get install -y docker-compose-plugin
fi
echo "compose: $(docker compose version)"

# ---------- 4. Ollama ----------
if ! command -v ollama >/dev/null; then
  say "Installing Ollama"
  curl -fsSL https://ollama.com/install.sh | sh
fi

# Bind Ollama on all interfaces so Docker containers can reach it via host-gateway
say "Configuring Ollama to listen on 0.0.0.0:11434"
mkdir -p /etc/systemd/system/ollama.service.d
cat >/etc/systemd/system/ollama.service.d/host.conf <<'EOF'
[Service]
Environment="OLLAMA_HOST=0.0.0.0:11434"
EOF
systemctl daemon-reload
systemctl restart ollama
sleep 6

# ---------- 5. Pull model ----------
say "Pulling model: ${OLLAMA_MODEL_NAME}"
ollama pull "${OLLAMA_MODEL_NAME}"

# Verify Ollama is reachable
if ! curl -fsS http://127.0.0.1:11434/api/tags >/dev/null; then
  echo "Ollama not responding on 127.0.0.1:11434 — aborting" >&2
  exit 1
fi

# ---------- 6. Clone / update repo ----------
if [ ! -d "${REPO_DIR}/.git" ]; then
  say "Cloning ${REPO_URL}"
  git clone "${REPO_URL}" "${REPO_DIR}"
else
  say "Updating repo"
  git -C "${REPO_DIR}" fetch origin main
  git -C "${REPO_DIR}" reset --hard origin/main
fi

cd "${REPO_DIR}"

# ---------- 7. Compose up ----------
say "Building and starting containers (Ollama URL = host.docker.internal:11434)"
export OLLAMA_MODEL="${OLLAMA_MODEL_NAME}"
docker compose down 2>/dev/null || true
docker compose up -d --build

# ---------- 8. Wait for backend ----------
say "Waiting for backend health..."
for i in $(seq 1 90); do
  if curl -fsS http://localhost:8000/health >/dev/null 2>&1; then
    echo "backend ok"
    break
  fi
  sleep 2
done

curl -fsS http://localhost:8000/health || { echo "backend never came up"; exit 1; }

# ---------- 9. Ingest PDFs ----------
say "Ingesting demo PDFs into Qdrant (CPU embedding, takes ~3-5 min)"
PDFS=(
  sample_data/jenny-sources/snf/fall-prevention-policy.pdf
  sample_data/jenny-sources/snf/insulin-administration-protocol.pdf
  sample_data/jenny-sources/snf/rehab-admission-process.pdf
  sample_data/jenny-sources/snf/wound-care-procedures.pdf
  sample_data/jenny-sources/legal/custody-and-visitation-sop.pdf
  sample_data/jenny-sources/legal/mediation-preparation-checklist.pdf
  sample_data/jenny-sources/legal/personal-injury-case-strategy.pdf
  sample_data/jenny-sources/legal/settlement-distribution-procedure.pdf
  sample_data/jenny-sources/hipaa/nist-800-66r2-hipaa-security.pdf
  sample_data/jenny-sources/real-estate/ohio-landlord-tenant-handbook.pdf
)
for pdf in "${PDFS[@]}"; do
  if [ -f "$pdf" ]; then
    name=$(basename "$pdf")
    printf "  → %s ... " "$name"
    out=$(curl -sS -X POST -F "file=@${pdf}" http://localhost:8000/ingest --max-time 900 || echo '{"error":"timeout"}')
    chunks=$(echo "$out" | grep -o '"chunks":[0-9]*' | cut -d: -f2 || echo "?")
    pages=$(echo "$out" | grep -o '"pages":[0-9]*' | cut -d: -f2 || echo "?")
    echo "chunks=$chunks pages=$pages"
  fi
done

# ---------- 10. Firewall ----------
say "Configuring firewall (ssh + 5174 frontend + 8000 backend)"
ufw allow ssh >/dev/null 2>&1 || true
ufw allow 5174/tcp >/dev/null 2>&1 || true
ufw allow 8000/tcp >/dev/null 2>&1 || true
ufw --force enable >/dev/null 2>&1 || true
ufw status

# ---------- 11. Done ----------
PUBLIC_IP=$(curl -fsS https://ifconfig.me || hostname -I | awk '{print $1}')
say "DEPLOYED"
echo
echo "  Frontend: http://${PUBLIC_IP}:5174"
echo "  API:      http://${PUBLIC_IP}:8000"
echo "  Model:    ${OLLAMA_MODEL_NAME} (via Ollama on the VPS)"
echo
echo "To redeploy after a code push:"
echo "  cd ${REPO_DIR} && git pull && docker compose up -d --build"
