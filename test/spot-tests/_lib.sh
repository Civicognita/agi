#!/usr/bin/env bash
# Shared helpers for spot tests. Source with: . "$(dirname "$0")/_lib.sh"

set -uo pipefail

PASS=0
FAIL=0
TEST_NAME="${TEST_NAME:-spot-test}"

GREEN=$'\033[32m'; RED=$'\033[31m'; YELLOW=$'\033[33m'; BOLD=$'\033[1m'; RESET=$'\033[0m'

header()  { echo; echo "${BOLD}=== ${1} ===${RESET}"; }
pass()    { echo "  ${GREEN}✓${RESET} $*"; PASS=$((PASS + 1)); }
fail()    { echo "  ${RED}✗${RESET} $*"; FAIL=$((FAIL + 1)); }
info()    { echo "  ${YELLOW}…${RESET} $*"; }

# assert_eq <expected> <actual> <description>
assert_eq() {
  local expected="$1" actual="$2" desc="$3"
  if [ "$expected" = "$actual" ]; then
    pass "$desc"
  else
    fail "$desc — expected '$expected', got '$actual'"
  fi
}

# assert_contains <haystack> <needle> <description>
assert_contains() {
  local haystack="$1" needle="$2" desc="$3"
  if echo "$haystack" | grep -qF "$needle"; then
    pass "$desc"
  else
    fail "$desc — '$needle' not found"
  fi
}

# assert_nonempty <value> <description>
assert_nonempty() {
  local value="$1" desc="$2"
  if [ -n "$value" ]; then
    pass "$desc"
  else
    fail "$desc — value was empty"
  fi
}

# assert_command <cmd> <description>  — runs cmd, passes if exit 0
assert_command() {
  local cmd="$1" desc="$2"
  if eval "$cmd" >/dev/null 2>&1; then
    pass "$desc"
  else
    fail "$desc — command failed: $cmd"
  fi
}

# require_agi_cli — abort if `agi` not in PATH (running outside a configured AGI host)
require_agi_cli() {
  if ! command -v agi >/dev/null 2>&1; then
    echo "${RED}Spot tests require the agi CLI in PATH.${RESET}" >&2
    echo "Run from a host with AGI installed, or inside the test VM." >&2
    exit 2
  fi
}

# summary — print pass/fail counts and exit with appropriate code
summary() {
  echo
  echo "${BOLD}=== ${TEST_NAME} summary ===${RESET}"
  echo "  ${GREEN}Passed: ${PASS}${RESET}"
  if [ "$FAIL" -gt 0 ]; then
    echo "  ${RED}Failed: ${FAIL}${RESET}"
    exit 1
  else
    exit 0
  fi
}
