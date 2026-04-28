#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# check-docs-vs-help — drift lint between `agi help` and docs/human/cli.md
# ---------------------------------------------------------------------------
# Tynn s101 t363, v0.4.0 sweep. Surfaces three classes of drift:
#
#   1. Subcommands listed by `agi help` but missing from docs/human/cli.md
#      (i.e. owners reading the doc don't know they exist).
#   2. `### agi <name>` sections in cli.md that don't correspond to any
#      live subcommand (i.e. the doc names something the binary no longer
#      ships, or a typo).
#   3. TODO|WIP|MVP|FIXME markers in `agi help` output (i.e. a description
#      shipped as a placeholder and the placeholder survived to release —
#      this is exactly the drift class v0.4.177 fixed for `bash CMD`).
#
# Usage:
#   bash scripts/check-docs-vs-help.sh         # warn-only (exit 0)
#   bash scripts/check-docs-vs-help.sh --strict  # exit 2 on any drift
#
# The default is warn-only because a few subcommands are intentionally
# documented in sibling pages (e.g. test-vm → docs/human/testing.md;
# models → docs/human/huggingface.md). The strict mode is meant for the
# subset of CI runs that should block on drift. Per s101 process learning,
# ship warn-only first, promote to block-on-drift later if warnings stop
# appearing for legitimate reasons.
#
# Exits:
#   0 — clean OR warn-only with findings
#   2 — strict mode found drift
#   1 — invocation/setup error (missing files, etc.)
# ---------------------------------------------------------------------------
set -uo pipefail

STRICT=0
if [ "${1:-}" = "--strict" ]; then
  STRICT=1
fi

REPO_DIR="$(cd -P "$(dirname "$0")/.." && pwd)"
HELP_SCRIPT="$REPO_DIR/scripts/agi-cli.sh"
CLI_DOC="$REPO_DIR/docs/human/cli.md"

if [ ! -f "$HELP_SCRIPT" ]; then
  echo "error: $HELP_SCRIPT not found" >&2
  exit 1
fi
if [ ! -f "$CLI_DOC" ]; then
  echo "error: $CLI_DOC not found" >&2
  exit 1
fi

# Subcommands intentionally documented in sibling pages — not required in
# cli.md. Keep this list short; growing it past ~6 means the convention
# isn't really "everything in cli.md" any more and the lint should change.
ALLOWED_ELSEWHERE=(
  "test"
  "test-vm"
  "models"
  "providers"
  "marketplace"
  "lemonade"
  "ollama"
  "safemode"
  "incidents"
  "setup-claude-hooks"
  "help"
)

is_allowed_elsewhere() {
  local needle="$1"
  for s in "${ALLOWED_ELSEWHERE[@]}"; do
    [ "$s" = "$needle" ] && return 0
  done
  return 1
}

# ---------------------------------------------------------------------------
# Extract subcommand names from `agi help` output. The help block uses a
# two-column layout starting at column 2 with the subcommand name (first
# token) followed by the description on the same or following lines.
# ---------------------------------------------------------------------------
HELP_OUT=$(bash "$HELP_SCRIPT" help 2>&1)

# A subcommand line: starts with two spaces, then [a-z0-9-]+ as the first
# token, then whitespace, then any description. Reject lines that start
# with more indentation (continuation lines) or are usage/help text.
HELP_SUBCMDS=$(printf '%s\n' "$HELP_OUT" \
  | sed -n '/^Commands:/,/^[A-Z]/p' \
  | grep -E '^  [a-z][a-z0-9-]*[[:space:]]' \
  | sed -E 's/^  ([a-z][a-z0-9-]*).*/\1/' \
  | sort -u)

if [ -z "$HELP_SUBCMDS" ]; then
  echo "error: failed to parse subcommands from agi help — script may have changed format" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Extract `### agi <name>` sections from cli.md. A section header may
# combine names (e.g. "### agi restart / start / stop") so split on " / ".
# ---------------------------------------------------------------------------
DOC_SUBCMDS=$(grep -E '^### agi [a-z]' "$CLI_DOC" \
  | sed -E 's/^### agi //; s/`//g' \
  | tr '/' '\n' \
  | awk '{print $1}' \
  | sort -u)

# ---------------------------------------------------------------------------
# Drift checks
# ---------------------------------------------------------------------------
FINDINGS=0

# Class 1: subcommands in help but not in cli.md (and not allowed elsewhere)
for sub in $HELP_SUBCMDS; do
  if ! grep -qx "$sub" <<<"$DOC_SUBCMDS"; then
    if is_allowed_elsewhere "$sub"; then
      continue
    fi
    echo "DRIFT[help-not-in-cli.md]: \`agi $sub\` is in help but missing from docs/human/cli.md"
    FINDINGS=$((FINDINGS + 1))
  fi
done

# Class 2: cli.md sections naming subcommands that don't exist
for sub in $DOC_SUBCMDS; do
  if ! grep -qx "$sub" <<<"$HELP_SUBCMDS"; then
    echo "DRIFT[cli.md-not-in-help]: \`### agi $sub\` in cli.md but no such subcommand in agi help"
    FINDINGS=$((FINDINGS + 1))
  fi
done

# Class 3: WIP/MVP/TODO/FIXME markers leaking into help output
WIP_LINES=$(printf '%s\n' "$HELP_OUT" | grep -nE '\b(WIP|MVP|TODO|FIXME)\b' || true)
if [ -n "$WIP_LINES" ]; then
  while IFS= read -r line; do
    echo "DRIFT[wip-marker-in-help]: $line"
    FINDINGS=$((FINDINGS + 1))
  done <<<"$WIP_LINES"
fi

# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------
if [ "$FINDINGS" -eq 0 ]; then
  echo "docs-vs-help: clean ($(echo "$HELP_SUBCMDS" | wc -l | tr -d ' ') subcommands cross-checked)"
  exit 0
fi

echo ""
echo "docs-vs-help: $FINDINGS drift finding(s). Sweep before committing CLI changes."
echo "Reference: docs/agents/testing-and-shipping.md § 3 (Same-commit help-text + docs sweep)"

if [ "$STRICT" -eq 1 ]; then
  exit 2
fi
exit 0
