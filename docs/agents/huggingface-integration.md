# HuggingFace Integration

This document describes the HuggingFace model marketplace integration for AI coding agents and contributors working on the Aionima codebase. It covers architecture, key files, API surface, and the agent tool interface.

---

## Overview

The HF integration enables Aionima to browse the HuggingFace Hub, download model files locally, and serve them via Podman containers that expose OpenAI-compatible inference endpoints. MApps and the agent's `hf_models` tool consume these endpoints.

The feature is opt-in: it is enabled or disabled via the `hf.enabled` flag in `gateway.json`. When disabled, all HF routes return `503` and the `hf_models` tool is unregistered.

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

The `hf` section of `~/.agi/gateway.json`:

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
| `GET` | `/api/hf/running` | List all currently running model containers. Returns `HFRunningModel[]` (see `ui/dashboard/src/types.ts`): `modelId`, `containerId`, `containerName`, `port`, `runtimeType`, `startedAt`, `status`, plus a live `healthCheckPassed` boolean computed by probing each container's `/health` endpoint at request time, and `displayName` + `pipelineTag` enriched from the installed-model row. |
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

---

## Custom Runtime System

Models with custom Python code (not standard Transformers pipelines) are handled via the custom runtime system.

### KnownModelsRegistry

**File:** `packages/model-runtime/src/known-models-registry.ts`

A static + JSON-driven registry that maps HuggingFace model IDs to `CustomRuntimeDefinition` objects. Loaded at boot; extended by JSON files in `~/.agi/custom-runtimes/*.json`.

```ts
interface CustomRuntimeDefinition {
  sourceRepo: string;          // Git URL to clone
  image: string;               // Podman image tag to build
  internalPort: number;        // Port the container listens on
  healthCheckPath: string;     // HTTP path for health checks
  endpoints: Record<string, string>; // Named endpoints: { predict: "/predict" }
  env?: Record<string, string>;      // Extra environment variables
  extraPipDeps?: string[];           // Additional pip packages to install
  hfModels?: string[];               // HF model files to download into the container
}
```

`KnownModelsRegistry.get(modelId)` returns the definition if recognized, or `undefined` for standard models.

**Initial known model:** `NeoQuasar/Kronos-base` — mapped to the Kronos FastAPI container with a `/predict` endpoint.

**Custom runtime JSON schema** (for `~/.agi/custom-runtimes/*.json`):
```json
{
  "modelId": "author/repo-name",
  "definition": { /* CustomRuntimeDefinition fields */ }
}
```

### CustomContainerBuilder

**File:** `packages/model-runtime/src/custom-container-builder.ts`

Builds a Podman container image from a `CustomRuntimeDefinition`. Steps:
1. Clone `sourceRepo` to a temp directory.
2. Generate a `Containerfile` from the default template (Python 3.11 + FastAPI + `extraPipDeps`).
3. Run `podman build -t {image} .` in the cloned directory.
4. Emit build progress events (SSE-streamed to dashboard via the wizard build-log endpoint).

Image is tagged `aionima-custom-{sanitized-model-id}:latest`. If the image already exists (from a previous install), the build step is skipped.

**Integration:** `CapabilityResolver.buildContainerConfig()` detects `runtimeType === "custom"` and uses the `CustomRuntimeDefinition` from the registry instead of the standard image map.

**Proof-of-concept containers:**
- `containers/Containerfile.kronos` — Python + Kronos source + FastAPI
- `containers/entrypoint_kronos.py` — loads Kronos model, serves `/predict` and `/health`

---

## Dataset Integration

### DatasetStore

**File:** `packages/model-runtime/src/dataset-store.ts`

SQLite store at `~/.agi/datasets/index.db`. Tracks installed datasets: ID, revision, local path, download status, size. Same pattern as `ModelStore`.

```ts
interface InstalledDataset {
  id: string;
  revision: string;
  localPath: string;
  status: "downloading" | "ready" | "error";
  fileSizeBytes: number;
  installedAt: number;
}
```

### Dataset API Routes

Mounted under `/api/hf/datasets/` in `packages/gateway-core/src/hf-api.ts`:

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/hf/datasets/search` | Search HF Hub datasets. Query params: `q`, `limit` |
| `GET` | `/api/hf/datasets` | List locally installed datasets |
| `GET` | `/api/hf/datasets/:id` | Get a single installed dataset record |
| `POST` | `/api/hf/datasets/install` | Start a dataset download. Body: `{ datasetId, revision? }` |
| `DELETE` | `/api/hf/datasets/:id` | Delete a downloaded dataset |

### Storage Layout

```
~/.agi/datasets/
  index.db                          — SQLite dataset index (DatasetStore)
  hub/
    datasets--{author}--{repo}/     — Dataset files mirroring HF Hub cache structure
      {revision}/
        {filename}
```

### HF Hub Client Methods

`HfHubClient` in `packages/model-runtime/src/hf-hub-client.ts` exposes dataset methods mirroring the model methods:

```ts
searchDatasets(params: HfDatasetSearchParams): Promise<HfDatasetInfo[]>
getDatasetInfo(datasetId: string): Promise<HfDatasetInfo>
getDatasetFiles(datasetId: string, revision?: string): Promise<string[]>
downloadDatasetFile(datasetId: string, filename: string, destDir: string): Promise<string>
```

---

## Project Model Bindings

### Schema Fields

**File:** `config/src/project-schema.ts`

```ts
// Added to ProjectConfigSchema
aiModels?: Array<{
  modelId: string;   // HF model ID: "author/repo"
  alias: string;     // Used as env var suffix: AIONIMA_MODEL_{ALIAS}_URL
  required: boolean; // If true, project start is blocked when model is not running
}>;

aiDatasets?: Array<{
  datasetId: string;  // HF dataset ID: "author/repo"
  alias: string;      // Human-readable label
  mountPath: string;  // Mount path inside project container, e.g. "/data/docs"
}>;
```

### Environment Variable Injection

**File:** `packages/gateway-core/src/hosting-manager.ts`

When `HostingManager` starts a project container:

1. Reads `projectConfig.aiModels`.
2. For each entry, calls `ModelStore.getById(modelId)` to check installation status.
3. If installed and running (`ModelContainerManager.getRunning()` returns the container): resolves the host port and injects `AIONIMA_MODEL_{ALIAS.toUpperCase()}_URL=http://host.containers.internal:{port}`.
4. If `required: true` and model is not running: throws an error with a user-facing message: `"Required model {modelId} is not running. Start it from Admin > HF Models."` The project container is not started.
5. If `required: false` and model is not running: injects nothing; project starts without the env var.
6. For each `aiDatasets` entry: mounts `~/.agi/datasets/hub/datasets--{author}--{repo}/` read-only to `mountPath` inside the container.

**Auto-start behavior:** If a required model is installed but stopped, `HostingManager` automatically calls `ModelContainerManager.start(model)` before injecting the env var.

---

## MApp Model Dependencies

### Schema Extension

**File:** `config/src/mapp-schema.ts`

```ts
// Added to MAppDefinition
modelDependencies?: Array<{
  modelId: string;          // HF model ID
  label: string;            // Display name in dashboard
  required: boolean;        // Block MApp open if missing
  pipelineTag?: string;     // Expected task type (informational)
}>;
```

### model-inference Workflow Step

MApp workflow definitions can include steps of type `"model-inference"`:

```json
{
  "type": "model-inference",
  "config": {
    "modelId": "NeoQuasar/Kronos-base",
    "endpoint": "/predict",
    "inputTemplate": "{{ step.input }}",
    "outputKey": "forecast"
  }
}
```

The workflow runner resolves the model's running container port via `ModelContainerManager`, constructs the full URL, and makes an HTTP POST with the rendered `inputTemplate`. The response body is stored under `outputKey` for use by subsequent steps.

### Model Status in MApp UI

When a MApp with `modelDependencies` is opened in the dashboard:
- Each dependency is shown as a status card: green (running), yellow (installed but stopped), red (not installed).
- Start buttons appear for stopped models.
- If a `required` model is missing entirely, the MApp shows an install prompt rather than launching.

---

## Fine-Tune Manager

### FineTuneManager

**File:** `packages/model-runtime/src/finetune-manager.ts`

Manages fine-tune job lifecycle. Jobs run inside a dedicated Podman container (`containers/Containerfile.finetune`) that includes `transformers`, `peft`, `datasets`, `accelerate`, and `trl`.

```ts
interface FineTuneConfig {
  baseModelId: string;
  datasetId: string;
  method: "lora" | "qlora";
  loraConfig: {
    r: number;
    alpha: number;
    dropout: number;
    targetModules: string[];
  };
  trainingConfig: {
    epochs: number;
    batchSize: number;
    learningRate: number;
  };
}

class FineTuneManager {
  startJob(config: FineTuneConfig): Promise<string>; // returns jobId
  getStatus(jobId: string): FineTuneStatus;
  stopJob(jobId: string): Promise<void>;
  listJobs(): FineTuneStatus[];
}
```

**Job lifecycle:**
1. Container mounts base model weights (read-only), dataset (read-only), output dir (read-write at `~/.agi/finetune/{jobId}/`).
2. `entrypoint_finetune.py` starts a FastAPI server exposing `/finetune/start`, `/finetune/status`, `/finetune/stop`, `/finetune/adapter`.
3. Training runs in a background thread; progress (epoch, loss) is polled via `/finetune/status`.
4. On completion, the LoRA adapter is saved to `~/.agi/finetune/{jobId}/adapter/`.

### Fine-Tune API Routes

Mounted in `packages/gateway-core/src/hf-api.ts`:

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/hf/finetune/start` | Start a fine-tune job. Body: `FineTuneConfig` |
| `GET` | `/api/hf/finetune` | List all jobs with status |
| `GET` | `/api/hf/finetune/:jobId` | Get status for a specific job |
| `POST` | `/api/hf/finetune/:jobId/stop` | Stop a running job |

### Fine-Tune Containers

**`containers/Containerfile.finetune`** — Python 3.11 + `transformers peft datasets accelerate trl` + FastAPI. Base image: `python:3.11-slim`.

**`containers/entrypoint_finetune.py`** — FastAPI application that:
- On `POST /finetune/start`: validates config, starts training in a background thread using `SFTTrainer` (from `trl`) with PEFT LoRA/QLoRA config.
- On `GET /finetune/status`: returns current epoch, loss, ETA, and completion status.
- On `POST /finetune/stop`: interrupts training gracefully and saves any completed adapter checkpoints.
- On `GET /finetune/adapter`: returns metadata about the saved adapter (path, parameter count, base model).

### Agent Tool: `hf_models` (Updated Actions)

The `hf_models` tool registered in `packages/gateway-core/src/server.ts` now includes two additional actions:

| Action | Parameters | Returns |
|--------|-----------|---------|
| `datasets` | `query: string` | Array of matching HF datasets with id, downloads, likes, tags |
| `endpoints` | `modelId: string` | Array of `ModelEndpoint` objects declared by the installed model |

These additions let the agent search for datasets when building RAG or fine-tune workflows, and inspect a model's available API paths when constructing project bindings.
