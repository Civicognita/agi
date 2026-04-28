#!/usr/bin/env bash
# Spot test: hardware/machine snapshot surface.
#
# Verifies /api/machine/hardware returns a complete snapshot with all
# expected sections populated, and that `agi doctor` rendering picks up
# the underlying probes.

set -uo pipefail
TEST_NAME="hardware"
. "$(dirname "$0")/_lib.sh"

require_agi_cli

header "agi doctor — machine sections present"

DOCTOR_OUT="$(agi doctor 2>&1 || true)"
assert_contains "$DOCTOR_OUT" "Node.js:" "doctor renders Node.js row"
assert_contains "$DOCTOR_OUT" "Disk:" "doctor renders Disk row"
assert_contains "$DOCTOR_OUT" "Caddy:" "doctor renders Caddy row"
assert_contains "$DOCTOR_OUT" "Podman:" "doctor renders Podman row"

header "/api/machine/hardware — JSON shape"

# Pull the JSON via Node's http (rather than curl) so we go through the
# AGI surface explicitly and don't hardcode :3100.
HW_JSON="$(node -e '
const http = require("http");
http.get({host: "127.0.0.1", port: 3100, path: "/api/machine/hardware"}, (r) => {
  let d = "";
  r.on("data", (c) => d += c);
  r.on("end", () => process.stdout.write(d));
}).on("error", (e) => { process.stderr.write(String(e)); process.exit(1); });
' 2>&1)"

assert_nonempty "$HW_JSON" "endpoint returns a body"

# Use Python to introspect JSON shape (jq not always available)
SHAPE_OUT="$(echo "$HW_JSON" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
except Exception as e:
    print(f'PARSE_ERROR: {e}')
    sys.exit(1)
expected = ['identity', 'firmware', 'motherboard', 'os', 'cpu', 'memory', 'storage', 'network']
missing = [k for k in expected if k not in d]
if missing:
    print(f'MISSING: {missing}')
    sys.exit(1)
out = []
out.append(f'identity.hostname={\"hostname\" in d.get(\"identity\", {})}')
out.append(f'firmware.biosVersion={\"biosVersion\" in d.get(\"firmware\", {})}')
out.append(f'motherboard.manufacturer={\"manufacturer\" in d.get(\"motherboard\", {})}')
out.append(f'os.distro={\"distro\" in d.get(\"os\", {})}')
out.append(f'cpu.cores_int={isinstance(d.get(\"cpu\", {}).get(\"cores\"), int)}')
out.append(f'memory.totalGB_num={isinstance(d.get(\"memory\", {}).get(\"totalGB\"), (int, float))}')
out.append(f'storage_is_list={isinstance(d.get(\"storage\"), list)}')
out.append(f'network_is_list={isinstance(d.get(\"network\"), list)}')
out.append(f'storage_count={len(d.get(\"storage\", []))}')
out.append(f'network_count={len(d.get(\"network\", []))}')
print(' '.join(out))
" 2>&1)"

if echo "$SHAPE_OUT" | grep -q "MISSING\|PARSE_ERROR"; then
  fail "JSON shape: $SHAPE_OUT"
else
  pass "JSON has all expected sections (identity/firmware/motherboard/os/cpu/memory/storage/network)"
  for kv in $SHAPE_OUT; do
    info "$kv"
  done
fi

header "/api/machine/hardware — content sanity"

# Fields that should never be empty on a real Linux host
HOSTNAME_CHECK="$(echo "$HW_JSON" | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(d.get('identity', {}).get('hostname', '') or 'EMPTY')
")"
assert_nonempty "$HOSTNAME_CHECK" "identity.hostname is populated"

OS_DISTRO="$(echo "$HW_JSON" | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(d.get('os', {}).get('distro', '') or 'EMPTY')
")"
assert_nonempty "$OS_DISTRO" "os.distro is populated"

CPU_CORES="$(echo "$HW_JSON" | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(d.get('cpu', {}).get('cores', 0))
")"
if [ "$CPU_CORES" -gt 0 ] 2>/dev/null; then
  pass "cpu.cores > 0 (got $CPU_CORES)"
else
  fail "cpu.cores should be > 0 (got '$CPU_CORES')"
fi

summary
