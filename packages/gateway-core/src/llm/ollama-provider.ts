/**
 * OllamaProvider — Task #52
 *
 * Implements LLMProvider using Ollama's OpenAI-compatible HTTP API.
 * Uses native fetch() — NO npm dependency.
 *
 * Default base URL: http://localhost:11434
 * API endpoint: /api/chat (OpenAI-compatible format)
 *
 * For models without native tool calling support, implements a prompt-based
 * fallback that injects tool definitions into the system prompt and parses
 * JSON tool call blocks from the response text.
 */

import type { LLMProvider, LLMProviderConfig } from "./provider.js";
import type {
  LLMMessage,
  LLMContentBlock,
  LLMToolDefinition,
  LLMToolCall,
  LLMResponse,
  LLMInvokeParams,
  LLMToolContinuationParams,
} from "./types.js";

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_BASE_URL = "http://localhost:11434";

const DEFAULT_CONFIG: Required<Omit<LLMProviderConfig, "apiKey">> & { apiKey: string } = {
  apiKey: "",
  defaultModel: "llama3.2",
  maxTokens: 4096,
  maxRetries: 3,
  retryBaseMs: 1000,
  baseUrl: DEFAULT_BASE_URL,
};

// ---------------------------------------------------------------------------
// Ollama API types (OpenAI-compatible)
// ---------------------------------------------------------------------------

interface OllamaMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: OllamaToolCall[];
  tool_call_id?: string;
}

interface OllamaToolCall {
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

interface OllamaTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface OllamaChatResponse {
  model: string;
  message: {
    role: string;
    content: string;
    tool_calls?: OllamaToolCall[];
  };
  done: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// ---------------------------------------------------------------------------
// Tool call parsing (prompt-based fallback)
// ---------------------------------------------------------------------------

/**
 * Build a system prompt section that describes available tools in structured text.
 * Used for models without native tool calling support.
 */
export function buildToolsSystemPrompt(tools: LLMToolDefinition[]): string {
  if (tools.length === 0) return "";

  const lines: string[] = [
    "",
    "## Available Tools",
    "",
    "You have access to the following tools. To call a tool, respond with a JSON block",
    'in this exact format (including the ``` markers):',
    "",
    "```tool_call",
    '{"tool": "<tool_name>", "input": {<arguments>}}',
    "```",
    "",
    "Only call one tool per response. After receiving the tool result, you may call",
    "another tool or provide your final answer.",
    "",
    "### Tool Definitions",
    "",
  ];

  for (const tool of tools) {
    lines.push(`**${tool.name}**: ${tool.description}`);
    lines.push(`Parameters: ${JSON.stringify(tool.input_schema)}`);
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Parse tool call blocks from response text (prompt-based fallback).
 *
 * Looks for ```tool_call blocks containing JSON with "tool" and "input" fields.
 */
export function parseToolCallsFromText(
  text: string,
): { toolCalls: LLMToolCall[]; cleanText: string } {
  const toolCalls: LLMToolCall[] = [];
  let cleanText = text;

  const pattern = /```tool_call\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  let idCounter = 0;

  while ((match = pattern.exec(text)) !== null) {
    const raw = match[1]?.trim();
    if (!raw) continue;

    try {
      const parsed = JSON.parse(raw) as { tool?: string; input?: Record<string, unknown> };
      if (typeof parsed.tool === "string") {
        idCounter++;
        toolCalls.push({
          id: `ollama-tool-${String(idCounter)}`,
          name: parsed.tool,
          input: parsed.input ?? {},
        });
      }
    } catch {
      // Malformed JSON — skip this block
    }
  }

  if (toolCalls.length > 0) {
    // Strip tool_call blocks from the text
    cleanText = text.replace(/```tool_call\n[\s\S]*?```/g, "").trim();
  }

  return { toolCalls, cleanText };
}

// ---------------------------------------------------------------------------
// Translation functions
// ---------------------------------------------------------------------------

/**
 * Convert provider-agnostic messages to Ollama message format.
 */
export function toOllamaMessages(
  system: string,
  messages: LLMMessage[],
  toolsPromptSuffix?: string,
): OllamaMessage[] {
  const systemContent = toolsPromptSuffix
    ? system + toolsPromptSuffix
    : system;

  const result: OllamaMessage[] = [{ role: "system", content: systemContent }];

  for (const msg of messages) {
    if (msg.role === "system") continue;

    if (typeof msg.content === "string") {
      result.push({ role: msg.role as "user" | "assistant", content: msg.content });
    } else {
      const textContent = msg.content
        .filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("\n");
      const toolUseBlocks = msg.content.filter((b) => b.type === "tool_use");
      const toolResultBlocks = msg.content.filter((b) => b.type === "tool_result");

      if (toolUseBlocks.length > 0) {
        const toolCalls: OllamaToolCall[] = toolUseBlocks.map((b) => ({
          function: {
            name: b.name ?? "",
            arguments: b.input ?? {},
          },
        }));
        result.push({
          role: "assistant",
          content: textContent,
          tool_calls: toolCalls,
        });
      } else if (toolResultBlocks.length > 0) {
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
 * Convert provider-agnostic tool definitions to Ollama tool format.
 */
export function toOllamaTools(tools: LLMToolDefinition[]): OllamaTool[] {
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
 * Translate an Ollama chat response to provider-agnostic LLMResponse.
 */
export function fromOllamaResponse(
  response: OllamaChatResponse,
  usePromptFallback: boolean,
): LLMResponse {
  const rawContent = response.message.content ?? "";

  let toolCalls: LLMToolCall[] = [];
  let text = rawContent;

  if (response.message.tool_calls && response.message.tool_calls.length > 0) {
    // Native tool calling
    let idCounter = 0;
    toolCalls = response.message.tool_calls.map((tc) => {
      idCounter++;
      return {
        id: `ollama-tool-${String(idCounter)}`,
        name: tc.function.name,
        input: tc.function.arguments,
      };
    });
  } else if (usePromptFallback) {
    // Parse tool calls from text
    const parsed = parseToolCallsFromText(rawContent);
    toolCalls = parsed.toolCalls;
    text = parsed.cleanText;
  }

  const contentBlocks: LLMContentBlock[] = [];
  if (text) {
    contentBlocks.push({ type: "text", text });
  }
  for (const tc of toolCalls) {
    contentBlocks.push({
      type: "tool_use",
      id: tc.id,
      name: tc.name,
      input: tc.input,
    });
  }

  const stopReason = response.done_reason === "stop" ? "end_turn"
    : response.done_reason === "tool_calls" ? "tool_use"
    : response.done_reason ?? null;

  return {
    text,
    toolCalls,
    contentBlocks,
    stopReason,
    usage: {
      inputTokens: response.prompt_eval_count ?? 0,
      outputTokens: response.eval_count ?? 0,
    },
    model: response.model,
    thinkingBlocks: [],
  };
}

// ---------------------------------------------------------------------------
// OllamaProvider
// ---------------------------------------------------------------------------

export class OllamaProvider implements LLMProvider {
  private readonly config: Required<LLMProviderConfig>;
  /** Whether to use prompt-based tool calling fallback. */
  private readonly usePromptFallback: boolean;

  constructor(
    config?: Partial<LLMProviderConfig> & { usePromptFallback?: boolean },
  ) {
    this.config = {
      apiKey: "",
      defaultModel: DEFAULT_CONFIG.defaultModel,
      maxTokens: DEFAULT_CONFIG.maxTokens,
      maxRetries: DEFAULT_CONFIG.maxRetries,
      retryBaseMs: DEFAULT_CONFIG.retryBaseMs,
      baseUrl: DEFAULT_CONFIG.baseUrl,
      ...config,
    };
    this.usePromptFallback = config?.usePromptFallback ?? false;
  }

  // ---------------------------------------------------------------------------
  // Core request method
  // ---------------------------------------------------------------------------

  private async request(
    messages: OllamaMessage[],
    tools: OllamaTool[] | undefined,
    model: string,
  ): Promise<OllamaChatResponse> {
    const baseUrl = this.config.baseUrl || DEFAULT_BASE_URL;
    const url = `${baseUrl}/api/chat`;

    const body: Record<string, unknown> = {
      model,
      messages,
      stream: false,
    };
    if (tools && tools.length > 0 && !this.usePromptFallback) {
      body["tools"] = tools;
    }

    let lastError: unknown;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const resp = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (!resp.ok) {
          const status = resp.status;
          const responseText = await resp.text();

          // Check for model not found
          if (status === 404 || responseText.toLowerCase().includes("model") && responseText.toLowerCase().includes("not found")) {
            throw new Error(
              `Ollama model "${model}" not found. Run: ollama pull ${model}`,
            );
          }

          throw new Error(
            `Ollama API error: HTTP ${String(status)}: ${responseText}`,
          );
        }

        return (await resp.json()) as OllamaChatResponse;
      } catch (err) {
        lastError = err;

        // Friendly error for connection refused — Ollama may be idle-unloaded,
        // restarting, or genuinely not running. Callers see this only after the
        // agent-invoker's retry has also failed.
        if (
          err instanceof Error &&
          (err.message.includes("ECONNREFUSED") || err.message.includes("fetch failed"))
        ) {
          throw new Error(
            `Ollama isn't responding yet. It may be reloading the model — try again in a moment. If it keeps failing, check that Ollama is running at ${baseUrl}.`,
          );
        }

        // Don't retry non-retryable errors
        if (
          err instanceof Error &&
          (err.message.includes("not found") || err.message.includes("ollama pull"))
        ) {
          throw err;
        }

        if (attempt < this.config.maxRetries) {
          const delay =
            (this.config.retryBaseMs ?? 1000) * Math.pow(2, attempt) +
            Math.floor(Math.random() * 500);
          await sleep(delay);
        } else {
          throw err;
        }
      }
    }

    throw lastError;
  }

  // ---------------------------------------------------------------------------
  // LLMProvider.invoke
  // ---------------------------------------------------------------------------

  async invoke(params: LLMInvokeParams): Promise<LLMResponse> {
    const model = params.model ?? this.config.defaultModel;

    let toolsPromptSuffix: string | undefined;
    let ollamaTools: OllamaTool[] | undefined;

    if (params.tools && params.tools.length > 0) {
      if (this.usePromptFallback) {
        toolsPromptSuffix = buildToolsSystemPrompt(params.tools);
      } else {
        ollamaTools = toOllamaTools(params.tools);
      }
    }

    const messages = toOllamaMessages(params.system, params.messages, toolsPromptSuffix);
    const response = await this.request(messages, ollamaTools, model);
    return fromOllamaResponse(response, this.usePromptFallback);
  }

  // ---------------------------------------------------------------------------
  // LLMProvider.continueWithToolResults
  // ---------------------------------------------------------------------------

  async continueWithToolResults(
    params: LLMToolContinuationParams,
  ): Promise<LLMResponse> {
    const model = params.original.model ?? this.config.defaultModel;

    let toolsPromptSuffix: string | undefined;
    let ollamaTools: OllamaTool[] | undefined;

    if (params.original.tools && params.original.tools.length > 0) {
      if (this.usePromptFallback) {
        toolsPromptSuffix = buildToolsSystemPrompt(params.original.tools);
      } else {
        ollamaTools = toOllamaTools(params.original.tools);
      }
    }

    const messages = toOllamaMessages(
      params.original.system,
      params.original.messages,
      toolsPromptSuffix,
    );

    // Append assistant message with tool calls
    const toolCallBlocks = params.assistantContent.filter((b) => b.type === "tool_use");
    const textBlocks = params.assistantContent.filter((b) => b.type === "text");
    const textContent = textBlocks.map((b) => b.text ?? "").join("\n");

    if (this.usePromptFallback) {
      // For prompt fallback, format tool calls as tool_call blocks in text
      const toolCallText = toolCallBlocks
        .map(
          (b) =>
            "```tool_call\n" +
            JSON.stringify({ tool: b.name, input: b.input }) +
            "\n```",
        )
        .join("\n");
      messages.push({
        role: "assistant",
        content: [textContent, toolCallText].filter(Boolean).join("\n"),
      });
      // Tool results as user messages
      const toolResultText = params.toolResults
        .map((r) => `Tool result for ${r.tool_use_id}:\n${r.content}`)
        .join("\n\n");
      messages.push({ role: "user", content: toolResultText });
    } else {
      // Native tool calling format
      const ollamaToolCalls: OllamaToolCall[] = toolCallBlocks.map((b) => ({
        function: {
          name: b.name ?? "",
          arguments: b.input ?? {},
        },
      }));
      messages.push({
        role: "assistant",
        content: textContent,
        tool_calls: ollamaToolCalls.length > 0 ? ollamaToolCalls : undefined,
      });
      for (const r of params.toolResults) {
        messages.push({
          role: "tool",
          tool_call_id: r.tool_use_id,
          content: r.content,
        });
      }
    }

    const response = await this.request(messages, ollamaTools, model);
    return fromOllamaResponse(response, this.usePromptFallback);
  }

  // ---------------------------------------------------------------------------
  // LLMProvider.summarize
  // ---------------------------------------------------------------------------

  async summarize(text: string, prompt: string): Promise<string> {
    const messages: OllamaMessage[] = [
      { role: "system", content: prompt },
      { role: "user", content: text },
    ];

    const response = await this.request(
      messages,
      undefined,
      this.config.defaultModel,
    );

    return response.message.content ?? "";
  }
}
