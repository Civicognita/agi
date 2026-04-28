#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# check-route-collisions — Fastify route uniqueness lint
# ---------------------------------------------------------------------------
# Born from v0.4.187 → v0.4.188 hotfix: providers-api.ts registered
#   GET /api/providers
# but server-runtime-state.ts:3788 already had it. Fastify rejected the
# duplicate at startup, gateway crashed, Caddy returned 502 to every
# dashboard request. Unit tests passed because each fixture spun up a
# fresh Fastify instance — the collision only surfaced in real boot.
#
# This lint scans packages/*/src/ for `(app|fastify|f).<method>("/api/...")`
# patterns and reports any (METHOD, PATH) combination registered more
# than once. Catches the same class of bug at commit time instead of at
# production-deploy time.
#
# Usage:
#   bash scripts/check-route-collisions.sh         # warn-only (exit 0)
#   bash scripts/check-route-collisions.sh --strict  # exit 2 on collision
#
# Allow-list: routes that ARE intentionally registered twice (e.g. inside
# if/else conditional blocks where only one runs at boot) live in
# ALLOWED_DUPLICATES below. Each entry is "METHOD /path".
# ---------------------------------------------------------------------------
set -uo pipefail

STRICT=0
if [ "${1:-}" = "--strict" ]; then STRICT=1; fi

REPO_DIR="$(cd -P "$(dirname "$0")/.." && pwd)"

if [ ! -d "$REPO_DIR/packages" ]; then
  echo "error: $REPO_DIR/packages not found" >&2
  exit 1
fi

# Routes intentionally registered in mutually-exclusive code paths (if/else,
# different module init flows). Adding to this list is the explicit signal
# that the duplication is deliberate — review carefully before extending.
ALLOWED_DUPLICATES=(
  "GET /api/auth/status"   # machine-admin-api.ts:1018 vs 1337 — auth-on vs auth-off branches
)

is_allowed() {
  local key="$1"
  for allow in "${ALLOWED_DUPLICATES[@]}"; do
    [ "$key" = "$allow" ] && return 0
  done
  return 1
}

TMPFILE=$(mktemp)
trap 'rm -f "$TMPFILE"' EXIT

# Two-stage pipeline (POSIX-portable, no gawk required):
#   1. grep finds candidate lines anywhere matching <ident>.<method>(<...>)?("/api/...")
#   2. grep -oE extracts just the method+path piece
#   3. sed normalizes to "METHOD /api/path" (lowercase method → uppercase, path verbatim)
grep -rEn '\b(app|fastify|f|p)\.(get|post|put|delete|patch|head|options)(<[^>]*>)?\("/api[A-Za-z0-9/:_*-]+"' \
  "$REPO_DIR/packages" \
  --include="*.ts" \
  --exclude-dir=dist \
  --exclude-dir=node_modules \
  --exclude="*.test.ts" \
  --exclude="*.spec.ts" \
  2>/dev/null \
  | grep -oE '\.(get|post|put|delete|patch|head|options)(<[^>]*>)?\("/api[A-Za-z0-9/:_*-]+"' \
  | sed -E 's/^\.([a-z]+)(<[^>]*>)?\("(.+)"$/\1 \3/' \
  | awk '{ print toupper($1) " " $2 }' \
  > "$TMPFILE"

# Aggregate (METHOD, PATH) → count, dropping allow-listed ones.
COLLISIONS=$(awk '{ count[$0]++ } END { for (k in count) if (count[k] > 1) print count[k] " " k }' "$TMPFILE" | sort -rn)

if [ -z "$COLLISIONS" ]; then
  TOTAL=$(wc -l < "$TMPFILE" | tr -d ' ')
  echo "route-collisions: clean (${TOTAL} unique routes scanned)"
  exit 0
fi

# Print collisions, filtering allow-list
FINDINGS=0
ALLOWED=0
REPORT=""

while IFS= read -r line; do
  count=$(echo "$line" | awk '{print $1}')
  method=$(echo "$line" | awk '{print $2}')
  path=$(echo "$line" | awk '{print $3}')
  key="$method $path"

  if is_allowed "$key"; then
    ALLOWED=$((ALLOWED + 1))
    continue
  fi

  REPORT="${REPORT}COLLISION[$count] $method $path
"
  # Find source locations
  while IFS= read -r src; do
    REPORT="${REPORT}  - ${src%%:*}: line $(echo "$src" | cut -d: -f2)
"
  done < <(grep -rEn "\b(app|fastify|f|p)\.${method,,}(<[^>]*>)?\(\"${path//\//\\/}\"" \
    "$REPO_DIR/packages" \
    --include="*.ts" \
    --exclude-dir=dist \
    --exclude-dir=node_modules \
    --exclude="*.test.ts" \
    --exclude="*.spec.ts" \
    2>/dev/null \
    | head -10)

  REPORT="${REPORT}
"
  FINDINGS=$((FINDINGS + 1))
done <<<"$COLLISIONS"

if [ "$FINDINGS" -eq 0 ]; then
  TOTAL=$(wc -l < "$TMPFILE" | tr -d ' ')
  echo "route-collisions: clean (${TOTAL} unique routes scanned, ${ALLOWED} allow-listed)"
  exit 0
fi

echo ""
echo "Route collisions (same METHOD + PATH registered more than once):"
echo ""
printf '%s' "$REPORT"

echo "route-collisions: ${FINDINGS} collision(s) found, ${ALLOWED} allow-listed."
echo "Reference: v0.4.188 hotfix (providers-api / server-runtime-state collision)."
echo "If a collision is intentional (e.g. if/else conditional blocks), add to ALLOWED_DUPLICATES."

if [ "$STRICT" -eq 1 ]; then
  exit 2
fi
exit 0
