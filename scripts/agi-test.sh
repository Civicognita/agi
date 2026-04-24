#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# agi-test — single test runner entrypoint for Aion + humans
# ---------------------------------------------------------------------------
# Invoked via the `agi` CLI as `agi test [kind] [pattern] [options]`. This
# script is NOT meant to be executed directly — go through `agi test …` so
# every automation (humans, workers, Aion) hits the same entry.
#
# Kinds (flag):
#   --unit        Vitest inside the test VM   (default)
#   --e2e         Playwright against VM's :80 bridge
#   --e2e-ui     Same as --e2e but uses the e2e:ui script (test.ai.on path)
#   --spot <f>    Spot tests for feature <f> (hardware|marketplace|lemonade|project-types|all)
#   --all         Run every tier in sequence
#
# Common options:
#   --list        List candidate specs for the chosen kind; exit 0
#   --help, -h    Print this usage
#
# Pattern (positional):
#   Names a spec. For unit/e2e modes the pattern is matched against spec
#   filenames first (case-insensitive substring), with content-grep as
#   fallback. For spot mode the positional is the feature name.
#
# Examples:
#   agi test dashboard              Run packages/gateway-core/src/dashboard.test.ts
#   agi test --e2e mapps-walk       Run e2e/walk/mapps-walk.spec.ts
#   agi test --spot hardware        Run spot hardware feature test
#   agi test --list                 Enumerate unit specs
#
# Exit codes:
#   0 = all passed   1 = one or more failed
#   2 = no match     3 = VM/setup error
# ---------------------------------------------------------------------------
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
VM_NAME="agi-test"
VM_TEST_SCRIPT="$SCRIPT_DIR/test-vm.sh"
TEST_RUN_SCRIPT="$SCRIPT_DIR/test-run.sh"

KIND="unit"
PATTERN=""
LIST_MODE=0

usage() {
  sed -n '2,35p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
}

die()  { echo "[agi test] $1" >&2; exit "${2:-3}"; }
log()  { echo "[agi test] $*"; }

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
while [ $# -gt 0 ]; do
  case "$1" in
    --unit)    KIND="unit"; shift ;;
    --e2e)     KIND="e2e"; shift ;;
    --e2e-ui)  KIND="e2e-ui"; shift ;;
    --spot)    KIND="spot"; shift ;;
    --all)     KIND="all"; shift ;;
    --list)    LIST_MODE=1; shift ;;
    --help|-h) usage ;;
    --*)       die "unknown flag: $1" ;;
    *)
      if [ -z "$PATTERN" ]; then PATTERN="$1"; else PATTERN="$PATTERN $1"; fi
      shift
      ;;
  esac
done

# ---------------------------------------------------------------------------
# List mode
# ---------------------------------------------------------------------------
if [ "$LIST_MODE" -eq 1 ]; then
  case "$KIND" in
    e2e|e2e-ui)
      echo "# e2e specs (playwright, matched by filename)"
      (cd "$REPO_DIR" && find e2e -type f -name "*.spec.ts" 2>/dev/null | sort)
      ;;
    spot)
      echo "# spot feature names"
      printf 'hardware\nmarketplace\nlemonade\nproject-types\nall\n'
      ;;
    *)
      echo "# unit specs (vitest, matched by filename)"
      (cd "$REPO_DIR" && find packages cli config -type f -name "*.test.ts" 2>/dev/null | sort)
      ;;
  esac
  exit 0
fi

# ---------------------------------------------------------------------------
# VM preflight (shared)
# ---------------------------------------------------------------------------
preflight() {
  if ! command -v multipass >/dev/null 2>&1; then
    die "multipass not installed on host"
  fi
  local state
  state="$(multipass info "$VM_NAME" --format csv 2>/dev/null | tail -1 | cut -d',' -f2)"
  if [ -z "$state" ] || [ "$state" = "state" ]; then
    die "VM '$VM_NAME' not found — run 'pnpm test:vm:create' first"
  fi
  if [ "$state" != "Running" ]; then
    log "VM '$VM_NAME' is '$state' — starting..."
    multipass start "$VM_NAME" >/dev/null || die "failed to start VM"
  fi
}

# ---------------------------------------------------------------------------
# Pattern resolution — filename first, then content-grep fallback
# ---------------------------------------------------------------------------
resolve_unit_spec() {
  local pat="$1"
  if [ -f "$REPO_DIR/$pat" ]; then
    echo "$pat"; return 0
  fi
  local found
  found="$(cd "$REPO_DIR" && find packages cli config -type f -iname "*${pat// /*}*.test.ts" 2>/dev/null | sort | head -1)"
  if [ -n "$found" ]; then echo "$found"; return 0; fi
  found="$(cd "$REPO_DIR" && find packages cli config -type f -name "*.test.ts" -exec grep -l -iE "$pat" {} \; 2>/dev/null | sort | head -1)"
  if [ -n "$found" ]; then echo "$found"; return 0; fi
  return 1
}

resolve_e2e_spec() {
  local pat="$1"
  if [ -f "$REPO_DIR/$pat" ]; then
    echo "$pat"; return 0
  fi
  local found
  found="$(cd "$REPO_DIR" && find e2e -type f -iname "*${pat// /*}*.spec.ts" 2>/dev/null | sort | head -1)"
  if [ -n "$found" ]; then echo "$found"; return 0; fi
  return 1
}

# ---------------------------------------------------------------------------
# Runners
# ---------------------------------------------------------------------------
run_unit() {
  preflight
  if [ -z "$PATTERN" ]; then die "unit: missing <pattern>. Use 'agi test --list' to see candidates." 2; fi
  local spec
  spec="$(resolve_unit_spec "$PATTERN")" || die "no unit specs matched '$PATTERN'" 2
  log "unit → $spec (in $VM_NAME)"
  multipass exec "$VM_NAME" -- bash -lc "cd /mnt/agi && AIONIMA_TEST_VM=1 pnpm exec vitest run '$spec' --reporter=basic"
}

run_e2e() {
  preflight
  if [ -z "$PATTERN" ]; then die "e2e: missing <pattern>. Use 'agi test --e2e --list' to see candidates." 2; fi
  local spec
  spec="$(resolve_e2e_spec "$PATTERN")" || die "no e2e specs matched '$PATTERN'" 2
  local vm_ip
  vm_ip="$(multipass info "$VM_NAME" --format csv | tail -1 | cut -d',' -f3)"
  # Ensure the :80 bridge is up before running Playwright on the host.
  if ! curl -s --connect-timeout 3 -o /dev/null -w "%{http_code}" "http://$vm_ip/api/system/stats" | grep -q "^2"; then
    log "VM gateway unreachable at http://$vm_ip/ — running services-start"
    bash "$VM_TEST_SCRIPT" services-start >/dev/null 2>&1 || true
  fi
  log "e2e → $spec (against http://$vm_ip/)"
  (cd "$REPO_DIR" && BASE_URL="http://$vm_ip" npx playwright test "$spec" --reporter=list)
}

run_e2e_ui() {
  preflight
  log "e2e-ui → test-run.sh e2e:ui (Playwright vs test.ai.on)"
  bash "$TEST_RUN_SCRIPT" e2e:ui
}

run_spot() {
  preflight
  local feature="${PATTERN:-all}"
  log "spot → feature=$feature"
  bash "$TEST_RUN_SCRIPT" spot "$feature"
}

run_all() {
  preflight
  log "all tiers → delegating to test-run.sh all"
  bash "$TEST_RUN_SCRIPT" all
}

# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------
case "$KIND" in
  unit)   run_unit ;;
  e2e)    run_e2e ;;
  e2e-ui) run_e2e_ui ;;
  spot)   run_spot ;;
  all)    run_all ;;
  *)      die "unknown kind: $KIND" ;;
esac
