#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# agi-bash-router — Claude Code PreToolUse hook for the Bash tool
# ---------------------------------------------------------------------------
# Story #108. Enforces the rule from ~/temp_core/CLAUDE.md § 3:
#
#   Every shell exec by the assistant must flow through `agi bash` so the
#   invocation lands in the JSONL log surface (~/.agi/logs/agi-bash-*.jsonl)
#   with caller attribution. Substrate completeness, not by-discipline.
#
# Behavior (transparent rewrite — agibash IS the bash replacement):
#   * Unwrapped command → emit hookSpecificOutput.updatedInput.command
#     that wraps it as `agi bash '<cmd>'`. Claude Code runs the rewritten
#     form with no friction. The assistant's plain `Bash("ls /tmp")` call
#     becomes `agi bash 'ls /tmp'` automatically.
#   * Already-wrapped (`agi bash …`, `bash …agi-cli.sh bash`, `agi <subcmd>`)
#     → exit 0 with empty stdout (allow as-is).
#   * AGI_ROUTER_BYPASS=1 → exit 0 (allow), audit-logged.
#
# Output protocol (PreToolUse, current):
#   {
#     "hookSpecificOutput": {
#       "hookEventName": "PreToolUse",
#       "permissionDecision": "allow",
#       "updatedInput": { "command": "<rewritten>" }
#     }
#   }
#
# Robustness: the hook NEVER blocks on its own malfunction. If jq is
# missing or stdin is malformed, exit 0 (allow) and log to ROUTER_LOG.
# Output is always written to ROUTER_LOG for post-hoc audit.
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
# Already-wrapped detection — passes through unchanged.
# Detection is intentionally permissive (anchored substring); a
# false-positive bypass is preferable to false-positive rewrite.
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
# Rewrite: wrap the command via `agi bash '<cmd>'` (live) or the
# dev-source path (when /usr/local/bin/agi predates v0.4.149). Quote
# inner single-quotes by closing-out, escaping, and reopening.
# ---------------------------------------------------------------------------
QUOTED_CMD="${CMD//\'/\'\\\'\'}"

if /usr/local/bin/agi help 2>/dev/null | grep -q "bash CMD" 2>/dev/null; then
  REWRITTEN="agi bash '${QUOTED_CMD}'"
  WRAP_FORM="live"
else
  REWRITTEN="bash /home/wishborn/temp_core/agi/scripts/agi-cli.sh bash '${QUOTED_CMD}'"
  WRAP_FORM="dev-source"
fi

CMD_HASH="$(printf '%s' "$CMD" | sha256sum | cut -c1-12)"
log "REWRITE (${WRAP_FORM}) hash=${CMD_HASH} cmd_len=${#CMD}"

# ---------------------------------------------------------------------------
# Emit the PreToolUse rewrite payload. We need to JSON-encode REWRITTEN as
# a string; prefer jq, fall back to a python3 one-liner, then a manual
# escape if both are unavailable.
# ---------------------------------------------------------------------------
emit_rewrite_json() {
  local cmd="$1"
  if command -v jq >/dev/null 2>&1; then
    jq -nc --arg cmd "$cmd" '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        updatedInput: { command: $cmd }
      }
    }'
    return 0
  fi
  if command -v python3 >/dev/null 2>&1; then
    REWRITTEN_CMD="$cmd" python3 -c '
import json, os
print(json.dumps({
    "hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "allow",
        "updatedInput": {"command": os.environ["REWRITTEN_CMD"]},
    }
}))'
    return 0
  fi
  # Manual fallback: only escape backslashes, double-quotes, and control chars.
  # This branch is best-effort; jq/python3 are the supported paths.
  local esc="${cmd//\\/\\\\}"
  esc="${esc//\"/\\\"}"
  esc="${esc//$'\n'/\\n}"
  esc="${esc//$'\t'/\\t}"
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","updatedInput":{"command":"%s"}}}\n' "$esc"
}

emit_rewrite_json "$REWRITTEN"
exit 0
