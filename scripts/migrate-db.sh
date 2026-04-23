#!/usr/bin/env bash
# migrate-db.sh — apply additive DB schema changes to the live agi_data
# database. Run by upgrade.sh between build and container-build steps.
#
# Drizzle-kit push doesn't work in this project because schema files
# use NodeNext `.js` imports that drizzle-kit's CJS resolver can't
# follow (see drizzle.config.ts comment block). We use direct psql
# ALTER TABLE IF NOT EXISTS instead — idempotent, targeted, no
# migration framework required.
#
# Adding a new column? Append an ALTER TABLE … ADD COLUMN IF NOT EXISTS
# line to MIGRATIONS_SQL below. Existing lines stay forever; they're
# no-ops on subsequent runs.
#
# DESTRUCTIVE changes (column drops, type changes) DO NOT belong here.
# Those need explicit migration scripts that handle data preservation.
#
# Env:
#   DATABASE_URL    optional override of the connection string
#                   (defaults to postgres://agi:aionima@localhost:5432/agi_data)

set -euo pipefail

DATABASE_URL="${DATABASE_URL:-postgres://agi:aionima@localhost:5432/agi_data}"
PG_CONTAINER="${PG_CONTAINER:-agi-postgres-17}"
DB_NAME="${DB_NAME:-agi_data}"
DB_USER="${DB_USER:-agi}"

# psql isn't installed on the host (postgres runs in a podman container).
# Pick whichever path is available — host psql first, container psql second.
PSQL_RUNNER=""
if command -v psql >/dev/null 2>&1; then
  PSQL_RUNNER="psql $DATABASE_URL"
elif podman ps --format '{{.Names}}' 2>/dev/null | grep -qx "$PG_CONTAINER"; then
  PSQL_RUNNER="podman exec -i $PG_CONTAINER psql -U $DB_USER -d $DB_NAME"
else
  echo "[migrate-db] no psql available (host or container=$PG_CONTAINER) — skipping schema migration" >&2
  exit 0
fi
echo "[migrate-db] using: $PSQL_RUNNER"

# All known additive schema changes. Each statement is idempotent.
read -r -d '' MIGRATIONS_SQL <<'SQL' || true
-- v0.4.96 — Phase M aliases column on plugins_marketplace
ALTER TABLE IF EXISTS plugins_marketplace
  ADD COLUMN IF NOT EXISTS aliases jsonb;
SQL

echo "[migrate-db] applying $(echo "$MIGRATIONS_SQL" | grep -cE '^[A-Z]') statement(s) idempotently"

if echo "$MIGRATIONS_SQL" | $PSQL_RUNNER -v ON_ERROR_STOP=1 -q; then
  echo "[migrate-db] schema in sync"
  exit 0
else
  echo "[migrate-db] some statements failed — see above" >&2
  exit 1
fi
