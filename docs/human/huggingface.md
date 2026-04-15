# HuggingFace Model Marketplace

## What is it?

Aionima can download and run AI models from HuggingFace, the world's largest open-source AI model repository. This lets you run AI models locally on your own hardware — no cloud API keys or subscriptions needed.

---

## Enabling HuggingFace Support

1. Open the Admin menu (button at the bottom of the sidebar).
2. Go to System > Settings > HF Marketplace.
3. Click "Enable".
4. Save your settings.

---

## Browsing Models

1. Open Admin > HF Models.
2. Use the search bar to find models.
3. Filter by task type (Text Generation, Image Generation, etc.).
4. Each model shows a compatibility badge:
   - **Compatible** (green) — runs well on your hardware.
   - **Limited** (yellow) — will work but may be slow.
   - **Incompatible** (red) — your hardware cannot run this model.

---

## Installing a Model

1. Click on a model card to see details.
2. For models with multiple versions, pick the recommended one.
3. Click "Install Model" or "Download".
4. Wait for the download to complete — this can take several minutes for large models.
5. The model appears in the "Installed" tab when ready.

---

## Starting a Model

1. Go to the "Installed" tab.
2. Find your installed model.
3. Click "Start".
4. The model loads into a container and becomes available for use.

---

## Using Models in Apps

Once a model is running, MagicApps and plugins can use it for:

- **Text generation** — chatbots, content writing, code generation.
- **Image generation** — art, diagrams, illustrations.
- **Text embeddings** — semantic search, similarity matching.
- **Audio transcription** — speech to text.
- **Text classification** — categorization, sentiment analysis.

---

## Hardware Requirements

Your hardware determines which models you can run:

| Hardware | What You Can Run |
|----------|-----------------|
| 16 GB RAM, no GPU | Small models (7B parameters) with GGUF quantization |
| 32 GB RAM | Medium models (13B parameters) |
| GPU with 8+ GB VRAM | Larger models and image generation |
| GPU with 24+ GB VRAM | Large models (30B+ parameters) at full quality |

Check Settings > HF Marketplace > Hardware to see what your system supports.

---

## Tips

- For CPU-only systems, look for GGUF format models with "Q4_K_M" quantization — this gives the best balance of quality and speed.
- Only one large model can run at a time on limited hardware.
- Models are stored in `~/.agi/models/` — delete unused models to free disk space.

---

## Datasets

Aionima can download datasets from HuggingFace Hub alongside models, so you can use them as data sources for your projects or fine-tuning jobs.

**Browsing and downloading datasets:**
1. Open Admin > HF Models > Datasets tab.
2. Search for a dataset by name or keyword.
3. Click a dataset card to see its description, size, and files.
4. Click "Download" to fetch the dataset to `~/.agi/datasets/`.

**Using datasets in projects:**
Add an `aiDatasets` binding in your project's `project.json`:
```json
{
  "aiDatasets": [
    { "datasetId": "author/dataset-name", "alias": "mydata", "mountPath": "/data/mydata" }
  ]
}
```
When the project container starts, Aionima mounts the dataset files read-only at the path you specify.

---

## Custom Models

Some models on HuggingFace use custom Python code that cannot run in a standard Transformers container. Aionima handles these automatically.

**How it works:**
1. When you install a model, Aionima checks it against the **Known-Models Registry** — a built-in list of well-known custom models.
2. If the model is recognized (e.g., `NeoQuasar/Kronos-base`), the install wizard shows a "Custom Runtime" badge and walks you through the install.
3. During install, Aionima clones the model's source repository and builds a dedicated Podman container image (`aionima-custom-{model-id}:latest`).
4. Build progress streams live in the install wizard — you can see each step: clone, pip install, build.
5. Once built, the container starts like any other model and exposes its API endpoints.

**Adding your own custom runtimes:**
Place a JSON file in `~/.agi/custom-runtimes/` defining your model's container configuration. See the agent documentation for the schema.

---

## Building AI Apps

Aionima is a platform for building real AI applications — not just running models in isolation. The standard pattern pairs a model with two projects:

1. **API backend** — A Python/FastAPI project that calls the model. It declares the model as a dependency, and Aionima injects the model's URL as an environment variable (`AIONIMA_MODEL_{ALIAS}_URL`) when the project container starts.
2. **Frontend** — A React, Next.js, or other web project that calls your API and shows the results.

**Example: Trading AI with Kronos**
- Install `NeoQuasar/Kronos-base` from HF Marketplace
- Create an API project with `aiModels: [{ modelId: "NeoQuasar/Kronos-base", alias: "kronos", required: true }]`
- The API reads `AIONIMA_MODEL_KRONOS_URL` and forwards requests to `/predict`
- Create a frontend that calls the API and displays forecast charts

**Example: RAG (question answering over documents)**
- Install an embedding model + an LLM
- Create an API project bound to both models
- API indexes documents with embeddings, retrieves relevant chunks, sends them to the LLM
- Frontend provides document upload and a chat interface

**Example: Image generation**
- Install a diffusion model (GPU recommended)
- Create an API project with the model bound
- Frontend takes prompt input and shows generated images

Ask the AI assistant — "build me a trading AI app using Kronos" — and it will create the projects and write the code for you.

---

## Fine-Tuning

Fine-tuning lets you train a model on your own data to improve its performance on a specific task.

**How to start a fine-tune job:**
1. Go to Settings > HF Marketplace > Fine-Tune tab.
2. Select a base model (must be installed).
3. Select a downloaded dataset.
4. Choose the fine-tuning method (LoRA or QLoRA) and configure the parameters:
   - **Rank (r)** — higher = more capacity, more VRAM
   - **Alpha** — scaling factor (usually 2× rank)
   - **Epochs** — how many passes over the dataset
   - **Learning rate** — typically 1e-4 to 5e-5
5. Click "Start Training".
6. Monitor the training loss curve in the Fine-Tune tab.

**Outputs:**
- Trained adapters are saved to `~/.agi/finetune/{job-id}/`.
- Adapters are lightweight — they sit on top of the base model rather than replacing it.

**Hardware note:** Fine-tuning with QLoRA is memory-efficient and can run on CPU-only servers for small models and datasets, though it will be slow. GPU with 8+ GB VRAM is recommended for reasonable training times.
