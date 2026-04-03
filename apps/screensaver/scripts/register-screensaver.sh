#!/usr/bin/env bash
# Register Aionima screensaver with X11 idle detection
# Usage: ./register-screensaver.sh [idle-seconds]
#
# Requires: xss-lock, xset, electron

set -euo pipefail

IDLE_SECS="${1:-180}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
MAIN_JS="$APP_DIR/dist/main.js"

if ! command -v xss-lock &>/dev/null; then
  echo "xss-lock is required: sudo apt install xss-lock"
  exit 1
fi

if [ ! -f "$MAIN_JS" ]; then
  echo "Build first: cd $APP_DIR && pnpm build"
  exit 1
fi

ELECTRON_BIN="$APP_DIR/node_modules/.bin/electron"
if [ ! -f "$ELECTRON_BIN" ]; then
  echo "Install deps first: cd $APP_DIR && pnpm install"
  exit 1
fi

# Set X11 screen saver idle timeout
xset s "$IDLE_SECS" 0

LAUNCHER="$SCRIPT_DIR/launch-screensaver.sh"

echo "Starting xss-lock with ${IDLE_SECS}s idle timeout..."
echo "Screensaver: $LAUNCHER"
echo ""
echo "To autostart, add this to your session startup (e.g. ~/.xprofile):"
echo "  xset s $IDLE_SECS 0"
echo "  xss-lock -- $LAUNCHER &"
echo ""

xss-lock -- "$LAUNCHER" &
echo "xss-lock running (PID: $!)"
