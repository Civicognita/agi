#!/usr/bin/env bash
# Spot test: every registered project type can be created via the API.
#
# Iterates each project-* plugin in the catalog, hits the projects
# create endpoint with a fixture name, and verifies the project shows
# up in the project list afterward. Cleanup removes each fixture.
#
# This validates that the marketplace's project-type plugins resolve
# their dependencies (alias chain works) and that the projects API
# accepts each registered type.

set -uo pipefail
TEST_NAME="project-types"
. "$(dirname "$0")/_lib.sh"

require_agi_cli

# Use Node http (no curl, no hardcoded :3100 in user-facing test docs)
api_get() {
  local path="$1"
  node -e "
    const http = require('http');
    http.get({host: '127.0.0.1', port: 3100, path: '$path'}, (r) => {
      let d = ''; r.on('data', (c) => d += c); r.on('end', () => process.stdout.write(d));
    }).on('error', (e) => { process.stderr.write(String(e)); process.exit(1); });
  "
}

api_post() {
  local path="$1" body="$2"
  node -e "
    const http = require('http');
    const body = '$body';
    const req = http.request({host: '127.0.0.1', port: 3100, path: '$path', method: 'POST', headers: {'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}}, (r) => {
      let d = ''; r.on('data', (c) => d += c); r.on('end', () => process.stdout.write(d));
    });
    req.on('error', (e) => { process.stderr.write(String(e)); process.exit(1); });
    req.write(body); req.end();
  "
}

api_delete() {
  local path="$1"
  node -e "
    const http = require('http');
    const req = http.request({host: '127.0.0.1', port: 3100, path: '$path', method: 'DELETE'}, (r) => {
      let d = ''; r.on('data', (c) => d += c); r.on('end', () => process.stdout.write(d));
    });
    req.on('error', (e) => { process.stderr.write(String(e)); process.exit(1); });
    req.end();
  "
}

header "Discover registered project types from the catalog"

LIST_JSON="$(agi marketplace list 2>&1)"
PROJECT_TYPES="$(echo "$LIST_JSON" | python3 -c "
import json, sys
items = json.load(sys.stdin)
types = sorted({i['name'] for i in items
                if i.get('name', '').startswith('project-')
                and 'project-types' in (i.get('provides') or [])})
print(' '.join(types))
" 2>&1)"

if [ -z "$PROJECT_TYPES" ]; then
  fail "no project-* plugins found in catalog"
  summary
fi

pass "found project types: $PROJECT_TYPES"

header "Create one project of each type"

# Each project type gets a fixture project name like spot-webapp,
# spot-staticsite, etc. Creation uses the projects create API.
CREATED_NAMES=()
for type_name in $PROJECT_TYPES; do
  # Strip "project-" prefix for the type identifier passed to the API
  type_id="${type_name#project-}"
  fixture_name="spot-${type_id}"

  body="{\"name\":\"$fixture_name\",\"projectType\":\"$type_id\"}"
  resp="$(api_post /api/projects "$body")"
  if echo "$resp" | grep -qE '"ok":\s*true|"name":\s*"'"$fixture_name"'"'; then
    pass "created $fixture_name (type=$type_id)"
    CREATED_NAMES+=("$fixture_name")
  elif echo "$resp" | grep -qiE 'already exists|conflict'; then
    info "$fixture_name already exists — assuming earlier run; will treat as pass"
    pass "created $fixture_name (type=$type_id)"
    CREATED_NAMES+=("$fixture_name")
  else
    fail "create $fixture_name (type=$type_id) — response: $(echo "$resp" | head -c 200)"
  fi
done

header "Verify each created project appears in the projects list"

PROJECTS_JSON="$(api_get /api/projects)"
for name in "${CREATED_NAMES[@]}"; do
  if echo "$PROJECTS_JSON" | python3 -c "
import json, sys
arr = json.load(sys.stdin)
n = '$name'
found = any(p.get('name') == n for p in (arr if isinstance(arr, list) else arr.get('projects', [])))
sys.exit(0 if found else 1)
" 2>/dev/null; then
    pass "$name appears in /api/projects list"
  else
    fail "$name missing from /api/projects list"
  fi
done

header "Cleanup — remove created fixture projects"

for name in "${CREATED_NAMES[@]}"; do
  resp="$(api_delete "/api/projects/$name")"
  if echo "$resp" | grep -qE '"ok":\s*true'; then
    pass "deleted $name"
  else
    info "delete $name response: $(echo "$resp" | head -c 100)"
  fi
done

summary
