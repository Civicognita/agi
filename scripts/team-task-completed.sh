#!/bin/bash
# BOTS TaskCompleted Hook
#
# Fires when any agent team task is marked complete.
# Handles gate enforcement for BOTS-managed tasks:
#
# - auto gate: exit 0 (allow; next phase tasks unblock via dependencies)
# - checkpoint gate: if all phase workers done, exit 2 to block + signal lead
# - terminal gate: exit 2 to trigger merge review
#
# Exit codes:
#   0 = allow task completion
#   2 = block task completion (requires review)

set -e

# Read task description from stdin
TASK_DESC=$(cat)

# Quick check: is this a BOTS task?
if ! echo "$TASK_DESC" | grep -q "BOTS Worker Task"; then
  exit 0
fi

# Parse BOTS metadata from task description
JOB_ID=$(echo "$TASK_DESC" | grep -oP '\*\*job_id:\*\* \K[^\s]+' || echo "")
PHASE_ID=$(echo "$TASK_DESC" | grep -oP '\*\*phase_id:\*\* \K[^\s]+' || echo "")
WORKER=$(echo "$TASK_DESC" | grep -oP '\*\*worker:\*\* \K[^\s]+' || echo "")
WORKER_TID=$(echo "$TASK_DESC" | grep -oP '\*\*worker_tid:\*\* \K[^\s]+' || echo "")
GATE=$(echo "$TASK_DESC" | grep -oP '\*\*gate:\*\* \K[^\s]+' || echo "")

# Validate metadata
if [ -z "$JOB_ID" ] || [ -z "$PHASE_ID" ] || [ -z "$WORKER" ]; then
  # Not enough metadata to process — allow completion
  exit 0
fi

# Find project root
find_project_root() {
  local dir="$PWD"
  while [ "$dir" != "/" ]; do
    if [ -d "$dir/.bots" ]; then
      echo "$dir"
      return 0
    fi
    dir="$(dirname "$dir")"
  done
  return 1
}

PROJECT_ROOT=$(find_project_root) || exit 0
cd "$PROJECT_ROOT" || exit 0

# Reconcile task completion with BOTS state
RECONCILE_RESULT=$(npx tsx .bots/lib/cli.ts team-reconcile "$JOB_ID" "$PHASE_ID" "$WORKER" "$WORKER_TID" 2>/dev/null) || exit 0

# Parse reconcile result
ALL_COMPLETE=$(echo "$RECONCILE_RESULT" | grep -o '"allPhaseWorkersComplete":true' || echo "")

# Gate enforcement
case "$GATE" in
  auto)
    # Auto gate: allow completion, dependencies handle sequencing
    exit 0
    ;;
  checkpoint)
    if [ -n "$ALL_COMPLETE" ]; then
      # All phase workers done — block for human review
      echo "CHECKPOINT: Phase $PHASE_ID complete for job $JOB_ID. Review needed before proceeding." >&2
      echo "Run: npm run tm approve $JOB_ID" >&2
      exit 2
    fi
    # Not all workers done yet — allow this task to complete
    exit 0
    ;;
  terminal)
    if [ -n "$ALL_COMPLETE" ]; then
      # Job complete — block for merge review
      echo "TERMINAL: Job $JOB_ID complete. Ready for merge review." >&2
      echo "Run: npm run tm complete $JOB_ID" >&2
      exit 2
    fi
    exit 0
    ;;
  *)
    # Unknown gate type — allow completion
    exit 0
    ;;
esac
