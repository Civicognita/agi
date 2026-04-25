#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# loop-cycle-finished — Claude Code Stop hook for /loop completion chime
# ---------------------------------------------------------------------------
# Plays a sound when the assistant finishes responding to a /loop iteration.
# Stays silent for normal conversation turns so the chime stays meaningful.
#
# Detection strategy:
#   * Read the Stop hook event JSON from stdin (Claude Code provides
#     transcript_path and session_id).
#   * Open the transcript JSONL and find the most recent user message.
#   * If that user message contains any fingerprint listed in
#     ~/.claude/hooks/loop-cycle-fingerprints.txt (one per line, treated
#     as fixed substrings), play the chime.
#   * Missing or empty fingerprint file → never plays (opt-in).
#
# Sound playback:
#   * Tries pw-play (PipeWire) → aplay (ALSA wav fallback) → notify-send
#     with sound. First success wins. All failures swallowed.
#
# Robustness: ALWAYS exits 0 — a sound failure must not block a Stop event
# or surface a hook error to the assistant.
# ---------------------------------------------------------------------------
set -uo pipefail

LOG="${HOME}/.agi/logs/loop-cycle-chime.log"
mkdir -p "$(dirname "$LOG")" 2>/dev/null || true
log() { printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >>"$LOG" 2>/dev/null || true; }

FINGERPRINTS_FILE="${HOME}/.claude/hooks/loop-cycle-fingerprints.txt"
SOUND_FILE="${LOOP_CYCLE_SOUND:-/usr/share/sounds/freedesktop/stereo/complete.oga}"

# ---------------------------------------------------------------------------
# Read hook input. Failures degrade to no-op + log.
# ---------------------------------------------------------------------------
EVENT_JSON="$(cat 2>/dev/null || true)"
if [ -z "$EVENT_JSON" ]; then
  log "no stdin"; exit 0
fi

if ! command -v jq >/dev/null 2>&1; then
  log "jq missing"; exit 0
fi

TRANSCRIPT_PATH=$(printf '%s' "$EVENT_JSON" | jq -r '.transcript_path // empty')
if [ -z "$TRANSCRIPT_PATH" ] || [ ! -f "$TRANSCRIPT_PATH" ]; then
  log "no transcript path: ${TRANSCRIPT_PATH:-missing}"
  exit 0
fi

if [ ! -f "$FINGERPRINTS_FILE" ]; then
  log "no fingerprints file at $FINGERPRINTS_FILE — skipping"
  exit 0
fi

# Strip blank lines + comments from fingerprints
mapfile -t FINGERPRINTS < <(grep -vE '^[[:space:]]*(#|$)' "$FINGERPRINTS_FILE" 2>/dev/null || true)
if [ "${#FINGERPRINTS[@]}" -eq 0 ]; then
  log "fingerprints file empty"; exit 0
fi

# ---------------------------------------------------------------------------
# Find the last user message in the transcript. The transcript is JSONL;
# each line is one event. We pick the last "user" role message and read its
# content — for multi-block content we concatenate all text blocks.
# ---------------------------------------------------------------------------
LAST_USER=$(jq -rs '
  map(select(.type == "user" and .message.role == "user"))
  | last
  | .message.content
  | if type == "string" then .
    elif type == "array" then map(select(.type == "text") | .text) | join("\n")
    else "" end
' "$TRANSCRIPT_PATH" 2>/dev/null || true)

if [ -z "$LAST_USER" ]; then
  log "no last user message in transcript"
  exit 0
fi

# ---------------------------------------------------------------------------
# Fingerprint match — fixed-substring search (no regex, robust against
# user-supplied prompt text).
# ---------------------------------------------------------------------------
MATCHED=""
for fp in "${FINGERPRINTS[@]}"; do
  case "$LAST_USER" in
    *"$fp"*) MATCHED="$fp"; break ;;
  esac
done

if [ -z "$MATCHED" ]; then
  log "no fingerprint match in last user message"
  exit 0
fi

# ---------------------------------------------------------------------------
# Play the chime — first available player wins. Never block.
# ---------------------------------------------------------------------------
play_via() {
  local player="$1"; shift
  command -v "$player" >/dev/null 2>&1 || return 1
  "$player" "$@" >/dev/null 2>&1 &
  disown 2>/dev/null || true
  return 0
}

PLAYED=""
if [ -f "$SOUND_FILE" ]; then
  case "$SOUND_FILE" in
    *.oga|*.ogg) play_via pw-play "$SOUND_FILE" && PLAYED="pw-play" ;;
    *.wav)       play_via aplay   -q "$SOUND_FILE" && PLAYED="aplay" ;;
  esac
  # Fallback chain when the preferred player isn't available
  if [ -z "$PLAYED" ]; then
    play_via ffplay -nodisp -autoexit -loglevel quiet "$SOUND_FILE" && PLAYED="ffplay"
  fi
fi

# Last resort: notify-send (will use system notification sound if configured)
if [ -z "$PLAYED" ]; then
  play_via notify-send -u low -t 1500 "Loop cycle finished" "/loop iteration completed" && PLAYED="notify-send"
fi

log "matched fingerprint=${MATCHED:0:48} played=${PLAYED:-none}"
exit 0
