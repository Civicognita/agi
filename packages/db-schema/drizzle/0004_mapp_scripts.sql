-- s182 Phase B — mapp_scripts table (2026-05-19).
--
-- Per-MApp Starlark script definitions with deny-by-default execution.
-- Compilation pipeline (Phase D) populates wasm_b64 + wasm_hash.
-- Idempotent: CREATE TABLE / CREATE INDEX IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS "mapp_scripts" (
  "id"               text        PRIMARY KEY NOT NULL,
  "mapp_id"          text        NOT NULL,
  "name"             text        NOT NULL,
  "description"      text,
  "language"         text        NOT NULL DEFAULT 'starlark',
  "source"           text,
  "source_hash"      text,
  "wasm_b64"         text,
  "wasm_hash"        text,
  "is_packer"        boolean     NOT NULL DEFAULT false,
  "enabled"          boolean     NOT NULL DEFAULT false,
  "timeout_ms"       integer     NOT NULL DEFAULT 1000,
  "max_memory_pages" integer     NOT NULL DEFAULT 256,
  "created_at"       timestamptz NOT NULL DEFAULT now(),
  "updated_at"       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "mapp_scripts_mapp_idx"
  ON "mapp_scripts" ("mapp_id");

CREATE UNIQUE INDEX IF NOT EXISTS "mapp_scripts_name_uniq"
  ON "mapp_scripts" ("mapp_id", "name");

CREATE INDEX IF NOT EXISTS "mapp_scripts_packer_idx"
  ON "mapp_scripts" ("mapp_id", "is_packer", "enabled");
