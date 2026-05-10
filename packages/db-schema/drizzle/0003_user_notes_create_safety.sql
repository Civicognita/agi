-- s157 cycle 178 — user_notes table CREATE TABLE IF NOT EXISTS safety net.
--
-- Drift discovery (cycle 177): user_notes was added to platform.ts in s152
-- (2026-05-09) and referenced by notes-store.ts, but no migration ever created
-- the table. Production may or may not have it depending on which non-tracked
-- path created it. Migration 0002 (cycle 177) used ALTER IF EXISTS to be safe
-- regardless. This migration ensures the table itself exists so 0002's ADD
-- COLUMN succeeds on fresh databases too.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS — does nothing if table already
-- present. Indices are CREATE INDEX IF NOT EXISTS for the same reason. The
-- `kind` column is included with its default so this migration alone is
-- sufficient on a fresh DB; on existing DBs that already received 0002, the
-- column is already present and CREATE TABLE IF NOT EXISTS is a no-op.

CREATE TABLE IF NOT EXISTS "user_notes" (
  "id" text PRIMARY KEY NOT NULL,
  "user_entity_id" text NOT NULL,
  "project_path" text,
  "title" text NOT NULL,
  "kind" text NOT NULL DEFAULT 'markdown',
  "body" text NOT NULL DEFAULT '',
  "sort_order" integer NOT NULL DEFAULT 0,
  "pinned" boolean NOT NULL DEFAULT false,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "user_notes_user_idx" ON "user_notes" ("user_entity_id");
CREATE INDEX IF NOT EXISTS "user_notes_project_idx" ON "user_notes" ("project_path");
CREATE INDEX IF NOT EXISTS "user_notes_pinned_idx" ON "user_notes" ("pinned");
CREATE INDEX IF NOT EXISTS "user_notes_kind_idx" ON "user_notes" ("kind");
