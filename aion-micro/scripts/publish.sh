#!/usr/bin/env bash
# publish.sh — merge LoRA, quantize to GGUF, push to HuggingFace Hub.
#
# Usage:  ./scripts/publish.sh <version> [--repo <owner/name>]
#         e.g.  ./scripts/publish.sh v2
#               ./scripts/publish.sh v2 --repo wishborn/aion-micro-v2
#
# Requires: Python 3.10+ with transformers + peft + huggingface_hub
#           llama.cpp checkout at $LLAMA_CPP (defaults to ~/llama.cpp)
#           HF token in environment as HF_TOKEN, or `huggingface-cli login`
#
# Steps:
#   1. Merge adapter into base weights → temp safetensors
#   2. Convert to GGUF q4_K_M (small) + q8_0 (accurate) via llama.cpp
#   3. Push both .gguf files + a model card to HuggingFace Hub

set -euo pipefail

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  echo "Usage: $0 <version> [--repo <owner/name>]" >&2
  exit 1
fi
shift || true

REPO="wishborn/aion-micro-${VERSION}"
while [ $# -gt 0 ]; do
  case "$1" in
    --repo) REPO="$2"; shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ADAPTER_DIR="${ROOT}/adapters/${VERSION}"
TRAINING_FILE="${ROOT}/training-data/${VERSION}.jsonl"
LLAMA_CPP="${LLAMA_CPP:-${HOME}/llama.cpp}"
BASE_MODEL="${BASE_MODEL:-HuggingFaceTB/SmolLM2-135M-Instruct}"

if [ ! -d "$ADAPTER_DIR" ]; then
  echo "ERROR: adapter not found at $ADAPTER_DIR" >&2
  echo "       Run ./scripts/fine-tune.sh ${VERSION} first." >&2
  exit 1
fi
if [ ! -d "$LLAMA_CPP" ]; then
  echo "ERROR: llama.cpp not found at $LLAMA_CPP" >&2
  echo "       export LLAMA_CPP=/path/to/llama.cpp  or clone:" >&2
  echo "       git clone https://github.com/ggerganov/llama.cpp ~/llama.cpp" >&2
  exit 1
fi

WORK="$(mktemp -d -t aion-micro-publish-XXXXXX)"
trap "rm -rf '$WORK'" EXIT

echo "[1/3] Merging adapter into base weights → ${WORK}/merged"
python3 - <<EOF
from transformers import AutoModelForCausalLM, AutoTokenizer
from peft import PeftModel

base = AutoModelForCausalLM.from_pretrained("${BASE_MODEL}")
tokenizer = AutoTokenizer.from_pretrained("${BASE_MODEL}")
model = PeftModel.from_pretrained(base, "${ADAPTER_DIR}")
merged = model.merge_and_unload()
merged.save_pretrained("${WORK}/merged")
tokenizer.save_pretrained("${WORK}/merged")
print("  merged weights written.")
EOF

echo "[2/3] Converting to GGUF (q4_K_M + q8_0)"
python3 "${LLAMA_CPP}/convert_hf_to_gguf.py" "${WORK}/merged" --outfile "${WORK}/merged-f16.gguf" --outtype f16
"${LLAMA_CPP}/build/bin/llama-quantize" "${WORK}/merged-f16.gguf" "${WORK}/aion-micro-${VERSION}-q4_K_M.gguf" Q4_K_M
"${LLAMA_CPP}/build/bin/llama-quantize" "${WORK}/merged-f16.gguf" "${WORK}/aion-micro-${VERSION}-q8_0.gguf" Q8_0

echo "[3/3] Pushing to HuggingFace Hub: ${REPO}"
python3 - <<EOF
import os
from huggingface_hub import HfApi, create_repo
api = HfApi()
create_repo("${REPO}", exist_ok=True, repo_type="model")

# Push GGUFs
for fname in ["aion-micro-${VERSION}-q4_K_M.gguf", "aion-micro-${VERSION}-q8_0.gguf"]:
    print(f"  uploading {fname}...")
    api.upload_file(path_or_fileobj="${WORK}/" + fname, path_in_repo=fname, repo_id="${REPO}")

# Push training data + model card
print("  uploading training-data/${VERSION}.jsonl...")
api.upload_file(path_or_fileobj="${TRAINING_FILE}", path_in_repo="training-data/${VERSION}.jsonl", repo_id="${REPO}")

card = """---
license: apache-2.0
base_model: ${BASE_MODEL}
tags:
  - aion-micro
  - agi
  - small
---

# Aion-Micro ${VERSION}

Fine-tuned ${BASE_MODEL} for AGI diagnostic narratives and merge-conflict resolution.

Distributed as GGUF (q4_K_M + q8_0). Served by the agi-lemonade-runtime
marketplace plugin in AGI; pull via:

    agi lemonade pull ${REPO}

Training data is included in this repo at training-data/${VERSION}.jsonl
for reproducibility.
"""
api.upload_file(path_or_fileobj=card.encode(), path_in_repo="README.md", repo_id="${REPO}")
print("done.")
EOF

echo
echo "Published: https://huggingface.co/${REPO}"
echo "Pull via:  agi lemonade pull ${REPO}"
