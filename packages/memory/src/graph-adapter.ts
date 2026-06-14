/**
 * GraphMemoryAdapter — Postgres-backed temporal event graph (s112 CoALA+TiMem).
 *
 * Migrated from node:sqlite → agi_data Postgres (single-DB rule, pgvector support).
 *
 * Four tables (defined in @agi/db-schema src/memory.ts):
 *   memory_events            — Layer B episodic records with temporal provenance
 *   memory_relationships     — consolidated fact graph (valid_from / valid_until)
 *   memory_doc_chunks        — indexed agi/docs/ + k/ folder chunks (DocIndexer)
 *   memory_consolidation_log — audit trail for the consolidation pipeline
 *
 * Full-text search: PostgreSQL tsvector GIN index via plainto_tsquery (replaces FTS5).
 * Embeddings: pgvector vector(768) stored as number[]; cosine rerank in TS after FTS pre-filter.
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { and, desc, eq, inArray, isNull, lt, notInArray, sql } from "drizzle-orm";

import type {
  AnyDb,
  memoryDocChunks,
  memoryEvents,
  memoryRelationships,
} from "@agi/db-schema";

import type {
  MemoryProvider,
  MemoryEntry,
  MemoryQueryParams,
  PruneParams,
  MemoryCategory,
  MemorySource,
} from "./types.js";

// ---------------------------------------------------------------------------
// Re-exported types (same shape as before)
// ---------------------------------------------------------------------------

/** Internal event record (maps to the memory_events table). */
export interface GraphEventRecord {
  id: string;
  entityId: string;
  projectPath?: string | null;
  sessionId?: string | null;
  summary: string;
  tags: string[];
  confidence: number;
  primeAlignment?: number | null;
  sourceLinks: string[];
  hash: string;
  coaFingerprint: string;
  modelVersion?: string | null;
  createdAt: number; // Unix ms
  consolidatedAt?: number | null;
  embedding?: Float32Array | null;
}

/** A consolidated semantic relationship between entities. */
export interface RelationshipRecord {
  id: string;
  subjectEntityId: string;
  predicate: string;
  objectEntityId?: string | null;
  objectLiteral?: string | null;
  projectPath?: string | null;
  validFrom: number; // Unix ms
  validUntil?: number | null;
  confidence: number;
  sourceEventIds: string[];
  createdAt: number; // Unix ms
}

/** A doc chunk from agi/docs/ or a k/ folder. */
export interface DocChunkRecord {
  id: string;
  sourcePath: string;
  scope: string; // 'global' | 'project:<path>' | 'prime'
  heading?: string | null;
  content: string;
  chunkIndex: number;
  contentHash: string;
  indexedAt: number; // Unix ms
  embedding?: Float32Array | null;
}

/** Graph-aware event query (superset of MemoryQueryParams). */
export interface EventQuery {
  entityId?: string;
  projectPath?: string | null; // null = global only; undefined = entity-wide
  timeRange?: { from: Date; to?: Date };
  semantic?: string;
  tags?: string[];
  minConfidence?: number;
  limit?: number;
}

/** Relationship query with point-in-time traversal. */
export interface RelationshipQuery {
  subjectEntityId?: string;
  projectPath?: string | null;
  predicate?: string;
  validAt?: Date;
  limit?: number;
}

/** Doc chunk keyword / semantic query. */
export interface DocQuery {
  scope?: string;
  semantic?: string;
  limit?: number;
  queryEmbedding?: Float32Array;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface GraphMemoryConfig {
  /** Drizzle AnyDb instance. Passed in by the gateway at boot. */
  db: AnyDb;
  /** Legacy FileMemoryProvider directory — scanned for migration on first boot. */
  legacyMemDir?: string;
}

// ---------------------------------------------------------------------------
// Type aliases for drizzle table inferred types
// ---------------------------------------------------------------------------

type EventRow = typeof memoryEvents.$inferSelect;
type RelRow = typeof memoryRelationships.$inferSelect;
type DocRow = typeof memoryDocChunks.$inferSelect;

// ---------------------------------------------------------------------------
// GraphMemoryAdapter
// ---------------------------------------------------------------------------

export class GraphMemoryAdapter implements MemoryProvider {
  readonly name = "graph-memory";
  readonly requiresNetwork = false;

  private readonly db: AnyDb;

  constructor(config: GraphMemoryConfig) {
    this.db = config.db;
    if (config.legacyMemDir) {
      void this.migrateFromFileAdapter(config.legacyMemDir);
    }
  }

  // ---------------------------------------------------------------------------
  // MemoryProvider interface
  // ---------------------------------------------------------------------------

  async store(entry: MemoryEntry | unknown): Promise<void> {
    if (isEpisodicRecord(entry)) {
      const ep = entry as EpisodicRecordLike;
      await this.insertEvent({
        id: ep.id,
        entityId: ep.actor.entityId,
        projectPath: null,
        sessionId: ep.sourceLinks?.[0] ?? null,
        summary: ep.summary,
        tags: ep.tags ?? [],
        confidence: ep.confidence ?? 0.5,
        primeAlignment: ep.primeAlignment ?? null,
        sourceLinks: ep.sourceLinks ?? [],
        hash: ep.hash,
        coaFingerprint: ep.coaFingerprint,
        modelVersion: ep.modelVersion ?? null,
        createdAt: new Date(ep.timestamp).getTime(),
        consolidatedAt: null,
        embedding: null,
      });
      return;
    }
    const mem = entry as MemoryEntry;
    await this.insertEvent({
      id: mem.id,
      entityId: mem.entityId,
      projectPath: null,
      sessionId: null,
      summary: mem.content,
      tags: [mem.category],
      confidence: 0.5,
      primeAlignment: null,
      sourceLinks: [mem.source],
      hash: hashFromParts(mem.content, mem.createdAt),
      coaFingerprint: "legacy",
      modelVersion: null,
      createdAt: new Date(mem.createdAt).getTime(),
      consolidatedAt: null,
      embedding: null,
    });
  }

  async storeBatch(entries: MemoryEntry[]): Promise<void> {
    for (const e of entries) await this.store(e);
  }

  async query(params: MemoryQueryParams): Promise<MemoryEntry[]> {
    const rows = await this.selectEvents({
      entityId: params.entityId,
      semantic: params.query,
      tags: params.categories,
      minConfidence: params.minRelevance,
      limit: params.limit ?? 10,
    });
    return rows.map(eventRowToMemoryEntry);
  }

  async delete(memoryId: string): Promise<void> {
    const { memoryEvents } = await import("@agi/db-schema");
    await this.db.delete(memoryEvents).where(eq(memoryEvents.id, memoryId));
  }

  async deleteAllForEntity(entityId: string): Promise<void> {
    const { memoryEvents } = await import("@agi/db-schema");
    await this.db.delete(memoryEvents).where(eq(memoryEvents.entityId, entityId));
  }

  async prune(params: PruneParams): Promise<number> {
    const { memoryEvents } = await import("@agi/db-schema");
    const conditions = [];

    if (params.entityId) conditions.push(eq(memoryEvents.entityId, params.entityId));
    if (params.olderThan) {
      conditions.push(lt(memoryEvents.createdAt, new Date(params.olderThan).getTime()));
    }

    const result = await this.db
      .delete(memoryEvents)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .returning({ id: memoryEvents.id });

    if (params.maxPerEntity !== undefined && params.entityId !== undefined) {
      const overflow = await this.db
        .select({ id: memoryEvents.id })
        .from(memoryEvents)
        .where(eq(memoryEvents.entityId, params.entityId))
        .orderBy(desc(memoryEvents.createdAt))
        .offset(params.maxPerEntity);

      if (overflow.length > 0) {
        await this.db
          .delete(memoryEvents)
          .where(notInArray(memoryEvents.id, overflow.map((r) => r.id)));
      }
    }

    return result.length;
  }

  async count(entityId: string): Promise<number> {
    const { memoryEvents } = await import("@agi/db-schema");
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(memoryEvents)
      .where(eq(memoryEvents.entityId, entityId));
    return row?.n ?? 0;
  }

  isAvailable(): boolean {
    return true; // Postgres is always available (gateway fails to boot without it)
  }

  // ---------------------------------------------------------------------------
  // Extended graph API (used by EpisodeExtractor, ConsolidationEngine, DocIndexer)
  // ---------------------------------------------------------------------------

  async storeEpisodicEvent(
    record: Omit<GraphEventRecord, "embedding"> & {
      projectPath?: string | null;
    },
  ): Promise<void> {
    await this.insertEvent({ ...record, embedding: null });
  }

  async storeRelationship(rel: RelationshipRecord): Promise<void> {
    const { memoryRelationships } = await import("@agi/db-schema");
    await this.db
      .insert(memoryRelationships)
      .values({
        id: rel.id,
        subjectEntityId: rel.subjectEntityId,
        predicate: rel.predicate,
        objectEntityId: rel.objectEntityId ?? null,
        objectLiteral: rel.objectLiteral ?? null,
        projectPath: rel.projectPath ?? null,
        validFrom: rel.validFrom,
        validUntil: rel.validUntil ?? null,
        confidence: rel.confidence,
        sourceEventIds: JSON.stringify(rel.sourceEventIds),
        createdAt: rel.createdAt,
      })
      .onConflictDoUpdate({
        target: memoryRelationships.id,
        set: {
          validUntil: rel.validUntil ?? null,
          confidence: rel.confidence,
          sourceEventIds: JSON.stringify(rel.sourceEventIds),
        },
      });
  }

  async invalidatePriorRelationship(
    subjectEntityId: string,
    predicate: string,
    projectPath: string | null,
    validUntil: number,
  ): Promise<void> {
    const { memoryRelationships } = await import("@agi/db-schema");
    await this.db
      .update(memoryRelationships)
      .set({ validUntil })
      .where(
        and(
          eq(memoryRelationships.subjectEntityId, subjectEntityId),
          eq(memoryRelationships.predicate, predicate),
          projectPath === null
            ? isNull(memoryRelationships.projectPath)
            : eq(memoryRelationships.projectPath, projectPath),
          isNull(memoryRelationships.validUntil),
        ),
      );
  }

  async queryGraphEvents(params: EventQuery): Promise<GraphEventRecord[]> {
    const rows = await this.selectEvents(params);
    return rows.map(eventRowToGraphEvent);
  }

  async queryRelationships(params: RelationshipQuery): Promise<RelationshipRecord[]> {
    const { memoryRelationships } = await import("@agi/db-schema");
    const conditions = [];

    if (params.subjectEntityId) conditions.push(eq(memoryRelationships.subjectEntityId, params.subjectEntityId));
    if (params.predicate) conditions.push(eq(memoryRelationships.predicate, params.predicate));
    if ("projectPath" in params) {
      if (params.projectPath === null) {
        conditions.push(isNull(memoryRelationships.projectPath));
      } else if (params.projectPath !== undefined) {
        conditions.push(eq(memoryRelationships.projectPath, params.projectPath));
      }
    }
    if (params.validAt) {
      const ts = params.validAt.getTime();
      conditions.push(
        sql`${memoryRelationships.validFrom} <= ${ts} AND (${memoryRelationships.validUntil} IS NULL OR ${memoryRelationships.validUntil} > ${ts})`,
      );
    }

    const rows = await this.db
      .select()
      .from(memoryRelationships)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(memoryRelationships.validFrom))
      .limit(params.limit ?? 10);

    return rows.map(relRowToRelationship);
  }

  async markConsolidated(eventIds: string[]): Promise<void> {
    if (eventIds.length === 0) return;
    const { memoryEvents } = await import("@agi/db-schema");
    const now = Date.now();
    await this.db
      .update(memoryEvents)
      .set({ consolidatedAt: now })
      .where(inArray(memoryEvents.id, eventIds));
  }

  async getUnconsolidated(
    entityId: string,
    projectPath: string | null | undefined,
    limit = 20,
  ): Promise<GraphEventRecord[]> {
    const { memoryEvents } = await import("@agi/db-schema");
    const conditions = [
      eq(memoryEvents.entityId, entityId),
      isNull(memoryEvents.consolidatedAt),
    ];

    if (projectPath === null) {
      conditions.push(isNull(memoryEvents.projectPath));
    } else if (projectPath !== undefined) {
      conditions.push(eq(memoryEvents.projectPath, projectPath));
    }

    const rows = await this.db
      .select()
      .from(memoryEvents)
      .where(and(...conditions))
      .orderBy(memoryEvents.createdAt)
      .limit(limit);

    return rows.map(eventRowToGraphEvent);
  }

  async storeConsolidationLog(entry: {
    id: string;
    trigger: string;
    entityId?: string | null;
    projectPath?: string | null;
    eventsProcessed: number;
    relationshipsAdded: number;
    startedAt: number;
    completedAt?: number | null;
  }): Promise<void> {
    const { memoryConsolidationLog } = await import("@agi/db-schema");
    await this.db
      .insert(memoryConsolidationLog)
      .values({
        id: entry.id,
        trigger: entry.trigger,
        entityId: entry.entityId ?? null,
        projectPath: entry.projectPath ?? null,
        eventsProcessed: entry.eventsProcessed,
        relationshipsAdded: entry.relationshipsAdded,
        startedAt: entry.startedAt,
        completedAt: entry.completedAt ?? null,
      })
      .onConflictDoUpdate({
        target: memoryConsolidationLog.id,
        set: { completedAt: entry.completedAt ?? null },
      });
  }

  // ---------------------------------------------------------------------------
  // Doc chunk API (used by DocIndexer — Phase 3)
  // ---------------------------------------------------------------------------

  async storeDocChunk(chunk: DocChunkRecord): Promise<void> {
    const { memoryDocChunks } = await import("@agi/db-schema");
    await this.db
      .insert(memoryDocChunks)
      .values({
        id: chunk.id,
        sourcePath: chunk.sourcePath,
        scope: chunk.scope,
        heading: chunk.heading ?? null,
        content: chunk.content,
        chunkIndex: chunk.chunkIndex,
        contentHash: chunk.contentHash,
        indexedAt: chunk.indexedAt,
        embedding: chunk.embedding ? Array.from(chunk.embedding) : null,
      })
      .onConflictDoUpdate({
        target: memoryDocChunks.id,
        set: {
          content: chunk.content,
          heading: chunk.heading ?? null,
          contentHash: chunk.contentHash,
          indexedAt: chunk.indexedAt,
          embedding: chunk.embedding ? Array.from(chunk.embedding) : null,
        },
      });
  }

  async deleteDocChunksForPath(sourcePath: string): Promise<void> {
    const { memoryDocChunks } = await import("@agi/db-schema");
    await this.db.delete(memoryDocChunks).where(eq(memoryDocChunks.sourcePath, sourcePath));
  }

  async getDocChunkHash(sourcePath: string): Promise<string | null> {
    const { memoryDocChunks } = await import("@agi/db-schema");
    const [row] = await this.db
      .select({ contentHash: memoryDocChunks.contentHash })
      .from(memoryDocChunks)
      .where(eq(memoryDocChunks.sourcePath, sourcePath))
      .limit(1);
    return row?.contentHash ?? null;
  }

  async queryDocChunks(params: DocQuery): Promise<DocChunkRecord[]> {
    const { memoryDocChunks } = await import("@agi/db-schema");
    const query = params.semantic ?? "";
    const limit = params.limit ?? 5;
    const fetchLimit = params.queryEmbedding ? Math.min(limit * 5, 50) : limit;

    if (query.trim().length > 0) {
      // FTS pre-filter using PostgreSQL tsvector + plainto_tsquery
      const tsQuery = sql`plainto_tsquery('english', ${query})`;
      const tsVector = sql`to_tsvector('english', ${memoryDocChunks.content} || ' ' || coalesce(${memoryDocChunks.heading}, ''))`;

      const conditions = [sql`${tsVector} @@ ${tsQuery}`];
      if (params.scope) conditions.push(eq(memoryDocChunks.scope, params.scope));

      const candidates = await this.db
        .select()
        .from(memoryDocChunks)
        .where(and(...conditions))
        .orderBy(sql`ts_rank(${tsVector}, ${tsQuery}) DESC`)
        .limit(fetchLimit);

      if (params.queryEmbedding) {
        return cosineRerankDocs(candidates.map(docRowToChunk), params.queryEmbedding, limit);
      }
      return candidates.slice(0, limit).map(stripEmbedding);
    }

    // No query — recency order
    const conditions = params.scope ? [eq(memoryDocChunks.scope, params.scope)] : [];
    const rows = await this.db
      .select()
      .from(memoryDocChunks)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(memoryDocChunks.indexedAt))
      .limit(limit);

    return rows.map(stripEmbedding);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async insertEvent(r: GraphEventRecord): Promise<void> {
    const { memoryEvents } = await import("@agi/db-schema");
    await this.db
      .insert(memoryEvents)
      .values({
        id: r.id,
        entityId: r.entityId,
        projectPath: r.projectPath ?? null,
        sessionId: r.sessionId ?? null,
        summary: r.summary,
        tags: JSON.stringify(r.tags),
        confidence: r.confidence,
        primeAlignment: r.primeAlignment ?? null,
        sourceLinks: JSON.stringify(r.sourceLinks),
        hash: r.hash,
        coaFingerprint: r.coaFingerprint,
        modelVersion: r.modelVersion ?? null,
        createdAt: r.createdAt,
        consolidatedAt: r.consolidatedAt ?? null,
        embedding: r.embedding ? Array.from(r.embedding) : null,
      })
      .onConflictDoNothing(); // Hash collision = duplicate event, silently skip
  }

  private async selectEvents(params: EventQuery): Promise<EventRow[]> {
    const { memoryEvents } = await import("@agi/db-schema");
    const { semantic, entityId, tags, minConfidence = 0, limit = 10 } = params;

    if (semantic && semantic.trim().length > 0) {
      // FTS pre-filter → optional cosine rerank in caller
      const tsQuery = sql`plainto_tsquery('english', ${semantic})`;
      const tsVector = sql`to_tsvector('english', ${memoryEvents.summary} || ' ' || ${memoryEvents.tags})`;

      const conditions = [
        sql`${tsVector} @@ ${tsQuery}`,
        sql`${memoryEvents.confidence} >= ${minConfidence}`,
      ];
      if (entityId) conditions.push(eq(memoryEvents.entityId, entityId));
      this.addProjectPathCondition(conditions, memoryEvents, params);

      return this.db
        .select()
        .from(memoryEvents)
        .where(and(...conditions))
        .orderBy(sql`ts_rank(${tsVector}, ${tsQuery}) DESC`)
        .limit(Math.min(limit * 3, 50));
    }

    // Recency order
    const conditions = [sql`${memoryEvents.confidence} >= ${minConfidence}`];
    if (entityId) conditions.push(eq(memoryEvents.entityId, entityId));
    this.addProjectPathCondition(conditions, memoryEvents, params);

    if (tags && tags.length > 0) {
      const tagChecks = tags.map((t) => sql`${memoryEvents.tags} LIKE ${"%" + JSON.stringify(t).slice(1, -1) + "%"}`);
      conditions.push(sql`(${sql.join(tagChecks, sql` OR `)})`);
    }
    if (params.timeRange) {
      conditions.push(sql`${memoryEvents.createdAt} >= ${params.timeRange.from.getTime()}`);
      if (params.timeRange.to) {
        conditions.push(sql`${memoryEvents.createdAt} <= ${params.timeRange.to.getTime()}`);
      }
    }

    return this.db
      .select()
      .from(memoryEvents)
      .where(and(...conditions))
      .orderBy(desc(memoryEvents.createdAt))
      .limit(limit);
  }

  // biome-ignore lint/suspicious/noExplicitAny: drizzle table type is complex
  private addProjectPathCondition(conditions: ReturnType<typeof sql>[], table: any, params: EventQuery): void {
    if ("projectPath" in params) {
      if (params.projectPath === null) {
        conditions.push(isNull(table.projectPath));
      } else if (params.projectPath !== undefined) {
        conditions.push(eq(table.projectPath, params.projectPath));
      }
    }
  }

  private async migrateFromFileAdapter(legacyMemDir: string): Promise<void> {
    const dir = legacyMemDir.startsWith("/") ? legacyMemDir : join(process.cwd(), legacyMemDir);
    if (!existsSync(dir)) return;

    // Check if already migrated (look for any events from the legacy source)
    const { memoryEvents } = await import("@agi/db-schema");
    const [existing] = await this.db
      .select({ id: memoryEvents.id })
      .from(memoryEvents)
      .where(eq(memoryEvents.coaFingerprint, "migrated"))
      .limit(1);
    if (existing) return;

    let count = 0;
    try {
      for (const entity of readdirSync(dir)) {
        const entityPath = join(dir, entity);
        try {
          for (const file of readdirSync(entityPath)) {
            if (!file.endsWith(".json")) continue;
            try {
              const raw = JSON.parse(readFileSync(join(entityPath, file), "utf-8")) as Record<string, unknown>;
              const content = typeof raw.content === "string" ? raw.content : "";
              const createdAt = typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString();
              await this.insertEvent({
                id: typeof raw.id === "string" ? raw.id : `migrated-${file}`,
                entityId: typeof raw.entityId === "string" ? raw.entityId : entity,
                projectPath: null,
                sessionId: null,
                summary: content,
                tags: [typeof raw.category === "string" ? raw.category : "fact"],
                confidence: 0.5,
                primeAlignment: null,
                sourceLinks: [typeof raw.source === "string" ? raw.source : "migrated"],
                hash: hashFromParts(content, createdAt),
                coaFingerprint: "migrated",
                modelVersion: null,
                createdAt: new Date(createdAt).getTime(),
                consolidatedAt: null,
                embedding: null,
              });
              count++;
            } catch { /* skip malformed */ }
          }
        } catch { /* skip unreadable entity dir */ }
      }
    } catch { /* legacy dir unreadable */ }

    if (count > 0) {
      process.stderr.write(`[memory] Migrated ${String(count)} entries from file adapter to Postgres\n`);
    }
  }
}

// ---------------------------------------------------------------------------
// Row converters
// ---------------------------------------------------------------------------

function eventRowToMemoryEntry(row: EventRow): MemoryEntry {
  const tags = parseJson<string[]>(row.tags, []);
  const links = parseJson<string[]>(row.sourceLinks, []);
  const createdAt = new Date(row.createdAt).toISOString();
  return {
    id: row.id,
    entityId: row.entityId,
    content: row.summary,
    category: (tags[0] ?? "fact") as MemoryCategory,
    source: (links[0] ?? "system") as MemorySource,
    createdAt,
    lastAccessedAt: createdAt,
    accessCount: 0,
    relevanceScore: row.confidence,
  };
}

function eventRowToGraphEvent(row: EventRow): GraphEventRecord {
  return {
    id: row.id,
    entityId: row.entityId,
    projectPath: row.projectPath ?? null,
    sessionId: row.sessionId ?? null,
    summary: row.summary,
    tags: parseJson<string[]>(row.tags, []),
    confidence: row.confidence,
    primeAlignment: row.primeAlignment ?? null,
    sourceLinks: parseJson<string[]>(row.sourceLinks, []),
    hash: row.hash,
    coaFingerprint: row.coaFingerprint,
    modelVersion: row.modelVersion ?? null,
    createdAt: row.createdAt,
    consolidatedAt: row.consolidatedAt ?? null,
    embedding: row.embedding ? new Float32Array(row.embedding) : null,
  };
}

function relRowToRelationship(row: RelRow): RelationshipRecord {
  return {
    id: row.id,
    subjectEntityId: row.subjectEntityId,
    predicate: row.predicate,
    objectEntityId: row.objectEntityId ?? null,
    objectLiteral: row.objectLiteral ?? null,
    projectPath: row.projectPath ?? null,
    validFrom: row.validFrom,
    validUntil: row.validUntil ?? null,
    confidence: row.confidence,
    sourceEventIds: parseJson<string[]>(row.sourceEventIds, []),
    createdAt: row.createdAt,
  };
}

function docRowToChunk(row: DocRow): DocChunkRecord {
  return {
    id: row.id,
    sourcePath: row.sourcePath,
    scope: row.scope,
    heading: row.heading ?? null,
    content: row.content,
    chunkIndex: Number(row.chunkIndex),
    contentHash: row.contentHash,
    indexedAt: Number(row.indexedAt),
    embedding: row.embedding ? new Float32Array(row.embedding) : null,
  };
}

function stripEmbedding(row: DocRow): DocChunkRecord {
  return { ...docRowToChunk(row), embedding: null };
}

function cosineRerankDocs(
  candidates: DocChunkRecord[],
  queryEmb: Float32Array,
  limit: number,
): DocChunkRecord[] {
  const scored = candidates.map((c) => ({
    c,
    score: c.embedding ? cosineSim(queryEmb, c.embedding) : -1,
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => ({ ...s.c, embedding: null }));
}

function cosineSim(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! ** 2;
    nb += b[i]! ** 2;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function hashFromParts(content: string, createdAt: string): string {
  return "sha256:" + createHash("sha256").update(content + createdAt).digest("hex");
}

interface EpisodicRecordLike {
  id: string;
  timestamp: string;
  actor: { entityId: string; coaAlias: string };
  summary: string;
  tags: string[];
  confidence: number;
  primeAlignment?: number | null;
  sourceLinks: string[];
  hash: string;
  coaFingerprint: string;
  modelVersion?: string | null;
}

function isEpisodicRecord(entry: unknown): entry is EpisodicRecordLike {
  const r = entry as Record<string, unknown>;
  return (
    typeof r?.summary === "string" &&
    typeof r?.coaFingerprint === "string" &&
    typeof r?.actor === "object" &&
    r.actor !== null
  );
}
