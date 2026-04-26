/**
 * OpenAIProvider — Task #51
 *
 * Implements LLMProvider using the openai npm package (optional dependency).
 * Translates between provider-agnostic LLM types and OpenAI API types.
 *
 * Supported models: gpt-4o, gpt-4-turbo, o1, o3-mini
 *
 * NOTE: openai is an optional dependency. Import is done dynamically so that
 * gateway-core does not require it at startup.
 */

import type { LLMProvider, LLMProviderConfig } from "./provider.js";
import type {
  LLMMessage,
  LLMContentBlock,
  LLMToolDefinition,
  LLMToolCall,
  LLMToolResult,
  LLMResponse,
  LLMInvokeParams,
  LLMToolContinuationParams,
} from "./types.js";

// ---------------------------------------------------------------------------
// OpenAI type shims (avoid hard dependency on the openai package types at
// import-time; actual types are inferred at runtime)
// ---------------------------------------------------------------------------

interface OpenAIChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
  name?: string;
}

interface OpenAIToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface OpenAIChoice {
  message: {
    role: string;
    content: string | null;
    tool_calls?: OpenAIToolCall[];
  };
  finish_reason: string | null;
}

interface OpenAICompletion {
  id: string;
  model: string;
  choices: OpenAIChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
  };
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: Required<LLMProviderConfig> = {
  apiKey: "",
  defaultModel: "gpt-4o",
  maxTokens: 4096,
  maxRetries: 3,
  retryBaseMs: 1000,
  baseUrl: "https://api.openai.com/v1",
  timeoutMs: 0,
};

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUS_CODES.has(status);
}

// ---------------------------------------------------------------------------
// Translation functions
// ---------------------------------------------------------------------------

/**
 * Convert provider-agnostic LLMMessage array to OpenAI chat messages.
 * System prompt is included as the first message with role "system".
 */
export function toOpenAIMessages(
  system: string,
  messages: LLMMessage[],
): OpenAIChatMessage[] {
  const result: OpenAIChatMessage[] = [{ role: "system", content: system }];

  for (const msg of messages) {
    if (msg.role === "system") {
      // Additional system messages merged into content
      const content = typeof msg.content === "string"
        ? msg.content
        : msg.content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n");
      result.push({ role: "system", content });
      continue;
    }

    if (typeof msg.content === "string") {
      result.push({ role: msg.role as "user" | "assistant", content: msg.content });
    } else {
      // Handle structured content blocks
      const textContent = msg.content
        .filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("\n");
      const toolUseBlocks = msg.content.filter((b) => b.type === "tool_use");
      const toolResultBlocks = msg.content.filter((b) => b.type === "tool_result");

      if (toolUseBlocks.length > 0) {
        // Assistant message with tool calls
        const toolCalls: OpenAIToolCall[] = toolUseBlocks.map((b) => ({
          id: b.id ?? "",
          type: "function" as const,
          function: {
            name: b.name ?? "",
            arguments: JSON.stringify(b.input ?? {}),
          },
        }));
        result.push({
          role: "assistant",
          content: textContent || null,
          tool_calls: toolCalls,
        });
      } else if (toolResultBlocks.length > 0) {
        // Tool result messages (one per result)
        for (const block of toolResultBlocks) {
          result.push({
            role: "tool",
            tool_call_id: block.tool_use_id ?? "",
            content: block.content ?? "",
          });
        }
      } else {
        result.push({
          role: msg.role as "user" | "assistant",
          content: textContent,
        });
      }
    }
  }

  return result;
}

/**
 * Convert provider-agnostic LLMToolDefinition to OpenAI function tools format.
 */
export function toOpenAITools(tools: LLMToolDefinition[]): OpenAITool[] {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

/**
 * Convert LLMToolResult to OpenAI tool messages.
 */
export function toOpenAIToolMessages(results: LLMToolResult[]): OpenAIChatMessage[] {
  return results.map((r) => ({
    role: "tool" as const,
    tool_call_id: r.tool_use_id,
    content: r.content,
  }));
}

/**
 * Translate an OpenAI chat completion to provider-agnostic LLMResponse.
 */
export function fromOpenAICompletion(
  completion: OpenAICompletion,
): LLMResponse {
  const choice = completion.choices[0];
  if (choice === undefined) {
    return {
      text: "",
      toolCalls: [],
      contentBlocks: [],
      stopReason: null,
      usage: { inputTokens: 0, outputTokens: 0 },
      model: completion.model,
      thinkingBlocks: [],
    };
  }

  const rawContent = choice.message.content ?? "";
  const rawToolCalls = choice.message.tool_calls ?? [];

  const toolCalls: LLMToolCall[] = rawToolCalls.map((tc) => ({
    id: tc.id,
    name: tc.function.name,
    input: (() => {
      try {
        return JSON.parse(tc.function.arguments) as Record<string, unknown>;
      } catch {
        return {};
      }
    })(),
  }));

  const contentBlocks: LLMContentBlock[] = [];
  if (rawContent) {
    contentBlocks.push({ type: "text", text: rawContent });
  }
  for (const tc of toolCalls) {
    contentBlocks.push({
      type: "tool_use",
      id: tc.id,
      name: tc.name,
      input: tc.input,
    });
  }

  // Map OpenAI finish_reason to our stopReason
  let stopReason: string | null = null;
  if (choice.finish_reason === "stop") stopReason = "end_turn";
  else if (choice.finish_reason === "tool_calls") stopReason = "tool_use";
  else if (choice.finish_reason === "length") stopReason = "max_tokens";
  else if (choice.finish_reason !== null) stopReason = choice.finish_reason;

  return {
    text: rawContent,
    toolCalls,
    contentBlocks,
    stopReason,
    usage: {
      inputTokens: completion.usage?.prompt_tokens ?? 0,
      outputTokens: completion.usage?.completion_tokens ?? 0,
    },
    model: completion.model,
    thinkingBlocks: [],
  };
}

// ---------------------------------------------------------------------------
// OpenAIProvider
// ---------------------------------------------------------------------------

export class OpenAIProvider implements LLMProvider {
  private readonly config: Required<LLMProviderConfig>;

  constructor(config?: Partial<LLMProviderConfig>) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    };
  }

  // ---------------------------------------------------------------------------
  // Core request method
  // ---------------------------------------------------------------------------

  private async request(
    messages: OpenAIChatMessage[],
    tools: OpenAITool[] | undefined,
    model: string,
    maxTokens: number,
  ): Promise<OpenAICompletion> {
    const apiKey = this.config.apiKey || process.env["OPENAI_API_KEY"] || "";
    const baseUrl = this.config.baseUrl || DEFAULT_CONFIG.baseUrl;

    const body: Record<string, unknown> = {
      model,
      max_tokens: maxTokens,
      messages,
    };
    if (tools && tools.length > 0) {
      body["tools"] = tools;
    }

    let lastError: unknown;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      // Per-request deadline. timeoutMs > 0 wraps the fetch in an
      // AbortController so the promise rejects predictably when the deadline
      // hits (vs hanging on a slow CPU-bound local Provider). 0 = no timeout
      // (cloud SDK default; preserves pre-t413 behavior). Cleared on every
      // path so the timer doesn't leak across retries.
      const controller = this.config.timeoutMs > 0 ? new AbortController() : undefined;
      const timer =
        controller !== undefined
          ? setTimeout(() => controller.abort(), this.config.timeoutMs)
          : undefined;
      try {
        const resp = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
          ...(controller !== undefined ? { signal: controller.signal } : {}),
        });

        if (!resp.ok) {
          const status = resp.status;
          if (isRetryableStatus(status) && attempt < this.config.maxRetries) {
            lastError = new Error(`OpenAI API error: HTTP ${String(status)}`);
            const delay =
              (this.config.retryBaseMs ?? 1000) * Math.pow(2, attempt) +
              Math.floor(Math.random() * 500);
            await sleep(delay);
            continue;
          }
          const text = await resp.text();
          throw new Error(`OpenAI API error: HTTP ${String(status)}: ${text}`);
        }

        return (await resp.json()) as OpenAICompletion;
      } catch (err) {
        lastError = err;

        // AbortError from the deadline timer surfaces as a clear timeout error
        // instead of bubbling the cryptic native AbortError up the stack.
        if (err instanceof Error && (err.name === "AbortError" || err.message.includes("aborted"))) {
          throw new Error(`OpenAI request timed out after ${String(this.config.timeoutMs)}ms`);
        }

        // Network errors (fetch failed)
        if (
          err instanceof Error &&
          (err.message.includes("fetch failed") || err.message.includes("ECONNREFUSED")) &&
          attempt < this.config.maxRetries
        ) {
          const delay =
            (this.config.retryBaseMs ?? 1000) * Math.pow(2, attempt) +
            Math.floor(Math.random() * 500);
          await sleep(delay);
          continue;
        }

        if (attempt === this.config.maxRetries) {
          throw err;
        }
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    }

    throw lastError;
  }

  // ---------------------------------------------------------------------------
  // LLMProvider.invoke
  // ---------------------------------------------------------------------------

  async invoke(params: LLMInvokeParams): Promise<LLMResponse> {
    const model = params.model ?? this.config.defaultModel;
    const maxTokens = params.maxTokens ?? this.config.maxTokens;
    const messages = toOpenAIMessages(params.system, params.messages);
    const tools = params.tools ? toOpenAITools(params.tools) : undefined;

    const completion = await this.request(messages, tools, model, maxTokens);
    return fromOpenAICompletion(completion);
  }

  // ---------------------------------------------------------------------------
  // LLMProvider.continueWithToolResults
  // ---------------------------------------------------------------------------

  async continueWithToolResults(
    params: LLMToolContinuationParams,
  ): Promise<LLMResponse> {
    const model = params.original.model ?? this.config.defaultModel;
    const maxTokens = params.original.maxTokens ?? this.config.maxTokens;

    const messages = toOpenAIMessages(params.original.system, params.original.messages);

    // Append assistant message with tool calls
    const toolCallBlocks = params.assistantContent.filter((b) => b.type === "tool_use");
    const textBlocks = params.assistantContent.filter((b) => b.type === "text");
    const textContent = textBlocks.map((b) => b.text ?? "").join("\n") || null;

    if (toolCallBlocks.length > 0) {
      const toolCalls: OpenAIToolCall[] = toolCallBlocks.map((b) => ({
        id: b.id ?? "",
        type: "function" as const,
        function: {
          name: b.name ?? "",
          arguments: JSON.stringify(b.input ?? {}),
        },
      }));
      messages.push({ role: "assistant", content: textContent, tool_calls: toolCalls });
    } else {
      messages.push({ role: "assistant", content: textContent ?? "" });
    }

    // Append tool results
    const toolMessages = toOpenAIToolMessages(params.toolResults);
    messages.push(...toolMessages);

    const tools = params.original.tools ? toOpenAITools(params.original.tools) : undefined;
    const completion = await this.request(messages, tools, model, maxTokens);
    return fromOpenAICompletion(completion);
  }

  // ---------------------------------------------------------------------------
  // LLMProvider.summarize
  // ---------------------------------------------------------------------------

  async summarize(text: string, prompt: string): Promise<string> {
    const messages: OpenAIChatMessage[] = [
      { role: "system", content: prompt },
      { role: "user", content: text },
    ];

    const completion = await this.request(
      messages,
      undefined,
      this.config.defaultModel,
      1024,
    );

    return completion.choices[0]?.message.content ?? "";
  }
}
