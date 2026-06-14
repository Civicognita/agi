# Memory Graph — SQLite Schema Reference

> Technical reference for `~/.agi/memory/graph.db`. See `memory-and-learning.md` for the conceptual overview.

---

## Tables

### `events` — episodic event store

```sql
events (
  id              TEXT PRIMARY KEY,           -- ULID
  entity_id       TEXT NOT NULL,              -- actor ($A0, #E0, …)
  project_path    TEXT,                       -- NULL = global
  session_id      TEXT,                       -- source chat/job session
  summary         TEXT NOT NULL,
  tags            TEXT NOT NULL DEFAULT '[]', -- JSON string[]
  confidence      REAL NOT NULL DEFAULT 0.5,
  prime_alignment REAL,                       -- NULL until G2 scores
  source_links    TEXT NOT NULL DEFAULT '[]', -- JSON string[]
  hash            TEXT UNIQUE NOT NULL,       -- SHA-256 canonical hash
  coa_fingerprint TEXT NOT NULL DEFAULT 'legacy',
  model_version   TEXT,
  created_at      INTEGER NOT NULL,           -- Unix ms
  consolidated_at INTEGER,                    -- NULL = not yet processed
  embedding       BLOB                        -- Float32LE from Ollama
)
events_fts USING fts5(summary, tags, content='events', content_rowid='rowid')
```

Auto-sync FTS5 via `AFTER INSERT/DELETE/UPDATE` triggers.

---

### `relationships` — consolidated semantic graph

```sql
relationships (
  id                TEXT PRIMARY KEY,
  subject_entity_id TEXT NOT NULL,
  predicate         TEXT NOT NULL,        -- closed vocab (see below)
  object_entity_id  TEXT,                 -- NULL if literal
  object_literal    TEXT,
  project_path      TEXT,
  valid_from        INTEGER NOT NULL,     -- Unix ms
  valid_until       INTEGER,             -- NULL = still valid
  confidence        REAL DEFAULT 1.0,
  source_event_ids  TEXT,                 -- JSON string[] (provenance)
  created_at        INTEGER NOT NULL
)
```

**Predicate vocabulary:**
`worked_on` | `decided` | `learned` | `used_tool` | `blocked_by` | `completed` | `discovered` | `prefers` | `created` | `fixed`

---

### `doc_chunks` — documentation index

```sql
doc_chunks (
  id           TEXT PRIMARY KEY,
  source_path  TEXT NOT NULL,
  scope        TEXT NOT NULL,            -- 'global' | 'project:<path>'
  heading      TEXT,
  content      TEXT NOT NULL,
  chunk_index  INTEGER NOT NULL,
  content_hash TEXT NOT NULL,            -- SHA-256 for staleness check
  indexed_at   INTEGER NOT NULL,         -- Unix ms
  embedding    BLOB                      -- Float32LE from Ollama
)
doc_chunks_fts USING fts5(content, heading, source_path, content='doc_chunks', content_rowid='rowid')
```

---

### `consolidation_log` — audit trail

```sql
consolidation_log (
  id                  TEXT PRIMARY KEY,
  trigger             TEXT NOT NULL,     -- 'session_close'|'job_complete'|'idle'
  entity_id           TEXT,
  project_path        TEXT,
  events_processed    INTEGER,
  relationships_added INTEGER,
  started_at          INTEGER,
  completed_at        INTEGER
)
```

---

### `_meta` — migration markers

```sql
_meta (
  key   TEXT PRIMARY KEY,
  value TEXT
)
```

Keys:
- `migrated_from_file_adapter` — set after one-shot migration from `FileMemoryProvider`

---

## TypeScript query interfaces

```typescript
interface EventQuery {
  entityId?: string;
  projectPath?: string | null;   // null = global only; undefined = entity-wide
  timeRange?: { from: Date; to?: Date };
  semantic?: string;             // FTS5 + optional cosine rerank
  tags?: string[];
  minConfidence?: number;
  limit?: number;
}

interface RelationshipQuery {
  subjectEntityId?: string;
  projectPath?: string | null;
  predicate?: string;
  validAt?: Date;               // point-in-time traversal
  limit?: number;
}

interface DocQuery {
  scope?: string;               // 'global' | 'project:<path>'
  semantic?: string;
  limit?: number;
  queryEmbedding?: Float32Array; // when set, cosine-reranks FTS5 candidates
}
```

---

## Key methods on `GraphMemoryAdapter`

| Method | Purpose |
|--------|---------|
| `store(entry)` | Duck-typed: accepts `MemoryEntry` (legacy) or `EpisodicRecord` |
| `storeEpisodicEvent(record)` | Native `GraphEventRecord` insert |
| `queryGraphEvents(params)` | Returns `GraphEventRecord[]` (superset of `MemoryEntry`) |
| `storeRelationship(rel)` | Write relationship to semantic graph |
| `queryRelationships(params)` | Point-in-time relationship traversal |
| `invalidatePriorRelationship(...)` | Set `valid_until` on open relationships |
| `getUnconsolidated(entityId, projectPath, limit)` | Fetch events pending consolidation |
| `markConsolidated(eventIds)` | Set `consolidated_at` on processed events |
| `storeDocChunk(chunk)` | Upsert a doc chunk |
| `queryDocChunks(params)` | FTS5 + optional cosine rerank |
| `getDocChunkHash(sourcePath)` | Staleness check |
| `deleteDocChunksForPath(sourcePath)` | Remove stale chunks before re-index |

---

## Migration from file adapter

On first boot, if `_meta.migrated_from_file_adapter` is not set and `./data/memory/` contains JSON files matching the old `FileMemoryProvider` format, `GraphMemoryAdapter` runs `migrateFromFileAdapter()`:

- Scans JSON files → converts `MemoryEntry` → synthetic `GraphEventRecord`
  - `content` → `summary`; `category` → `tags[0]`; `createdAt` → `createdAt` (ms)
  - `coaFingerprint = "migrated"`
- Writes to `events` table; source JSON files are **kept as backup**
- Sets `_meta.migrated_from_file_adapter = "true"` to prevent re-runs
