// Memory package — NC 2.7 Cognee Memory Integration

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
