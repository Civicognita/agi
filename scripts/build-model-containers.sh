#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# build-model-containers.sh — build HuggingFace model runtime container images
#
# Builds the container images locally so models can be served via Podman.
# Called by hosting-setup.sh and upgrade.sh when HF is enabled.
#
# Images:
#   ghcr.io/civicognita/transformers-server:latest  — general runtime
#   ghcr.io/civicognita/diffusion-server:latest     — diffusion runtime
#   LLM runtime also uses transformers-server (supports all model formats)
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTAINERS_DIR="${SCRIPT_DIR}/../containers"

info()  { echo -e "\033[0;34m[info]\033[0m $*"; }
ok()    { echo -e "\033[0;32m[ok]\033[0m $*"; }
warn()  { echo -e "\033[0;33m[warn]\033[0m $*"; }

if ! command -v podman &>/dev/null; then
  warn "podman not installed — skipping container image builds"
  exit 0
fi

# General runtime (transformers + fastapi)
info "Building general model runtime image..."
podman build \
  -t ghcr.io/civicognita/transformers-server:latest \
  -f "${CONTAINERS_DIR}/Containerfile.general" \
  "${CONTAINERS_DIR}"
ok "ghcr.io/civicognita/transformers-server:latest built"

# Diffusion runtime (diffusers + fastapi)
info "Building diffusion model runtime image..."
podman build \
  -t ghcr.io/civicognita/diffusion-server:latest \
  -f "${CONTAINERS_DIR}/Containerfile.diffusion" \
  "${CONTAINERS_DIR}"
ok "ghcr.io/civicognita/diffusion-server:latest built"

# LLM runtime — uses the same transformers-server as general runtime (supports all formats)
# No separate pull needed — transformers-server is built above

# Fine-tune runtime (PEFT/LoRA via trl + transformers)
info "Building fine-tune runtime image..."
podman build \
  -t agi-finetune:latest \
  -f "${CONTAINERS_DIR}/Containerfile.finetune" \
  "${CONTAINERS_DIR}"
ok "agi-finetune:latest built"

ok "Model runtime container images ready"
