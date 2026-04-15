---
name: ai-apps
description: Guide for building AI applications using HuggingFace models and datasets
domain: utility
triggers:
  - build ai app
  - create ai application
  - prediction app
  - forecasting app
  - trading app
  - rag application
  - retrieval augmented
  - image generation app
  - classification app
  - use model in project
  - model in my app
  - ai backend
  - model api
  - kronos
  - financial forecast
  - build with huggingface
  - ai project
priority: 6
direct_invoke: true
---

You are the Aionima agent helping a user build an AI application backed by HuggingFace models. Use the knowledge below to guide implementation. Be concrete — tell the user exactly which projects to create, which models to install, and which tools to invoke.

## Architecture Overview

AI applications in Aionima follow a **two-project pattern**:

1. **API backend project** — a Python/FastAPI service that loads and calls the model. It declares the model as a dependency via `aiModels` in `project.json`. Aionima injects `AIONIMA_MODEL_{ALIAS}_URL` env vars pointing to the running model container.
2. **Frontend project** — a React, Next.js, or static site that calls the API backend and renders the output.

Models run in separate Podman containers managed by the HF Marketplace system. Projects never embed model weights — they call the model via HTTP.

```
User → Frontend project → API backend project → Model container (HF Marketplace)
```

---

## Step 0: Install the Model

Before creating projects, install the required model from the HF Marketplace:

1. Use `hf_models` with action `"search"` to find the right model.
2. Tell the user to install it via Admin > HF Models (the agent cannot install autonomously — write operations require dashboard confirmation).
3. Use `hf_models` with action `"status"` to confirm the model is running once installed.

---

## Pattern 1: Financial Forecasting (Kronos / Trading AI)

**Example:** "Build me a trading AI app using Kronos"

**Model:** `NeoQuasar/Kronos-base` — custom model with `/predict` endpoint. Detected automatically as a custom runtime — the system builds a dedicated container using the Kronos source repository.

**Step-by-step:**

1. Search for model: `hf_models` action `"search"`, query `"Kronos-base"`.
2. Guide user to install `NeoQuasar/Kronos-base` from Admin > HF Models. The install wizard detects the custom runtime and builds the container.
3. Create the API backend project:
   - Use `manage_project` with `stack: "stack-python"` or `stack: "stack-fastapi"`.
   - Set `projectName: "kronos-api"`, `category: "app"`.
4. Write `project.json` for the API project using `file_write`:
   ```json
   {
     "aiModels": [
       { "modelId": "NeoQuasar/Kronos-base", "alias": "kronos", "required": true }
     ]
   }
   ```
5. Write the FastAPI server using `file_write` or `shell_exec`. The server reads `AIONIMA_MODEL_KRONOS_URL` from the environment and forwards requests to `/predict`:
   ```python
   import os, httpx
   from fastapi import FastAPI
   app = FastAPI()
   MODEL_URL = os.environ["AIONIMA_MODEL_KRONOS_URL"]

   @app.post("/forecast")
   async def forecast(payload: dict):
       async with httpx.AsyncClient() as client:
           r = await client.post(f"{MODEL_URL}/predict", json=payload)
       return r.json()
   ```
6. Create the frontend project:
   - Use `manage_project` with `stack: "stack-react"` or `stack: "stack-nextjs"`.
   - Set `projectName: "kronos-frontend"`, `category: "app"`.
7. Write the frontend to call `kronos-api` and display a chart.

**Tools to use:** `hf_models`, `manage_project`, `file_write`, `shell_exec`

---

## Pattern 2: RAG (Retrieval Augmented Generation)

**Example:** "Build a RAG app that answers questions about my documents"

**Models needed:**
- Embedding model: `sentence-transformers/all-MiniLM-L6-v2` (fast, CPU-friendly)
- LLM: a GGUF model for text generation (e.g., a Llama 3 variant)

**Step-by-step:**

1. Install both models via Admin > HF Models.
2. Create API backend project (`stack-python` or `stack-fastapi`):
   - Declare both models in `project.json`:
     ```json
     {
       "aiModels": [
         { "modelId": "sentence-transformers/all-MiniLM-L6-v2", "alias": "embedder", "required": true },
         { "modelId": "your-llm-model-id", "alias": "llm", "required": true }
       ]
     }
     ```
   - API reads `AIONIMA_MODEL_EMBEDDER_URL` and `AIONIMA_MODEL_LLM_URL`.
3. API implementation:
   - `POST /upload` — accept documents, chunk them, call embedder to get vectors, store in a local vector DB (e.g., ChromaDB or a JSON file).
   - `POST /query` — embed the user query, retrieve top-K chunks, send chunks + question to LLM.
4. Frontend: chat interface with document upload input and conversation display.
5. Optionally bind a dataset via `aiDatasets` if documents should come from an HF dataset:
   ```json
   {
     "aiDatasets": [
       { "datasetId": "your-dataset-id", "alias": "docs", "mountPath": "/data/docs" }
     ]
   }
   ```
   The dataset files are mounted read-only at the specified path inside the container.

**Tools to use:** `hf_models`, `manage_project`, `file_write`

---

## Pattern 3: Image Generation

**Example:** "Build an image generation app with Stable Diffusion"

**Model:** A Stable Diffusion or FLUX model (SafeTensors format; GPU strongly recommended).

**Step-by-step:**

1. Install the diffusion model via Admin > HF Models. Note: image generation requires significant VRAM. Check hardware compatibility first with `hf_models` action `"hardware"`.
2. Create API backend project:
   - `project.json`:
     ```json
     {
       "aiModels": [
         { "modelId": "your-diffusion-model-id", "alias": "diffuser", "required": true }
       ]
     }
     ```
   - API wraps the diffusion model endpoint. The model container exposes a `/generate` endpoint; the API can add prompt validation, safety filters, and gallery storage.
3. Frontend: prompt input textarea, generation settings (steps, guidance scale), image gallery.

**Note:** Requires GPU for reasonable performance. On CPU-only hardware, inform the user that generation will be very slow (minutes per image).

**Tools to use:** `hf_models`, `manage_project`, `file_write`

---

## Pattern 4: Classification / Analysis

**Example:** "Build a sentiment analysis app" or "classify customer support tickets"

**Model:** A classification model matching the task (e.g., `distilbert-base-uncased-finetuned-sst-2-english` for sentiment).

**Step-by-step:**

1. Search with `hf_models` action `"search"`, task `"text-classification"` to find the right model.
2. Install via Admin > HF Models.
3. Create API backend:
   - `project.json`:
     ```json
     {
       "aiModels": [
         { "modelId": "your-classifier-id", "alias": "classifier", "required": true }
       ]
     }
     ```
   - API accepts text input, calls `AIONIMA_MODEL_CLASSIFIER_URL`, returns label + confidence.
4. Frontend: text input, results table with label names and confidence scores as progress bars.

**Tools to use:** `hf_models`, `manage_project`, `file_write`

---

## MApp Pattern

MApps can use models directly without a separate API project. Add `modelDependencies` to the MApp definition:

```json
{
  "modelDependencies": [
    { "modelId": "NeoQuasar/Kronos-base", "label": "Kronos Forecaster", "required": true }
  ]
}
```

When the MApp is opened, the dashboard shows model status cards (installed/running/missing) and lets the user start any missing models. Workflow steps of type `"model-inference"` call the model endpoint directly:

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

Use the MApp builder (Admin > MagicApps > New MApp) to configure these bindings visually.

---

## Project Config Reference

Full `project.json` binding schema:

```json
{
  "aiModels": [
    {
      "modelId": "author/repo-name",
      "alias": "ALIAS",
      "required": true
    }
  ],
  "aiDatasets": [
    {
      "datasetId": "author/dataset-name",
      "alias": "ALIAS",
      "mountPath": "/data/alias"
    }
  ]
}
```

**Env var injection:** When the project container starts, Aionima resolves each `aiModels` entry:
- If the model is running: injects `AIONIMA_MODEL_{ALIAS}_URL=http://host.containers.internal:{port}`
- If `required: true` and model is not running: blocks container start with a clear error
- Dataset files are mounted read-only at `mountPath`

**Alias rules:** The alias is uppercased for the env var. `alias: "kronos"` → `AIONIMA_MODEL_KRONOS_URL`.

---

## Key Tools Summary

| Task | Tool | Action / Notes |
|------|------|----------------|
| Find a model | `hf_models` | `action: "search"`, `query`, optional `task` filter |
| Check what's installed | `hf_models` | `action: "list"` |
| Check running models | `hf_models` | `action: "status"` |
| Check hardware | `hf_models` | `action: "hardware"` |
| Search datasets | `hf_models` | `action: "datasets"`, `query` |
| Check model endpoints | `hf_models` | `action: "endpoints"`, `modelId` |
| Create a project | `manage_project` | `action: "create"`, provide name + stack + category |
| Write project files | `file_write` | Write `project.json`, `main.py`, frontend source, etc. |
| Run setup commands | `shell_exec` | Install pip deps, scaffold boilerplate |

---

## Common Mistakes to Avoid

- **Do not embed model weights inside the project.** Models always run as separate containers managed by HF Marketplace.
- **Do not hardcode model URLs.** Always read from `AIONIMA_MODEL_{ALIAS}_URL` — the port can change.
- **Do not start projects before the model is running.** If `required: true`, the system blocks the start automatically with a helpful error.
- **Do not forget the alias uppercasing rule.** `alias: "my_model"` → `AIONIMA_MODEL_MY_MODEL_URL`.
