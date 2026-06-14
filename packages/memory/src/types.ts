/**
 * Memory system types — s112 CoALA+TiMem graph backend.
 *
 * Semantic memory for entities persisting across session boundaries.
 * Storage: SQLite at ~/.agi/memory/graph.db (no cloud dependency).
 */

// ---------------------------------------------------------------------------
// Memory entry
// ---------------------------------------------------------------------------

/** A single memory entry for an entity. */
export interface MemoryEntry {
  /** Unique memory ID (ULID). */
  id: string;
  /** Entity that owns this memory. */
  entityId: string;
  /** Memory content — a natural language statement. */
  content: string;
  /** Semantic category for retrieval. */
  category: MemoryCategory;
  /** Source event that generated this memory. */
  source: MemorySource;
  /** ISO-8601 creation timestamp. */
  createdAt: string;
  /** ISO-8601 last access timestamp (for pruning). */
  lastAccessedAt: string;
  /** Access count (for pruning priority). */
  accessCount: number;
  /** Relevance score from last retrieval (0.0-1.0). */
  relevanceScore?: number;
  /** Optional metadata. */
  metadata?: Record<string, unknown>;
}

/** Memory categories for semantic grouping. */
export type MemoryCategory =
  | "preference"       // Entity preferences and settings
  | "fact"             // Learned facts about the entity
  | "relationship"     // Relationship patterns between entities
  | "conversation"     // Conversation summaries
  | "decision"         // Decisions made by or for the entity
  | "skill_usage"      // Skills the entity has invoked
  | "verification";    // Verification events

/** How the memory was created. */
export type MemorySource =
  | "session_close"    // Extracted at session close
  | "compaction"       // Extracted during context compaction
  | "verification"     // Created during verification events
  | "mint"             // Created during MINT ceremony
  | "explicit"         // Explicitly stored by operator
  | "system";          // System-generated

// ---------------------------------------------------------------------------
// Memory provider interface
// ---------------------------------------------------------------------------

/** Abstract memory provider — implemented by Cognee and file adapters. */
export interface MemoryProvider {
  readonly name: string;
  readonly requiresNetwork: boolean;

  /** Store a memory entry. */
  store(entry: MemoryEntry): Promise<void>;

  /** Store multiple entries in batch. */
  storeBatch(entries: MemoryEntry[]): Promise<void>;

  /** Query memories for an entity by semantic relevance. */
  query(params: MemoryQueryParams): Promise<MemoryEntry[]>;

  /** Delete a specific memory entry. */
  delete(memoryId: string): Promise<void>;

  /** Delete all memories for an entity (GDPR). */
  deleteAllForEntity(entityId: string): Promise<void>;

  /** Prune old/irrelevant memories based on criteria. */
  prune(params: PruneParams): Promise<number>;

  /** Count memories for an entity. */
  count(entityId: string): Promise<number>;

  /** Check if the provider is available. Synchronous — SQLite is always local. */
  isAvailable(): boolean;
}

// ---------------------------------------------------------------------------
// Query parameters
// ---------------------------------------------------------------------------

/** Parameters for memory retrieval. */
export interface MemoryQueryParams {
  /** Entity to query memories for. */
  entityId: string;
  /** Semantic search query (conversation topic). */
  query?: string;
  /** Filter by category. */
  categories?: MemoryCategory[];
  /** Maximum entries to return. */
  limit?: number;
  /** Minimum relevance score (0.0-1.0). */
  minRelevance?: number;
}

/** Parameters for memory pruning. */
export interface PruneParams {
  /** Entity to prune (omit for all entities). */
  entityId?: string;
  /** Prune entries older than this (ISO-8601). */
  olderThan?: string;
  /** Prune entries accessed fewer than N times. */
  accessCountBelow?: number;
  /** Maximum entries to keep per entity. */
  maxPerEntity?: number;
}

// ---------------------------------------------------------------------------
// Memory adapter config
// ---------------------------------------------------------------------------

/** Configuration for the graph memory adapter (s112 CoALA+TiMem). */
export interface MemoryConfig {
  /** Absolute path to SQLite graph DB. Default: ~/.agi/memory/graph.db */
  graphDbPath?: string;
  /** Legacy file-adapter directory for one-shot migration. */
  legacyMemDir?: string;
  /** Maximum memories to inject per agent call. */
  maxMemoriesPerCall: number;
  /** Maximum token budget for memory injection. */
  memoryTokenBudget: number;
  /** Memory retention days before pruning. */
  retentionDays: number;
  /** Embedding model name (passed to EmbeddingEngine). Default: nomic-embed-text */
  embeddingModel?: string;
}

/** Default memory configuration. */
export const DEFAULT_MEMORY_CONFIG: Omit<MemoryConfig, "graphDbPath" | "legacyMemDir"> = {
  maxMemoriesPerCall: 10,
  memoryTokenBudget: 2000,
  retentionDays: 180,
};
