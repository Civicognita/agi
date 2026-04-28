/**
 * Provider-agnostic LLM types — Task #49
 *
 * Replaces @anthropic-ai/sdk types throughout the codebase.
 * All providers translate to/from these types.
 */

// ---------------------------------------------------------------------------
// Message types
// ---------------------------------------------------------------------------

export interface LLMMessage {
  role: "user" | "assistant" | "system";
  content: string | LLMContentBlock[];
}

export interface LLMContentBlock {
  type: "text" | "tool_use" | "tool_result" | "image" | "thinking";
  // text block
  text?: string;
  // tool_use block
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  // tool_result block
  tool_use_id?: string;
  content?: string;
  // image block
  source?: {
    type: "base64";
    media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
    data: string;
  };
  // thinking block
  thinking?: string;
  signature?: string;
}

// ---------------------------------------------------------------------------
// Tool types
// ---------------------------------------------------------------------------

export interface LLMToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface LLMToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface LLMToolResult {
  tool_use_id: string;
  content: string;
}

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export interface LLMResponse {
  /** Concatenated text from all text blocks. */
  text: string;
  /** Tool calls requested by the model. */
  toolCalls: LLMToolCall[];
  /** Raw content blocks (needed for tool continuation). */
  contentBlocks: LLMContentBlock[];
  /** Stop reason (e.g. "end_turn", "tool_use", "stop"). */
  stopReason: string | null;
  /** Token usage for billing and rate limiting. */
  usage: { inputTokens: number; outputTokens: number };
  /** Model identifier that was used. */
  model: string;
  /** Thinking blocks from extended thinking (if enabled). */
  thinkingBlocks: Array<{ thinking: string; signature: string }>;
  /** Routing metadata — populated by AgentRouter, undefined when using a direct provider. */
  routingMeta?: {
    costMode: string;
    complexity: string;
    selectedModel: string;
    selectedProvider: string;
    escalated: boolean;
    reason: string;
    /** Dynamic-context request type (chat/project/entity/...). Attached by agent-invoker. */
    requestType?: string;
    /** How the request type was determined. */
    classifierUsed?: "heuristic" | "aion-micro";
    /** Context layers included in the assembled system prompt (e.g. ["identity", "project"]). */
    contextLayers?: string[];
  };
}

// ---------------------------------------------------------------------------
// Invocation parameter types
// ---------------------------------------------------------------------------

export interface LLMInvokeParams {
  /** System prompt. */
  system: string;
  /** Conversation messages. */
  messages: LLMMessage[];
  /** Tool definitions for the model. */
  tools?: LLMToolDefinition[];
  /** Entity ULID (used for metadata, e.g. hashed user_id). */
  entityId: string;
  /** Model override. */
  model?: string;
  /** Max response tokens override. */
  maxTokens?: number;
  /** Extended thinking configuration. */
  thinking?: { type: "enabled"; budget_tokens: number } | { type: "disabled" };
}

export interface LLMToolContinuationParams {
  /** Original invocation parameters. */
  original: LLMInvokeParams;
  /** The assistant's content blocks (including tool_use blocks). */
  assistantContent: LLMContentBlock[];
  /** Tool results to send back. */
  toolResults: LLMToolResult[];
}
