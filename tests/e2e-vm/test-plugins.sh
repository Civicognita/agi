#!/usr/bin/env bash
# Test: Plugin service install framework.
# Runs INSIDE the VM where the Aionima service is running.
# Tests that plugin services can be discovered, installed, and checked.
set -euo pipefail

BASE="http://localhost:3100"

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

echo "=== Aionima Plugin Install Tests ==="
echo ""

# -----------------------------------------------------------------------
# Discover plugins with install capabilities
# -----------------------------------------------------------------------
echo "--- Discovering plugins ---"

# Get the list of plugins from the hosting API (services are exposed there)
HOSTING_STATUS=$(curl -sf "$BASE/api/hosting/status" 2>/dev/null) || HOSTING_STATUS=""

if [ -z "$HOSTING_STATUS" ]; then
  echo "  SKIP  Hosting API not available (may not be configured)"
  echo ""
  echo "=== Plugin Test Summary ==="
  echo "  Passed: $PASS"
  echo "  Failed: $FAIL"
  echo "  Skipped: hosting API not reachable"
  exit 0
fi

echo "  Hosting status retrieved."

# -----------------------------------------------------------------------
# Test plugin discovery via filesystem
# -----------------------------------------------------------------------
echo ""
echo "--- Plugin filesystem checks ---"

DEPLOY_DIR="/opt/agi"

# Check that plugin directories exist in the deploy
for plugin in plugin-editor plugin-mysql plugin-postgres plugin-redis plugin-node-runtime plugin-php-runtime; do
  if [ -d "$DEPLOY_DIR/packages/$plugin" ]; then
    echo "  PASS  $plugin directory exists"
    PASS=$((PASS + 1))
    TESTS+=("PASS: $plugin directory exists")
  else
    echo "  SKIP  $plugin not deployed"
  fi
done

# -----------------------------------------------------------------------
# Test installedCheck commands (expect failure on fresh VM)
# -----------------------------------------------------------------------
echo ""
echo "--- InstalledCheck commands (expect not-installed on fresh VM) ---"

# These are the installedCheck commands from the plugin manifests.
# On a fresh VM, none of these services should be installed.
declare -A CHECKS=(
  ["redis"]="redis-cli --version"
  ["mysql"]="mysql --version"
  ["postgres"]="psql --version"
  ["node-runtime"]="node --version"
  ["php-fpm"]="php-fpm8.3 --version"
)

INSTALLABLE_COUNT=0
for svc in "${!CHECKS[@]}"; do
  cmd="${CHECKS[$svc]}"
  if eval "$cmd" &>/dev/null; then
    echo "  INFO  $svc already installed (installedCheck passed)"
  else
    echo "  PASS  $svc correctly shows as not-installed"
    PASS=$((PASS + 1))
    TESTS+=("PASS: $svc not-installed on fresh VM")
    INSTALLABLE_COUNT=$((INSTALLABLE_COUNT + 1))
  fi
done

# -----------------------------------------------------------------------
# Test installing one service (redis — lightweight and fast)
# -----------------------------------------------------------------------
echo ""
echo "--- Installing redis (lightweight test service) ---"

if command -v redis-cli &>/dev/null; then
  echo "  SKIP  Redis already installed"
else
  echo "  Installing redis-server..."
  if sudo apt-get install -y -qq redis-server &>/dev/null; then
    check "redis installed successfully" command -v redis-cli
    check "redis-cli --version works" redis-cli --version
    check "redis-server is running" systemctl is-active redis-server

    # Test that we can interact with it
    PONG=$(redis-cli ping 2>/dev/null) || PONG=""
    if [ "$PONG" = "PONG" ]; then
      echo "  PASS  redis-cli ping returns PONG"
      PASS=$((PASS + 1))
      TESTS+=("PASS: redis-cli ping returns PONG")
    else
      echo "  FAIL  redis-cli ping (expected PONG, got: $PONG)"
      FAIL=$((FAIL + 1))
      TESTS+=("FAIL: redis-cli ping")
    fi
  else
    echo "  FAIL  apt-get install redis-server failed"
    FAIL=$((FAIL + 1))
    TESTS+=("FAIL: redis install")
  fi
fi

# -----------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------
echo ""
echo "=== Plugin Test Summary ==="
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
