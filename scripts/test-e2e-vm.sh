#!/usr/bin/env bash
# Aionima end-to-end VM test orchestrator.
# Creates a VM, runs install.sh, then validates everything works.
#
# Usage:
#   ./scripts/test-e2e-vm.sh              # Run all tests (reuse existing VM)
#   ./scripts/test-e2e-vm.sh --fresh      # Destroy and recreate VM first
#   ./scripts/test-e2e-vm.sh --cleanup    # Destroy VM after tests
#   ./scripts/test-e2e-vm.sh --quick      # Skip plugin tests (faster)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
VM_SCRIPT="$SCRIPT_DIR/test-vm.sh"
TEST_DIR="$REPO_DIR/tests/e2e-vm"

FRESH=0
CLEANUP=0
QUICK=0

for arg in "$@"; do
  case "$arg" in
    --fresh)   FRESH=1 ;;
    --cleanup) CLEANUP=1 ;;
    --quick)   QUICK=1 ;;
  esac
done

SUITE_PASS=0
SUITE_FAIL=0
SUITE_SKIP=0
SUITE_RESULTS=()

run_suite() {
  local name="$1"
  local runner="$2"
  shift 2

  echo ""
  echo "================================================================"
  echo "  $name"
  echo "================================================================"
  echo ""

  if $runner "$@"; then
    SUITE_PASS=$((SUITE_PASS + 1))
    SUITE_RESULTS+=("PASS: $name")
  else
    SUITE_FAIL=$((SUITE_FAIL + 1))
    SUITE_RESULTS+=("FAIL: $name")
  fi
}

skip_suite() {
  local name="$1"
  echo ""
  echo "================================================================"
  echo "  SKIP: $name"
  echo "================================================================"
  SUITE_SKIP=$((SUITE_SKIP + 1))
  SUITE_RESULTS+=("SKIP: $name")
}

# ---------------------------------------------------------------------------
# 1. Ensure multipass is available
# ---------------------------------------------------------------------------
if ! command -v multipass &>/dev/null; then
  echo "Error: multipass is not installed."
  echo "Install with: sudo snap install multipass"
  exit 1
fi

# ---------------------------------------------------------------------------
# 2. Create or reuse VM
# ---------------------------------------------------------------------------
if [ "$FRESH" = "1" ]; then
  echo "==> Destroying existing VM (--fresh)..."
  bash "$VM_SCRIPT" destroy 2>/dev/null || true
fi

echo "==> Ensuring VM exists..."
bash "$VM_SCRIPT" create

VM_IP=$(bash "$VM_SCRIPT" ip)
echo "==> VM IP: $VM_IP"

# ---------------------------------------------------------------------------
# 3. Run test suites
# ---------------------------------------------------------------------------

# Suite 1: Install test (runs inside VM)
run_suite "Install Test" multipass exec agi-test -- bash /mnt/agi/tests/e2e-vm/test-install.sh

# Wait a moment for service to stabilize after install test
sleep 3

# Suite 2: API tests (runs from host)
run_suite "API Tests" bash "$TEST_DIR/test-api.sh" "$VM_IP"

# Suite 3: Onboarding flow (runs from host)
run_suite "Onboarding Flow" bash "$TEST_DIR/test-onboarding.sh" "$VM_IP"

# Suite 4: Plugin tests (runs inside VM)
if [ "$QUICK" = "0" ]; then
  run_suite "Plugin Install Tests" multipass exec agi-test -- bash /mnt/agi/tests/e2e-vm/test-plugins.sh
else
  skip_suite "Plugin Install Tests (--quick)"
fi

# ---------------------------------------------------------------------------
# 4. Summary
# ---------------------------------------------------------------------------
echo ""
echo "================================================================"
echo "  E2E VM Test Summary"
echo "================================================================"
echo ""
for r in "${SUITE_RESULTS[@]}"; do
  echo "  $r"
done
echo ""
echo "  Suites passed:  $SUITE_PASS"
echo "  Suites failed:  $SUITE_FAIL"
echo "  Suites skipped: $SUITE_SKIP"
echo ""

# ---------------------------------------------------------------------------
# 5. Cleanup
# ---------------------------------------------------------------------------
if [ "$CLEANUP" = "1" ]; then
  echo "==> Destroying VM (--cleanup)..."
  bash "$VM_SCRIPT" destroy
fi

if [ "$SUITE_FAIL" -gt 0 ]; then
  echo "Some test suites FAILED."
  exit 1
else
  echo "All test suites PASSED."
  exit 0
fi
