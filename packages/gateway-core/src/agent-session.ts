/**
 * Agent Session Manager — Task #112 + #113
 *
 * In-memory session store for entity conversations. Sessions do not persist
 * across gateway restarts. Includes context compaction at 75% of the
 * configured context window.
 *
 * @see docs/governance/agent-invocation-spec.md §5
 */

import { randomUUID } from "node:crypto";

import { estimateTokens } from "./system-prompt.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ImageRef {
  imageId: string;
  mediaType: string;
  /** Estimated tokens for this image (~1600 per 768px tile). */
  estimatedTokens: number;
}

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  coaFingerprint: string;
  toolsUsed?: string[];
  imageRefs?: ImageRef[];
}

export interface AgentSession {
  sessionId: string;
  entityId: string;
  coaAlias: string;
  channel: string;
  createdAt: string;
  lastActivityAt: string;
  turns: ConversationTurn[];
  compactedAt?: string;
  compactionCount: number;
  isCompacting: boolean;
}

export interface SessionManagerConfig {
  /** Total context window in tokens (default: 200,000). */
  contextWindowTokens: number;
  /** Reserved tokens for system prompt (default: 2,000). */
  systemPromptBudget: number;
  /** Reserved tokens for tool results per invocation (default: 20,000). */
  toolResultBudget: number;
  /** Reserved tokens for model response (default: 10,000). */
  responseBudget: number;
  /** Session idle timeout in ms (default: 24 hours). */
  idleTimeoutMs: number;
  /** Compaction threshold as fraction of context window (default: 0.75). */
  compactionThreshold: number;
  /** Sweep interval for idle session cleanup in ms (default: 5 minutes). */
  sweepIntervalMs: number;
}

export interface HistoryAssemblyResult {
  messages: Array<{ role: "user" | "assistant"; content: string; imageRefs?: ImageRef[] }>;
  tokenEstimate: number;
  turnsIncluded: number;
  needsCompaction: boolean;
}

export interface MemoryExtraction {
  sessionId: string;
  entityId: string;
  extractedAt: string;
  sessionSummary: string;
  topicsDiscussed: string[];
  turnsCount: number;
  compactionCount: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const PROVIDER_CONTEXT_WINDOWS: Record<string, number> = {
  anthropic: 200_000,
  openai: 128_000,
  ollama: 32_000,
  "hf-local": 4_096,
};

const DEFAULT_CONFIG: SessionManagerConfig = {
  contextWindowTokens: 32_000,
  systemPromptBudget: 2_000,
  toolResultBudget: 8_000,
  responseBudget: 4_000,
  idleTimeoutMs: 24 * 60 * 60 * 1000, // 24 hours
  compactionThreshold: 0.75,
  sweepIntervalMs: 5 * 60 * 1000, // 5 minutes
};

// ---------------------------------------------------------------------------
// Compaction prompt (minimal — no persona, no tools)
// ---------------------------------------------------------------------------

const COMPACTION_PROMPT =
  "Summarize the following conversation in 300 words or fewer. Capture key decisions, open questions, and any commitments made. Do not include pleasantries. Output plain text only.";

// ---------------------------------------------------------------------------
// AgentSessionManager
// ---------------------------------------------------------------------------

export class AgentSessionManager {
  private readonly sessions = new Map<string, AgentSession>();
  private readonly config: SessionManagerConfig;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config?: Partial<SessionManagerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /** Start the idle session sweep timer. */
  startSweep(): void {
    if (this.sweepTimer !== null) return;
    this.sweepTimer = setInterval(() => {
      this.sweepIdleSessions();
    }, this.config.sweepIntervalMs);
    // Unref so the timer doesn't prevent process exit
    if (typeof this.sweepTimer === "object" && "unref" in this.sweepTimer) {
      this.sweepTimer.unref();
    }
  }

  /** Stop the idle session sweep timer. */
  stopSweep(): void {
    if (this.sweepTimer !== null) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Session CRUD
  // ---------------------------------------------------------------------------

  /**
   * Get or create a session for an entity on a channel.
   * Sessions are keyed by entityId (one session per entity across channels).
   */
  getOrCreate(entityId: string, coaAlias: string, channel: string): AgentSession {
    const existing = this.sessions.get(entityId);
    if (existing !== undefined) {
      existing.lastActivityAt = new Date().toISOString();
      return existing;
    }

    const session: AgentSession = {
      sessionId: randomUUID(),
      entityId,
      coaAlias,
      channel,
      createdAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      turns: [],
      compactionCount: 0,
      isCompacting: false,
    };

    this.sessions.set(entityId, session);
    return session;
  }

  /** Get a session by entity ID. */
  get(entityId: string): AgentSession | undefined {
    return this.sessions.get(entityId);
  }

  /** Check if a session exists for an entity. */
  has(entityId: string): boolean {
    return this.sessions.has(entityId);
  }

  /** Get all active sessions (snapshot). */
  getAll(): AgentSession[] {
    return [...this.sessions.values()];
  }

  /** Get active session count. */
  get count(): number {
    return this.sessions.size;
  }

  // ---------------------------------------------------------------------------
  // Turn management
  // ---------------------------------------------------------------------------

  /** Add a user turn to a session. */
  addUserTurn(
    entityId: string,
    content: string,
    coaFingerprint: string,
    imageRefs?: ImageRef[],
  ): void {
    const session = this.sessions.get(entityId);
    if (session === undefined) return;

    session.turns.push({
      role: "user",
      content,
      timestamp: new Date().toISOString(),
      coaFingerprint,
      imageRefs: imageRefs?.length ? imageRefs : undefined,
    });
    session.lastActivityAt = new Date().toISOString();
  }

  /** Add an assistant turn to a session. */
  addAssistantTurn(
    entityId: string,
    content: string,
    coaFingerprint: string,
    toolsUsed?: string[],
  ): void {
    const session = this.sessions.get(entityId);
    if (session === undefined) return;

    session.turns.push({
      role: "assistant",
      content,
      timestamp: new Date().toISOString(),
      coaFingerprint,
      toolsUsed,
    });
    session.lastActivityAt = new Date().toISOString();
  }

  // ---------------------------------------------------------------------------
  // History assembly
  // ---------------------------------------------------------------------------

  /**
   * Assemble conversation history for an API call.
   *
   * Rules:
   * - Include turns in chronological order (oldest first in final array).
   * - Select turns newest-first until the budget is exhausted.
   * - Always include the current inbound turn as the final user message.
   * - If a turn pair cannot fit, exclude the pair entirely.
   * - Minimum 2 turns (1 pair) always included.
   */
  assembleHistory(
    entityId: string,
    systemPromptTokens: number,
  ): HistoryAssemblyResult {
    const session = this.sessions.get(entityId);
    if (session === undefined) {
      return { messages: [], tokenEstimate: 0, turnsIncluded: 0, needsCompaction: false };
    }

    const historyBudget =
      this.config.contextWindowTokens -
      systemPromptTokens -
      this.config.toolResultBudget -
      this.config.responseBudget;

    const totalHistoryTokens = session.turns.reduce(
      (sum, t) => sum + estimateTokens(t.content) + estimateImageRefsTokens(t.imageRefs),
      0,
    );

    const usedRatio =
      (totalHistoryTokens + systemPromptTokens) / this.config.contextWindowTokens;
    const needsCompaction = usedRatio >= this.config.compactionThreshold;

    // Select turns within budget (newest first, then reverse for chronological order)
    const selected: ConversationTurn[] = [];
    let usedTokens = 0;

    // Walk backwards through turns, collecting pairs
    for (let i = session.turns.length - 1; i >= 0; i--) {
      const turn = session.turns[i]!;
      const turnTokens = estimateTokens(turn.content) + estimateImageRefsTokens(turn.imageRefs);

      if (usedTokens + turnTokens > historyBudget && selected.length >= 2) {
        break;
      }

      selected.unshift(turn);
      usedTokens += turnTokens;
    }

    // Ensure minimum of 2 turns
    if (selected.length < 2 && session.turns.length >= 2) {
      const lastTwo = session.turns.slice(-2);
      return {
        messages: lastTwo.map((t) => ({ role: t.role, content: t.content, imageRefs: t.imageRefs })),
        tokenEstimate: lastTwo.reduce((s, t) => s + estimateTokens(t.content) + estimateImageRefsTokens(t.imageRefs), 0),
        turnsIncluded: 2,
        needsCompaction,
      };
    }

    return {
      messages: selected.map((t) => ({ role: t.role, content: t.content, imageRefs: t.imageRefs })),
      tokenEstimate: usedTokens,
      turnsIncluded: selected.length,
      needsCompaction,
    };
  }

  // ---------------------------------------------------------------------------
  // Compaction — Task #113
  // ---------------------------------------------------------------------------

  /**
   * Compact a session by replacing old turns with a summary.
   *
   * The caller must provide a `summarize` function that calls the Anthropic API
   * with COMPACTION_PROMPT. This keeps the session manager API-agnostic.
   *
   * @param entityId - The entity whose session to compact.
   * @param summarize - Async function that summarizes text via API.
   * @returns The summary text, or null if compaction was skipped.
   */
  async compact(
    entityId: string,
    summarize: (conversationText: string, prompt: string) => Promise<string>,
  ): Promise<string | null> {
    const session = this.sessions.get(entityId);
    if (session === undefined) return null;
    if (session.isCompacting) return null;

    session.isCompacting = true;

    try {
      // Build conversation text for summarization
      const conversationText = session.turns
        .map((t) => `${t.role}: ${t.content}`)
        .join("\n\n");

      const summary = await summarize(conversationText, COMPACTION_PROMPT);

      // Replace turns with a single synthetic assistant turn containing the summary
      const syntheticTurn: ConversationTurn = {
        role: "assistant",
        content: `[Session compacted — summary of prior conversation]\n\n${summary}`,
        timestamp: new Date().toISOString(),
        coaFingerprint: session.turns.at(-1)?.coaFingerprint ?? "",
      };

      session.turns = [syntheticTurn];
      session.compactedAt = new Date().toISOString();
      session.compactionCount++;

      return summary;
    } finally {
      session.isCompacting = false;
    }
  }

  /** Get the compaction prompt (exposed for the API client to use). */
  getCompactionPrompt(): string {
    return COMPACTION_PROMPT;
  }

  // ---------------------------------------------------------------------------
  // Session close + memory extraction
  // ---------------------------------------------------------------------------

  /**
   * Close a session and extract memory.
   *
   * The caller must provide a `summarize` function for the extraction API call
   * (same interface as compaction).
   *
   * @returns MemoryExtraction or null if session not found.
   */
  async closeSession(
    entityId: string,
    summarize?: (conversationText: string, prompt: string) => Promise<string>,
  ): Promise<MemoryExtraction | null> {
    const session = this.sessions.get(entityId);
    if (session === undefined) return null;

    // Wait for compaction to finish
    if (session.isCompacting) return null;

    let sessionSummary = "";

    // Generate summary if we have turns and a summarizer
    if (session.turns.length > 0 && summarize !== undefined) {
      const conversationText = session.turns
        .map((t) => `${t.role}: ${t.content}`)
        .join("\n\n");

      try {
        sessionSummary = await summarize(
          conversationText,
          "Summarize this conversation in 3-5 sentences. Capture the main topics, any decisions made, and unresolved questions.",
        );
      } catch {
        // If summarization fails, extract a basic summary from turns
        sessionSummary = `Session with ${String(session.turns.length)} turns. Last activity: ${session.lastActivityAt}`;
      }
    }

    // Extract topics from turns
    const topicsDiscussed = extractTopics(session.turns);

    const extraction: MemoryExtraction = {
      sessionId: session.sessionId,
      entityId: session.entityId,
      extractedAt: new Date().toISOString(),
      sessionSummary,
      topicsDiscussed,
      turnsCount: session.turns.length,
      compactionCount: session.compactionCount,
    };

    // Remove session
    this.sessions.delete(entityId);

    return extraction;
  }

  // ---------------------------------------------------------------------------
  // Idle session sweep
  // ---------------------------------------------------------------------------

  /**
   * Find and close idle sessions (>24h since last activity).
   * Returns entity IDs of closed sessions.
   */
  sweepIdleSessions(): string[] {
    const now = Date.now();
    const closed: string[] = [];

    for (const [entityId, session] of this.sessions) {
      const lastActive = new Date(session.lastActivityAt).getTime();
      const idleMs = now - lastActive;

      if (idleMs >= this.config.idleTimeoutMs && !session.isCompacting) {
        this.sessions.delete(entityId);
        closed.push(entityId);
      }
    }

    return closed;
  }

  /** Destroy all sessions (for gateway shutdown). */
  destroy(): void {
    this.stopSweep();
    this.sessions.clear();
  }
}

// ---------------------------------------------------------------------------
// Image token estimation
// ---------------------------------------------------------------------------

/**
 * Estimate token cost for a base64-encoded image.
 * Claude charges ~1600 tokens per 768px tile. Without decoding pixel
 * dimensions, we approximate from byte size: ~200KB per tile.
 */
export function estimateImageTokens(base64Data: string): number {
  const bytes = base64Data.length * 0.75;
  const tiles = Math.max(1, Math.ceil(bytes / 200_000));
  return tiles * 1600;
}

/** Sum estimated tokens for a set of image refs (0 if none). */
function estimateImageRefsTokens(refs?: ImageRef[]): number {
  if (!refs?.length) return 0;
  return refs.reduce((sum, r) => sum + r.estimatedTokens, 0);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract basic topic keywords from conversation turns. */
function extractTopics(turns: ConversationTurn[]): string[] {
  // Simple heuristic: extract unique nouns/phrases from user messages
  const userContent = turns
    .filter((t) => t.role === "user")
    .map((t) => t.content)
    .join(" ");

  // Extract words >4 chars, deduplicate, take top 10
  const words = userContent
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 4);

  const freq = new Map<string, number>();
  for (const w of words) {
    freq.set(w, (freq.get(w) ?? 0) + 1);
  }

  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word]) => word);
}
