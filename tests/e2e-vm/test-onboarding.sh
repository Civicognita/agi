#!/usr/bin/env bash
# Test: Full onboarding flow via API.
# Runs from the HOST against the VM's IP.
# Usage: ./tests/e2e-vm/test-onboarding.sh <vm-ip>
set -euo pipefail

VM_IP="${1:?Usage: $0 <vm-ip>}"
BASE="http://${VM_IP}:3100"

PASS=0
FAIL=0
TESTS=()

check_status() {
  local name="$1"
  local expected="$2"
  local method="$3"
  local url="$4"
  shift 4
  local status
  status=$(curl -sf -o /dev/null -w '%{http_code}' -X "$method" "$url" "$@" 2>/dev/null) || status="000"
  if [ "$status" = "$expected" ]; then
    echo "  PASS  $name"
    PASS=$((PASS + 1))
    TESTS+=("PASS: $name")
  else
    echo "  FAIL  $name (expected $expected, got $status)"
    FAIL=$((FAIL + 1))
    TESTS+=("FAIL: $name")
  fi
}

check_json() {
  local name="$1"
  local assertion="$2"
  local method="$3"
  local url="$4"
  shift 4
  local body
  body=$(curl -sf -X "$method" "$url" "$@" 2>/dev/null) || body="{}"
  if echo "$body" | python3 -c "import sys,json; d=json.load(sys.stdin); assert $assertion" 2>/dev/null; then
    echo "  PASS  $name"
    PASS=$((PASS + 1))
    TESTS+=("PASS: $name")
  else
    echo "  FAIL  $name (assertion: $assertion)"
    FAIL=$((FAIL + 1))
    TESTS+=("FAIL: $name")
  fi
}

echo "=== Aionima Onboarding Flow Test ==="
echo "Target: $BASE"
echo ""

# -----------------------------------------------------------------------
# Step 1: Check initial state (fresh install = all pending)
# -----------------------------------------------------------------------
echo "--- Step 1: Initial state ---"
check_status "GET onboarding state" "200" GET "$BASE/api/onboarding/state"
check_json "all steps exist" "'steps' in d" GET "$BASE/api/onboarding/state"

# -----------------------------------------------------------------------
# Step 2: Submit AI keys
# -----------------------------------------------------------------------
echo ""
echo "--- Step 2: AI Keys ---"
check_status "POST ai-keys" "200" POST "$BASE/api/onboarding/ai-keys" \
  -H "Content-Type: application/json" \
  -d '{"anthropicKey":"sk-ant-test-key-for-e2e","openaiKey":""}'

# Verify state updated
check_json "ai-keys step marked complete" \
  "d.get('steps',{}).get('ai-keys',{}).get('status') in ('done','complete','completed')" \
  GET "$BASE/api/onboarding/state"

# -----------------------------------------------------------------------
# Step 3: Owner profile
# -----------------------------------------------------------------------
echo ""
echo "--- Step 3: Owner Profile ---"
check_status "GET owner-profile" "200" GET "$BASE/api/onboarding/owner-profile"

check_status "POST owner-profile" "200" POST "$BASE/api/onboarding/owner-profile" \
  -H "Content-Type: application/json" \
  -d '{"displayName":"E2E Test User","dmPolicy":"owner-only"}'

check_json "owner-profile step marked complete" \
  "d.get('steps',{}).get('owner-profile',{}).get('status') in ('done','complete','completed')" \
  GET "$BASE/api/onboarding/state"

# -----------------------------------------------------------------------
# Step 4: Channels
# -----------------------------------------------------------------------
echo ""
echo "--- Step 4: Channels ---"
check_status "GET channels config" "200" GET "$BASE/api/onboarding/channels"

# Skip channel enable — would need real tokens

# -----------------------------------------------------------------------
# Step 5: Reset and verify
# -----------------------------------------------------------------------
echo ""
echo "--- Step 5: Reset ---"
check_status "POST reset" "200" POST "$BASE/api/onboarding/reset"

# After reset, steps should be pending again
check_json "steps reset to pending" \
  "all(s.get('status') in ('pending','incomplete') for s in d.get('steps',{}).values() if isinstance(s, dict))" \
  GET "$BASE/api/onboarding/state"

# -----------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------
echo ""
echo "=== Onboarding Test Summary ==="
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
