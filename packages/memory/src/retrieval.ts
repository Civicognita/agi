/**
 * Memory Retrieval — Task #142
 *
 * Before each agent call, retrieve relevant memories for the entity
 * and format them for injection into the agent system prompt.
 *
 * Relevance scoring based on current conversation topic.
 * Token budget enforced to prevent memory from dominating context.
 */

import type { MemoryProvider, MemoryEntry, MemoryCategory } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of memory retrieval for agent context injection. */
export interface MemoryInjection {
  /** Formatted memory block for system prompt injection. */
  promptBlock: string;
  /** Number of memories included. */
  memoriesIncluded: number;
  /** Estimated token count of the injection. */
  estimatedTokens: number;
  /** Entity ID these memories belong to. */
  entityId: string;
}

/** Configuration for retrieval. */
export interface RetrievalConfig {
  /** Maximum memories to inject per call (default: 10). */
  maxMemories: number;
  /** Maximum token budget for memory injection (default: 2000). */
  tokenBudget: number;
  /** Minimum relevance score to include (default: 0.1). */
  minRelevance: number;
  /** Priority categories (checked first). */
  priorityCategories: MemoryCategory[];
}

const DEFAULT_RETRIEVAL_CONFIG: RetrievalConfig = {
  maxMemories: 10,
  tokenBudget: 2000,
  minRelevance: 0.1,
  priorityCategories: ["preference", "decision", "fact"],
};

// ---------------------------------------------------------------------------
// Retrieval function
// ---------------------------------------------------------------------------

/**
 * Retrieve relevant memories for an entity and format for prompt injection.
 *
 * @param provider - Memory provider (composite adapter).
 * @param entityId - Entity to retrieve memories for.
 * @param conversationTopic - Current conversation context for relevance.
 * @param config - Retrieval configuration overrides.
 * @returns Formatted memory injection block.
 */
export async function retrieveMemories(
  provider: MemoryProvider,
  entityId: string,
  conversationTopic: string,
  config?: Partial<RetrievalConfig>,
): Promise<MemoryInjection> {
  const cfg: RetrievalConfig = { ...DEFAULT_RETRIEVAL_CONFIG, ...config };

  // Query for relevant memories
  const memories = await provider.query({
    entityId,
    query: conversationTopic,
    limit: cfg.maxMemories * 2, // Fetch extra for token budget filtering
    minRelevance: cfg.minRelevance,
  });

  if (memories.length === 0) {
    return {
      promptBlock: "",
      memoriesIncluded: 0,
      estimatedTokens: 0,
      entityId,
    };
  }

  // Sort: priority categories first, then by relevance
  const prioritySet = new Set(cfg.priorityCategories);
  memories.sort((a, b) => {
    const aPriority = prioritySet.has(a.category) ? 1 : 0;
    const bPriority = prioritySet.has(b.category) ? 1 : 0;
    if (aPriority !== bPriority) return bPriority - aPriority;
    return (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0);
  });

  // Select memories within token budget
  const selected: MemoryEntry[] = [];
  let totalTokens = 0;
  const headerTokens = estimateTokens(MEMORY_HEADER);

  for (const mem of memories) {
    if (selected.length >= cfg.maxMemories) break;

    const line = formatMemoryLine(mem);
    const lineTokens = estimateTokens(line);

    if (totalTokens + lineTokens + headerTokens > cfg.tokenBudget) break;

    selected.push(mem);
    totalTokens += lineTokens;
  }

  if (selected.length === 0) {
    return {
      promptBlock: "",
      memoriesIncluded: 0,
      estimatedTokens: 0,
      entityId,
    };
  }

  // Build prompt block
  const lines = selected.map(formatMemoryLine);
  const promptBlock = `${MEMORY_HEADER}\n${lines.join("\n")}`;

  return {
    promptBlock,
    memoriesIncluded: selected.length,
    estimatedTokens: totalTokens + headerTokens,
    entityId,
  };
}

// ---------------------------------------------------------------------------
// Memory extraction from session
// ---------------------------------------------------------------------------

/** Parameters for extracting memories from a closing session. */
export interface ExtractionParams {
  entityId: string;
  sessionSummary: string;
  topicsDiscussed: string[];
  turnsCount: number;
}

/**
 * Extract memory entries from a session close event.
 *
 * @param params - Session data to extract from.
 * @param now - Current timestamp (default: now).
 * @returns Array of MemoryEntry to store.
 */
export function extractSessionMemories(
  params: ExtractionParams,
  now?: string,
): Omit<MemoryEntry, "id">[] {
  const timestamp = now ?? new Date().toISOString();
  const entries: Omit<MemoryEntry, "id">[] = [];

  // Always store a conversation summary
  if (params.sessionSummary.length > 0) {
    entries.push({
      entityId: params.entityId,
      content: params.sessionSummary,
      category: "conversation",
      source: "session_close",
      createdAt: timestamp,
      lastAccessedAt: timestamp,
      accessCount: 0,
    });
  }

  // Store topic keywords as individual fact memories
  for (const topic of params.topicsDiscussed.slice(0, 5)) {
    entries.push({
      entityId: params.entityId,
      content: `Discussed topic: ${topic}`,
      category: "fact",
      source: "session_close",
      createdAt: timestamp,
      lastAccessedAt: timestamp,
      accessCount: 0,
    });
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MEMORY_HEADER = `## Entity Memory
The following are recalled memories about this entity from prior sessions:`;

function formatMemoryLine(mem: MemoryEntry): string {
  const categoryTag = `[${mem.category}]`;
  return `- ${categoryTag} ${mem.content}`;
}

/** Rough token estimation (4 chars ~ 1 token). */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
