/**
 * Memory graph tables — CoALA+TiMem hybrid (s112).
 *
 * Four tables covering the full memory pipeline:
 *   memory_events            — raw episodic records with temporal provenance
 *   memory_relationships     — consolidated semantic fact graph (valid_from/until)
 *   memory_doc_chunks        — agi/docs/ + k/ folder doc index
 *   memory_consolidation_log — audit trail for consolidation pipeline runs
 *
 * Embeddings are stored as pgvector `vector(768)` columns (nomic-embed-text dims).
 * Full-text search uses a GIN index on generated tsvector columns, replacing
 * SQLite FTS5.
 *
 * Requires: CREATE EXTENSION IF NOT EXISTS vector; (in migration 0000_memory_init.sql)
 */

import {
  bigint,
  index,
  pgTable,
  real,
  text,
  customType,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// pgvector custom type
// ---------------------------------------------------------------------------

/**
 * Drizzle custom type for pgvector `vector(N)`.
 * Wire format: "[f1,f2,...,fN]" string (Postgres text protocol).
 * JS representation: number[].
 */
export const vector = customType<{
  data: number[];
  driverData: string;
  config: { dimensions: number };
}>({
  dataType(config) {
    return `vector(${config?.dimensions ?? 768})`;
  },
  toDriver(value: number[]) {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: string) {
    if (!value) return [];
    return value.slice(1, -1).split(",").map(Number);
  },
});

// ---------------------------------------------------------------------------
// memory_events — Layer B episodic records
// ---------------------------------------------------------------------------

export const memoryEvents = pgTable(
  "memory_events",
  {
    id: text("id").primaryKey(),
    entityId: text("entity_id").notNull(),
    projectPath: text("project_path"),
    sessionId: text("session_id"),
    summary: text("summary").notNull(),
    /** JSON string[] — stored as text for compatibility with FTS tsvector. */
    tags: text("tags").notNull().default("[]"),
    confidence: real("confidence").notNull().default(0.5),
    primeAlignment: real("prime_alignment"),
    /** JSON string[] */
    sourceLinks: text("source_links").notNull().default("[]"),
    hash: text("hash").unique().notNull(),
    coaFingerprint: text("coa_fingerprint").notNull().default("legacy"),
    modelVersion: text("model_version"),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    consolidatedAt: bigint("consolidated_at", { mode: "number" }),
    embedding: vector("embedding", { dimensions: 768 }),
  },
  (t) => [
    index("idx_memory_events_entity").on(t.entityId),
    index("idx_memory_events_project").on(t.entityId, t.projectPath),
    index("idx_memory_events_created").on(t.createdAt),
    index("idx_memory_events_unconsolidated").on(t.entityId, t.consolidatedAt),
  ],
);

// ---------------------------------------------------------------------------
// memory_relationships — consolidated semantic graph layer
// ---------------------------------------------------------------------------

export const memoryRelationships = pgTable(
  "memory_relationships",
  {
    id: text("id").primaryKey(),
    subjectEntityId: text("subject_entity_id").notNull(),
    predicate: text("predicate").notNull(),
    objectEntityId: text("object_entity_id"),
    objectLiteral: text("object_literal"),
    projectPath: text("project_path"),
    validFrom: bigint("valid_from", { mode: "number" }).notNull(),
    validUntil: bigint("valid_until", { mode: "number" }),
    confidence: real("confidence").notNull().default(1.0),
    /** JSON string[] — provenance event IDs */
    sourceEventIds: text("source_event_ids").notNull().default("[]"),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (t) => [
    index("idx_memory_rel_subject").on(t.subjectEntityId, t.validUntil),
    index("idx_memory_rel_project").on(
      t.subjectEntityId,
      t.projectPath,
      t.validUntil,
    ),
  ],
);

// ---------------------------------------------------------------------------
// memory_doc_chunks — agi/docs/ + k/ folder index
// ---------------------------------------------------------------------------

export const memoryDocChunks = pgTable(
  "memory_doc_chunks",
  {
    id: text("id").primaryKey(),
    sourcePath: text("source_path").notNull(),
    scope: text("scope").notNull(), // 'global' | 'project:<path>' | 'prime'
    heading: text("heading"),
    content: text("content").notNull(),
    chunkIndex: bigint("chunk_index", { mode: "number" }).notNull(),
    contentHash: text("content_hash").notNull(),
    indexedAt: bigint("indexed_at", { mode: "number" }).notNull(),
    embedding: vector("embedding", { dimensions: 768 }),
  },
  (t) => [
    index("idx_memory_doc_scope").on(t.scope),
    index("idx_memory_doc_path").on(t.sourcePath),
  ],
);

// ---------------------------------------------------------------------------
// memory_consolidation_log — audit trail
// ---------------------------------------------------------------------------

export const memoryConsolidationLog = pgTable("memory_consolidation_log", {
  id: text("id").primaryKey(),
  trigger: text("trigger").notNull(), // 'session_close'|'job_complete'|'idle'
  entityId: text("entity_id"),
  projectPath: text("project_path"),
  eventsProcessed: bigint("events_processed", { mode: "number" }),
  relationshipsAdded: bigint("relationships_added", { mode: "number" }),
  startedAt: bigint("started_at", { mode: "number" }).notNull(),
  completedAt: bigint("completed_at", { mode: "number" }),
});
