"""
Aionima Diffusion Model Runtime — serves image generation models via FastAPI.

Supports Stable Diffusion, FLUX, and other diffusers-compatible models.

Environment variables:
  MODEL_PATH  — path to model directory inside the container
  HF_TASK     — pipeline task (default: text-to-image)
"""

import os
import io
import base64
import logging
from contextlib import asynccontextmanager

import torch
import uvicorn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("aionima-diffusion")

MODEL_PATH = os.environ.get("MODEL_PATH", "/models")
PORT = int(os.environ.get("PORT", "8000"))

pipe = None


def load_model():
    global pipe
    from diffusers import AutoPipelineForText2Image

    log.info(f"Loading diffusion model from {MODEL_PATH}...")

    model_dir = MODEL_PATH
    if os.path.isfile(model_dir):
        model_dir = os.path.dirname(model_dir)

    device = "cuda" if torch.cuda.is_available() else "cpu"
    dtype = torch.float16 if torch.cuda.is_available() else torch.float32

    pipe = AutoPipelineForText2Image.from_pretrained(
        model_dir,
        torch_dtype=dtype,
    ).to(device)

    if hasattr(pipe, "enable_attention_slicing"):
        pipe.enable_attention_slicing()

    log.info(f"Diffusion model loaded on {device}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    load_model()
    yield
    log.info("Shutting down")


app = FastAPI(lifespan=lifespan)


@app.get("/health")
def health():
    return {"status": "ok", "task": "text-to-image", "model": MODEL_PATH}


class GenerateRequest(BaseModel):
    prompt: str
    negative_prompt: str | None = None
    width: int = 512
    height: int = 512
    num_inference_steps: int = 30
    guidance_scale: float = 7.5


@app.post("/v1/generate")
def generate(req: GenerateRequest):
    if pipe is None:
        raise HTTPException(503, "Model not loaded")

    with torch.inference_mode():
        result = pipe(
            prompt=req.prompt,
            negative_prompt=req.negative_prompt,
            width=req.width,
            height=req.height,
            num_inference_steps=req.num_inference_steps,
            guidance_scale=req.guidance_scale,
        )

    images = []
    for img in result.images:
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        b64 = base64.b64encode(buf.getvalue()).decode("utf-8")
        images.append({"b64_json": b64})

    return {"images": images}


if __name__ == "__main__":
    log.info(f"Starting diffusion server on port {PORT}")
    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="info")
