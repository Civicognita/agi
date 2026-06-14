// Memory package — s112 CoALA+TiMem graph backend

// Layer D blockchain anchor — v0.4.0 ships only NoopAnchor (no chain calls);
// v0.6.0 adds the live Ethereum/L2 implementation through the same interface
// (defined in @agi/sdk/anchor). Per s112 t383.
export { NoopAnchor } from "./anchors/noop.js";
export type { NoopAnchorOptions } from "./anchors/noop.js";

// Layer A + B memory schema — s112 t381.
export type { EpisodicRecord, WorkingMemory } from "./episodic.js";
export { canonicalEpisodicHash, episodicToAnchor } from "./episodic.js";

export type {
  MemoryEntry,
  MemoryCategory,
  MemorySource,
  MemoryProvider,
  MemoryQueryParams,
  PruneParams,
  MemoryConfig,
} from "./types.js";
export { DEFAULT_MEMORY_CONFIG } from "./types.js";

// Graph adapter — SQLite temporal event store (replaces Cognee + file-adapter).
export { GraphMemoryAdapter } from "./graph-adapter.js";
export type {
  GraphMemoryConfig,
  GraphEventRecord,
  RelationshipRecord,
  DocChunkRecord,
  EventQuery,
  RelationshipQuery,
  DocQuery,
} from "./graph-adapter.js";

// Backward-compat alias: CompositeMemoryAdapter → GraphMemoryAdapter
export { GraphMemoryAdapter as CompositeMemoryAdapter } from "./graph-adapter.js";

// Embedding engine — Ollama-backed semantic retrieval (Phase 2).
export { EmbeddingEngine } from "./embedding-engine.js";
export type { EmbeddingEngineConfig } from "./embedding-engine.js";

// Consolidation pipeline — relationship extraction at session boundaries (Phase 4).
export { ConsolidationEngine } from "./consolidation.js";
export type { ConsolidationEngineOptions } from "./consolidation.js";

export { retrieveMemories, extractSessionMemories } from "./retrieval.js";
export type {
  MemoryInjection,
  RetrievalConfig,
  ExtractionParams,
} from "./retrieval.js";

// Layer B candidate dataset + 4-gate eval pipeline (s112 t385 G5).
export { CandidateDatasetAccumulator } from "./candidate-dataset.js";
export type {
  CandidateEntry,
  AccumulatorOptions,
  AccumulateResult,
} from "./candidate-dataset.js";
export type { GateResult } from "./gates/index.js";
export {
  gateDataQuality,
  gateReward,
  gateGovernance,
  gateRollback,
} from "./gates/index.js";
