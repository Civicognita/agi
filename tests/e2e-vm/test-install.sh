#!/usr/bin/env bash
# Test: install.sh on a clean VM
# Runs INSIDE the VM via multipass exec.
# Expects the host repo mounted at /mnt/agi.
set -euo pipefail

PASS=0
FAIL=0
TESTS=()

check() {
  local name="$1"
  shift
  if "$@" &>/dev/null; then
    echo "  PASS  $name"
    PASS=$((PASS + 1))
    TESTS+=("PASS: $name")
  else
    echo "  FAIL  $name"
    FAIL=$((FAIL + 1))
    TESTS+=("FAIL: $name")
  fi
}

check_output() {
  local name="$1"
  local expected="$2"
  shift 2
  local output
  output=$("$@" 2>/dev/null) || true
  if echo "$output" | grep -qE "$expected"; then
    echo "  PASS  $name"
    PASS=$((PASS + 1))
    TESTS+=("PASS: $name")
  else
    echo "  FAIL  $name (expected match: $expected, got: $output)"
    FAIL=$((FAIL + 1))
    TESTS+=("FAIL: $name")
  fi
}

echo "=== Aionima Install Test ==="
echo ""

# -----------------------------------------------------------------------
# Run install.sh
# -----------------------------------------------------------------------
echo "--- Running install.sh ---"
sudo AIONIMA_REPO=/mnt/agi AIONIMA_SKIP_HARDENING=1 bash /mnt/agi/scripts/install.sh
echo ""

# -----------------------------------------------------------------------
# Verify installation
# -----------------------------------------------------------------------
echo "--- Verifying installation ---"

check "aionima user exists" id aionima
check "node installed" command -v node
check_output "node version >= 22" "^v2[2-9]" node --version
check "pnpm installed" command -v pnpm
check "/opt/aionima exists" test -d /opt/aionima
check "/opt/aionima has package.json" test -f /opt/aionima/package.json
check "systemd unit exists" test -f /etc/systemd/system/aionima.service
check "service is enabled" systemctl is-enabled aionima
check ".env file exists" test -f /opt/aionima/.env
check ".env has correct permissions (0600)" test "$(stat -c '%a' /opt/aionima/.env)" = "600"

# Check that built artifacts exist
check "cli/dist exists" test -d /opt/aionima/cli/dist
check "gateway-core/dist exists" test -d /opt/aionima/packages/gateway-core/dist

# -----------------------------------------------------------------------
# Start the service and test it responds
# -----------------------------------------------------------------------
echo ""
echo "--- Starting service ---"
sudo systemctl start aionima

# Wait for the service to come up (max 30s)
echo "Waiting for service to be ready..."
READY=0
for i in $(seq 1 30); do
  if curl -sf http://localhost:3100/health &>/dev/null; then
    READY=1
    break
  fi
  sleep 1
done

if [ "$READY" = "1" ]; then
  echo "  Service is up."
else
  echo "  Service failed to start within 30s."
  echo "  --- journalctl output ---"
  sudo journalctl -u aionima --no-pager -n 50
  echo "  ---"
fi

check "service is running" systemctl is-active aionima
check "health endpoint responds" curl -sf http://localhost:3100/health

# Check health response content
check_output "health returns ok:true" '"ok":true' curl -sf http://localhost:3100/health

# Check dashboard serves HTML
check_output "dashboard serves HTML" "<!DOCTYPE html|<html" curl -sf http://localhost:3100/

# -----------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------
echo ""
echo "=== Install Test Summary ==="
echo "  Passed: $PASS"
echo "  Failed: $FAIL"
echo "  Total:  $((PASS + FAIL))"

if [ "$FAIL" -gt 0 ]; then
  echo ""
  echo "Failed tests:"
  for t in "${TESTS[@]}"; do
    if [[ "$t" == FAIL:* ]]; then
      echo "  - ${t#FAIL: }"
    fi
  done
  exit 1
fi
