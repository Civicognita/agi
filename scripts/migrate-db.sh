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

-- v0.4.433 (cycle 150) — cost_records table for the cost ledger
-- (packages/db-schema/src/cost-ledger.ts). The schema-was-defined-but-
-- table-never-created gap surfaced when /api/providers/cost/today
-- 500'd against the missing relation. CREATE TABLE IF NOT EXISTS makes
-- this idempotent across upgrades.
CREATE TABLE IF NOT EXISTS cost_records (
  id text PRIMARY KEY,
  ts timestamptz NOT NULL DEFAULT now(),
  entity_id text,
  provider text NOT NULL,
  model text NOT NULL,
  cost_mode text NOT NULL,
  complexity text NOT NULL,
  input_tokens integer NOT NULL,
  output_tokens integer NOT NULL,
  cpu_watts_observed real,
  gpu_watts_observed real,
  dollar_cost real,
  escalated boolean NOT NULL DEFAULT false,
  turn_duration_ms integer NOT NULL,
  routing_reason text NOT NULL
);
CREATE INDEX IF NOT EXISTS cost_records_ts_idx ON cost_records (ts);
CREATE INDEX IF NOT EXISTS cost_records_provider_idx ON cost_records (provider);
CREATE INDEX IF NOT EXISTS cost_records_entity_ts_idx ON cost_records (entity_id, ts);

-- v0.4.938 — connections.dtoken (device-flow token column;
-- packages/db-schema/src/auth.ts). Added to the Drizzle schema + the unused
-- 0004_special_bishop.sql migration in 5701568 but NEVER to THIS script — the
-- only path that touches the live DB (drizzle-kit push is disabled here). So the
-- GitHub device-flow connection INSERT failed in production with:
--   column "dtoken" of relation "connections" does not exist
-- Guarded going forward by migrate-db-parity.test.ts (s219 follow-up).
ALTER TABLE IF EXISTS connections
  ADD COLUMN IF NOT EXISTS dtoken text;

-- v0.4.939 — 0004_special_bishop.sql objects that need NO special privileges:
-- s182 mapp_scripts + the non-vector s112 memory tables. Added to the Drizzle
-- schema + 0004 migration but never ported HERE (the only prod path), so they
-- were absent in production. Same drift class as dtoken/cost_records.
-- (The vector-backed memory tables are applied separately below — they need the
-- pgvector extension, whose CREATE EXTENSION requires superuser.)
CREATE TABLE IF NOT EXISTS mapp_scripts (
  id text PRIMARY KEY NOT NULL,
  mapp_id text NOT NULL,
  name text NOT NULL,
  description text,
  language text DEFAULT 'starlark' NOT NULL,
  source text,
  source_hash text,
  wasm_b64 text,
  wasm_hash text,
  is_packer boolean DEFAULT false NOT NULL,
  enabled boolean DEFAULT false NOT NULL,
  timeout_ms integer DEFAULT 1000 NOT NULL,
  max_memory_pages integer DEFAULT 256 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_consolidation_log (
  id text PRIMARY KEY NOT NULL,
  trigger text NOT NULL,
  entity_id text,
  project_path text,
  events_processed bigint,
  relationships_added bigint,
  started_at bigint NOT NULL,
  completed_at bigint
);

CREATE TABLE IF NOT EXISTS memory_relationships (
  id text PRIMARY KEY NOT NULL,
  subject_entity_id text NOT NULL,
  predicate text NOT NULL,
  object_entity_id text,
  object_literal text,
  project_path text,
  scope text DEFAULT 'gestalt' NOT NULL,
  valid_from bigint NOT NULL,
  valid_until bigint,
  confidence real DEFAULT 1 NOT NULL,
  source_event_ids text DEFAULT '[]' NOT NULL,
  created_at bigint NOT NULL
);

CREATE INDEX IF NOT EXISTS mapp_scripts_mapp_idx ON mapp_scripts USING btree (mapp_id);
CREATE UNIQUE INDEX IF NOT EXISTS mapp_scripts_name_uniq ON mapp_scripts USING btree (mapp_id, name);
CREATE INDEX IF NOT EXISTS mapp_scripts_packer_idx ON mapp_scripts USING btree (mapp_id, is_packer, enabled);
CREATE INDEX IF NOT EXISTS idx_memory_rel_subject ON memory_relationships USING btree (subject_entity_id, valid_until);
CREATE INDEX IF NOT EXISTS idx_memory_rel_project ON memory_relationships USING btree (subject_entity_id, project_path, valid_until);

-- s234: locality scope on existing memory_relationships rows.
ALTER TABLE memory_relationships ADD COLUMN IF NOT EXISTS scope text DEFAULT 'gestalt' NOT NULL;
UPDATE memory_relationships SET scope = 'project:' || project_path WHERE project_path IS NOT NULL AND scope = 'gestalt';
CREATE INDEX IF NOT EXISTS idx_memory_rel_scope ON memory_relationships USING btree (subject_entity_id, scope, valid_until);

-- s234: additive locality scope on memory_events + doc-chunk vocabulary. These are
-- pure column/value changes, INDEPENDENT of pgvector, so they live in the core
-- (always-run) block — not the gated vector block where memory_events is created.
-- Guarded by table existence so a fresh DB (vector block creates memory_events WITH
-- scope) is a clean no-op; an existing install gets scope even if the vector block
-- is skipped.
DO $do$
BEGIN
  IF to_regclass('public.memory_events') IS NOT NULL THEN
    ALTER TABLE memory_events ADD COLUMN IF NOT EXISTS scope text DEFAULT 'gestalt' NOT NULL;
    UPDATE memory_events SET scope = 'project:' || project_path WHERE project_path IS NOT NULL AND scope = 'gestalt';
  END IF;
  IF to_regclass('public.memory_doc_chunks') IS NOT NULL THEN
    UPDATE memory_doc_chunks SET scope = 'gestalt' WHERE scope = 'global';
  END IF;
END
$do$;
SQL

# Vector-backed s112 memory tables — embedding columns are vector(768), so they
# require the pgvector extension. CREATE EXTENSION needs SUPERUSER (the `agi` role
# is not one), so these are applied separately and only once pgvector is present.
read -r -d '' MIGRATIONS_SQL_VECTOR <<'SQL' || true
CREATE TABLE IF NOT EXISTS memory_doc_chunks (
  id text PRIMARY KEY NOT NULL,
  source_path text NOT NULL,
  scope text NOT NULL,
  heading text,
  content text NOT NULL,
  chunk_index bigint NOT NULL,
  content_hash text NOT NULL,
  indexed_at bigint NOT NULL,
  embedding vector(768)
);

CREATE TABLE IF NOT EXISTS memory_events (
  id text PRIMARY KEY NOT NULL,
  entity_id text NOT NULL,
  project_path text,
  session_id text,
  summary text NOT NULL,
  tags text DEFAULT '[]' NOT NULL,
  confidence real DEFAULT 0.5 NOT NULL,
  prime_alignment real,
  source_links text DEFAULT '[]' NOT NULL,
  hash text NOT NULL,
  coa_fingerprint text DEFAULT 'legacy' NOT NULL,
  model_version text,
  scope text DEFAULT 'gestalt' NOT NULL,
  created_at bigint NOT NULL,
  consolidated_at bigint,
  embedding vector(768),
  CONSTRAINT memory_events_hash_unique UNIQUE(hash)
);

CREATE INDEX IF NOT EXISTS idx_memory_doc_scope ON memory_doc_chunks USING btree (scope);
CREATE INDEX IF NOT EXISTS idx_memory_doc_path ON memory_doc_chunks USING btree (source_path);
CREATE INDEX IF NOT EXISTS idx_memory_events_entity ON memory_events USING btree (entity_id);
CREATE INDEX IF NOT EXISTS idx_memory_events_project ON memory_events USING btree (entity_id, project_path);
CREATE INDEX IF NOT EXISTS idx_memory_events_created ON memory_events USING btree (created_at);
CREATE INDEX IF NOT EXISTS idx_memory_events_unconsolidated ON memory_events USING btree (entity_id, consolidated_at);
CREATE INDEX IF NOT EXISTS idx_memory_events_scope ON memory_events USING btree (scope, created_at);
SQL

# --- Apply core (additive, no special privileges) ---------------------------
echo "[migrate-db] applying $(echo "$MIGRATIONS_SQL" | grep -cE '^[A-Z]') core statement(s) idempotently"
if ! echo "$MIGRATIONS_SQL" | $PSQL_RUNNER -v ON_ERROR_STOP=1 -q; then
  echo "[migrate-db] core statements failed — see above" >&2
  exit 1
fi

# --- pgvector (superuser) + vector-backed tables ----------------------------
# CREATE EXTENSION requires superuser; agi is not one. Install via the container's
# postgres superuser when reachable. If pgvector can't be made available, SKIP the
# vector tables with a warning rather than failing the whole migration (the core
# additive changes above must still land).
vector_ready() {
  echo "SELECT 1 FROM pg_extension WHERE extname='vector';" \
    | $PSQL_RUNNER -tA 2>/dev/null | grep -q 1
}
if ! vector_ready; then
  if podman ps --format '{{.Names}}' 2>/dev/null | grep -qx "$PG_CONTAINER" \
     && podman exec -i "$PG_CONTAINER" psql -U postgres -d "$DB_NAME" -v ON_ERROR_STOP=1 -qc \
          "CREATE EXTENSION IF NOT EXISTS vector;" >/dev/null 2>&1; then
    echo "[migrate-db] pgvector installed (postgres superuser)"
  else
    echo "[migrate-db] WARN: pgvector unavailable (CREATE EXTENSION needs superuser) — skipping vector-backed memory tables" >&2
  fi
fi

if vector_ready; then
  echo "[migrate-db] applying $(echo "$MIGRATIONS_SQL_VECTOR" | grep -cE '^[A-Z]') vector-backed statement(s)"
  if ! echo "$MIGRATIONS_SQL_VECTOR" | $PSQL_RUNNER -v ON_ERROR_STOP=1 -q; then
    echo "[migrate-db] vector-backed statements failed — see above" >&2
    exit 1
  fi
fi

echo "[migrate-db] schema in sync"
exit 0
