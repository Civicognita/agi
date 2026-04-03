#!/bin/bash
# BOTS UserPromptSubmit Hook
#
# Detects w:> and n:> shortcodes in user input:
# 1. Creates WORK{JOB}s via CLI
# 2. Runs orchestrator to prepare workers
# 3. Outputs signal for terminal to spawn workers

set -e

# Get user input from stdin
INPUT=$(cat)

# Quick check for shortcodes (fast path)
if ! echo "$INPUT" | grep -qE '(w:|n:)>'; then
  exit 0
fi

# Find project root (walk up to find .bots/)
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

# Check if CLI is available
if ! command -v npx &> /dev/null; then
  exit 0
fi

# Create jobs via CLI
RESULT=$(echo "$INPUT" | npx tsx .bots/lib/cli.ts queue 2>/dev/null) || exit 0

# Parse result
JOB_COUNT=$(echo "$RESULT" | grep -o '"created":[0-9]*' | grep -o '[0-9]*' || echo "0")

if [ "$JOB_COUNT" -gt 0 ] 2>/dev/null; then
  # Extract job IDs
  JOB_IDS=$(echo "$RESULT" | grep -o '"id":"[^"]*"' | sed 's/"id":"//g' | sed 's/"//g' | tr '\n' ' ')

  # Detect execution mode
  MODE=$(npx tsx -e "
    const fs = require('fs');
    try {
      const state = JSON.parse(fs.readFileSync('.bots/state/taskmaster.json', 'utf-8'));
      console.log(state.mode || 'subagent');
    } catch { console.log('subagent'); }
  " 2>/dev/null || echo "subagent")

  # Run orchestrator to prepare workers
  ORCH_RESULT=$(npx tsx .bots/lib/orchestrator.ts run 2>/dev/null) || true

  # Output structured signal for terminal
  echo ""
  echo "╔═══════════════════════════════════════════════════════════════╗"
  echo "║  BOTS                                                         ║"
  echo "╠═══════════════════════════════════════════════════════════════╣"
  echo "║  Queued: $JOB_COUNT job(s)                                           ║"

  # Show jobs
  echo "$RESULT" | npx tsx -e "
    const data = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
    data.jobs.forEach(j => {
      const line = '  → ' + j.id + ': ' + j.entryWorker;
      console.log('║' + line.padEnd(65) + '║');
    });
    if (data.nextFrame) {
      console.log('║  Next: ' + data.nextFrame.substring(0, 54).padEnd(57) + '║');
    }
  " 2>/dev/null || true

  echo "╠═══════════════════════════════════════════════════════════════╣"

  if [ "$MODE" = "team" ]; then
    echo "║  <bots-team-orchestrate jobs=\"$JOB_IDS\"/>                    ║"
  else
    echo "║  <bots-auto-spawn jobs=\"$JOB_IDS\"/>                          ║"
  fi

  echo "╚═══════════════════════════════════════════════════════════════╝"
  echo ""
fi

exit 0
