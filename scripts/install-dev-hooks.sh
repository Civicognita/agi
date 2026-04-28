#!/usr/bin/env bash
# install-dev-hooks.sh — one-time dev machine setup for git hooks.
#
# Run this once after cloning or pulling the repo on your development machine:
#   bash scripts/install-dev-hooks.sh
#
# What it installs:
#   .git/hooks/pre-push  → enforces VM unit tests before pushes to dev/main
#
# The hook blocks pushes to dev/main if the VM test suite fails.
# Bypass with AGI_ALLOW_UNTESTED_PUSH=1 git push (emergency only).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GIT_HOOKS_DIR="$REPO_DIR/.git/hooks"

if [[ ! -d "$REPO_DIR/.git" ]]; then
  echo "Error: not inside a git repository at $REPO_DIR" >&2
  exit 1
fi

mkdir -p "$GIT_HOOKS_DIR"

HOOK_SRC="$SCRIPT_DIR/hooks/pre-push"
HOOK_DST="$GIT_HOOKS_DIR/pre-push"

if [[ ! -f "$HOOK_SRC" ]]; then
  echo "Error: hook source not found at $HOOK_SRC" >&2
  exit 1
fi

ln -sf "$HOOK_SRC" "$HOOK_DST"
chmod +x "$HOOK_DST"

echo ""
echo "  [OK] Installed pre-push hook -> .git/hooks/pre-push"
echo ""
echo "  This hook runs the VM unit test suite before each push to dev/main."
echo ""
echo "  Bypass (emergency only):"
echo "    AGI_ALLOW_UNTESTED_PUSH=1 git push"
echo "    git push --no-verify"
echo ""
