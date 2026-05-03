#!/usr/bin/env bash
# agi-runtime:lamp — build script
#
# Builds the LAMP+Node base image for multi-repo project containers
# (s130 t515 B4). Tags as `agi-runtime:lamp` so hosting-manager's
# `--image` flag can resolve it. Idempotent — re-running rebuilds the
# image but uses Docker layer cache for unchanged layers.
#
# Usage:
#   bash scripts/runtime-images/lamp/build.sh
#
# Or: from agi root, `pnpm runtime:build:lamp`.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TAG="agi-runtime:lamp"

echo "[lamp] Building $TAG from $SCRIPT_DIR..."
podman build -t "$TAG" "$SCRIPT_DIR"
echo "[lamp] Built $TAG"

# Sanity probe — ensure all the expected runtimes are present.
echo "[lamp] Verifying runtimes..."
podman run --rm "$TAG" bash -lc '
  set -e
  echo "  node:  $(node --version)"
  echo "  npm:   $(npm --version)"
  echo "  pnpm:  $(pnpm --version)"
  echo "  npx concurrently: $(npx --no-install concurrently --version)"
  echo "  php:   $(php --version | head -1)"
  echo "  apache: $(apache2 -v | head -1)"
  echo "  git:   $(git --version)"
  echo "  dumb-init: $(dumb-init --version 2>&1 | head -1)"
'
echo "[lamp] OK"
