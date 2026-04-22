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


class MergeConflictRequest(BaseModel):
    file_path: str
    ours_label: str
    theirs_label: str
    conflict_text: str


def _split_conflict_hunks(text: str) -> tuple[list[str], list[dict[str, str]]]:
    """Walk a file with conflict markers and extract each `<<<<<<< ... =======
    ... >>>>>>>` region. Returns `(prefix_parts, hunks)` where `prefix_parts`
    is a list of text fragments (in order) and `hunks` is a list of
    `{ours, theirs}` dicts. Prefixes + hunks alternate, so the caller can
    reconstruct by zipping them.
    """
    out_prefixes: list[str] = []
    hunks: list[dict[str, str]] = []
    i = 0
    n = len(text)
    while i < n:
        # Look for the start marker on its own line.
        start = text.find("<<<<<<<", i)
        if start == -1:
            out_prefixes.append(text[i:])
            break
        # Ensure the marker is at the start of a line.
        if start > 0 and text[start - 1] != "\n":
            i = start + 7
            continue
        out_prefixes.append(text[i:start])
        # Skip to newline after <<<<<<< label
        line_end = text.find("\n", start)
        if line_end == -1:
            out_prefixes.append(text[start:])
            break
        sep = text.find("\n=======", line_end)
        if sep == -1:
            out_prefixes.append(text[start:])
            break
        close = text.find("\n>>>>>>>", sep)
        if close == -1:
            out_prefixes.append(text[start:])
            break
        # Include trailing newline in both sides so the reconstructed
        # file preserves line structure. `sep` points at the \n before
        # `=======`, and `close` points at the \n before `>>>>>>>` —
        # each hunk side runs from after its header newline up through
        # (and including) that delimiting newline.
        #   sep + 8 = position right after `\n=======` (so next char is
        #             the \n terminating the `=======` line).
        #   sep + 9 = start of `theirs` content proper.
        ours = text[line_end + 1 : sep + 1]
        theirs = text[sep + 9 : close + 1] if sep + 9 <= close + 1 else ""
        hunks.append({"ours": ours, "theirs": theirs})
        # Advance past the closing `>>>>>>>` line.
        close_end = text.find("\n", close + 1)
        i = close_end + 1 if close_end != -1 else n
    return out_prefixes, hunks


def _resolve_hunk_deterministic(ours: str, theirs: str) -> tuple[str, str] | None:
    """Deterministic resolutions for trivial cases. Returns `(resolved, reason)`
    or None when the conflict needs model assistance (or manual review)."""
    if ours == theirs:
        return ours, "both sides identical"
    if ours.strip() == theirs.strip():
        # Whitespace-only conflict: prefer upstream to respect their style.
        return theirs, "whitespace-only — preferred upstream"
    if ours.strip() == "":
        # Fork deleted, upstream added: keep the addition.
        return theirs, "fork deleted, upstream added"
    if theirs.strip() == "":
        # Upstream deleted, fork added: keep the addition.
        return ours, "upstream deleted, fork added"
    return None


@app.post("/v1/resolve-merge-conflict")
def resolve_merge_conflict(req: MergeConflictRequest):
    """Resolve a single file's merge conflicts. Returns `high` confidence
    only when every hunk can be resolved deterministically OR the model
    emits an unambiguous pick. Everything else falls back to `low` so the
    caller refuses to auto-commit.
    """
    prefixes, hunks = _split_conflict_hunks(req.conflict_text)
    if not hunks:
        # No conflict markers — nothing to resolve.
        return {
            "resolved_text": req.conflict_text,
            "confidence": "high",
            "unresolved_hunks": [],
        }

    resolved_parts: list[str] = []
    unresolved: list[str] = []
    overall_high = True

    for idx, hunk in enumerate(hunks):
        ours = hunk["ours"]
        theirs = hunk["theirs"]
        det = _resolve_hunk_deterministic(ours, theirs)
        if det is not None:
            resolved_text, _reason = det
            resolved_parts.append(resolved_text)
            continue

        # Non-trivial — ask the model for a directional pick. We do NOT
        # ask it to synthesize new code; only to pick a side. This keeps
        # the 135M model in its comfort zone.
        messages = [
            ChatMessage(role="system", content=(
                "You are reviewing a merge conflict for the AGI platform. The user's fork "
                "('ours') has local work; upstream ('theirs') has the canonical release. "
                "Your ONLY job is to pick which side to keep. Respond with exactly one of: "
                "OURS, THEIRS, or UNCLEAR. Pick UNCLEAR if both sides have meaningful content "
                "that neither overrides nor trivially merges."
            )),
            ChatMessage(role="user", content=(
                f"File: {req.file_path}\n\nOURS (fork):\n{ours[:1500]}\n\n"
                f"THEIRS (upstream):\n{theirs[:1500]}\n\nYour pick:"
            )),
        ]
        answer = generate(messages, max_tokens=16, temperature=0.0).strip().upper()
        pick = "UNCLEAR"
        if answer.startswith("OURS"):
            pick = "OURS"
        elif answer.startswith("THEIRS"):
            pick = "THEIRS"
        if pick == "OURS":
            resolved_parts.append(ours)
        elif pick == "THEIRS":
            resolved_parts.append(theirs)
        else:
            overall_high = False
            unresolved.append(f"hunk {idx + 1} in {req.file_path}: model unsure")
            # Preserve the original conflict markers so a human can resolve.
            resolved_parts.append(
                f"<<<<<<< {req.ours_label}\n{ours}=======\n{theirs}>>>>>>> {req.theirs_label}\n"
            )

    # Reassemble: prefix[0] + resolved[0] + prefix[1] + resolved[1] + ... + prefix[last]
    result_parts: list[str] = []
    for i, p in enumerate(prefixes):
        result_parts.append(p)
        if i < len(resolved_parts):
            result_parts.append(resolved_parts[i])
    resolved_text = "".join(result_parts)

    return {
        "resolved_text": resolved_text,
        "confidence": "high" if overall_high else "low",
        "unresolved_hunks": unresolved,
    }


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
