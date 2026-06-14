#!/usr/bin/env python3
"""
Aion-micro LoRA adapter trainer.

Reads candidate JSONL from ~/.agi/datasets/ (or a specified file), converts
entries to SFT format, fine-tunes a base model via TRL SFTTrainer + PEFT LoRA,
and writes the adapter + metadata to ~/.agi/adapters/candidates/<timestamp>/.

Requires: torch transformers peft trl datasets accelerate
Install:  pip install torch transformers peft trl datasets accelerate bitsandbytes

Usage:
  python train-aion-micro.py [OPTIONS]

Options:
  --dataset PATH         Candidate JSONL file (default: latest candidates file)
  --base-model NAME      HuggingFace model ID or local path
  --output-dir DIR       Override output directory
  --epochs N             Training epochs (default: 3)
  --lora-rank N          LoRA rank r (default: 16)
  --lora-alpha N         LoRA alpha (default: 32)
  --batch-size N         Per-device train batch size (default: 1)
  --max-steps N          Max gradient steps (0 = use epochs, default: 0)
  --dry-run              Parse + validate dataset; skip training; exit 0
  --gold-fixture PATH    Path to gold-fixture JSONL for post-train verification
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path


# ---------------------------------------------------------------------------
# Arg parse
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Train an Aion-micro LoRA adapter")
    p.add_argument("--dataset", default="")
    p.add_argument("--base-model", default="Qwen/Qwen2.5-0.5B-Instruct")
    p.add_argument("--output-dir", default="")
    p.add_argument("--epochs", type=int, default=3)
    p.add_argument("--lora-rank", type=int, default=16)
    p.add_argument("--lora-alpha", type=int, default=32)
    p.add_argument("--batch-size", type=int, default=1)
    p.add_argument("--max-steps", type=int, default=0)
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--gold-fixture", default="")
    return p.parse_args()


# ---------------------------------------------------------------------------
# Dataset loading
# ---------------------------------------------------------------------------

def resolve_dataset(path: str) -> Path:
    if path:
        p = Path(path).expanduser()
        if not p.exists():
            sys.exit(f"[adapter train] dataset not found: {p}")
        return p
    pattern = str(Path("~/.agi/datasets/candidates-*.jsonl").expanduser())
    files = sorted(glob.glob(pattern))
    if not files:
        sys.exit(
            "[adapter train] no candidate datasets in ~/.agi/datasets/.\n"
            "  Run the gateway and accumulate episodes first, or specify --dataset."
        )
    return Path(files[-1])


def load_candidate_jsonl(path: Path) -> list[dict]:
    entries = []
    with path.open() as f:
        for i, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                entries.append(json.loads(line))
            except json.JSONDecodeError as e:
                print(f"  [warn] skipping malformed line {i}: {e}", file=sys.stderr)
    return entries


def to_sft_rows(entries: list[dict]) -> list[dict]:
    """Convert CandidateEntry records to ChatML {text: ...} format."""
    rows = []
    for e in entries:
        summary = e.get("summary", "").strip()
        tags = e.get("tags", [])
        if not summary:
            continue
        tag_str = ", ".join(tags) if tags else "general"
        # Single-turn reflection: model learns to recall its own behaviour
        text = (
            "<|im_start|>system\n"
            "You are Aion, an AI assistant. Reflect honestly on your recent actions.\n"
            "<|im_end|>\n"
            "<|im_start|>user\n"
            f"Summarise what you did in the session tagged [{tag_str}].\n"
            "<|im_end|>\n"
            "<|im_start|>assistant\n"
            f"{summary}\n"
            "<|im_end|>"
        )
        rows.append({"text": text})
    return rows


# ---------------------------------------------------------------------------
# Training
# ---------------------------------------------------------------------------

def run_training(args: argparse.Namespace, rows: list[dict], output_dir: Path) -> None:
    try:
        from datasets import Dataset  # type: ignore[import-untyped]
        from peft import LoraConfig, TaskType  # type: ignore[import-untyped]
        from transformers import AutoModelForCausalLM, AutoTokenizer  # type: ignore[import-untyped]
        from trl import SFTConfig, SFTTrainer  # type: ignore[import-untyped]
    except ImportError as e:
        sys.exit(
            f"[adapter train] missing dependency: {e}\n"
            "  Install: pip install torch transformers peft trl datasets accelerate"
        )

    print(f"[adapter train] loading base model: {args.base_model}")
    tokenizer = AutoTokenizer.from_pretrained(args.base_model, trust_remote_code=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    model = AutoModelForCausalLM.from_pretrained(
        args.base_model,
        trust_remote_code=True,
        device_map="auto",
    )

    lora_cfg = LoraConfig(
        task_type=TaskType.CAUSAL_LM,
        r=args.lora_rank,
        lora_alpha=args.lora_alpha,
        lora_dropout=0.05,
        bias="none",
        target_modules="all-linear",
    )

    dataset = Dataset.from_list(rows)

    max_steps = args.max_steps if args.max_steps > 0 else -1

    training_args = SFTConfig(
        output_dir=str(output_dir / "checkpoints"),
        num_train_epochs=args.epochs,
        max_steps=max_steps,
        per_device_train_batch_size=args.batch_size,
        gradient_accumulation_steps=4,
        learning_rate=2e-4,
        lr_scheduler_type="cosine",
        warmup_ratio=0.05,
        logging_steps=10,
        save_strategy="no",
        fp16=False,
        bf16=False,
        report_to="none",
        dataset_text_field="text",
        max_seq_length=2048,
    )

    trainer = SFTTrainer(
        model=model,
        args=training_args,
        train_dataset=dataset,
        peft_config=lora_cfg,
        tokenizer=tokenizer,
    )

    print(f"[adapter train] training on {len(rows)} examples, {args.epochs} epoch(s)…")
    trainer.train()

    adapter_path = output_dir / "adapter"
    trainer.model.save_pretrained(str(adapter_path))
    tokenizer.save_pretrained(str(adapter_path))
    print(f"[adapter train] adapter saved → {adapter_path}")


# ---------------------------------------------------------------------------
# Gold-fixture verification
# ---------------------------------------------------------------------------

def run_fixture_check(fixture_path: Path, adapter_dir: Path) -> None:
    """Load trained adapter, run gold-fixture prompts, check must_include/must_not_include."""
    try:
        from peft import PeftModel  # type: ignore[import-untyped]
        from transformers import AutoModelForCausalLM, AutoTokenizer, pipeline  # type: ignore[import-untyped]
    except ImportError:
        print("[adapter check] skipped — HF dependencies not available", file=sys.stderr)
        return

    adapter_path = adapter_dir / "adapter"
    if not adapter_path.exists():
        print(f"[adapter check] adapter not found at {adapter_path}", file=sys.stderr)
        return

    fixtures = []
    with fixture_path.open() as f:
        for line in f:
            line = line.strip()
            if line:
                fixtures.append(json.loads(line))

    print(f"[adapter check] verifying {len(fixtures)} gold fixtures…")

    meta_path = adapter_dir / "adapter.json"
    base_model = "Qwen/Qwen2.5-0.5B-Instruct"
    if meta_path.exists():
        meta = json.loads(meta_path.read_text())
        base_model = meta.get("base_model", base_model)

    tokenizer = AutoTokenizer.from_pretrained(str(adapter_path), trust_remote_code=True)
    base = AutoModelForCausalLM.from_pretrained(base_model, trust_remote_code=True, device_map="auto")
    model = PeftModel.from_pretrained(base, str(adapter_path))

    gen = pipeline("text-generation", model=model, tokenizer=tokenizer, max_new_tokens=200)

    passed = 0
    failed = 0
    for fx in fixtures:
        prompt = fx.get("prompt", "")
        must_include = fx.get("must_include", [])
        must_not_include = fx.get("must_not_include", [])
        if not prompt:
            continue
        output = gen(prompt, do_sample=False)[0]["generated_text"][len(prompt):]
        ok = True
        for term in must_include:
            if term.lower() not in output.lower():
                print(f"  [FAIL] {fx['id']}: missing '{term}'")
                ok = False
        for term in must_not_include:
            if term.lower() in output.lower():
                print(f"  [FAIL] {fx['id']}: found forbidden '{term}'")
                ok = False
        if ok:
            passed += 1
        else:
            failed += 1

    print(f"[adapter check] {passed}/{passed+failed} fixtures passed")
    if failed > 0:
        sys.exit(1)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    args = parse_args()

    dataset_path = resolve_dataset(args.dataset)
    print(f"[adapter train] dataset:    {dataset_path}")

    entries = load_candidate_jsonl(dataset_path)
    rows = to_sft_rows(entries)
    print(f"[adapter train] {len(entries)} entries → {len(rows)} SFT rows")

    if len(rows) == 0:
        sys.exit("[adapter train] no usable rows after filtering — nothing to train on")

    if args.dry_run:
        print("[adapter train] --dry-run: validation passed, skipping training")
        return

    if args.output_dir:
        output_dir = Path(args.output_dir).expanduser()
    else:
        ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        output_dir = Path("~/.agi/adapters/candidates").expanduser() / ts

    output_dir.mkdir(parents=True, exist_ok=True)

    run_training(args, rows, output_dir)

    meta = {
        "id": output_dir.name,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "base_model": args.base_model,
        "dataset": str(dataset_path),
        "num_examples": len(rows),
        "epochs": args.epochs,
        "lora_rank": args.lora_rank,
        "lora_alpha": args.lora_alpha,
        "status": "candidate",
    }
    (output_dir / "adapter.json").write_text(json.dumps(meta, indent=2))
    print(f"[adapter train] metadata    → {output_dir / 'adapter.json'}")

    if args.gold_fixture:
        fixture_path = Path(args.gold_fixture).expanduser()
        if fixture_path.exists():
            run_fixture_check(fixture_path, output_dir)

    print(f"\n[adapter train] done. id: {output_dir.name}")
    print(f"  Promote with:  agi adapter promote {output_dir.name}")


if __name__ == "__main__":
    main()
