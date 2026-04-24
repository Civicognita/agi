#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# agi-test — single-command test runner for the Aionima test VM
# ---------------------------------------------------------------------------
# Canonical entrypoint for running tests. Handles VM preflight + mount paths +
# environment setup so callers just name the test.
#
# Usage:
#   agi-test <test-pattern>
#   agi-test --unit <pattern>       # vitest spec files (default kind)
#   agi-test --e2e  <pattern>       # playwright e2e spec files
#   agi-test --list                 # list candidate specs
#   agi-test --help
#
# Pattern semantics:
#   - Matches against filenames + describe-block names, case-insensitive.
#   - For vitest:    --testNamePattern is used + path filter
#   - For playwright: --grep is used
#
# Examples:
#   agi-test dashboard              # runs packages/gateway-core/src/dashboard.test.ts
#   agi-test "DashboardApi.handle"  # filter by describe name
#   agi-test --e2e mapps-walk       # runs e2e/walk/mapps-walk.spec.ts
#
# Exit codes:
#   0 = all matched tests passed
#   1 = one or more tests failed
#   2 = no tests matched the pattern
#   3 = VM unavailable or setup problem
#
# CRITICAL: This script always targets the test VM. It refuses to run vitest
# on the host (there's a guard in vitest.config.ts that crashes on host).
# Playwright runs on host against the VM's gateway via the :80 bridge.
# ---------------------------------------------------------------------------
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
VM_NAME="agi-test"
VM_TEST_SCRIPT="$SCRIPT_DIR/test-vm.sh"
KIND="unit"
PATTERN=""
LIST_MODE=0

usage() {
  sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
}

die() {
  echo "[agi-test] $1" >&2
  exit "${2:-3}"
}

log() { echo "[agi-test] $*"; }

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
while [ $# -gt 0 ]; do
  case "$1" in
    --unit)   KIND="unit"; shift ;;
    --e2e)    KIND="e2e"; shift ;;
    --list)   LIST_MODE=1; shift ;;
    --help|-h) usage ;;
    --*)      die "unknown flag: $1" ;;
    *)
      if [ -z "$PATTERN" ]; then PATTERN="$1"; else PATTERN="$PATTERN $1"; fi
      shift
      ;;
  esac
done

# ---------------------------------------------------------------------------
# List mode — show candidate specs without running anything
# ---------------------------------------------------------------------------
if [ "$LIST_MODE" -eq 1 ]; then
  echo "# unit specs (vitest)"
  find "$REPO_DIR/packages" "$REPO_DIR/cli" "$REPO_DIR/config" \
       -type f -name "*.test.ts" 2>/dev/null | sed "s|^$REPO_DIR/||" | sort
  echo
  echo "# e2e specs (playwright)"
  find "$REPO_DIR/e2e" -type f -name "*.spec.ts" 2>/dev/null \
       | sed "s|^$REPO_DIR/||" | sort
  exit 0
fi

if [ -z "$PATTERN" ]; then
  die "missing <test-pattern>. Try: agi-test --help"
fi

# ---------------------------------------------------------------------------
# VM preflight — ensure the VM is up + services are running
# ---------------------------------------------------------------------------
preflight() {
  if ! command -v multipass >/dev/null 2>&1; then
    die "multipass not found on host"
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
  # Gateway reachable check for e2e mode (needs :80 bridge)
  if [ "$KIND" = "e2e" ]; then
    local vm_ip
    vm_ip="$(multipass info "$VM_NAME" --format csv | tail -1 | cut -d',' -f3)"
    if ! curl -s --connect-timeout 3 -o /dev/null -w "%{http_code}" "http://$vm_ip/api/system/stats" | grep -q "^2"; then
      log "gateway unreachable at http://$vm_ip/ — running services-start"
      bash "$VM_TEST_SCRIPT" services-start >/dev/null 2>&1 || true
    fi
    echo "$vm_ip" > /tmp/.agi-test-vm-ip
  fi
}

preflight

# ---------------------------------------------------------------------------
# Unit mode — vitest inside the VM
# ---------------------------------------------------------------------------
if [ "$KIND" = "unit" ]; then
  log "unit: $PATTERN (in VM)"
  # Resolve pattern against spec files first so we pass a concrete path to vitest.
  # If the pattern is already a file path, use it. Otherwise match filenames.
  if [ -f "$REPO_DIR/$PATTERN" ]; then
    SPEC_PATH="$PATTERN"
  else
    SPEC_PATH="$(find packages cli config -type f -name "*.test.ts" 2>/dev/null \
                 -exec grep -l -iE "$PATTERN" {} \; -o \
                 -iname "*${PATTERN// /*}*" 2>/dev/null \
                 | head -1)"
    if [ -z "$SPEC_PATH" ]; then
      # Fallback: try exact filename match
      SPEC_PATH="$(cd "$REPO_DIR" && find packages cli config -type f -iname "*${PATTERN}*.test.ts" 2>/dev/null | head -1)"
    fi
  fi

  if [ -z "$SPEC_PATH" ]; then
    echo "[agi-test] no unit specs matched '$PATTERN'" >&2
    exit 2
  fi

  log "→ running $SPEC_PATH"
  multipass exec "$VM_NAME" -- bash -lc "
    cd /mnt/agi &&
    AIONIMA_TEST_VM=1 pnpm exec vitest run '$SPEC_PATH' --reporter=basic
  "
  exit $?
fi

# ---------------------------------------------------------------------------
# E2E mode — playwright on host against VM gateway
# ---------------------------------------------------------------------------
if [ "$KIND" = "e2e" ]; then
  VM_IP="$(cat /tmp/.agi-test-vm-ip 2>/dev/null)"
  if [ -z "$VM_IP" ]; then
    VM_IP="$(multipass info "$VM_NAME" --format csv | tail -1 | cut -d',' -f3)"
  fi

  log "e2e: $PATTERN (against http://$VM_IP/)"

  if [ -f "$REPO_DIR/$PATTERN" ]; then
    SPEC_PATH="$PATTERN"
  else
    SPEC_PATH="$(cd "$REPO_DIR" && find e2e -type f -iname "*${PATTERN}*.spec.ts" 2>/dev/null | head -1)"
  fi

  if [ -z "$SPEC_PATH" ]; then
    echo "[agi-test] no e2e specs matched '$PATTERN'" >&2
    exit 2
  fi

  log "→ running $SPEC_PATH"
  cd "$REPO_DIR"
  BASE_URL="http://$VM_IP" npx playwright test "$SPEC_PATH" --reporter=list
  exit $?
fi

die "unknown kind: $KIND"
