// Memory package — NC 2.7 Cognee Memory Integration

// Layer D blockchain anchor — v0.4.0 ships only NoopAnchor (no chain calls);
// v0.6.0 adds the live Ethereum/L2 implementation through the same interface
// (defined in @agi/sdk/anchor). Per s112 t383.
export { NoopAnchor } from "./anchors/noop.js";
export type { NoopAnchorOptions } from "./anchors/noop.js";

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

export { FileMemoryProvider } from "./file-adapter.js";

export { CogneeMemoryProvider } from "./cognee-adapter.js";
export type { CogneeConfig } from "./cognee-adapter.js";

export { CompositeMemoryAdapter } from "./composite-adapter.js";

export { retrieveMemories, extractSessionMemories } from "./retrieval.js";
export type {
  MemoryInjection,
  RetrievalConfig,
  ExtractionParams,
} from "./retrieval.js";
