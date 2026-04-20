"""
Aionima Fine-Tune Container Entrypoint

FastAPI server that manages PEFT/LoRA fine-tuning jobs.
Reads configuration from environment variables and starts training on demand.

Environment variables:
  BASE_MODEL_PATH  - Path to base model weights inside container (default: /models)
  DATASET_PATH     - Path to dataset directory (default: /data)
  OUTPUT_PATH      - Path for adapter output (default: /output)
  LORA_R           - LoRA rank (default: 8)
  LORA_ALPHA       - LoRA alpha (default: 32)
  LORA_DROPOUT     - LoRA dropout (default: 0.1)
  TARGET_MODULES   - Comma-separated target module names (default: q_proj,v_proj)
  EPOCHS           - Number of training epochs (default: 3)
  BATCH_SIZE       - Per-device train batch size (default: 4)
  LEARNING_RATE    - Learning rate (default: 2e-5)
  MAX_STEPS        - Max training steps; 0 = unlimited (default: 0)
  METHOD           - lora or qlora (default: lora)
  OUTPUT_NAME      - Name for the output adapter directory (default: adapter)
"""

import os
import threading
import time
import traceback
import uvicorn
from fastapi import FastAPI
from pydantic import BaseModel
from typing import Optional

app = FastAPI(title="Aionima Fine-Tune Server", version="1.0.0")

# ---------------------------------------------------------------------------
# Training state (shared between request handlers and background thread)
# ---------------------------------------------------------------------------

_status: dict = {
    "status": "idle",      # idle | training | complete | error
    "epoch": 0,
    "total_epochs": 0,
    "loss": None,
    "learning_rate": None,
    "eta_seconds": None,
    "error": None,
}
_status_lock = threading.Lock()
_stop_event = threading.Event()
_training_thread: Optional[threading.Thread] = None


def _update_status(**kwargs):
    with _status_lock:
        _status.update(kwargs)


def _get_status() -> dict:
    with _status_lock:
        return dict(_status)


# ---------------------------------------------------------------------------
# Training loop
# ---------------------------------------------------------------------------

def _train(config: dict):
    """Run fine-tuning in a background thread using PEFT LoRA / QLoRA."""
    try:
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer, TrainingArguments
        from peft import LoraConfig, get_peft_model, TaskType
        from trl import SFTTrainer
        from datasets import load_from_disk, Dataset
        import json

        base_model_path = config["base_model_path"]
        dataset_path = config["dataset_path"]
        output_path = config["output_path"]
        lora_r = config["lora_r"]
        lora_alpha = config["lora_alpha"]
        lora_dropout = config["lora_dropout"]
        target_modules = config["target_modules"]
        epochs = config["epochs"]
        batch_size = config["batch_size"]
        learning_rate = config["learning_rate"]
        max_steps = config["max_steps"]
        output_name = config["output_name"]
        method = config["method"]

        total_epochs = epochs
        _update_status(status="training", total_epochs=total_epochs, epoch=0, loss=None, eta_seconds=None)

        # Load tokenizer
        tokenizer = AutoTokenizer.from_pretrained(base_model_path, trust_remote_code=True)
        if tokenizer.pad_token is None:
            tokenizer.pad_token = tokenizer.eos_token

        # Load model — use bitsandbytes 4-bit for qlora if available
        load_in_4bit = method == "qlora"
        if load_in_4bit:
            try:
                model = AutoModelForCausalLM.from_pretrained(
                    base_model_path,
                    load_in_4bit=True,
                    device_map="auto",
                    trust_remote_code=True,
                )
            except Exception:
                # Fall back to regular loading if 4-bit not available
                model = AutoModelForCausalLM.from_pretrained(
                    base_model_path,
                    trust_remote_code=True,
                )
        else:
            model = AutoModelForCausalLM.from_pretrained(
                base_model_path,
                trust_remote_code=True,
            )

        # Configure LoRA
        lora_config = LoraConfig(
            r=lora_r,
            lora_alpha=lora_alpha,
            lora_dropout=lora_dropout,
            target_modules=target_modules if target_modules else None,
            task_type=TaskType.CAUSAL_LM,
            bias="none",
        )
        model = get_peft_model(model, lora_config)
        model.print_trainable_parameters()

        # Load dataset — try load_from_disk first, fall back to directory scan
        try:
            dataset = load_from_disk(dataset_path)
            if hasattr(dataset, "train"):
                dataset = dataset["train"]
        except Exception:
            # Try loading as JSON lines
            import glob
            json_files = glob.glob(os.path.join(dataset_path, "**/*.jsonl"), recursive=True)
            if not json_files:
                json_files = glob.glob(os.path.join(dataset_path, "**/*.json"), recursive=True)
            if json_files:
                records = []
                for jf in json_files:
                    with open(jf) as f:
                        for line in f:
                            line = line.strip()
                            if line:
                                try:
                                    records.append(json.loads(line))
                                except json.JSONDecodeError:
                                    pass
                dataset = Dataset.from_list(records)
            else:
                raise ValueError(f"Could not load dataset from {dataset_path}")

        # Training arguments
        training_args_kwargs = {
            "output_dir": os.path.join(output_path, output_name),
            "num_train_epochs": epochs,
            "per_device_train_batch_size": batch_size,
            "learning_rate": learning_rate,
            "logging_steps": 10,
            "save_strategy": "epoch",
            "fp16": torch.cuda.is_available(),
            "report_to": "none",
        }
        if max_steps and max_steps > 0:
            training_args_kwargs["max_steps"] = max_steps

        training_args = TrainingArguments(**training_args_kwargs)

        start_time = time.time()

        # Callback to track progress and check stop signal
        class ProgressCallback:
            def __init__(self):
                from transformers import TrainerCallback
                self.__class__.__bases__ = (TrainerCallback,)

            def on_log(self, args, state, control, logs=None, **kwargs):
                if _stop_event.is_set():
                    control.should_training_stop = True
                    return
                if logs:
                    current_loss = logs.get("loss")
                    current_lr = logs.get("learning_rate")
                    elapsed = time.time() - start_time
                    if state.max_steps > 0 and state.global_step > 0:
                        eta = (elapsed / state.global_step) * (state.max_steps - state.global_step)
                    else:
                        eta = None
                    _update_status(
                        epoch=state.epoch or 0,
                        loss=current_loss,
                        learning_rate=current_lr,
                        eta_seconds=int(eta) if eta is not None else None,
                    )

        from transformers import TrainerCallback

        class _ProgressCallback(TrainerCallback):
            def on_log(self, args, state, control, logs=None, **kwargs):
                if _stop_event.is_set():
                    control.should_training_stop = True
                    return
                if logs:
                    current_loss = logs.get("loss")
                    current_lr = logs.get("learning_rate")
                    elapsed = time.time() - start_time
                    if state.max_steps > 0 and state.global_step > 0:
                        eta = (elapsed / state.global_step) * (state.max_steps - state.global_step)
                    else:
                        eta = None
                    _update_status(
                        epoch=float(state.epoch or 0),
                        loss=current_loss,
                        learning_rate=current_lr,
                        eta_seconds=int(eta) if eta is not None else None,
                    )

        trainer = SFTTrainer(
            model=model,
            args=training_args,
            train_dataset=dataset,
            processing_class=tokenizer,
            callbacks=[_ProgressCallback()],
        )

        trainer.train()

        if not _stop_event.is_set():
            # Save adapter weights
            adapter_output = os.path.join(output_path, output_name)
            model.save_pretrained(adapter_output)
            tokenizer.save_pretrained(adapter_output)
            _update_status(status="complete", epoch=float(total_epochs), eta_seconds=0)
        else:
            _update_status(status="complete")

    except Exception as exc:
        _update_status(status="error", error=str(exc))
        traceback.print_exc()


# ---------------------------------------------------------------------------
# API endpoints
# ---------------------------------------------------------------------------

class FineTuneStartRequest(BaseModel):
    base_model_path: str = os.environ.get("BASE_MODEL_PATH", "/models")
    dataset_path: str = os.environ.get("DATASET_PATH", "/data")
    output_path: str = os.environ.get("OUTPUT_PATH", "/output")
    lora_r: int = int(os.environ.get("LORA_R", "8"))
    lora_alpha: int = int(os.environ.get("LORA_ALPHA", "32"))
    lora_dropout: float = float(os.environ.get("LORA_DROPOUT", "0.1"))
    target_modules: list[str] = os.environ.get("TARGET_MODULES", "q_proj,v_proj").split(",")
    epochs: int = int(os.environ.get("EPOCHS", "3"))
    batch_size: int = int(os.environ.get("BATCH_SIZE", "4"))
    learning_rate: float = float(os.environ.get("LEARNING_RATE", "2e-5"))
    max_steps: int = int(os.environ.get("MAX_STEPS", "0"))
    method: str = os.environ.get("METHOD", "lora")
    output_name: str = os.environ.get("OUTPUT_NAME", "adapter")


@app.post("/finetune/start")
def finetune_start(req: FineTuneStartRequest = None):
    global _training_thread, _stop_event

    current = _get_status()
    if current["status"] == "training":
        return {"ok": False, "error": "Training already in progress"}

    # Use env vars if no body provided
    if req is None:
        req = FineTuneStartRequest()

    _stop_event = threading.Event()
    config = req.model_dump()

    _training_thread = threading.Thread(target=_train, args=(config,), daemon=True)
    _training_thread.start()

    return {"ok": True, "job_id": "container-local"}


@app.get("/finetune/status")
def finetune_status():
    return _get_status()


@app.post("/finetune/stop")
def finetune_stop():
    _stop_event.set()
    return {"ok": True}


@app.get("/finetune/adapter")
def finetune_adapter():
    output_path = os.environ.get("OUTPUT_PATH", "/output")
    output_name = os.environ.get("OUTPUT_NAME", "adapter")
    adapter_path = os.path.join(output_path, output_name)
    if os.path.isdir(adapter_path):
        return {"path": adapter_path, "exists": True}
    return {"path": adapter_path, "exists": False}


@app.get("/health")
def health():
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Auto-start training on launch if env vars are set
# ---------------------------------------------------------------------------

@app.on_event("startup")
def auto_start():
    """If BASE_MODEL_PATH is set and training hasn't been started, auto-start."""
    base_model_path = os.environ.get("BASE_MODEL_PATH", "/models")
    if base_model_path and os.path.isdir(base_model_path):
        req = FineTuneStartRequest()
        finetune_start(req)


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
