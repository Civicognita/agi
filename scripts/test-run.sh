#!/usr/bin/env bash
# Unified Aionima test runner — routes all test tiers through whatever
# environment is configured (VM by default, host with RUN_LOCAL=1).
#
# Renamed from test-vm-run.sh in v0.4.95 (Phase J task #282) — the old
# name implied a hard VM dependency that doesn't reflect what the kit
# does today. Spot/unit tests can be run locally with RUN_LOCAL=1 set,
# bypassing the multipass VM preflight; e2e:ui still routes via the
# Caddy hostname (host or VM).
#
# Usage:
#   test-run.sh unit              # Vitest unit tests inside VM (or host with RUN_LOCAL=1)
#   test-run.sh e2e               # System e2e tests (install + API + onboarding)
#   test-run.sh e2e:ui            # Playwright against the gateway hostname
#   test-run.sh spot <feature>    # Per-feature spot test
#                                 # features: hardware, marketplace, lemonade, project-types, all
#   test-run.sh all               # Everything (unit + e2e + e2e:ui + spot:all)
#
# Environment overrides:
#   RUN_LOCAL=1          Skip VM preflight; run tests against the host gateway
#   AIONIMA_TEST_VM=1    Required by vitest's runtime guard (set automatically)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VM_SCRIPT="$SCRIPT_DIR/test-vm.sh"
E2E_SCRIPT="$SCRIPT_DIR/test-e2e-vm.sh"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
FIXTURE_CONFIG="$REPO_DIR/test/fixtures/gateway-test.json"

VM_NAME="agi-test"

# ---------------------------------------------------------------------------
# Preflight: ensure VM is created, running, and set up
#
# Skipped entirely when RUN_LOCAL=1 — tests then run against the host
# gateway (whatever's at http://127.0.0.1:3100). Use this for fast local
# iteration; use the default VM mode for the canonical "fresh-state"
# guarantees the test suite was designed around.
# ---------------------------------------------------------------------------
preflight() {
  if [ "${RUN_LOCAL:-0}" = "1" ]; then
    echo "RUN_LOCAL=1 — skipping VM preflight, testing against host gateway"
    return 0
  fi

  if ! command -v multipass &>/dev/null; then
    echo "Error: multipass is not installed." >&2
    echo "Install with: sudo snap install multipass" >&2
    echo "(or set RUN_LOCAL=1 to skip the VM and test against the host gateway)" >&2
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

  # Version drift check — the VM mounts host source live, but the long-running
  # AGI tsx process keeps the package.json `version` it had at start. Without
  # this check, a Playwright run against a VM whose AGI service was started
  # days ago silently validates STALE code, not the active codebase. The
  # whole point of the test VM is to validate the current dev branch — so
  # the test runner auto-restarts services when drift is detected. This is
  # a test-time decision, never gated on a flag.
  local host_version vm_version
  host_version=$(grep -m1 '"version"' "$REPO_DIR/package.json" 2>/dev/null \
    | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')
  vm_version=$(multipass exec "$VM_NAME" -- bash -c "curl -sk https://ai.on/health 2>/dev/null" 2>/dev/null \
    | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/' \
    | tr -d '\r\n ')

  if [ -n "$host_version" ] && [ -n "$vm_version" ] && [ "$host_version" != "$vm_version" ]; then
    echo "VM AGI is on v${vm_version}, host source is v${host_version} — restarting services to pick up the active codebase..." >&2
    bash "$VM_SCRIPT" services-restart
    # Wait up to 30s for /health to come back ONLINE so tests don't race the boot
    local waited=0
    while [ $waited -lt 30 ]; do
      if multipass exec "$VM_NAME" -- bash -c "curl -sk https://ai.on/health 2>/dev/null | grep -q '\"state\":\"ONLINE\"'" 2>/dev/null; then
        echo "VM services back online (took ${waited}s)." >&2
        break
      fi
      sleep 1
      waited=$((waited + 1))
    done
    if [ $waited -ge 30 ]; then
      echo "Warning: services-restart did not yield ONLINE within 30s — proceeding anyway." >&2
    fi
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
  multipass transfer "$FIXTURE_CONFIG" "$VM_NAME":/home/ubuntu/.agi/gateway.json

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
# Tier: Spot tests (per-feature integration assertions inside VM)
# ---------------------------------------------------------------------------
run_spot() {
  local feature="${1:-all}"
  local spot_dir="/mnt/agi/test/spot-tests"

  # When RUN_LOCAL=1, run spot tests against the host gateway directly.
  # Otherwise use multipass exec against the VM (where /mnt/agi is mounted).
  local exec_prefix=""
  local spot_path="$spot_dir"
  if [ "${RUN_LOCAL:-0}" != "1" ]; then
    exec_prefix="multipass exec $VM_NAME --"
  else
    spot_path="$REPO_DIR/test/spot-tests"
  fi

  case "$feature" in
    hardware|marketplace|lemonade|project-types)
      echo
      echo "================================================================"
      echo "  Spot Test: $feature ($([ "${RUN_LOCAL:-0}" = "1" ] && echo "host" || echo "VM"))"
      echo "================================================================"
      $exec_prefix bash "${spot_path}/${feature}.sh"
      ;;
    all)
      echo
      echo "================================================================"
      echo "  Spot Tests: ALL features ($([ "${RUN_LOCAL:-0}" = "1" ] && echo "host" || echo "VM"))"
      echo "================================================================"
      local failed=0
      for f in hardware marketplace lemonade project-types; do
        echo
        echo "--- $f ---"
        if ! $exec_prefix bash "${spot_path}/${f}.sh"; then
          failed=$((failed + 1))
        fi
      done
      echo
      if [ "$failed" -eq 0 ]; then
        echo "All spot tests passed."
      else
        echo "$failed spot test(s) failed."
        return 1
      fi
      ;;
    *)
      echo "Unknown spot feature: $feature" >&2
      echo "Available: hardware, marketplace, lemonade, project-types, all" >&2
      return 1
      ;;
  esac
}

# ---------------------------------------------------------------------------
# Tier: E2E UI tests (Playwright from host against VM)
# ---------------------------------------------------------------------------
run_e2e_ui() {
  echo ""
  echo "================================================================"
  echo "  E2E UI Tests (Playwright → test.ai.on)"
  echo "================================================================"
  echo ""

  echo "Running Playwright against test.ai.on..."
  cd "$REPO_DIR"
  BASE_URL="https://test.ai.on" npx playwright test
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
  spot)
    preflight
    shift
    run_spot "${1:-all}"
    ;;
  all)
    preflight
    PASS=0
    FAIL=0

    run_unit && PASS=$((PASS + 1)) || FAIL=$((FAIL + 1))
    run_e2e && PASS=$((PASS + 1)) || FAIL=$((FAIL + 1))
    run_e2e_ui && PASS=$((PASS + 1)) || FAIL=$((FAIL + 1))
    run_spot all && PASS=$((PASS + 1)) || FAIL=$((FAIL + 1))

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
