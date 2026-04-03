/**
 * Context Budget Guard — Task #234
 *
 * Before submitting to LLM:
 * - Cap individual tool results to max 50% of context window.
 * - Truncate at newline boundaries with marker suffix.
 * - Track aggregate context budget (4 chars ~ 1 token, 75% headroom).
 * - Pre-compact old tool outputs when over budget.
 *
 * @see openclaw/src/agents/session-tool-result-guard.ts
 * @see openclaw/src/agents/pi-embedded-runner/tool-result-context-guard.ts
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Configuration for context budget management. */
export interface ContextBudgetConfig {
  /** Total context window in tokens (default: 200,000). */
  contextWindowTokens: number;
  /** Maximum fraction of context for a single tool result (default: 0.50). */
  maxToolResultFraction: number;
  /** Headroom fraction to keep free (default: 0.25). */
  headroomFraction: number;
  /** Chars per token estimate (default: 4). */
  charsPerToken: number;
}

/** A message in the context window. */
export interface ContextMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  /** If role === "tool", the tool name. */
  toolName?: string;
  /** If true, this message can be compacted. */
  compactable?: boolean;
}

/** Result of budget enforcement. */
export interface BudgetResult {
  messages: ContextMessage[];
  totalTokens: number;
  budgetTokens: number;
  overBudget: boolean;
  compactedCount: number;
  truncatedCount: number;
}

/** Result of capping a single tool result. */
export interface CapResult {
  content: string;
  wasTruncated: boolean;
  originalTokens: number;
  cappedTokens: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: ContextBudgetConfig = {
  contextWindowTokens: 200_000,
  maxToolResultFraction: 0.50,
  headroomFraction: 0.25,
  charsPerToken: 4,
};

const TRUNCATION_MARKER = "\n\n[... truncated — content exceeds context budget ...]";
const COMPACTION_MARKER = "[Tool output compacted to save context budget]";

// ---------------------------------------------------------------------------
// ContextGuard
// ---------------------------------------------------------------------------

export class ContextGuard {
  private readonly config: ContextBudgetConfig;

  constructor(config?: Partial<ContextBudgetConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ---------------------------------------------------------------------------
  // Single tool result capping
  // ---------------------------------------------------------------------------

  /**
   * Cap a single tool result to the maximum allowed size.
   * Truncates at newline boundaries.
   */
  capToolResult(content: string): CapResult {
    const maxTokens = Math.floor(
      this.config.contextWindowTokens * this.config.maxToolResultFraction,
    );
    const maxChars = maxTokens * this.config.charsPerToken;
    const originalTokens = this.estimateTokens(content);

    if (content.length <= maxChars) {
      return {
        content,
        wasTruncated: false,
        originalTokens,
        cappedTokens: originalTokens,
      };
    }

    // Truncate at newline boundary
    const truncated = truncateAtNewline(content, maxChars);

    return {
      content: truncated + TRUNCATION_MARKER,
      wasTruncated: true,
      originalTokens,
      cappedTokens: this.estimateTokens(truncated + TRUNCATION_MARKER),
    };
  }

  // ---------------------------------------------------------------------------
  // Budget enforcement
  // ---------------------------------------------------------------------------

  /**
   * Enforce context budget across all messages.
   *
   * Steps:
   * 1. Cap individual tool results.
   * 2. Calculate total token usage.
   * 3. If over budget, compact old tool outputs.
   * 4. If still over, drop oldest compactable messages.
   */
  enforceBudget(messages: ContextMessage[]): BudgetResult {
    const budgetTokens = Math.floor(
      this.config.contextWindowTokens * (1 - this.config.headroomFraction),
    );

    let compactedCount = 0;
    let truncatedCount = 0;

    // Step 1: Cap individual tool results
    const capped = messages.map((msg) => {
      if (msg.role === "tool") {
        const result = this.capToolResult(msg.content);
        if (result.wasTruncated) truncatedCount++;
        return { ...msg, content: result.content };
      }
      return { ...msg };
    });

    // Step 2: Calculate total
    let totalTokens = capped.reduce(
      (sum, msg) => sum + this.estimateTokens(msg.content),
      0,
    );

    if (totalTokens <= budgetTokens) {
      return {
        messages: capped,
        totalTokens,
        budgetTokens,
        overBudget: false,
        compactedCount,
        truncatedCount,
      };
    }

    // Step 3: Compact old tool outputs (oldest first)
    for (let i = 0; i < capped.length; i++) {
      if (totalTokens <= budgetTokens) break;

      const msg = capped[i]!;
      if (msg.role === "tool" && msg.compactable !== false) {
        const oldTokens = this.estimateTokens(msg.content);
        const compacted = COMPACTION_MARKER;
        const newTokens = this.estimateTokens(compacted);

        capped[i] = { ...msg, content: compacted };
        totalTokens -= oldTokens - newTokens;
        compactedCount++;
      }
    }

    // Step 4: If still over, drop oldest compactable non-tool messages
    if (totalTokens > budgetTokens) {
      for (let i = 0; i < capped.length; i++) {
        if (totalTokens <= budgetTokens) break;

        const msg = capped[i]!;
        if (msg.compactable === true) {
          totalTokens -= this.estimateTokens(msg.content);
          capped.splice(i, 1);
          compactedCount++;
          i--; // Adjust index after splice
        }
      }
    }

    return {
      messages: capped,
      totalTokens,
      budgetTokens,
      overBudget: totalTokens > budgetTokens,
      compactedCount,
      truncatedCount,
    };
  }

  // ---------------------------------------------------------------------------
  // Token estimation
  // ---------------------------------------------------------------------------

  /** Estimate token count for a string. */
  estimateTokens(text: string): number {
    return Math.ceil(text.length / this.config.charsPerToken);
  }

  /** Get the usable budget in tokens (after headroom). */
  get usableBudget(): number {
    return Math.floor(
      this.config.contextWindowTokens * (1 - this.config.headroomFraction),
    );
  }

  /** Get the max tool result size in tokens. */
  get maxToolResultTokens(): number {
    return Math.floor(
      this.config.contextWindowTokens * this.config.maxToolResultFraction,
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Truncate a string at the nearest newline boundary before maxChars.
 * If no newline found in the last 20% of the limit, truncate at maxChars.
 */
function truncateAtNewline(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;

  // Look for last newline within bounds
  const searchStart = Math.floor(maxChars * 0.8);
  const searchRegion = text.slice(searchStart, maxChars);
  const lastNewline = searchRegion.lastIndexOf("\n");

  if (lastNewline >= 0) {
    return text.slice(0, searchStart + lastNewline);
  }

  // No newline found — hard truncate
  return text.slice(0, maxChars);
}
