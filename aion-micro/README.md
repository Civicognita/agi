# Aion-Micro

Lightweight AGI-specific LLM used for `agi doctor` diagnostic narratives and core-fork merge-conflict resolution. Fine-tuned LoRA on top of `HuggingFaceTB/SmolLM2-135M-Instruct`, distributed as GGUF via HuggingFace Hub, and served at runtime by the **Lemonade local AI runtime** (the `agi-lemonade-runtime` marketplace plugin).

## Why this exists

The default-shipped Aion-Micro is calibrated specifically for AGI diagnostic prompts (failures, warnings, root-cause patterns) and for narrow OURS/THEIRS/UNCLEAR judgments on merge conflicts. Two reasons it's not just "use any small model":

1. **Diagnostic output shape**: dashboards render Aion's narrative directly. Generic small models drift in tone and structure across versions; the LoRA pins the shape.
2. **Merge-conflict precision**: the merge-conflict tier uses 16-token answers with `temperature=0`. Generic 135M models sometimes wander; the fine-tuning hardens the OURS/THEIRS/UNCLEAR contract.

## Layout

```
aion-micro/
├── adapters/
│   └── v1/                    Latest LoRA adapter (PEFT format)
│       ├── adapter_config.json
│       └── adapter_model.safetensors
├── training-data/
│   └── v1.jsonl               JSONL training corpus (one example per line)
├── scripts/
│   ├── fine-tune.sh           Train a new adapter from training-data/
│   └── publish.sh             Merge → quantize → push to HuggingFace Hub
└── README.md
```

## Distribution

The plugin pulls `wishborn/aion-micro-v1` from HuggingFace Hub by default (see `AionMicroConfig.model` in `packages/gateway-core/src/aion-micro-manager.ts`). Owners can override via `gateway.json`:

```json
{
  "ops": {
    "aionMicro": {
      "enabled": true,
      "model": "wishborn/aion-micro-v2",
      "fallbackModel": "SmolLM2-135M-Instruct"
    }
  }
}
```

Fallback is upstream `SmolLM2-135M-Instruct` so the platform stays functional in degraded environments (no HF Hub access, fine-tuned model not yet pulled).

## Iteration loop

When AGI's prompt surface evolves and Aion-Micro needs retraining:

1. Add new examples to `training-data/v{N+1}.jsonl`.
2. Run `scripts/fine-tune.sh v{N+1}` → produces `adapters/v{N+1}/`.
3. Run `scripts/publish.sh v{N+1}` → merges adapter + quantizes to GGUF + pushes to `wishborn/aion-micro-v{N+1}` on HuggingFace.
4. Bump the plugin manifest's default model name.
5. Owners get the new model on next `agi upgrade` + Lemonade pull.

The training data lives in this repo — Hub is the distribution channel, repo is the source of truth.

## Why Lemonade serves it (not a custom container)

Pre-K.4, Aion-Micro shipped as a custom Podman + FastAPI container that loaded SmolLM2 + applied the LoRA at boot via PEFT. That was ~300 lines of plumbing (Containerfile, Python entrypoint, PyTorch + transformers + peft deps, a healthcheck, podman lifecycle in TypeScript) for what's essentially "serve a small model with an OpenAI-compatible API." Lemonade does exactly that, supports the same hardware tiers (CPU/GPU/NPU), and is already part of the platform via `agi-lemonade-runtime`. Retiring the custom container removes the duplication and simplifies the manager from ~250 lines of podman exec calls to ~280 lines of HTTP client code (most of which is the merge-conflict parser, identical to before).

## Background

- Plugin: `agi-lemonade-runtime` (in agi-marketplace)
- Manager: `packages/gateway-core/src/aion-micro-manager.ts`
- Callers: `packages/gateway-core/src/admin-api.ts` (status endpoint), `packages/gateway-core/src/dev-mode-merge.ts` (merge-conflict path)
