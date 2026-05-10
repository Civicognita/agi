-- s157 cycle 177: add `kind` column to user_notes for whiteboard mode (s157, 2026-05-10).
-- Two modes coexist on the same table: `markdown` (default, s152 ship) and
-- `whiteboard` (JSON-persisted canvas state, s157 ship). Existing rows keep
-- markdown semantics via the default. Add an index so kind-filtered list queries
-- (Notes panel sub-tabs) stay fast as note counts grow.
--
-- Idempotent guards via `IF NOT EXISTS` on both column and index — the user_notes
-- table itself was added in a manual migration path during s152; this migration
-- assumes the table already exists and only extends it.

ALTER TABLE IF EXISTS "user_notes" ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'markdown';
CREATE INDEX IF NOT EXISTS "user_notes_kind_idx" ON "user_notes" ("kind");
