#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# agi-bash-router — Claude Code PreToolUse hook for the Bash tool
# ---------------------------------------------------------------------------
# Story #108, task #344 (v0.4.0 sweep). Enforces the routing rule from
# ~/temp_core/CLAUDE.md § 3:
#
#   Every shell exec by the assistant must flow through `agi bash` so the
#   invocation lands in the JSONL log surface (~/.agi/logs/agi-bash-*.jsonl)
#   with caller attribution. Substrate completeness, not by-discipline.
#
# Behavior (block-and-nudge):
#   * If the candidate command is already wrapped (matches `agi bash` or
#     `bash …agi-cli.sh bash`) → exit 0 (allow).
#   * If the binary at /usr/local/bin/agi exposes the `bash` subcommand,
#     suggest the short form (`agi bash '<cmd>'`). Otherwise suggest the
#     dev-source wrap (`bash <path>/agi-cli.sh bash '<cmd>'`).
#   * Block with exit 2 + a structured stderr message the assistant reads
#     and converts into a re-issue with the wrapped form.
#
# Carve-outs (allow without wrap):
#   * Empty / whitespace-only command → exit 0 (the Bash tool will reject).
#   * Commands that ARE the agi-cli.sh dispatch (e.g. `agi help`, `agi test
#     dashboard`) — these already-route-through-agi don't need wrapping.
#   * Commands the user explicitly opts out of via the env var
#     AGI_ROUTER_BYPASS=1 (escape hatch — recorded in router log).
#
# Collision protocol (story #108, task #347 will extend this):
#   When the inner agi bash itself returns 126 (policy block) or "Unknown
#   command" stderr, this hook is NOT the right place to intercept (that's
#   PostToolUse). The block path here only fires for unwrapped commands.
#
# Robustness:
#   * The hook NEVER blocks because of its own malfunction. If jq is
#     missing or stdin is malformed, exit 0 (allow) and log to the router
#     error log so the assistant isn't left stranded.
#   * Output is always written to ROUTER_LOG for post-hoc audit.
# ---------------------------------------------------------------------------
set -uo pipefail

ROUTER_LOG="${HOME}/.agi/logs/agi-bash-router.log"
mkdir -p "$(dirname "$ROUTER_LOG")" 2>/dev/null || true

log() {
  printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >>"$ROUTER_LOG" 2>/dev/null || true
}

# ---------------------------------------------------------------------------
# Read the hook event from stdin. Failures degrade to allow.
# ---------------------------------------------------------------------------
EVENT_JSON="$(cat 2>/dev/null || true)"
if [ -z "$EVENT_JSON" ]; then
  log "empty stdin — allow"
  exit 0
fi

# Use jq if available; fall back to a coarse grep extraction otherwise so
# missing jq doesn't strand the assistant.
extract_command() {
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$EVENT_JSON" | jq -r '.tool_input.command // empty' 2>/dev/null
  else
    printf '%s' "$EVENT_JSON" \
      | grep -oP '"command"\s*:\s*"\K(\\.|[^"\\])*' \
      | head -n1
  fi
}

CMD="$(extract_command)"
if [ -z "$CMD" ]; then
  log "no command field in event — allow"
  exit 0
fi

# Bypass via env var (recorded for audit).
if [ "${AGI_ROUTER_BYPASS:-0}" = "1" ]; then
  log "BYPASS active — allow (cmd hash=$(printf '%s' "$CMD" | sha256sum | cut -c1-12))"
  exit 0
fi

# ---------------------------------------------------------------------------
# Already-wrapped detection
# ---------------------------------------------------------------------------
#
# A command is considered routed if:
#   * It starts with `agi bash` (the live binary form, post-deploy).
#   * It matches `bash …agi-cli.sh bash` (the dev-source form).
#   * It is invoking the agi binary itself with a non-bash subcommand
#     (`agi status`, `agi test`, `agi marketplace …`) — those already use
#     the agi entryway.
#
# Detection is intentionally permissive (anchored substring); a
# false-positive bypass is preferable to false-positive blocking.
# ---------------------------------------------------------------------------
case "$CMD" in
  *"agi-cli.sh bash"*) log "allow — dev-script wrap"; exit 0 ;;
  *"agi bash "*|"agi bash") log "allow — live agi bash form"; exit 0 ;;
  "agi "*|*"/agi "*|*"agi help"*|*"agi status"*|*"agi logs"*|*"agi test"*|\
  *"agi config"*|*"agi marketplace"*|*"agi models"*|*"agi providers"*|\
  *"agi test-vm"*|*"agi ollama"*|*"agi lemonade"*|*"agi doctor"*|\
  *"agi upgrade"*|*"agi restart"*|*"agi start"*|*"agi stop"*|\
  *"agi setup"*|*"agi channels"*|*"agi projects"*|*"agi safemode"*|\
  *"agi incidents"*)
    log "allow — agi subcommand"; exit 0 ;;
esac

# ---------------------------------------------------------------------------
# Decide which wrap form to suggest.
# ---------------------------------------------------------------------------
SUGGESTED_FORM=""
if /usr/local/bin/agi help 2>/dev/null | grep -q "bash CMD" 2>/dev/null; then
  SUGGESTED_FORM="agi bash '<cmd>'"
  WRAP_PATH="agi bash"
else
  SUGGESTED_FORM="bash /home/wishborn/temp_core/agi/scripts/agi-cli.sh bash '<cmd>'"
  WRAP_PATH="bash /home/wishborn/temp_core/agi/scripts/agi-cli.sh bash"
fi

# Build a quoted version of CMD for the suggestion.
# Escape single quotes by closing-out, escaping, and reopening: ' \' '
QUOTED_CMD="${CMD//\'/\'\\\'\'}"
SUGGESTED_REWRITE="${WRAP_PATH} '${QUOTED_CMD}'"

CMD_HASH="$(printf '%s' "$CMD" | sha256sum | cut -c1-12)"
log "BLOCK unwrapped Bash (hash=${CMD_HASH}) — suggesting ${WRAP_PATH}"

# ---------------------------------------------------------------------------
# Block with structured stderr the assistant can parse.
# Format: a header line for human readability + a prefixed line per
# directive so future automation can tail it deterministically.
# ---------------------------------------------------------------------------
{
  echo "AGI-BASH-ROUTER: blocked unwrapped Bash command (story #108)"
  echo "AGI-BASH-ROUTER:reason: every shell exec must flow through agi bash"
  echo "AGI-BASH-ROUTER:cmd_hash: ${CMD_HASH}"
  echo "AGI-BASH-ROUTER:suggested_form: ${SUGGESTED_FORM}"
  echo "AGI-BASH-ROUTER:rewrite: ${SUGGESTED_REWRITE}"
  echo "AGI-BASH-ROUTER:bypass: set AGI_ROUTER_BYPASS=1 in the Bash env to skip routing (recorded in audit log)"
  echo ""
  echo "Re-issue the Bash call using the rewrite above, OR use AGI_ROUTER_BYPASS=1 if this exec is intentionally outside the entryway (and document why in tynn)."
} >&2
exit 2
