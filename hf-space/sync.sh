#!/usr/bin/env bash
# Builds a self-contained deploy folder at hf-space/_build/ that can be
# pushed to a Hugging Face Space repo as-is.
#
# Usage:
#   bash hf-space/sync.sh
#
# Then:
#   cd hf-space/_build
#   git init && git add . && git commit -m "deploy"
#   git remote add space https://huggingface.co/spaces/<user>/<name>
#   git push space main --force
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAGE="$ROOT/hf-space/_build"

echo "[sync] staging into $STAGE"
rm -rf "$STAGE"
mkdir -p "$STAGE"

# Copy backend (full app source) — overrides will replace specific files below.
rsync -a --exclude '__pycache__' "$ROOT/backend/" "$STAGE/backend/"

# Copy frontend source (Dockerfile stage 1 builds it inside the image).
rsync -a \
  --exclude 'node_modules' --exclude 'dist' --exclude 'build' \
  "$ROOT/frontend/" "$STAGE/frontend/"

# Copy hf-space scaffolding (Dockerfile, README, entrypoint, overrides).
rsync -a \
  --exclude '_build' --exclude '.git' \
  "$ROOT/hf-space/" "$STAGE/hf-space/"

# Move README + Dockerfile to the staging root — HF expects them at the repo root.
mv "$STAGE/hf-space/README.md" "$STAGE/README.md"
cp "$STAGE/hf-space/Dockerfile" "$STAGE/Dockerfile"
cp "$STAGE/hf-space/.dockerignore" "$STAGE/.dockerignore"

# Bake demo data into the staged folder.
mkdir -p "$STAGE/hf-space/baked"
cp "$ROOT/sample_data/tenant_handbook.pdf" "$STAGE/hf-space/baked/"
cp "$ROOT/sample_data/business.db" "$STAGE/hf-space/baked/"

echo "[sync] done."
echo
echo "Next:"
echo "  cd $STAGE"
echo "  git init && git add . && git commit -m 'deploy'"
echo "  git remote add space https://huggingface.co/spaces/<USER>/<SPACE>"
echo "  git push space main --force"
echo
echo "Before pushing, set the GROQ_API_KEY secret in the Space settings."
