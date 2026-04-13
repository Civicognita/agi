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
