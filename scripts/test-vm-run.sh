#!/usr/bin/env bash
# Unified Aionima test runner — routes all test tiers through the VM.
#
# Usage:
#   test-vm-run.sh unit          # Vitest unit tests inside VM
#   test-vm-run.sh e2e           # System e2e tests (install + API + onboarding)
#   test-vm-run.sh e2e:ui        # Playwright against VM from host
#   test-vm-run.sh all           # Everything
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VM_SCRIPT="$SCRIPT_DIR/test-vm.sh"
E2E_SCRIPT="$SCRIPT_DIR/test-e2e-vm.sh"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
FIXTURE_CONFIG="$REPO_DIR/test/fixtures/aionima-test.json"

VM_NAME="aionima-test"

# ---------------------------------------------------------------------------
# Preflight: ensure VM is created, running, and set up
# ---------------------------------------------------------------------------
preflight() {
  if ! command -v multipass &>/dev/null; then
    echo "Error: multipass is not installed." >&2
    echo "Install with: sudo snap install multipass" >&2
    exit 1
  fi

  if ! multipass info "$VM_NAME" &>/dev/null 2>&1; then
    echo "Error: Test VM '$VM_NAME' does not exist." >&2
    echo "" >&2
    echo "Set up the test VM first:" >&2
    echo "  pnpm test:vm:create   # Create VM with repo mounts" >&2
    echo "  pnpm test:vm:setup    # Install Node/pnpm, pnpm install" >&2
    exit 1
  fi

  local state
  state=$(multipass info "$VM_NAME" --format csv 2>/dev/null | tail -1 | cut -d',' -f2)
  if [[ "$state" != "Running" ]]; then
    echo "Error: Test VM '$VM_NAME' exists but is not running (state: $state)." >&2
    echo "Run: pnpm test:vm:create  (will start a stopped VM)" >&2
    exit 1
  fi

  # Verify mounts are active — they can drop after VM restart or host reboot.
  # Check the AGI mount by looking for package.json (not just the dir, which
  # exists even without a mount).
  if ! multipass exec "$VM_NAME" -- test -f /mnt/agi/package.json 2>/dev/null; then
    echo "Mounts are stale or missing. Re-mounting workspace repos..." >&2
    bash "$VM_SCRIPT" remount
    # Verify again after remount
    if ! multipass exec "$VM_NAME" -- test -f /mnt/agi/package.json 2>/dev/null; then
      echo "Error: Could not restore mounts. Destroy and recreate the VM:" >&2
      echo "  pnpm test:vm:destroy && pnpm test:vm:create && pnpm test:vm:setup" >&2
      exit 1
    fi
    echo "Mounts restored." >&2
  fi

  if ! multipass exec "$VM_NAME" -- test -d /mnt/agi/node_modules 2>/dev/null; then
    echo "Error: Dependencies not installed in VM." >&2
    echo "Run: pnpm test:vm:setup" >&2
    exit 1
  fi
}

# ---------------------------------------------------------------------------
# Tier: Unit tests (vitest inside VM)
# ---------------------------------------------------------------------------
run_unit() {
  echo ""
  echo "================================================================"
  echo "  Unit Tests (vitest)"
  echo "================================================================"
  echo ""

  # Copy test config fixture to VM
  multipass exec "$VM_NAME" -- mkdir -p /home/ubuntu/.agi
  multipass transfer "$FIXTURE_CONFIG" "$VM_NAME":/home/ubuntu/.agi/aionima.json

  multipass exec "$VM_NAME" -- bash -c \
    'cd /mnt/agi && AIONIMA_TEST_VM=1 npx vitest run'
}

# ---------------------------------------------------------------------------
# Tier: E2E system tests (delegates to test-e2e-vm.sh)
# ---------------------------------------------------------------------------
run_e2e() {
  echo ""
  echo "================================================================"
  echo "  E2E System Tests"
  echo "================================================================"
  echo ""

  bash "$E2E_SCRIPT" "$@"
}

# ---------------------------------------------------------------------------
# Tier: E2E UI tests (Playwright from host against VM)
# ---------------------------------------------------------------------------
run_e2e_ui() {
  echo ""
  echo "================================================================"
  echo "  E2E UI Tests (Playwright)"
  echo "================================================================"
  echo ""

  local vm_ip
  vm_ip=$(bash "$VM_SCRIPT" ip)

  echo "Running Playwright against VM at $vm_ip:3100..."
  cd "$REPO_DIR"
  BASE_URL="http://${vm_ip}:3100" npx playwright test
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
TIER="${1:-help}"

case "$TIER" in
  unit)
    preflight
    run_unit
    ;;
  e2e)
    preflight
    shift
    run_e2e "$@"
    ;;
  e2e:ui)
    preflight
    run_e2e_ui
    ;;
  all)
    preflight
    PASS=0
    FAIL=0

    run_unit && PASS=$((PASS + 1)) || FAIL=$((FAIL + 1))
    run_e2e && PASS=$((PASS + 1)) || FAIL=$((FAIL + 1))
    run_e2e_ui && PASS=$((PASS + 1)) || FAIL=$((FAIL + 1))

    echo ""
    echo "================================================================"
    echo "  Full Test Suite Summary"
    echo "================================================================"
    echo "  Passed: $PASS"
    echo "  Failed: $FAIL"
    echo ""

    [ "$FAIL" -eq 0 ] || exit 1
    ;;
  help|--help|-h)
    echo "Usage: $0 {unit|e2e|e2e:ui|all}"
    echo ""
    echo "Tiers:"
    echo "  unit     Vitest unit/integration tests (runs inside VM)"
    echo "  e2e      System e2e tests: install, API, onboarding, plugins"
    echo "  e2e:ui   Playwright UI tests (runs from host against VM)"
    echo "  all      Run all tiers sequentially"
    echo ""
    echo "Prerequisites:"
    echo "  pnpm test:vm:create   Create the test VM"
    echo "  pnpm test:vm:setup    Install deps inside VM"
    ;;
  *)
    echo "Unknown tier: $TIER" >&2
    echo "Run '$0 help' for usage." >&2
    exit 1
    ;;
esac
