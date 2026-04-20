"""
Aion-Micro — lightweight system operations model for AGI diagnostics.

Serves SmolLM2-135M-Instruct via OpenAI-compatible API for:
  - agi doctor intelligent diagnostics
  - Container dependency analysis
  - Log parsing and root cause identification
  - Structured config generation

Environment variables:
  MODEL_PATH  — HF cache dir containing model (default: /models)
  LORA_PATH   — optional LoRA adapter directory (default: /models/lora)
  PORT        — server port (default: 8000)
"""

import os
import sys
import json
import time
import logging
from contextlib import asynccontextmanager
from typing import Any

import torch
import uvicorn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("aion-micro")

MODEL_PATH = os.environ.get("MODEL_PATH", "/models")
LORA_PATH = os.environ.get("LORA_PATH", "/models/lora")
PORT = int(os.environ.get("PORT", "8000"))
MODEL_ID = "HuggingFaceTB/SmolLM2-135M-Instruct"

model = None
tokenizer = None


def load_model():
    global model, tokenizer
    from transformers import AutoModelForCausalLM, AutoTokenizer

    log.info(f"Loading {MODEL_ID} from {MODEL_PATH}...")

    tokenizer = AutoTokenizer.from_pretrained(
        MODEL_ID, cache_dir=MODEL_PATH, local_files_only=True
    )

    model = AutoModelForCausalLM.from_pretrained(
        MODEL_ID,
        cache_dir=MODEL_PATH,
        local_files_only=True,
        torch_dtype=torch.float32,
        device_map="cpu",
    )

    if os.path.isdir(LORA_PATH) and any(
        f.endswith(".safetensors") or f == "adapter_config.json"
        for f in os.listdir(LORA_PATH)
    ):
        from peft import PeftModel
        log.info(f"Loading LoRA adapter from {LORA_PATH}")
        model = PeftModel.from_pretrained(model, LORA_PATH)
        model = model.merge_and_unload()

    model.eval()
    log.info(f"Model loaded ({sum(p.numel() for p in model.parameters()) / 1e6:.1f}M params)")


@asynccontextmanager
async def lifespan(app: FastAPI):
    load_model()
    yield
    log.info("Shutting down")


app = FastAPI(lifespan=lifespan)


@app.get("/health")
def health():
    return {
        "status": "ok",
        "model": MODEL_ID,
        "has_lora": os.path.isdir(LORA_PATH),
    }


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    model: str | None = None
    messages: list[ChatMessage]
    max_tokens: int = 256
    temperature: float = 0.7
    stop: list[str] | None = None


def generate(messages: list[ChatMessage], max_tokens: int, temperature: float) -> str:
    if model is None or tokenizer is None:
        raise HTTPException(503, "Model not loaded")

    prompt_parts = []
    for msg in messages:
        if msg.role == "system":
            prompt_parts.append(f"<|im_start|>system\n{msg.content}<|im_end|>")
        elif msg.role == "user":
            prompt_parts.append(f"<|im_start|>user\n{msg.content}<|im_end|>")
        elif msg.role == "assistant":
            prompt_parts.append(f"<|im_start|>assistant\n{msg.content}<|im_end|>")
    prompt_parts.append("<|im_start|>assistant\n")
    prompt = "\n".join(prompt_parts)

    inputs = tokenizer(prompt, return_tensors="pt").to(model.device)
    input_len = inputs["input_ids"].shape[1]

    with torch.no_grad():
        outputs = model.generate(
            **inputs,
            max_new_tokens=max_tokens,
            temperature=max(temperature, 0.01),
            do_sample=temperature > 0,
            pad_token_id=tokenizer.eos_token_id,
        )

    new_tokens = outputs[0][input_len:]
    return tokenizer.decode(new_tokens, skip_special_tokens=True).strip()


@app.post("/v1/chat/completions")
def chat_completions(req: ChatRequest):
    start = time.time()
    content = generate(req.messages, req.max_tokens, req.temperature)
    elapsed = time.time() - start

    return {
        "id": f"aion-micro-{int(time.time())}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": MODEL_ID,
        "choices": [{
            "index": 0,
            "message": {"role": "assistant", "content": content},
            "finish_reason": "stop",
        }],
        "usage": {
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "total_tokens": 0,
        },
        "timing": {"elapsed_ms": int(elapsed * 1000)},
    }


class DiagnoseRequest(BaseModel):
    checks: list[dict[str, Any]]
    system_info: dict[str, Any] | None = None


@app.post("/v1/diagnose")
def diagnose(req: DiagnoseRequest):
    evidence = json.dumps(req.checks, indent=2)[:2000]
    system_ctx = ""
    if req.system_info:
        system_ctx = f"\nSystem: {json.dumps(req.system_info)[:500]}"

    messages = [
        ChatMessage(role="system", content=(
            "You are Aion-Micro, a system diagnostics assistant for the AGI gateway. "
            "Analyze the health check results and provide a concise diagnostic summary. "
            "Focus on: failures that need immediate attention, warnings that may cause future issues, "
            "and any patterns across multiple checks. Be specific and actionable."
        )),
        ChatMessage(role="user", content=f"Health check results:{system_ctx}\n\n{evidence}\n\nProvide a diagnostic summary."),
    ]

    content = generate(messages, max_tokens=512, temperature=0.3)
    return {"analysis": content, "model": MODEL_ID}


class ConfigRequest(BaseModel):
    model_config_json: dict[str, Any]
    model_id: str
    pipeline_tag: str | None = None


@app.post("/v1/generate-config")
def generate_config(req: ConfigRequest):
    config_str = json.dumps(req.model_config_json, indent=2)[:2000]

    messages = [
        ChatMessage(role="system", content=(
            "You are a HuggingFace model configuration expert. Given a model's config.json, "
            "determine what extra pip packages are needed to run it. "
            "Respond with ONLY a JSON object: {\"packages\": [\"pkg1\", \"pkg2\"], \"reason\": \"...\"}"
        )),
        ChatMessage(role="user", content=f"Model: {req.model_id}\nPipeline: {req.pipeline_tag}\n\nconfig.json:\n{config_str}"),
    ]

    content = generate(messages, max_tokens=256, temperature=0.1)
    try:
        result = json.loads(content)
        return result
    except json.JSONDecodeError:
        return {"packages": [], "reason": content, "parse_error": True}


if __name__ == "__main__":
    log.info(f"Starting Aion-Micro on port {PORT}")
    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="info")
