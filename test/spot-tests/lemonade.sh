#!/usr/bin/env bash
# Spot test: Lemonade proxy + agent tools.
#
# Verifies the /api/lemonade/* proxy works, status reports the expected
# shape, and agent tool invocation through Aion would have access to a
# functional surface. Skips gracefully when Lemonade isn't installed
# (proxy returns 503).

set -uo pipefail
TEST_NAME="lemonade"
. "$(dirname "$0")/_lib.sh"

require_agi_cli

header "agi lemonade — top-level reachability"

STATUS_JSON="$(agi lemonade status 2>&1)"

if echo "$STATUS_JSON" | grep -qE '"installed":\s*false'; then
  info "Lemonade not installed on this host — skipping deeper checks"
  pass "agi lemonade status returns a structured 'not installed' response"
  summary
fi

assert_nonempty "$STATUS_JSON" "agi lemonade status returns content"

header "Status JSON has expected sections"

STATUS_SHAPE="$(echo "$STATUS_JSON" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
except Exception as e:
    print(f'PARSE_ERROR: {e}')
    sys.exit(1)
expected = ['installed', 'running', 'baseUrl']
missing = [k for k in expected if k not in d]
if missing:
    print(f'MISSING: {missing}')
    sys.exit(1)
print(f'running={d.get(\"running\")} version={d.get(\"version\")} model={d.get(\"modelLoaded\")}')
sys.exit(0)
" 2>&1)"

if echo "$STATUS_SHAPE" | grep -q "MISSING\|PARSE_ERROR"; then
  fail "status JSON shape: $STATUS_SHAPE"
else
  pass "status has expected fields ($STATUS_SHAPE)"
fi

header "Backends list — at least one llamacpp backend"

BACKENDS_OUT="$(agi lemonade backends list 2>&1)"
assert_contains "$BACKENDS_OUT" "llamacpp:" "backends list mentions llamacpp"

header "Models list — JSON parses cleanly"

MODELS_JSON="$(agi lemonade models 2>&1)"
MODELS_PARSE="$(echo "$MODELS_JSON" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    arr = d.get('models', d if isinstance(d, list) else [])
    print(f'count={len(arr)}')
except Exception as e:
    print(f'PARSE_ERROR: {e}')
" 2>&1)"

if echo "$MODELS_PARSE" | grep -q "PARSE_ERROR"; then
  fail "models JSON parse: $MODELS_PARSE"
else
  pass "models list parses ($MODELS_PARSE)"
fi

summary
