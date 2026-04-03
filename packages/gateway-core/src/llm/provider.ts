/**
 * LLMProvider interface — Task #49
 *
 * All LLM providers implement this interface. Callers depend only on this
 * abstraction, not on any specific SDK.
 */

import type { LLMInvokeParams, LLMResponse, LLMToolContinuationParams } from "./types.js";

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------

export interface LLMProvider {
  /**
   * Invoke the LLM with a system prompt, conversation history, and optional tools.
   */
  invoke(params: LLMInvokeParams): Promise<LLMResponse>;

  /**
   * Continue a conversation after tool execution.
   *
   * Appends the assistant's tool-use content and the tool results, then
   * invokes the model again.
   */
  continueWithToolResults(params: LLMToolContinuationParams): Promise<LLMResponse>;

  /**
   * Summarize text using a simple prompt.
   *
   * Used for session compaction and memory extraction. Not recorded in COA.
   */
  summarize(text: string, prompt: string): Promise<string>;
}

// ---------------------------------------------------------------------------
// Provider configuration
// ---------------------------------------------------------------------------

export interface LLMProviderConfig {
  /** API key (falls back to provider-specific env var). */
  apiKey?: string;
  /** Default model identifier. */
  defaultModel: string;
  /** Max response tokens. */
  maxTokens: number;
  /** Max retry attempts on transient errors. */
  maxRetries: number;
  /** Base delay for exponential backoff in ms. */
  retryBaseMs?: number;
  /** Base URL (for self-hosted or proxy deployments). */
  baseUrl?: string;
}
