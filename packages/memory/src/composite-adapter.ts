/**
 * CompositeMemoryAdapter — thin compatibility shim.
 *
 * s112: Cognee backend removed; GraphMemoryAdapter is now the single backend.
 * This file is kept so existing imports of CompositeMemoryAdapter continue
 * to work without changes in server.ts or other consumers.
 *
 * Instantiation delegates directly to GraphMemoryAdapter.
 */

import { GraphMemoryAdapter } from "./graph-adapter.js";
import type { GraphMemoryConfig } from "./graph-adapter.js";

export { GraphMemoryAdapter as CompositeMemoryAdapter };
export type { GraphMemoryConfig as CompositeMemoryConfig };

// Re-export the class under its legacy name so callers that do
// `new CompositeMemoryAdapter(config)` keep working.
export default GraphMemoryAdapter;
