# HuggingFace Integration

This document describes the HuggingFace model marketplace integration for AI coding agents and contributors working on the Aionima codebase. It covers architecture, key files, API surface, and the agent tool interface.

---

## Overview

The HF integration enables Aionima to browse the HuggingFace Hub, download model files locally, and serve them via Podman containers that expose OpenAI-compatible inference endpoints. MApps and the agent's `hf_models` tool consume these endpoints.

The feature is opt-in: it is enabled or disabled via the `hf.enabled` flag in `aionima.json`. When disabled, all HF routes return `503` and the `hf_models` tool is unregistered.

---

## Package: `@aionima/model-runtime`

All HF-related logic lives in `packages/model-runtime/`. This package is loaded by `gateway-core` during boot when `hf.enabled` is true.

### Key Files

| File | Purpose |
|------|---------|
| `src/types.ts` | Shared TypeScript types: `HFModel`, `HFVariant`, `ModelInstallRecord`, `RunningModel`, `HardwareProfile`, `ContainerRuntimeType`, `InferenceEndpoint` |
| `src/hardware-profiler.ts` | Detects CPU cores, total RAM, GPU presence/VRAM via `/proc/cpuinfo`, `/proc/meminfo`, and `nvidia-smi` / `rocm-smi`. Returns `HardwareProfile`. |
| `src/hf-hub-client.ts` | HTTP client for the HuggingFace Hub API. Methods: `search(query, task?, limit?)`, `getModel(modelId)`, `listVariants(modelId)`. Respects the `hf.apiToken` config field for authenticated requests. |
| `src/model-store.ts` | Persistent store (SQLite via `better-sqlite3`) for install records. Tracks model ID, variant, local path, install timestamp, and status. Database file: `~/.agi/models/model-store.db`. |
| `src/model-container-manager.ts` | Podman lifecycle management. Pulls images, starts/stops containers, maps host ports (6000–6099), and writes container IDs to the store. |
| `src/capability-resolver.ts` | Takes a `HardwareProfile` and a model's metadata and returns a `CompatibilityResult` — whether the hardware can run the model, and at what quality level. Used to filter and annotate search results in the UI. |
| `src/inference-gateway.ts` | Reverse-proxy layer that routes `/api/hf/inference/:modelId/*` to the correct running container port. Handles container-not-running errors with a clear message. |
| `src/agent-bridge.ts` | Implements the `hf_models` agent tool. Registered by `gateway-core` when model-runtime is loaded. |
| `src/hf-api.ts` | Fastify route plugin. Mounts all `/api/hf/*` REST endpoints. Imported by `gateway-core/src/routes/index.ts`. |

---

## Configuration

The `hf` section of `~/.agi/aionima.json`:

```json
{
  "hf": {
    "enabled": true,
    "apiToken": "hf_...",
    "modelDir": "~/.agi/models",
    "maxConcurrentDownloads": 2,
    "portRange": { "start": 6000, "end": 6099 }
  }
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `enabled` | `false` | Master switch for the HF feature |
| `apiToken` | `""` | HuggingFace access token (required for gated models) |
| `modelDir` | `~/.agi/models` | Where model files are stored on disk |
| `maxConcurrentDownloads` | `2` | Parallel download limit |
| `portRange.start` | `6000` | First port for inference containers |
| `portRange.end` | `6099` | Last port for inference containers |

Config is read at use-time — never cached at boot. Changing `hf.enabled` takes effect on the next request without a restart.

---

## REST API

All endpoints are under `/api/hf/`. Authentication follows the standard Aionima session cookie — only `sealed` tier entities can write (install/start/stop); `verified` can read.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/hf/status` | Feature enabled flag, installed count, running count, hardware profile |
| `GET` | `/api/hf/hardware` | Detected hardware profile with compatibility thresholds |
| `GET` | `/api/hf/search` | Search HuggingFace Hub. Query params: `q`, `task`, `limit` |
| `GET` | `/api/hf/models` | List all locally installed models |
| `GET` | `/api/hf/models/:id` | Get a single installed model record |
| `POST` | `/api/hf/models/install` | Start a model download. Body: `{ modelId, variantId }` |
| `DELETE` | `/api/hf/models/:id` | Delete an installed model (must be stopped first) |
| `POST` | `/api/hf/models/:id/start` | Start inference container for an installed model |
| `POST` | `/api/hf/models/:id/stop` | Stop inference container |
| `GET` | `/api/hf/running` | List all currently running model containers |
| `ANY` | `/api/hf/inference/:modelId/*` | Proxy to the running model's inference endpoint |

---

## Container Runtime Types

The `ContainerRuntimeType` enum determines which Podman image and startup flags are used:

| Type | Models | Image | Notes |
|------|--------|-------|-------|
| `llm` | Text generation LLMs | `ghcr.io/ggerganov/llama.cpp:server` | Serves GGUF files via llama.cpp HTTP server; OpenAI-compatible `/v1/chat/completions` |
| `diffusion` | Image generation | `ghcr.io/huggingface/diffusers:latest` | Runs a Diffusers API server; returns base64-encoded images |
| `general` | Embeddings, classification, audio | `ghcr.io/huggingface/transformers-inference:latest` | General-purpose Transformers server |

The runtime type is inferred from the model's `pipeline_tag` on HuggingFace:
- `text-generation`, `text2text-generation` → `llm`
- `text-to-image`, `image-to-image` → `diffusion`
- All others → `general`

---

## Hardware-Adaptive Capability System

`capability-resolver.ts` evaluates whether a model can run on the current hardware before download. The UI uses this to annotate models with compatibility badges.

**Resolution logic:**
1. Get `HardwareProfile` from `hardware-profiler.ts`
2. Check model size (parameter count) and format against available RAM (and VRAM if GPU present)
3. For GGUF models: apply quantization discount (Q4_K_M uses ~4.5 bits/param, Q8_0 uses ~8 bits/param)
4. Return one of: `compatible`, `marginal` (will be slow), `incompatible` (insufficient RAM)

**Recommendations for CPU-only hardware:**
- 7B models: GGUF Q4_K_M requires ~4.5 GB RAM — compatible on most servers
- 13B models: GGUF Q4_K_M requires ~8 GB RAM — marginal on 8 GB, fine on 16 GB
- 70B models: not recommended without significant RAM (>40 GB)

---

## Agent Tool: `hf_models`

Registered in `agent-bridge.ts`. Available in `ONLINE` state to `verified` and `sealed` entities.

```ts
// Tool schema
{
  name: "hf_models",
  description: "Search HuggingFace, manage installed models, and check hardware",
  parameters: {
    action: "search" | "list" | "status" | "hardware",
    query: string,        // for action: "search"
    task: string,         // optional filter for "search" (e.g. "text-generation")
    limit: number,        // optional, default 10, max 50
  }
}
```

**Actions:**

| Action | What it returns |
|--------|----------------|
| `search` | Array of HF Hub results with compatibility annotations for current hardware |
| `list` | All locally installed models with install status and file paths |
| `status` | Running models, their container ports, and inference endpoint URLs |
| `hardware` | Full `HardwareProfile` including CPU, RAM, GPU, and recommended model sizes |

The tool's `install`, `start`, and `stop` actions are intentionally omitted from the agent surface — these are write operations that go through the dashboard UI to ensure user confirmation. The agent can inform users of what is available and guide them to the UI, but cannot install or start models autonomously.

---

## Model Storage

All model files land in `~/.agi/models/`:

```
~/.agi/models/
  model-store.db              — SQLite install records
  {author}/{repo}/            — model files per HF repo
    {variant-filename}.gguf   — downloaded variant file(s)
```

The `modelDir` path in config is expanded at use-time (`~` → `$HOME`). Model files are never stored inside the AGI repo or `/opt/aionima/`.

---

## Integration Points

**Gateway Core** (`packages/gateway-core/src/`):

- `boot.ts` — checks `hf.enabled`, imports `@aionima/model-runtime`, mounts `hf-api.ts` routes, registers `hf_models` agent tool
- `routes/index.ts` — includes the HF route plugin
- `tool-registry.ts` — calls `registerHFTool()` from `agent-bridge.ts` when feature is enabled

**Dashboard** (`ui/dashboard/src/`):

- `routes/admin/hf-models.tsx` — Admin > HF Models page: search, install, start/stop UI
- `lib/api/hf.ts` — typed fetch wrappers for all `/api/hf/*` endpoints
- `components/HFModelCard.tsx` — card component showing model info, compatibility badge, install/status controls

**MApps:** MApps that need an AI backend call the inference proxy at `/api/hf/inference/:modelId/v1/chat/completions` (for LLMs) or the equivalent endpoint for other types. The MApp schema's `container.env` can reference the model endpoint URL via the `AIONIMA_HF_ENDPOINT_{MODEL_ID}` environment variable injected at container start.

---

## Adding New Runtime Types

To add support for a new container runtime (e.g., vLLM, Ollama):

1. Add the new type to `ContainerRuntimeType` in `types.ts`
2. Add image selection and startup flags in `model-container-manager.ts` `getContainerConfig()`
3. Add `pipeline_tag` mappings in the `resolveRuntimeType()` function in `model-container-manager.ts`
4. Update `capability-resolver.ts` if the new runtime has different RAM/VRAM characteristics
5. Add the type to the API docs above and this file
