#!/usr/bin/env bash
# agi-runtime:polyglot — build script
#
# Builds the Python 3.12 + Node 24 base image for mixed-language
# multi-repo project containers. Tags as `agi-runtime:polyglot`.
#
# Usage:
#   bash scripts/runtime-images/polyglot/build.sh
#
# Or: pnpm runtime:build:polyglot

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TAG="agi-runtime:polyglot"

echo "[polyglot] Building $TAG from $SCRIPT_DIR..."
podman build -t "$TAG" "$SCRIPT_DIR"
echo "[polyglot] Built $TAG"

echo "[polyglot] Verifying runtimes..."
podman run --rm "$TAG" bash -lc '
  set -e
  echo "  node:        $(node --version)"
  echo "  npm:         $(npm --version)"
  echo "  pnpm:        $(pnpm --version)"
  echo "  concurrently: $(npx --no-install concurrently --version)"
  echo "  python:      $(python3 --version)"
  echo "  pip:         $(pip3 --version)"
  echo "  uvicorn:     $(uvicorn --version)"
  echo "  gunicorn:    $(gunicorn --version)"
  echo "  fastapi:     $(python3 -c '\''import fastapi; print(fastapi.__version__)'\'')"
  echo "  flask:       $(python3 -c '\''import flask; print(flask.__version__)'\'')"
  echo "  django:      $(python3 -c '\''import django; print(django.__version__)'\'')"
  echo "  dumb-init:   $(dumb-init --version 2>&1 | head -1)"
'
echo "[polyglot] OK"
