"""
Aionima General Model Runtime — serves HuggingFace Transformers models via FastAPI.

Supports multiple pipeline tasks: feature-extraction (embeddings), text-classification,
summarization, translation, automatic-speech-recognition, token-classification, etc.

Environment variables:
  MODEL_PATH  — path to model directory or file inside the container
  HF_TASK     — pipeline task (e.g. "feature-extraction", "text-classification")
"""

import os
import sys
import subprocess
import json
import logging
from contextlib import asynccontextmanager

import torch
import uvicorn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("aionima-model")

MODEL_PATH = os.environ.get("MODEL_PATH", "/models")
HF_TASK = os.environ.get("HF_TASK", "feature-extraction")
PORT = int(os.environ.get("PORT", "8000"))

pipeline_instance = None


def install_extra_deps():
    deps = []
    extra = os.environ.get("EXTRA_PIP_DEPS", "")
    if extra:
        deps.extend([d.strip() for d in extra.split(",") if d.strip()])
    model_dir = MODEL_PATH
    if os.path.isfile(model_dir):
        model_dir = os.path.dirname(model_dir)
    req_file = os.path.join(model_dir, "requirements.txt")
    if os.path.isfile(req_file):
        with open(req_file) as f:
            deps.extend([l.strip() for l in f if l.strip() and not l.startswith("#")])
    if not deps:
        return
    deps = list(dict.fromkeys(deps))
    log.info(f"Installing extra dependencies: {deps}")
    try:
        subprocess.check_call(
            [sys.executable, "-m", "pip", "install", "--no-cache-dir"] + deps,
            timeout=300,
        )
        log.info(f"Extra dependencies installed successfully")
    except Exception as e:
        log.error(f"Failed to install extra dependencies: {e}")
        raise


def load_model():
    global pipeline_instance
    from transformers import pipeline as hf_pipeline

    log.info(f"Loading model from {MODEL_PATH} for task '{HF_TASK}'...")

    # Resolve model path — strip filename if it points to a specific file
    model_dir = MODEL_PATH
    if os.path.isfile(model_dir):
        model_dir = os.path.dirname(model_dir)

    device = "cuda" if torch.cuda.is_available() else "cpu"
    dtype = torch.float16 if torch.cuda.is_available() else torch.float32

    pipeline_instance = hf_pipeline(
        task=HF_TASK,
        model=model_dir,
        device=device,
        torch_dtype=dtype,
    )
    log.info(f"Model loaded on {device} ({dtype})")


@asynccontextmanager
async def lifespan(app: FastAPI):
    install_extra_deps()
    load_model()
    yield
    log.info("Shutting down")


app = FastAPI(lifespan=lifespan)


@app.get("/health")
def health():
    return {"status": "ok", "task": HF_TASK, "model": MODEL_PATH}


# ---------------------------------------------------------------------------
# Embeddings (feature-extraction)
# ---------------------------------------------------------------------------

class EmbedRequest(BaseModel):
    input: str | list[str]
    model: str | None = None

@app.post("/v1/embeddings")
def embed(req: EmbedRequest):
    if pipeline_instance is None:
        raise HTTPException(503, "Model not loaded")
    inputs = req.input if isinstance(req.input, list) else [req.input]
    results = pipeline_instance(inputs)
    data = []
    for i, emb in enumerate(results):
        # pipeline returns nested lists for feature-extraction
        vec = emb[0] if isinstance(emb[0], list) else emb
        if hasattr(vec, "tolist"):
            vec = vec.tolist()
        # Mean pooling if we got token-level embeddings
        if isinstance(vec[0], list):
            import numpy as np
            vec = np.mean(vec, axis=0).tolist()
        data.append({"object": "embedding", "index": i, "embedding": vec})
    return {
        "object": "list",
        "data": data,
        "model": MODEL_PATH,
        "usage": {"prompt_tokens": sum(len(t.split()) for t in inputs), "total_tokens": sum(len(t.split()) for t in inputs)},
    }


# ---------------------------------------------------------------------------
# Classification
# ---------------------------------------------------------------------------

class ClassifyRequest(BaseModel):
    text: str

@app.post("/v1/classify")
def classify(req: ClassifyRequest):
    if pipeline_instance is None:
        raise HTTPException(503, "Model not loaded")
    results = pipeline_instance(req.text)
    if isinstance(results, list) and len(results) > 0 and isinstance(results[0], dict):
        labels = [{"label": r["label"], "score": float(r["score"])} for r in results]
    elif isinstance(results, list) and len(results) > 0 and isinstance(results[0], list):
        labels = [{"label": r["label"], "score": float(r["score"])} for r in results[0]]
    else:
        labels = [{"label": str(results), "score": 1.0}]
    return {"labels": labels}


# ---------------------------------------------------------------------------
# Summarization / Translation (text-to-text)
# ---------------------------------------------------------------------------

class TextRequest(BaseModel):
    text: str
    max_length: int | None = None

@app.post("/v1/summarize")
@app.post("/v1/translate")
def text_to_text(req: TextRequest):
    if pipeline_instance is None:
        raise HTTPException(503, "Model not loaded")
    kwargs = {}
    if req.max_length:
        kwargs["max_length"] = req.max_length
    results = pipeline_instance(req.text, **kwargs)
    output = results[0]["summary_text"] if "summary_text" in results[0] else results[0].get("translation_text", str(results[0]))
    return {"text": output}


# ---------------------------------------------------------------------------
# Transcription (automatic-speech-recognition)
# ---------------------------------------------------------------------------

class TranscribeRequest(BaseModel):
    audio: str  # base64-encoded
    format: str = "wav"
    language: str | None = None

@app.post("/v1/transcribe")
def transcribe(req: TranscribeRequest):
    if pipeline_instance is None:
        raise HTTPException(503, "Model not loaded")
    import base64, tempfile
    audio_bytes = base64.b64decode(req.audio)
    suffix = f".{req.format}"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
        f.write(audio_bytes)
        tmp_path = f.name
    try:
        kwargs = {}
        if req.language:
            kwargs["generate_kwargs"] = {"language": req.language}
        result = pipeline_instance(tmp_path, **kwargs)
        return {"text": result["text"], "language": req.language}
    finally:
        os.unlink(tmp_path)


# ---------------------------------------------------------------------------
# Generic fallback — for any task not covered above
# ---------------------------------------------------------------------------

class GenericRequest(BaseModel):
    inputs: str | list[str]

@app.post("/v1/predict")
def predict(req: GenericRequest):
    if pipeline_instance is None:
        raise HTTPException(503, "Model not loaded")
    results = pipeline_instance(req.inputs)
    return {"results": results}


if __name__ == "__main__":
    log.info(f"Starting general model server on port {PORT}, task={HF_TASK}")
    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="info")
