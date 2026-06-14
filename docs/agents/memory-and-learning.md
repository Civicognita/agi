# Memory and Learning Framework

> Canonical reference for s112 (v0.4.0). Storage: SQLite `~/.agi/memory/graph.db`. Embedding: Ollama `nomic-embed-text` (FTS5 BM25 fallback). Consolidation: session/job boundaries.

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
2. Pre-filter: FTS5 `events_fts MATCH ?` → top 25 candidates
3. Cosine-rerank in TypeScript → return top `limit` (default 10)

**Off-grid fallback:** when Ollama is unavailable, `isAvailable() = false` → pure FTS5 BM25 ordering. No crash, no silent failure.

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

---

## Memory injection into context (Phase 5)

`AgentInvoker` injects memory context into each invocation's system prompt:

```
## Memory

### Recalled context (global)
- {summary}   ← up to 4 global episodic events

### Project context            ← only for project-scoped requests
- {summary}   ← up to 4 project-scoped events

### Established facts
- {predicate}: {objectLiteral} (since {date})  ← up to 3 active relationships

### Related docs               ← up to 2 chunks from .ai/ or agi/docs/
**{heading}** ({sourcePath})
{content snippet, max 200 chars}
```

Token budget: ~400 (global) + ~400 (project) + ~120 (facts) + ~400 (docs) = ~1320 tokens within the 2000-token budget.

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

## SQLite schema reference

Full schema in `docs/agents/memory-graph.md`. Key tables:

- `events` — episodic records with FTS5 index (`events_fts`)
- `relationships` — consolidated semantic graph with temporal validity
- `doc_chunks` — indexed documentation + .ai/ files with FTS5 index (`doc_chunks_fts`)
- `consolidation_log` — audit trail for consolidation runs
- `_meta` — migration markers (e.g., `migrated_from_file_adapter`)
