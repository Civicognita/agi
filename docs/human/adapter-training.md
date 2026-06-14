# Adapter Training

Aion can improve its own behaviour by fine-tuning a small LoRA adapter on top of the base aion-micro model. This page describes how the pipeline works and how to use it.

> **Status (v0.4.0):** manual-trigger only. The pipeline scaffolds training, promotion, and rollback; automated scheduling and DPO (preference training) come later.

---

## How it works

The pipeline has four stages:

1. **Accumulate** — every session that scores above the confidence threshold and passes all data-quality gates is appended to a monthly candidate file at `~/.agi/datasets/candidates-YYYY-MM.jsonl`.
2. **Train** — `agi adapter train` runs `scripts/train-aion-micro.py`, which converts the candidate entries into ChatML-format SFT rows and fine-tunes via TRL `SFTTrainer` + PEFT `LoraConfig`. The resulting adapter lands in `~/.agi/adapters/candidates/<timestamp>/`.
3. **Check** — `agi adapter check <id>` runs the gold-fixture suite against the candidate adapter to catch alignment regressions before promotion.
4. **Promote** — `agi adapter promote <id>` sets `~/.agi/adapters/active` to the chosen candidate. After `agi restart`, Lemonade loads the adapter on top of the base model.

---

## Prerequisites

Python packages must be installed in the same environment Python is invoked from:

```bash
pip install torch transformers peft trl datasets accelerate
# GPU only:
pip install bitsandbytes
```

These packages are **not** bundled with AGI — they are large ML dependencies appropriate only on nodes that perform training.

---

## Commands

### `agi adapter train`

```
agi adapter train [OPTIONS]
  --dataset PATH       Candidate JSONL (default: latest ~/.agi/datasets/candidates-*.jsonl)
  --base-model NAME    HuggingFace model id (default: Qwen/Qwen2.5-0.5B-Instruct)
  --epochs N           Training epochs (default: 3)
  --lora-rank N        LoRA rank r (default: 16)
  --dry-run            Validate dataset only; skip training
```

Example — validate first, then train:

```bash
agi adapter train --dry-run
agi adapter train --epochs 1 --lora-rank 8
```

### `agi adapter list`

Shows all candidate adapters with status and example count. The active adapter is marked `[active]`.

### `agi adapter promote <id>`

Sets the named adapter as active. The `id` is the timestamp directory name shown by `agi adapter list`. Takes effect after `agi restart`.

### `agi adapter rollback [<id>]`

With an id: rolls back to a prior candidate.
Without an id: removes the active link so the base model is used directly.

### `agi adapter check [<id>]`

Runs the gold-fixture verification suite (at `test/fixtures/prime-gold-evals.jsonl`) against the specified adapter. If no id is given, checks the currently active adapter.

---

## LoRA details

| Hyperparameter | Default |
|---|---|
| Rank `r` | 16 |
| Alpha | 32 |
| Dropout | 0.05 |
| Target modules | `all-linear` |
| Learning rate | 2e-4 |
| LR scheduler | cosine |
| Warmup ratio | 0.05 |
| Max sequence length | 2048 |

The adapter is saved in HuggingFace `safetensors` format alongside `adapter.json` metadata that records the base model, dataset path, example count, epoch count, and promotion status.

---

## Adapter directory layout

```
~/.agi/adapters/
  active/                  ← symlink → candidates/<active-id>/ (or absent)
  candidates/
    20260518_143022/
      adapter/             ← PEFT adapter weights (safetensors + config.json)
      adapter.json         ← metadata
      checkpoints/         ← HF Trainer checkpoints (may be absent if save_strategy=no)
```

---

## Gold-fixture verification

The fixture file at `test/fixtures/prime-gold-evals.jsonl` contains 25 prompts that test Aion's core alignment (identity, mission, doctrine). P0 fixtures must pass; P1/P2 emit warnings.

Run standalone:

```bash
agi adapter check 20260518_143022
```

---

## Limitations (v0.4.0)

- Training runs on the CPU unless a compatible GPU is present. On a modern laptop, a 3-epoch run on ~100 examples with Qwen2.5-0.5B takes 5–20 minutes.
- DPO (preference training using reward-gate pairs) is deferred to v0.5.0 when Gate 2 (reward gate) is wired.
- Automated cadence (weekly, triggered by dataset size) is deferred to v0.5.0.
- Lemonade adapter loading is scaffolded via the `~/.agi/adapters/active` symlink; the Lemonade server must support PEFT adapter injection for this to take effect (verify with `agi lemonade status`).
