/**
 * AnthropicProvider — Task #50
 *
 * Implements LLMProvider using @anthropic-ai/sdk. Wraps the existing
 * AnthropicClient logic (retry, backoff, entityId hashing) and translates
 * between provider-agnostic LLM types and Anthropic SDK types.
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
  ThinkingBlock,
  ThinkingBlockParam,
} from "@anthropic-ai/sdk/resources/messages.js";

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
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: Required<LLMProviderConfig> = {
  apiKey: "",
  defaultModel: "claude-sonnet-4-6",
  maxTokens: 8192,
  maxRetries: 3,
  retryBaseMs: 1000,
  baseUrl: "",
};

// ---------------------------------------------------------------------------
// Retryable error detection
// ---------------------------------------------------------------------------

function isRetryable(err: unknown): boolean {
  if (err instanceof Anthropic.APIError) {
    // 429 (rate limit), 500, 502, 503, 529 (overloaded) are retryable
    return [429, 500, 502, 503, 529].includes(err.status);
  }
  if (err instanceof Error && err.message.includes("fetch failed")) {
    return true;
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// ---------------------------------------------------------------------------
// Translation functions
// ---------------------------------------------------------------------------

/**
 * Convert a provider-agnostic LLMMessage array to Anthropic MessageParam array.
 * System messages are filtered out (Anthropic takes system as a top-level field).
 */
export function toAnthropicMessages(messages: LLMMessage[]): MessageParam[] {
  const result: MessageParam[] = [];

  for (const msg of messages) {
    // Skip system messages — Anthropic takes system as a separate field
    if (msg.role === "system") continue;

    if (typeof msg.content === "string") {
      result.push({ role: msg.role as "user" | "assistant", content: msg.content });
    } else {
      // Convert LLMContentBlock array to Anthropic content blocks
      const anthropicContent = msg.content.flatMap(
        (block): Anthropic.Messages.ContentBlockParam[] => {
          if (block.type === "thinking" && block.thinking && block.signature) {
            return [{ type: "thinking", thinking: block.thinking, signature: block.signature } as ThinkingBlockParam];
          }
          if (block.type === "text") {
            return [{ type: "text", text: block.text ?? "" }];
          }
          if (block.type === "tool_use") {
            return [
              {
                type: "tool_use",
                id: block.id ?? "",
                name: block.name ?? "",
                input: block.input ?? {},
              },
            ];
          }
          if (block.type === "tool_result") {
            return [
              {
                type: "tool_result",
                tool_use_id: block.tool_use_id ?? "",
                content: block.content ?? "",
              },
            ];
          }
          if (block.type === "image" && block.source) {
            return [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: block.source.media_type,
                  data: block.source.data,
                },
              } as Anthropic.Messages.ImageBlockParam,
            ];
          }
          return [];
        },
      );
      result.push({ role: msg.role as "user" | "assistant", content: anthropicContent });
    }
  }

  return result;
}

/**
 * Convert provider-agnostic LLMToolDefinition array to Anthropic Tool array.
 */
export function toAnthropicTools(tools: LLMToolDefinition[]): Tool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema as Tool["input_schema"],
  }));
}

/**
 * Convert provider-agnostic LLMToolResult array to Anthropic ToolResultBlockParam array.
 */
export function toAnthropicToolResults(results: LLMToolResult[]): ToolResultBlockParam[] {
  return results.map((r) => ({
    type: "tool_result" as const,
    tool_use_id: r.tool_use_id,
    content: r.content,
  }));
}

/**
 * Translate an LLMContentBlock array (assistant message) to Anthropic ContentBlock array.
 * Used when building continuation messages.
 */
export function toAnthropicContentBlocks(blocks: LLMContentBlock[]): ContentBlock[] {
  return blocks.flatMap((block): ContentBlock[] => {
    if (block.type === "thinking" && block.thinking && block.signature) {
      return [{ type: "thinking", thinking: block.thinking, signature: block.signature } as ThinkingBlock];
    }
    if (block.type === "text") {
      return [{ type: "text", text: block.text ?? "" } as TextBlock];
    }
    if (block.type === "tool_use") {
      return [
        {
          type: "tool_use",
          id: block.id ?? "",
          name: block.name ?? "",
          input: block.input ?? {},
        } as ToolUseBlock,
      ];
    }
    return [];
  });
}

/**
 * Translate an Anthropic Message response to a provider-agnostic LLMResponse.
 */
export function toLLMResponse(response: Anthropic.Message): LLMResponse {
  const textBlocks = response.content.filter((b): b is TextBlock => b.type === "text");
  const toolUses = response.content.filter((b): b is ToolUseBlock => b.type === "tool_use");
  const thinkingRaw = response.content.filter(
    (b): b is ThinkingBlock => b.type === "thinking",
  );

  const toolCalls: LLMToolCall[] = toolUses.map((t) => ({
    id: t.id,
    name: t.name,
    input: t.input as Record<string, unknown>,
  }));

  const thinkingBlocks = thinkingRaw.map((t) => ({
    thinking: t.thinking,
    signature: t.signature,
  }));

  const contentBlocks: LLMContentBlock[] = response.content.map((b) => {
    if (b.type === "thinking") {
      return {
        type: "thinking" as const,
        thinking: (b as ThinkingBlock).thinking,
        signature: (b as ThinkingBlock).signature,
      };
    }
    if (b.type === "text") {
      return { type: "text", text: b.text };
    }
    if (b.type === "tool_use") {
      return {
        type: "tool_use",
        id: b.id,
        name: b.name,
        input: b.input as Record<string, unknown>,
      };
    }
    // Other block types (e.g. "document", "redacted_thinking") — pass through minimally
    return { type: "text", text: "" };
  });

  return {
    text: textBlocks.map((b) => b.text).join("\n"),
    toolCalls,
    contentBlocks,
    stopReason: response.stop_reason,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
    model: response.model,
    thinkingBlocks,
  };
}

// ---------------------------------------------------------------------------
// AnthropicProvider
// ---------------------------------------------------------------------------

export class AnthropicProvider implements LLMProvider {
  private readonly client: Anthropic;
  private readonly config: Required<LLMProviderConfig>;

  constructor(config?: Partial<LLMProviderConfig>) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    };
    this.client = new Anthropic({
      apiKey: this.config.apiKey || undefined,
      ...(this.config.baseUrl ? { baseURL: this.config.baseUrl } : {}),
    });
  }

  // ---------------------------------------------------------------------------
  // LLMProvider.invoke
  // ---------------------------------------------------------------------------

  async invoke(params: LLMInvokeParams): Promise<LLMResponse> {
    const model = params.model ?? this.config.defaultModel;
    const baseMaxTokens = params.maxTokens ?? this.config.maxTokens;
    // When thinking is enabled, max_tokens must cover both thinking budget and output
    const thinkingBudget = params.thinking?.type === "enabled" ? params.thinking.budget_tokens : 0;
    const maxTokens = thinkingBudget > 0 ? thinkingBudget + baseMaxTokens : baseMaxTokens;

    // Hash entityId for metadata.user_id (per spec §7)
    const userIdHash = createHash("sha256")
      .update(params.entityId)
      .digest("hex");

    const anthropicMessages = toAnthropicMessages(params.messages);
    const anthropicTools = params.tools ? toAnthropicTools(params.tools) : undefined;

    const requestBody = {
      model,
      max_tokens: maxTokens,
      system: params.system,
      messages: anthropicMessages,
      ...(anthropicTools && anthropicTools.length > 0 ? { tools: anthropicTools } : {}),
      ...(params.thinking ? { thinking: params.thinking } : {}),
      metadata: { user_id: userIdHash },
    };

    let lastError: unknown;
    const retryBaseMs = this.config.retryBaseMs;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const response = await this.client.messages.create(requestBody);
        return toLLMResponse(response);
      } catch (err) {
        lastError = err;

        if (!isRetryable(err) || attempt === this.config.maxRetries) {
          throw err;
        }

        // Exponential backoff with jitter
        const delay =
          retryBaseMs * Math.pow(2, attempt) +
          Math.floor(Math.random() * 500);
        await sleep(delay);
      }
    }

    throw lastError;
  }

  // ---------------------------------------------------------------------------
  // LLMProvider.continueWithToolResults
  // ---------------------------------------------------------------------------

  async continueWithToolResults(
    params: LLMToolContinuationParams,
  ): Promise<LLMResponse> {
    const toolResultBlocks = toAnthropicToolResults(params.toolResults);
    const assistantBlocks = toAnthropicContentBlocks(params.assistantContent);

    const continuationMessages: LLMMessage[] = [
      ...params.original.messages,
      { role: "assistant", content: params.assistantContent },
      {
        role: "user",
        content: params.toolResults.map((r) => ({
          type: "tool_result" as const,
          tool_use_id: r.tool_use_id,
          content: r.content,
        })),
      },
    ];

    // Build Anthropic-native continuation messages for accuracy
    const anthropicMessages = toAnthropicMessages(params.original.messages);
    anthropicMessages.push({ role: "assistant", content: assistantBlocks });
    anthropicMessages.push({ role: "user", content: toolResultBlocks });

    const model = params.original.model ?? this.config.defaultModel;
    const baseMaxTokens = params.original.maxTokens ?? this.config.maxTokens;
    const thinkingBudget = params.original.thinking?.type === "enabled" ? params.original.thinking.budget_tokens : 0;
    const maxTokens = thinkingBudget > 0 ? thinkingBudget + baseMaxTokens : baseMaxTokens;
    const userIdHash = createHash("sha256")
      .update(params.original.entityId)
      .digest("hex");
    const anthropicTools = params.original.tools
      ? toAnthropicTools(params.original.tools)
      : undefined;

    const requestBody = {
      model,
      max_tokens: maxTokens,
      system: params.original.system,
      messages: anthropicMessages,
      ...(anthropicTools && anthropicTools.length > 0 ? { tools: anthropicTools } : {}),
      ...(params.original.thinking ? { thinking: params.original.thinking } : {}),
      metadata: { user_id: userIdHash },
    };

    let lastError: unknown;
    const retryBaseMs = this.config.retryBaseMs;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const response = await this.client.messages.create(requestBody);
        return toLLMResponse(response);
      } catch (err) {
        lastError = err;

        if (!isRetryable(err) || attempt === this.config.maxRetries) {
          throw err;
        }

        const delay =
          retryBaseMs * Math.pow(2, attempt) +
          Math.floor(Math.random() * 500);
        await sleep(delay);
      }
    }

    // Suppress unused variable warning — continuationMessages built above
    void continuationMessages;

    throw lastError;
  }

  // ---------------------------------------------------------------------------
  // LLMProvider.summarize
  // ---------------------------------------------------------------------------

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
