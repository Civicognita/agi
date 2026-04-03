#!/usr/bin/env bash
# Voice notification for Claude Code — plays TTS via edge-tts + mpv
# Called by the Notification hook with context on stdin.

VOICE="en-US-EmmaNeural"
EDGE_TTS="$HOME/.local/bin/edge-tts"
TMP_FILE="/tmp/aionima-voice-notify.mp3"

# Read hook input from stdin
INPUT=$(cat)

# Log raw input for debugging
echo "$(date -Iseconds) $INPUT" >> /tmp/aionima-notify-debug.log

# Determine message based on notification type
# Claude Code sends JSON with a "type" field
TYPE=$(echo "$INPUT" | grep -oP '"type"\s*:\s*"\K[^"]+' 2>/dev/null || echo "")

case "$TYPE" in
  permission_prompt)
    MSG="Hey Wish, I need you to approve something"
    ;;
  *)
    MSG="Hey Wish, I'm done."
    ;;
esac

# Generate and play (fire-and-forget, don't block Claude)
"$EDGE_TTS" --voice "$VOICE" --text "$MSG" --write-media "$TMP_FILE" 2>/dev/null \
  && mpv --no-video --really-quiet "$TMP_FILE" 2>/dev/null &

exit 0
