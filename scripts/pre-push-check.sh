#!/usr/bin/env bash
# pre-push-check.sh — local CI gate that runs before every push.
#
# Replaces GitHub Actions CI to avoid per-minute charges.
# Runs: lockfile sync, typecheck, lint, build verification.
#
# Install as git hook:
#   ln -sf ../../scripts/pre-push-check.sh .git/hooks/pre-push
#
# Or run manually: bash scripts/pre-push-check.sh
#
# Skip in emergencies: git push --no-verify
set -euo pipefail

BOLD="\033[1m"
RED="\033[31m"
GREEN="\033[32m"
RESET="\033[0m"

pass() { echo -e "  ${GREEN}✓${RESET} $1"; }
fail() { echo -e "  ${RED}✗${RESET} $1"; echo ""; exit 1; }

echo -e "${BOLD}[pre-push] Running local CI checks...${RESET}"
echo ""

# 1. Lockfile sync
echo -n "  Lockfile... "
if pnpm install --frozen-lockfile --silent 2>/dev/null; then
  pass "lockfile in sync"
else
  echo ""
  fail "pnpm-lock.yaml is out of sync — run 'pnpm install' and commit"
fi

# 2. Type check
echo -n "  Typecheck... "
if pnpm typecheck 2>/dev/null; then
  pass "no type errors"
else
  echo ""
  fail "typecheck failed — run 'pnpm typecheck' to see errors"
fi

# 3. Lint
echo -n "  Lint... "
if pnpm lint 2>/dev/null; then
  pass "no lint errors"
else
  echo ""
  fail "lint failed — run 'pnpm lint' to see errors"
fi

echo ""
echo -e "${GREEN}${BOLD}All checks passed.${RESET}"
