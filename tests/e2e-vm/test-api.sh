#!/usr/bin/env bash
# Test: API endpoints against a running Aionima instance.
# Runs from the HOST against the VM's IP.
# Usage: ./tests/e2e-vm/test-api.sh <vm-ip>
set -euo pipefail

VM_IP="${1:?Usage: $0 <vm-ip>}"
BASE="http://${VM_IP}:3100"

PASS=0
FAIL=0
TESTS=()

check_status() {
  local name="$1"
  local expected_status="$2"
  local method="$3"
  local url="$4"
  shift 4
  local status
  status=$(curl -sf -o /dev/null -w '%{http_code}' -X "$method" "$url" "$@" 2>/dev/null) || status="000"
  if [ "$status" = "$expected_status" ]; then
    echo "  PASS  $name (HTTP $status)"
    PASS=$((PASS + 1))
    TESTS+=("PASS: $name")
  else
    echo "  FAIL  $name (expected HTTP $expected_status, got $status)"
    FAIL=$((FAIL + 1))
    TESTS+=("FAIL: $name")
  fi
}

check_json_field() {
  local name="$1"
  local url="$2"
  local field="$3"
  local body
  body=$(curl -sf "$url" 2>/dev/null) || body=""
  if echo "$body" | python3 -c "import sys,json; d=json.load(sys.stdin); assert '$field' in str(d)" 2>/dev/null; then
    echo "  PASS  $name"
    PASS=$((PASS + 1))
    TESTS+=("PASS: $name")
  else
    echo "  FAIL  $name (field '$field' not found in response)"
    FAIL=$((FAIL + 1))
    TESTS+=("FAIL: $name")
  fi
}

check_json_key() {
  local name="$1"
  local url="$2"
  local key="$3"
  local body
  body=$(curl -sf "$url" 2>/dev/null) || body=""
  if echo "$body" | python3 -c "import sys,json; d=json.load(sys.stdin); assert $key" 2>/dev/null; then
    echo "  PASS  $name"
    PASS=$((PASS + 1))
    TESTS+=("PASS: $name")
  else
    echo "  FAIL  $name (assertion failed: $key)"
    FAIL=$((FAIL + 1))
    TESTS+=("FAIL: $name")
  fi
}

echo "=== Aionima API Tests ==="
echo "Target: $BASE"
echo ""

# -----------------------------------------------------------------------
# Health
# -----------------------------------------------------------------------
echo "--- Health ---"
check_status "GET /health returns 200" "200" GET "$BASE/health"
check_json_key "health.ok is true" "$BASE/health" "d.get('ok') == True"
check_json_key "health has uptime" "$BASE/health" "'uptime' in d"

# -----------------------------------------------------------------------
# Onboarding
# -----------------------------------------------------------------------
echo ""
echo "--- Onboarding ---"
check_status "GET /api/onboarding/state returns 200" "200" GET "$BASE/api/onboarding/state"
check_json_key "onboarding state has steps" "$BASE/api/onboarding/state" "'steps' in d"

check_status "GET /api/onboarding/owner-profile returns 200" "200" GET "$BASE/api/onboarding/owner-profile"
check_status "GET /api/onboarding/channels returns 200" "200" GET "$BASE/api/onboarding/channels"

# POST ai-keys with empty body (should accept and return state)
check_status "POST /api/onboarding/ai-keys accepts JSON" "200" POST "$BASE/api/onboarding/ai-keys" \
  -H "Content-Type: application/json" \
  -d '{"anthropicKey":"","openaiKey":""}'

# POST owner-profile
check_status "POST /api/onboarding/owner-profile accepts JSON" "200" POST "$BASE/api/onboarding/owner-profile" \
  -H "Content-Type: application/json" \
  -d '{"displayName":"Test User","dmPolicy":"owner-only"}'

# -----------------------------------------------------------------------
# System
# -----------------------------------------------------------------------
echo ""
echo "--- System ---"
check_status "GET /api/system/stats returns 200" "200" GET "$BASE/api/system/stats"

# -----------------------------------------------------------------------
# Dev
# -----------------------------------------------------------------------
echo ""
echo "--- Dev ---"
check_status "GET /api/dev/status returns 200" "200" GET "$BASE/api/dev/status"

# -----------------------------------------------------------------------
# Dashboard
# -----------------------------------------------------------------------
echo ""
echo "--- Dashboard ---"
DASH_BODY=$(curl -sf "$BASE/" 2>/dev/null) || DASH_BODY=""
if echo "$DASH_BODY" | grep -q "html"; then
  echo "  PASS  Dashboard serves HTML"
  PASS=$((PASS + 1))
  TESTS+=("PASS: Dashboard serves HTML")
else
  echo "  FAIL  Dashboard serves HTML"
  FAIL=$((FAIL + 1))
  TESTS+=("FAIL: Dashboard serves HTML")
fi

# -----------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------
echo ""
echo "=== API Test Summary ==="
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
