/**
 * Anthropic API Client — Task #111
 *
 * Direct Anthropic API integration. Wraps the @anthropic-ai/sdk package
 * with retry logic, streaming support, and BAIF-specific metadata.
 *
 * @see docs/governance/agent-invocation-spec.md §7
 */

import { createHash } from "node:crypto";

import Anthropic from "@anthropic-ai/sdk";
import type {
  MessageParam,
  ContentBlock,
  ToolUseBlock,
  ToolResultBlockParam,
  Tool,
  TextBlock,
} from "@anthropic-ai/sdk/resources/messages.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AnthropicClientConfig {
  /** API key. Falls back to ANTHROPIC_API_KEY env var. */
  apiKey?: string;
  /** Default model (e.g. "claude-sonnet-4-6"). */
  defaultModel: string;
  /** Max response tokens (default: 8192). */
  maxTokens: number;
  /** Max retry attempts on transient errors (default: 3). */
  maxRetries: number;
  /** Base delay for exponential backoff in ms (default: 1000). */
  retryBaseMs: number;
}

export interface InvokeParams {
  /** System prompt (assembled by system-prompt.ts). */
  system: string;
  /** Conversation messages. */
  messages: MessageParam[];
  /** Tool definitions for the model. */
  tools?: Tool[];
  /** Entity ULID (will be hashed for metadata.user_id). */
  entityId: string;
  /** Model override (default: config.defaultModel). */
  model?: string;
  /** Max tokens override. */
  maxTokens?: number;
}

export interface InvokeResult {
  /** Response text content (concatenated text blocks). */
  text: string;
  /** Tool use blocks returned by the model. */
  toolUses: ToolUseBlock[];
  /** Raw content blocks from the API response (for tool continuation). */
  contentBlocks: ContentBlock[];
  /** Stop reason from the API. */
  stopReason: string | null;
  /** Token usage. */
  usage: { inputTokens: number; outputTokens: number };
  /** Model that was used. */
  model: string;
}

export interface ToolContinuationParams {
  /** Original invoke params (system, messages, tools, entityId). */
  original: InvokeParams;
  /** The assistant message containing tool use blocks. */
  assistantContent: ContentBlock[];
  /** Tool results to feed back. */
  toolResults: ToolResultBlockParam[];
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: AnthropicClientConfig = {
  defaultModel: "claude-sonnet-4-6",
  maxTokens: 8192,
  maxRetries: 3,
  retryBaseMs: 1000,
};

// ---------------------------------------------------------------------------
// Retryable error detection
// ---------------------------------------------------------------------------

function isRetryable(err: unknown): boolean {
  if (err instanceof Anthropic.APIError) {
    // 429 (rate limit), 500, 502, 503, 529 (overloaded) are retryable
    return [429, 500, 502, 503, 529].includes(err.status);
  }
  // Network errors
  if (err instanceof Error && err.message.includes("fetch failed")) {
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// AnthropicClient
// ---------------------------------------------------------------------------

export class AnthropicClient {
  private readonly client: Anthropic;
  private readonly config: AnthropicClientConfig;

  constructor(config?: Partial<AnthropicClientConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.client = new Anthropic({
      apiKey: this.config.apiKey,
    });
  }

  // ---------------------------------------------------------------------------
  // Main invocation
  // ---------------------------------------------------------------------------

  /**
   * Invoke the Anthropic API with BAIF context.
   *
   * Handles retries with exponential backoff for transient errors.
   */
  async invoke(params: InvokeParams): Promise<InvokeResult> {
    const model = params.model ?? this.config.defaultModel;
    const maxTokens = params.maxTokens ?? this.config.maxTokens;

    // Hash entityId for metadata.user_id (per spec §7)
    const userIdHash = createHash("sha256")
      .update(params.entityId)
      .digest("hex");

    const requestBody = {
      model,
      max_tokens: maxTokens,
      system: params.system,
      messages: params.messages,
      tools: params.tools,
      metadata: { user_id: userIdHash },
    };

    let lastError: unknown;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const response = await this.client.messages.create(requestBody);

        return parseResponse(response);
      } catch (err) {
        lastError = err;

        if (!isRetryable(err) || attempt === this.config.maxRetries) {
          throw err;
        }

        // Exponential backoff: base * 2^attempt with jitter
        const delay =
          this.config.retryBaseMs * Math.pow(2, attempt) +
          Math.floor(Math.random() * 500);
        await sleep(delay);
      }
    }

    throw lastError;
  }

  // ---------------------------------------------------------------------------
  // Tool continuation
  // ---------------------------------------------------------------------------

  /**
   * Continue an invocation after tool execution.
   *
   * Appends the assistant's tool-use message and the tool results to the
   * conversation, then calls the API again.
   */
  async continueWithToolResults(
    params: ToolContinuationParams,
  ): Promise<InvokeResult> {
    const continuationMessages: MessageParam[] = [
      ...params.original.messages,
      { role: "assistant", content: params.assistantContent },
      { role: "user", content: params.toolResults },
    ];

    return this.invoke({
      ...params.original,
      messages: continuationMessages,
    });
  }

  // ---------------------------------------------------------------------------
  // Summarization (for compaction + session close)
  // ---------------------------------------------------------------------------

  /**
   * Summarize text using a minimal prompt.
   *
   * Used for session compaction and memory extraction. This is a separate,
   * non-logged API call (no COA record).
   */
  async summarize(text: string, prompt: string): Promise<string> {
    const response = await this.client.messages.create({
      model: this.config.defaultModel,
      max_tokens: 1024,
      system: prompt,
      messages: [{ role: "user", content: text }],
    });

    const textBlocks = response.content.filter(
      (b): b is TextBlock => b.type === "text",
    );
    return textBlocks.map((b) => b.text).join("\n");
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseResponse(response: Anthropic.Message): InvokeResult {
  const textBlocks = response.content.filter(
    (b): b is TextBlock => b.type === "text",
  );
  const toolUses = response.content.filter(
    (b): b is ToolUseBlock => b.type === "tool_use",
  );

  return {
    text: textBlocks.map((b) => b.text).join("\n"),
    toolUses,
    contentBlocks: response.content,
    stopReason: response.stop_reason,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
    model: response.model,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
