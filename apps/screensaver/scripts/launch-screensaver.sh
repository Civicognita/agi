#!/usr/bin/env bash
# Wrapper for xss-lock that absorbs Electron crashes.
# xss-lock expects its child to exit cleanly — if the child crashes,
# xss-lock itself dies. This wrapper always exits 0.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
ELECTRON_BIN="$APP_DIR/node_modules/.bin/electron"
MAIN_JS="$APP_DIR/dist/main.js"

"$ELECTRON_BIN" "$MAIN_JS" "$@" 2>/dev/null || true
