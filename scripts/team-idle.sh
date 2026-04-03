#!/bin/bash
# BOTS TeammateIdle Hook
#
# Fires when a teammate is about to go idle.
# Enforces the BOTS handoff protocol: teammates must write
# their handoff JSON before going idle.
#
# Exit codes:
#   0 = allow idle
#   2 = block idle (teammate must write handoff first)

set -e

# Read teammate info from stdin
TEAMMATE_INFO=$(cat)

# Extract teammate name (if available in the input)
TEAMMATE_NAME=$(echo "$TEAMMATE_INFO" | grep -oP '"name":\s*"\K[^"]+' 2>/dev/null || echo "")

if [ -z "$TEAMMATE_NAME" ]; then
  # Can't identify teammate — allow idle
  exit 0
fi

# Quick check: is this a BOTS teammate? (name pattern: {worker}-job-{nnn})
if ! echo "$TEAMMATE_NAME" | grep -qE '.*-job-[0-9]+'; then
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

# Check if teammate has pending BOTS tasks without handoff
PENDING_RESULT=$(npx tsx .bots/lib/cli.ts team-pending "$TEAMMATE_NAME" 2>/dev/null) || exit 0

PENDING_COUNT=$(echo "$PENDING_RESULT" | grep -o '"pending":[0-9]*' | grep -o '[0-9]*' || echo "0")
HAS_HANDOFF=$(echo "$PENDING_RESULT" | grep -o '"hasHandoff":true' || echo "")

if [ "$PENDING_COUNT" -gt 0 ] && [ -z "$HAS_HANDOFF" ]; then
  echo "BOTS: Write handoff JSON before going idle. Teammate $TEAMMATE_NAME has $PENDING_COUNT pending task(s) without handoff files." >&2
  exit 2
fi

exit 0
