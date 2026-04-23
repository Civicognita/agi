#!/usr/bin/env bash
# fine-tune.sh — train a new Aion-Micro LoRA adapter from training-data/.
#
# Usage:  ./scripts/fine-tune.sh <version>      e.g. ./scripts/fine-tune.sh v2
#
# Reads:    aion-micro/training-data/<version>.jsonl
# Writes:   aion-micro/adapters/<version>/{adapter_config.json,adapter_model.safetensors}
#
# Requires: Python 3.10+, transformers, peft, trl, datasets, torch.
# AGI ships a pre-built `agi-finetune` container that has all of these
# pinned at known-good versions — prefer that over installing locally:
#
#   podman run --rm -v "$PWD/aion-micro:/work" agi-finetune:latest \
#     /work/scripts/fine-tune.sh v2
#
# Direct host invocation works too as long as your venv has the deps.

set -euo pipefail

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  echo "Usage: $0 <version>   (e.g. v2)" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TRAINING_FILE="${ROOT}/training-data/${VERSION}.jsonl"
ADAPTER_OUT="${ROOT}/adapters/${VERSION}"
BASE_MODEL="${BASE_MODEL:-HuggingFaceTB/SmolLM2-135M-Instruct}"

if [ ! -f "$TRAINING_FILE" ]; then
  echo "ERROR: training data not found at $TRAINING_FILE" >&2
  echo "       Add JSONL examples to $TRAINING_FILE first." >&2
  exit 1
fi

mkdir -p "$ADAPTER_OUT"

python3 - <<EOF
import json
from datasets import Dataset
from transformers import AutoModelForCausalLM, AutoTokenizer, TrainingArguments
from peft import LoraConfig, get_peft_model, TaskType
from trl import SFTTrainer, SFTConfig

print("Loading base model: ${BASE_MODEL}")
tokenizer = AutoTokenizer.from_pretrained("${BASE_MODEL}")
if tokenizer.pad_token is None:
    tokenizer.pad_token = tokenizer.eos_token
base = AutoModelForCausalLM.from_pretrained("${BASE_MODEL}")

print("Wrapping with LoRA (r=16, alpha=32, target=q_proj,v_proj)")
peft_config = LoraConfig(
    task_type=TaskType.CAUSAL_LM,
    r=16,
    lora_alpha=32,
    lora_dropout=0.05,
    target_modules=["q_proj", "v_proj"],
)
model = get_peft_model(base, peft_config)
model.print_trainable_parameters()

print("Loading training data: ${TRAINING_FILE}")
records = []
with open("${TRAINING_FILE}") as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        records.append(json.loads(line))
print(f"  {len(records)} examples")
dataset = Dataset.from_list(records)

print("Training...")
trainer = SFTTrainer(
    model=model,
    train_dataset=dataset,
    args=SFTConfig(
        output_dir="${ADAPTER_OUT}/_checkpoints",
        num_train_epochs=3,
        per_device_train_batch_size=4,
        gradient_accumulation_steps=2,
        learning_rate=2e-4,
        warmup_steps=20,
        logging_steps=10,
        save_strategy="no",
        report_to=[],
    ),
)
trainer.train()

print("Saving adapter to ${ADAPTER_OUT}")
model.save_pretrained("${ADAPTER_OUT}")
tokenizer.save_pretrained("${ADAPTER_OUT}")
print("done.")
EOF

echo
echo "Adapter saved to: $ADAPTER_OUT"
echo "Next step: ./scripts/publish.sh ${VERSION}"
