# Memory and Learning Framework

> Canonical reference for s112 + s234 (v0.4.0). Storage: **PostgreSQL** (`agi_data`) with **pgvector** `vector(768)` embeddings and a GIN `tsvector` full-text index. Embedding: Ollama `nomic-embed-text` (FTS BM25 fallback). Consolidation: session/job boundaries.
>
> **Two axes.** Memory is organised on two orthogonal axes: the **CoALA cognitive** axis (working → episodic → semantic → procedural, below) and the **s234 locality** axis (prime → gestalt → project → provider → room — see *Locality scopes*). A memory has both a cognitive layer and a `scope`.

---

## Architecture overview

Aion's memory system is a **CoALA + TiMem hybrid** — the cognitive taxonomy of CoALA (4-layer agent memory) merged with TiMem's temporal-hierarchical graph (raw events → consolidated semantic relationships with validity windows).

### The four layers

| Layer | Name | What lives here | Storage |
|-------|------|-----------------|---------|
| A | Working memory | Current conversation context (messages, tool calls) | In-process `AgentSession` |
| B | Episodic memory | Fire-and-forget extraction after each invocation | SQLite `events` table |
| B→C | Semantic graph | Consolidated relationship triples (Layer B→semantic bridge) | SQLite `relationships` table |
| C | PRIME (procedural) | Hardened knowledge files — persona, purpose, directives | File system (`aionima-prime/`) |

Layer D (blockchain anchor) is stubbed as `NoopAnchor` in v0.4.0; a live Ethereum/L2 implementation is planned for v0.6.0.

---

## Locality scopes (s234)

Every memory (`memory_events` + `memory_relationships`) carries a **`scope`** — *where* it was formed — on a unified scope-path. This is the locality axis, orthogonal to the cognitive layers above. Helpers live in `gateway-core/src/memory-scope.ts`.

| Layer | Scope string | Meaning | Writable? |
|-------|--------------|---------|-----------|
| InGrained | `prime` | PRIME doctrine from `aionima-prime` (doc-chunks). Universal. | **Read-only** (never written by the pipeline) |
| Gestalt | `gestalt` | Machine-wide shared substrate (Owner-governed). Was the pre-s234 `global`/`null` tier. | yes |
| Project | `project:<projectPath>` | Per-project (`.ai/memory` + project events). | yes |
| Channel Provider | `provider:<channelId>` | Per integration (discord, gmail, …). | yes |
| Room/Thread | `room:<channelId>:<roomId>` | A Discord channel/DM, Gmail contact-thread, etc. `roomId` is free-form. | yes |

**Recall = scope-stack cascade.** A request resolves an ordered scope-stack from its `channelContext` + `projectContext` (`resolveScopeStack`):

| Request origin | Stack (most-specific → broadest) |
|----------------|----------------------------------|
| Discord room in a bound project | `[room:P:R, provider:P, project:J, gestalt, prime]` |
| Project chat (no channel) | `[project:J, gestalt, prime]` |
| Bare chat | `[gestalt, prime]` |

A memory is recallable **iff its `scope` is in the request's stack**. That single rule gives both behaviours: broader layers cascade **down** (gestalt/prime are in every stack); narrower layers stay **confined** (`room:P:R` is in no other stack — a DM secret never leaks into another channel). `graph-adapter` queries take a `scopes[]` filter; `agent-invoker` Phase 5 builds the stack and labels each memory by locality.

**Write (`resolveWriteScope`).** A channel turn confines to `room:<channelId>:<roomId>`; otherwise `project:<path>`; otherwise `gestalt`. Never `prime`. The `episode-extractor` stamps this on every captured record; consolidation inherits it so facts stay confined.

**Owner cascade-up policy** (`gateway.json → memory.cascade`, hot-reloaded). Default = confined. Per-layer `reachUpTo` promotes new memories of that layer to a broader scope at write time (recall stays the pure stack rule):

```jsonc
"memory": { "cascade": {
  "room":     { "reachUpTo": "provider" },
  "provider": { "reachUpTo": "gestalt"  },
  "project":  { "reachUpTo": "gestalt"  }
} }
```

**Guards.** PRIME is read-only — `insertEvent`/`storeRelationship` coerce any `prime` write down to `gestalt`. **Sacred projects** (agi/prime/id/marketplaces + PAx) can never be driven from a Channel: `addRoomBinding` refuses the binding and `ChannelEventDispatcher.dispatch` refuses a sacred project even with a stale binding.

The dashboard **Aion's Mind** page (`/memory`) shows each memory's locality badge.

---

## Episodic pipeline (Layer B)

After every successful chat turn, `EpisodeExtractor.extractAndStore()` runs **fire-and-forget**:

1. **Extract** — short LLM call produces `{ summary, decisions, preferences, facts, tags }` from the exchange
2. **Score** — second LLM call rates `{ useful, aligned, correct }` → `confidence`
3. **Hash** — canonical SHA-256 hash for dedup
4. **Anchor** — `NoopAnchor.anchor()` (no-op in v0.4.0)
5. **Store** — `GraphMemoryAdapter.store()` → `events` table
6. **Accumulate** — 4-gate eval pipeline for training dataset admission
7. **Consolidate** — triggers `ConsolidationEngine.maybeConsolidate()` at session boundary

`EpisodicRecord` key fields:
- `id` — ULID
- `summary` — plain-language digest of the exchange
- `tags` — categorical retrieval labels
- `confidence` — 0..1, scorer-assigned quality score
- `primeAlignment` — optional G2 PRIME alignment score
- `hash` — SHA-256 for dedup and anchor reference
- `coaFingerprint` — links to the COA chain of the originating action
- `projectPath` — `null` for global events; path string for project-scoped

---

## Consolidation pipeline (Layer B→semantic bridge)

At session/job/idle boundaries, `ConsolidationEngine.maybeConsolidate()` runs:

1. Fetches unconsolidated events (`consolidated_at IS NULL`) — minimum 3 before running
2. Calls LLM with `consolidation-extract.md` prompt → JSON array of relationship triples
3. For definitive relationships (no `validUntil`): invalidates any prior open relationship with same `subject+predicate+scope`
4. Writes `RelationshipRecord` entries with `valid_from`/`valid_until` temporal windows and `sourceEventIds` provenance
5. Marks events as consolidated; writes to `consolidation_log`

**Predicate vocabulary (closed set):**
`worked_on` | `decided` | `learned` | `used_tool` | `blocked_by` | `completed` | `discovered` | `prefers` | `created` | `fixed`

Trigger sites:
- `EpisodeExtractor.extractAndStore()` — post-invocation
- `IterativeWorkScheduler.recordCompletion()` — job completion
- Server idle timer — every 30 minutes

---

## Embedding + retrieval (Phase 2)

`EmbeddingEngine` wraps Ollama's `/api/embeddings` endpoint:
- Default model: `nomic-embed-text` (768 dims, Apache 2.0)
- Alternative: `all-minilm:l6-v2` (384 dims, faster)
- Config: `gateway.json` → `memory.embeddingModel`

**Query path:**
1. Embed the query text via `EmbeddingEngine.embed()`
2. Pre-filter: Postgres `plainto_tsquery` over the generated `tsvector` (GIN index) → top candidates
3. Cosine-rerank in TypeScript over the pgvector embeddings → return top `limit` (default 10)

**Off-grid fallback:** when Ollama is unavailable, `isAvailable() = false` → pure `ts_rank` ordering. No crash, no silent failure.

---

## Doc indexer (Phase 3)

`DocIndexer` indexes markdown files into the `doc_chunks` table at gateway boot:

| Source | Scope |
|--------|-------|
| `agi/docs/**/*.md` | `global` |
| `_aionima/.ai/**/*.md` | `global` |
| `<projectRoot>/.ai/**/*.md` | `project:<projectRoot>` |

**Chunking:** split at H1/H2/H3 boundaries, 100–800 char range. Larger sections split by paragraph.

**Staleness detection:** SHA-256 content hash per file. Unchanged files are skipped.

**`search_docs` tool:** always available (no state/tier gate); semantic query over doc chunks.

**`search_memory` tool:** always available (no state/tier gate); active recall over the
episodic store (`memory_events`) — the same `GraphMemoryAdapter` the dashboard "Aion's Mind"
browser reads. Before this tool, episodic memory was only injected *passively* at
prompt-assembly (see Phase 5 below), so the agent could not query its own memories on demand;
`search_memory` closes that gap. Takes `query` (optional — empty returns most-recent), `limit`,
`projectPath`, `tags`, `minConfidence`.

> **Capture prerequisite — the prompts must load.** `EpisodeExtractor` loads
> `prompts/episode-extract.md` + `episode-score.md` at module init; if they fail to resolve,
> `EXTRACT_PROMPT` is empty and **every** extraction returns null → `memory_events` stays empty
> forever. The prompts-dir is resolved by walking up from `import.meta.url` (the relative depth
> differs between the `gateway-core/dist` and `cli/dist` bundles — the gateway runs the cli
> bundle). On failure the gateway logs `episodic memory DEGRADED` at boot, and the extractor
> keeps a stored/skipped tally so a silently-empty capture layer is visible in logs.

---

## Memory injection into context (Phase 5)

`AgentInvoker` injects memory context into each invocation's system prompt:

```
## Memory

### This room/thread          ← memories confined to the current room/DM/thread
- {summary}

### This channel              ← memories shared across the current channel provider
- {summary}

### Project context           ← memories scoped to the current project
- {summary}

### Recalled context (machine-wide)   ← the gestalt layer
- {summary}

### Established facts
- {predicate}: {objectLiteral} (since {date})  ← up to 3 active relationships

### Related docs               ← up to 2 chunks from .ai/ or agi/docs/
**{heading}** ({sourcePath})
{content snippet, max 200 chars}
```

Episodic events are queried across the request's full scope-stack (up to ~8) and rendered most-specific-first; only the tiers present in the stack appear. Token budget stays within ~2000.

---

## Training dataset pipeline (4-gate eval, Phase G5)

Each stored `EpisodicRecord` runs through `CandidateDatasetAccumulator` which applies 4 gates:

| Gate | Purpose | Cutoff |
|------|---------|--------|
| G1 Data Quality | Rejects malformed/trivial entries | confidence < 0.3 |
| G2 PRIME Alignment | Checks alignment with PRIME directives | primeAlignment < 0.4 |
| G3 Governance | Filters PII, harmful content, policy violations | hard block |
| G4 Rollback | Removes duplicates and contradictions | hash collision |

Admitted entries accumulate in a monthly dataset file. Future iteration: LoRA fine-tuning on admitted candidates to close the self-improvement loop.

---

## PostgreSQL schema reference

Schema in `packages/db-schema/src/memory.ts`; additive migrations apply via `scripts/migrate-db.sh` (NOT drizzle-kit). Key tables (all on `agi_data`, pgvector + GIN tsvector):

- `memory_events` — episodic records; `embedding vector(768)`; **`scope`** locality column (s234)
- `memory_relationships` — consolidated semantic graph with temporal validity (`valid_from`/`valid_until`); **`scope`** column
- `memory_doc_chunks` — indexed `agi/docs/` + `k/`/`.ai/` files; `scope` ∈ `gestalt | project:<path> | prime`
- `memory_consolidation_log` — audit trail for consolidation runs
