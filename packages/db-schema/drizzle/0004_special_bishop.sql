-- s112 memory graph (2026-05-20) + s182 mapp_scripts + connections.dtoken.
--
-- What's new in this migration:
--   • pgvector extension (required for vector(768) columns)
--   • mapp_scripts table (s182 Phase B)
--   • connections.dtoken column
--   • memory_events, memory_relationships, memory_doc_chunks,
--     memory_consolidation_log tables (s112 CoALA+TiMem)
--
-- Safe guards:
--   • CREATE EXTENSION IF NOT EXISTS — already present on agi-postgres, no-op
--   • CREATE TABLE IF NOT EXISTS — idempotent for tables not yet in earlier migrations
--   • ADD COLUMN IF NOT EXISTS — protects against manual columns in dev DBs
--   • user_notes/mapps_marketplace.name handled by migrations 0001-0003

CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mapp_scripts" (
	"id" text PRIMARY KEY NOT NULL,
	"mapp_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"language" text DEFAULT 'starlark' NOT NULL,
	"source" text,
	"source_hash" text,
	"wasm_b64" text,
	"wasm_hash" text,
	"is_packer" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"timeout_ms" integer DEFAULT 1000 NOT NULL,
	"max_memory_pages" integer DEFAULT 256 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN IF NOT EXISTS "dtoken" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "memory_consolidation_log" (
	"id" text PRIMARY KEY NOT NULL,
	"trigger" text NOT NULL,
	"entity_id" text,
	"project_path" text,
	"events_processed" bigint,
	"relationships_added" bigint,
	"started_at" bigint NOT NULL,
	"completed_at" bigint
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "memory_doc_chunks" (
	"id" text PRIMARY KEY NOT NULL,
	"source_path" text NOT NULL,
	"scope" text NOT NULL,
	"heading" text,
	"content" text NOT NULL,
	"chunk_index" bigint NOT NULL,
	"content_hash" text NOT NULL,
	"indexed_at" bigint NOT NULL,
	"embedding" vector(768)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "memory_events" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_id" text NOT NULL,
	"project_path" text,
	"session_id" text,
	"summary" text NOT NULL,
	"tags" text DEFAULT '[]' NOT NULL,
	"confidence" real DEFAULT 0.5 NOT NULL,
	"prime_alignment" real,
	"source_links" text DEFAULT '[]' NOT NULL,
	"hash" text NOT NULL,
	"coa_fingerprint" text DEFAULT 'legacy' NOT NULL,
	"model_version" text,
	"created_at" bigint NOT NULL,
	"consolidated_at" bigint,
	"embedding" vector(768),
	CONSTRAINT "memory_events_hash_unique" UNIQUE("hash")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "memory_relationships" (
	"id" text PRIMARY KEY NOT NULL,
	"subject_entity_id" text NOT NULL,
	"predicate" text NOT NULL,
	"object_entity_id" text,
	"object_literal" text,
	"project_path" text,
	"valid_from" bigint NOT NULL,
	"valid_until" bigint,
	"confidence" real DEFAULT 1 NOT NULL,
	"source_event_ids" text DEFAULT '[]' NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mapp_scripts_mapp_idx" ON "mapp_scripts" USING btree ("mapp_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mapp_scripts_name_uniq" ON "mapp_scripts" USING btree ("mapp_id","name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mapp_scripts_packer_idx" ON "mapp_scripts" USING btree ("mapp_id","is_packer","enabled");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_memory_doc_scope" ON "memory_doc_chunks" USING btree ("scope");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_memory_doc_path" ON "memory_doc_chunks" USING btree ("source_path");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_memory_events_entity" ON "memory_events" USING btree ("entity_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_memory_events_project" ON "memory_events" USING btree ("entity_id","project_path");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_memory_events_created" ON "memory_events" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_memory_events_unconsolidated" ON "memory_events" USING btree ("entity_id","consolidated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_memory_rel_subject" ON "memory_relationships" USING btree ("subject_entity_id","valid_until");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_memory_rel_project" ON "memory_relationships" USING btree ("subject_entity_id","project_path","valid_until");
