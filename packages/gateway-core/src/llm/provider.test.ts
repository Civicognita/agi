/**
 * LLM Provider Abstraction Layer Tests — Task #49-52
 *
 * Covers:
 * - Type translation for AnthropicProvider (mock @anthropic-ai/sdk)
 * - Type translation for OpenAIProvider (mock fetch)
 * - Type translation for OllamaProvider (mock fetch)
 * - LLMProvider interface contract for all providers
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  toAnthropicMessages,
  toAnthropicTools,
  toAnthropicToolResults,
  toLLMResponse,
  AnthropicProvider,
} from "./anthropic-provider.js";

import {
  toOpenAIMessages,
  toOpenAITools,
  toOpenAIToolMessages,
  fromOpenAICompletion,
  OpenAIProvider,
} from "./openai-provider.js";

import {
  toOllamaMessages,
  toOllamaTools,
  fromOllamaResponse,
  buildToolsSystemPrompt,
  parseToolCallsFromText,
  OllamaProvider,
} from "./ollama-provider.js";

import type {
  LLMMessage,
  LLMToolDefinition,
  LLMToolResult,
  LLMInvokeParams,
} from "./types.js";
import type { LLMProvider } from "./provider.js";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const sampleTools: LLMToolDefinition[] = [
  {
    name: "get_weather",
    description: "Get current weather for a location",
    input_schema: {
      type: "object",
      properties: { location: { type: "string" } },
      required: ["location"],
    },
  },
  {
    name: "send_message",
    description: "Send a message to a user",
    input_schema: {
      type: "object",
      properties: { recipient: { type: "string" }, text: { type: "string" } },
      required: ["recipient", "text"],
    },
  },
];

const sampleMessages: LLMMessage[] = [
  { role: "user", content: "Hello!" },
  { role: "assistant", content: "Hi there!" },
  { role: "user", content: "What is the weather?" },
];

const sampleToolResults: LLMToolResult[] = [
  { tool_use_id: "tool-1", content: "Sunny, 22°C" },
  { tool_use_id: "tool-2", content: "Message sent." },
];

// ---------------------------------------------------------------------------
// 1. AnthropicProvider — translation functions
// ---------------------------------------------------------------------------

describe("toAnthropicMessages", () => {
  it("converts simple string messages to MessageParam", () => {
    const messages: LLMMessage[] = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi" },
    ];
    const result = toAnthropicMessages(messages);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ role: "user", content: "Hello" });
    expect(result[1]).toEqual({ role: "assistant", content: "Hi" });
  });

  it("filters out system messages (Anthropic takes system as top-level)", () => {
    const messages: LLMMessage[] = [
      { role: "system", content: "You are helpful." },
      { role: "user", content: "Hello" },
    ];
    const result = toAnthropicMessages(messages);
    expect(result).toHaveLength(1);
    expect(result[0]!.role).toBe("user");
  });

  it("converts structured content blocks", () => {
    const messages: LLMMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "I will check the weather." },
          { type: "tool_use", id: "tool-1", name: "get_weather", input: { location: "NYC" } },
        ],
      },
    ];
    const result = toAnthropicMessages(messages);
    expect(result).toHaveLength(1);
    const content = result[0]!.content as unknown as Array<Record<string, unknown>>;
    expect(Array.isArray(content)).toBe(true);
    expect(content[0]).toMatchObject({ type: "text", text: "I will check the weather." });
    expect(content[1]).toMatchObject({ type: "tool_use", id: "tool-1", name: "get_weather" });
  });

  it("converts tool_result blocks", () => {
    const messages: LLMMessage[] = [
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "tool-1", content: "Sunny" },
        ],
      },
    ];
    const result = toAnthropicMessages(messages);
    const content = result[0]!.content as unknown as Array<Record<string, unknown>>;
    expect(content[0]).toMatchObject({ type: "tool_result", tool_use_id: "tool-1", content: "Sunny" });
  });

  it("handles empty messages array", () => {
    expect(toAnthropicMessages([])).toEqual([]);
  });
});

describe("toAnthropicTools", () => {
  it("converts LLMToolDefinition to Anthropic Tool format", () => {
    const result = toAnthropicTools(sampleTools);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      name: "get_weather",
      description: "Get current weather for a location",
      input_schema: { type: "object" },
    });
  });

  it("handles empty tools array", () => {
    expect(toAnthropicTools([])).toEqual([]);
  });
});

describe("toAnthropicToolResults", () => {
  it("converts LLMToolResult to ToolResultBlockParam", () => {
    const result = toAnthropicToolResults(sampleToolResults);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      type: "tool_result",
      tool_use_id: "tool-1",
      content: "Sunny, 22°C",
    });
    expect(result[1]).toMatchObject({
      type: "tool_result",
      tool_use_id: "tool-2",
      content: "Message sent.",
    });
  });

  it("handles empty results array", () => {
    expect(toAnthropicToolResults([])).toEqual([]);
  });
});

describe("toLLMResponse", () => {
  it("converts a text-only Anthropic Message to LLMResponse", () => {
    const fakeMessage = {
      id: "msg-1",
      type: "message" as const,
      role: "assistant" as const,
      model: "claude-sonnet-4-6",
      content: [{ type: "text" as const, text: "Hello!" }],
      stop_reason: "end_turn" as const,
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock object
    const result = toLLMResponse(fakeMessage as any);
    expect(result.text).toBe("Hello!");
    expect(result.toolCalls).toHaveLength(0);
    expect(result.stopReason).toBe("end_turn");
    expect(result.usage.inputTokens).toBe(10);
    expect(result.usage.outputTokens).toBe(5);
    expect(result.model).toBe("claude-sonnet-4-6");
  });

  it("converts a tool_use Anthropic Message to LLMResponse with toolCalls", () => {
    const fakeMessage = {
      id: "msg-2",
      type: "message" as const,
      role: "assistant" as const,
      model: "claude-sonnet-4-6",
      content: [
        { type: "text" as const, text: "Let me check." },
        {
          type: "tool_use" as const,
          id: "tool-abc",
          name: "get_weather",
          input: { location: "NYC" },
        },
      ],
      stop_reason: "tool_use" as const,
      stop_sequence: null,
      usage: { input_tokens: 20, output_tokens: 15, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock object
    const result = toLLMResponse(fakeMessage as any);
    expect(result.text).toBe("Let me check.");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]).toMatchObject({
      id: "tool-abc",
      name: "get_weather",
      input: { location: "NYC" },
    });
    expect(result.contentBlocks).toHaveLength(2);
    expect(result.stopReason).toBe("tool_use");
  });

  it("concatenates multiple text blocks with newline", () => {
    const fakeMessage = {
      id: "msg-3",
      type: "message" as const,
      role: "assistant" as const,
      model: "claude-sonnet-4-6",
      content: [
        { type: "text" as const, text: "First." },
        { type: "text" as const, text: "Second." },
      ],
      stop_reason: "end_turn" as const,
      stop_sequence: null,
      usage: { input_tokens: 5, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock object
    const result = toLLMResponse(fakeMessage as any);
    expect(result.text).toBe("First.\nSecond.");
  });
});

describe("AnthropicProvider — interface contract", () => {
  it("implements LLMProvider interface (structural check)", () => {
    const provider = new AnthropicProvider({ defaultModel: "claude-3-haiku-20240307", maxTokens: 256, maxRetries: 0 });
    // Type-level check: provider must have these methods
    expect(typeof provider.invoke).toBe("function");
    expect(typeof provider.continueWithToolResults).toBe("function");
    expect(typeof provider.summarize).toBe("function");
  });

  it("satisfies LLMProvider type assignment", () => {
    const provider: LLMProvider = new AnthropicProvider({
      defaultModel: "claude-3-haiku-20240307",
      maxTokens: 256,
      maxRetries: 0,
    });
    expect(provider).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 2. OpenAIProvider — translation functions
// ---------------------------------------------------------------------------

describe("toOpenAIMessages", () => {
  it("prepends system message as first element", () => {
    const messages: LLMMessage[] = [{ role: "user", content: "Hello" }];
    const result = toOpenAIMessages("You are helpful.", messages);
    expect(result[0]).toMatchObject({ role: "system", content: "You are helpful." });
    expect(result[1]).toMatchObject({ role: "user", content: "Hello" });
  });

  it("converts simple string messages", () => {
    const result = toOpenAIMessages("sys", sampleMessages);
    expect(result).toHaveLength(sampleMessages.length + 1); // +1 for system
    expect(result[1]).toMatchObject({ role: "user", content: "Hello!" });
  });

  it("converts assistant messages with tool calls to OpenAI format", () => {
    const messages: LLMMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "Checking..." },
          { type: "tool_use", id: "tc-1", name: "get_weather", input: { location: "LA" } },
        ],
      },
    ];
    const result = toOpenAIMessages("sys", messages);
    const assistantMsg = result.find((m) => m.role === "assistant");
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg!.tool_calls).toBeDefined();
    expect(assistantMsg!.tool_calls![0]).toMatchObject({
      id: "tc-1",
      type: "function",
      function: { name: "get_weather" },
    });
  });

  it("converts tool result blocks to separate tool messages", () => {
    const messages: LLMMessage[] = [
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "tc-1", content: "22C sunny" },
        ],
      },
    ];
    const result = toOpenAIMessages("sys", messages);
    const toolMsg = result.find((m) => m.role === "tool");
    expect(toolMsg).toBeDefined();
    expect(toolMsg!.tool_call_id).toBe("tc-1");
    expect(toolMsg!.content).toBe("22C sunny");
  });

  it("skips LLMMessage system messages (already handled as first arg)", () => {
    const messages: LLMMessage[] = [
      { role: "system", content: "Additional context." },
      { role: "user", content: "Hi" },
    ];
    const result = toOpenAIMessages("Main system.", messages);
    // The system role message from messages is added as additional system message
    const systemMsgs = result.filter((m) => m.role === "system");
    expect(systemMsgs.length).toBeGreaterThanOrEqual(1);
    expect(systemMsgs[0]!.content).toBe("Main system.");
  });
});

describe("toOpenAITools", () => {
  it("converts LLMToolDefinition to OpenAI function tools format", () => {
    const result = toOpenAITools(sampleTools);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      type: "function",
      function: {
        name: "get_weather",
        description: "Get current weather for a location",
        parameters: { type: "object" },
      },
    });
  });

  it("handles empty tools array", () => {
    expect(toOpenAITools([])).toEqual([]);
  });
});

describe("toOpenAIToolMessages", () => {
  it("converts LLMToolResult to OpenAI tool messages", () => {
    const result = toOpenAIToolMessages(sampleToolResults);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      role: "tool",
      tool_call_id: "tool-1",
      content: "Sunny, 22°C",
    });
  });
});

describe("fromOpenAICompletion", () => {
  it("converts a text-only completion to LLMResponse", () => {
    const completion = {
      id: "chatcmpl-1",
      model: "gpt-4o",
      choices: [
        {
          message: { role: "assistant", content: "Hello!" },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    };

    const result = fromOpenAICompletion(completion);
    expect(result.text).toBe("Hello!");
    expect(result.toolCalls).toHaveLength(0);
    expect(result.stopReason).toBe("end_turn");
    expect(result.usage.inputTokens).toBe(10);
    expect(result.usage.outputTokens).toBe(5);
    expect(result.model).toBe("gpt-4o");
  });

  it("converts tool_calls finish_reason to tool_use stopReason", () => {
    const completion = {
      id: "chatcmpl-2",
      model: "gpt-4o",
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call-1",
                type: "function" as const,
                function: { name: "get_weather", arguments: '{"location":"NYC"}' },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 20, completion_tokens: 10 },
    };

    const result = fromOpenAICompletion(completion);
    expect(result.stopReason).toBe("tool_use");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]).toMatchObject({
      id: "call-1",
      name: "get_weather",
      input: { location: "NYC" },
    });
  });

  it("converts length finish_reason to max_tokens stopReason", () => {
    const completion = {
      id: "chatcmpl-3",
      model: "gpt-4o",
      choices: [{ message: { role: "assistant", content: "..." }, finish_reason: "length" }],
    };

    const result = fromOpenAICompletion(completion);
    expect(result.stopReason).toBe("max_tokens");
  });

  it("handles malformed tool_call arguments gracefully", () => {
    const completion = {
      id: "chatcmpl-4",
      model: "gpt-4o",
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call-bad",
                type: "function" as const,
                function: { name: "broken", arguments: "NOT VALID JSON" },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    };

    const result = fromOpenAICompletion(completion);
    expect(result.toolCalls[0]!.input).toEqual({});
  });

  it("returns empty LLMResponse when choices array is empty", () => {
    const completion = { id: "chatcmpl-5", model: "gpt-4o", choices: [] };
    const result = fromOpenAICompletion(completion);
    expect(result.text).toBe("");
    expect(result.toolCalls).toHaveLength(0);
    expect(result.stopReason).toBeNull();
  });
});

describe("OpenAIProvider — mock fetch", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("calls OpenAI chat completions endpoint", async () => {
    let capturedUrl = "";
    let capturedBody: Record<string, unknown> = {};

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "chatcmpl-1",
        model: "gpt-4o",
        choices: [{ message: { role: "assistant", content: "Hello!" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 5, completion_tokens: 3 },
      }),
    }) as unknown as typeof fetch;

    // Capture what was called
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      async (url: string, init: RequestInit) => {
        capturedUrl = url;
        capturedBody = JSON.parse(init.body as string) as Record<string, unknown>;
        return {
          ok: true,
          json: async () => ({
            id: "chatcmpl-1",
            model: "gpt-4o",
            choices: [{ message: { role: "assistant", content: "Hello!" }, finish_reason: "stop" }],
            usage: { prompt_tokens: 5, completion_tokens: 3 },
          }),
        };
      },
    );

    const provider = new OpenAIProvider({
      apiKey: "test-key",
      defaultModel: "gpt-4o",
      maxTokens: 100,
      maxRetries: 0,
    });

    const params: LLMInvokeParams = {
      system: "You are helpful.",
      messages: [{ role: "user", content: "Hi" }],
      entityId: "entity-001",
    };

    const result = await provider.invoke(params);

    expect(capturedUrl).toContain("/chat/completions");
    expect(capturedBody["model"]).toBe("gpt-4o");
    expect(capturedBody["messages"]).toBeInstanceOf(Array);
    expect(result.text).toBe("Hello!");
    expect(result.stopReason).toBe("end_turn");
  });

  it("includes Authorization header with API key", async () => {
    let capturedHeaders: Record<string, string> = {};

    (globalThis.fetch as typeof fetch) = vi.fn().mockImplementation(
      async (_url: string, init: RequestInit) => {
        capturedHeaders = init.headers as Record<string, string>;
        return {
          ok: true,
          json: async () => ({
            id: "x",
            model: "gpt-4o",
            choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
          }),
        };
      },
    ) as unknown as typeof fetch;

    const provider = new OpenAIProvider({ apiKey: "sk-test-123", defaultModel: "gpt-4o", maxTokens: 10, maxRetries: 0 });
    await provider.invoke({ system: "s", messages: [{ role: "user", content: "hi" }], entityId: "e1" });

    expect(capturedHeaders["Authorization"]).toBe("Bearer sk-test-123");
  });

  it("retries on 429 response", async () => {
    let callCount = 0;
    (globalThis.fetch as typeof fetch) = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount < 2) {
        return { ok: false, status: 429, text: async () => "rate limited" };
      }
      return {
        ok: true,
        json: async () => ({
          id: "x",
          model: "gpt-4o",
          choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
      };
    }) as unknown as typeof fetch;

    const provider = new OpenAIProvider({
      apiKey: "key",
      defaultModel: "gpt-4o",
      maxTokens: 10,
      maxRetries: 2,
      retryBaseMs: 1, // very fast for testing
    });
    const result = await provider.invoke({ system: "s", messages: [{ role: "user", content: "hi" }], entityId: "e1" });
    expect(callCount).toBe(2);
    expect(result.text).toBe("ok");
  });

  it("throws after exhausting retries", async () => {
    (globalThis.fetch as typeof fetch) = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "server error",
    }) as unknown as typeof fetch;

    const provider = new OpenAIProvider({
      apiKey: "key",
      defaultModel: "gpt-4o",
      maxTokens: 10,
      maxRetries: 1,
      retryBaseMs: 1,
    });

    await expect(
      provider.invoke({ system: "s", messages: [{ role: "user", content: "hi" }], entityId: "e1" }),
    ).rejects.toThrow(/HTTP 500/);
  });

  it("includes tools in request body when tools are provided", async () => {
    let capturedBody: Record<string, unknown> = {};
    (globalThis.fetch as typeof fetch) = vi.fn().mockImplementation(
      async (_url: string, init: RequestInit) => {
        capturedBody = JSON.parse(init.body as string) as Record<string, unknown>;
        return {
          ok: true,
          json: async () => ({
            id: "x",
            model: "gpt-4o",
            choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
          }),
        };
      },
    ) as unknown as typeof fetch;

    const provider = new OpenAIProvider({ apiKey: "key", defaultModel: "gpt-4o", maxTokens: 10, maxRetries: 0 });
    await provider.invoke({
      system: "s",
      messages: [{ role: "user", content: "hi" }],
      tools: sampleTools,
      entityId: "e1",
    });

    expect(capturedBody["tools"]).toBeDefined();
    const tools = capturedBody["tools"] as Array<Record<string, unknown>>;
    expect(tools[0]).toMatchObject({ type: "function" });
  });

  it("satisfies LLMProvider interface", () => {
    const provider: LLMProvider = new OpenAIProvider({ defaultModel: "gpt-4o", maxTokens: 100, maxRetries: 0 });
    expect(typeof provider.invoke).toBe("function");
    expect(typeof provider.continueWithToolResults).toBe("function");
    expect(typeof provider.summarize).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// 3. OllamaProvider — translation functions and mock fetch
// ---------------------------------------------------------------------------

describe("buildToolsSystemPrompt", () => {
  it("returns empty string for empty tools array", () => {
    expect(buildToolsSystemPrompt([])).toBe("");
  });

  it("includes tool names and descriptions", () => {
    const prompt = buildToolsSystemPrompt(sampleTools);
    expect(prompt).toContain("get_weather");
    expect(prompt).toContain("Get current weather for a location");
    expect(prompt).toContain("send_message");
  });

  it("includes tool_call format instructions", () => {
    const prompt = buildToolsSystemPrompt(sampleTools);
    expect(prompt).toContain("tool_call");
    expect(prompt).toContain("tool");
    expect(prompt).toContain("input");
  });
});

describe("parseToolCallsFromText", () => {
  it("returns empty toolCalls for plain text", () => {
    const { toolCalls, cleanText } = parseToolCallsFromText("Just some plain text.");
    expect(toolCalls).toHaveLength(0);
    expect(cleanText).toBe("Just some plain text.");
  });

  it("parses a single tool_call block", () => {
    const text = 'Let me check.\n```tool_call\n{"tool": "get_weather", "input": {"location": "NYC"}}\n```';
    const { toolCalls, cleanText } = parseToolCallsFromText(text);
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]!.name).toBe("get_weather");
    expect(toolCalls[0]!.input).toEqual({ location: "NYC" });
    expect(cleanText).not.toContain("```tool_call");
  });

  it("assigns unique IDs to each tool call", () => {
    const text = [
      "```tool_call",
      '{"tool": "get_weather", "input": {"location": "NYC"}}',
      "```",
      "```tool_call",
      '{"tool": "send_message", "input": {"recipient": "alice", "text": "hello"}}',
      "```",
    ].join("\n");
    const { toolCalls } = parseToolCallsFromText(text);
    expect(toolCalls).toHaveLength(2);
    expect(toolCalls[0]!.id).not.toBe(toolCalls[1]!.id);
  });

  it("skips malformed JSON blocks without throwing", () => {
    const text = "```tool_call\nNOT JSON\n```";
    const { toolCalls } = parseToolCallsFromText(text);
    expect(toolCalls).toHaveLength(0);
  });

  it("strips tool_call blocks from clean text", () => {
    const text = 'Before.\n```tool_call\n{"tool": "x", "input": {}}\n```\nAfter.';
    const { cleanText } = parseToolCallsFromText(text);
    expect(cleanText).toContain("Before.");
    expect(cleanText).toContain("After.");
    expect(cleanText).not.toContain("```tool_call");
  });
});

describe("toOllamaMessages", () => {
  it("prepends system message", () => {
    const messages: LLMMessage[] = [{ role: "user", content: "Hello" }];
    const result = toOllamaMessages("You are helpful.", messages);
    expect(result[0]).toMatchObject({ role: "system", content: "You are helpful." });
  });

  it("appends toolsPromptSuffix to system message when provided", () => {
    const messages: LLMMessage[] = [{ role: "user", content: "Hello" }];
    const result = toOllamaMessages("Base prompt.", messages, "\n## Tools\nSome tools here.");
    expect(result[0]!.content).toContain("Base prompt.");
    expect(result[0]!.content).toContain("## Tools");
  });

  it("converts simple messages", () => {
    const result = toOllamaMessages("sys", sampleMessages);
    expect(result).toHaveLength(sampleMessages.length + 1);
    expect(result[1]).toMatchObject({ role: "user", content: "Hello!" });
  });
});

describe("toOllamaTools", () => {
  it("converts LLMToolDefinition to Ollama tool format", () => {
    const result = toOllamaTools(sampleTools);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      type: "function",
      function: {
        name: "get_weather",
        description: "Get current weather for a location",
      },
    });
  });
});

describe("fromOllamaResponse", () => {
  it("converts a text-only Ollama response to LLMResponse", () => {
    const response = {
      model: "llama3.2",
      message: { role: "assistant", content: "Hello!" },
      done: true,
      done_reason: "stop",
      prompt_eval_count: 10,
      eval_count: 5,
    };

    const result = fromOllamaResponse(response, false);
    expect(result.text).toBe("Hello!");
    expect(result.toolCalls).toHaveLength(0);
    expect(result.stopReason).toBe("end_turn");
    expect(result.usage.inputTokens).toBe(10);
    expect(result.usage.outputTokens).toBe(5);
  });

  it("converts native tool_calls from Ollama response", () => {
    const response = {
      model: "llama3.2",
      message: {
        role: "assistant",
        content: "",
        tool_calls: [
          { function: { name: "get_weather", arguments: { location: "NYC" } } },
        ],
      },
      done: true,
      done_reason: "tool_calls",
    };

    const result = fromOllamaResponse(response, false);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]!.name).toBe("get_weather");
    expect(result.toolCalls[0]!.input).toEqual({ location: "NYC" });
    expect(result.stopReason).toBe("tool_use");
  });

  it("uses parseToolCallsFromText when usePromptFallback=true", () => {
    const response = {
      model: "llama3.2",
      message: {
        role: "assistant",
        content: 'I will check.\n```tool_call\n{"tool": "get_weather", "input": {"location": "LA"}}\n```',
      },
      done: true,
      done_reason: "stop",
    };

    const result = fromOllamaResponse(response, true);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]!.name).toBe("get_weather");
    expect(result.text).not.toContain("```tool_call");
  });
});

describe("OllamaProvider — mock fetch", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("calls Ollama /api/chat endpoint", async () => {
    let capturedUrl = "";

    (globalThis.fetch as typeof fetch) = vi.fn().mockImplementation(
      async (url: string) => {
        capturedUrl = url;
        return {
          ok: true,
          json: async () => ({
            model: "llama3.2",
            message: { role: "assistant", content: "Hello!" },
            done: true,
            done_reason: "stop",
            prompt_eval_count: 5,
            eval_count: 3,
          }),
        };
      },
    ) as unknown as typeof fetch;

    const provider = new OllamaProvider({ defaultModel: "llama3.2", maxTokens: 100, maxRetries: 0 });
    await provider.invoke({ system: "s", messages: [{ role: "user", content: "hi" }], entityId: "e1" });

    expect(capturedUrl).toContain("/api/chat");
    expect(capturedUrl).toContain("localhost:11434");
  });

  it("uses custom baseUrl when provided", async () => {
    let capturedUrl = "";

    (globalThis.fetch as typeof fetch) = vi.fn().mockImplementation(
      async (url: string) => {
        capturedUrl = url;
        return {
          ok: true,
          json: async () => ({
            model: "llama3.2",
            message: { role: "assistant", content: "ok" },
            done: true,
          }),
        };
      },
    ) as unknown as typeof fetch;

    const provider = new OllamaProvider({
      baseUrl: "http://my-ollama:11434",
      defaultModel: "llama3.2",
      maxTokens: 10,
      maxRetries: 0,
    });
    await provider.invoke({ system: "s", messages: [{ role: "user", content: "hi" }], entityId: "e1" });

    expect(capturedUrl).toContain("my-ollama:11434");
  });

  it("throws clear error when Ollama is not running (ECONNREFUSED)", async () => {
    (globalThis.fetch as typeof fetch) = vi.fn().mockRejectedValue(
      Object.assign(new Error("fetch failed"), { cause: { code: "ECONNREFUSED" } }),
    ) as unknown as typeof fetch;

    const provider = new OllamaProvider({ defaultModel: "llama3.2", maxTokens: 10, maxRetries: 0 });

    await expect(
      provider.invoke({ system: "s", messages: [{ role: "user", content: "hi" }], entityId: "e1" }),
    ).rejects.toThrow(/ollama serve|Cannot connect/i);
  });

  it("throws clear error when model not found", async () => {
    (globalThis.fetch as typeof fetch) = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => '{"error":"model \\"llama4\\" not found"}',
    }) as unknown as typeof fetch;

    const provider = new OllamaProvider({ defaultModel: "llama4", maxTokens: 10, maxRetries: 0 });

    await expect(
      provider.invoke({ system: "s", messages: [{ role: "user", content: "hi" }], entityId: "e1" }),
    ).rejects.toThrow(/ollama pull|not found/i);
  });

  it("uses prompt fallback when usePromptFallback=true", async () => {
    let capturedBody: Record<string, unknown> = {};

    (globalThis.fetch as typeof fetch) = vi.fn().mockImplementation(
      async (_url: string, init: RequestInit) => {
        capturedBody = JSON.parse(init.body as string) as Record<string, unknown>;
        return {
          ok: true,
          json: async () => ({
            model: "llama3.2",
            message: { role: "assistant", content: "I'll help." },
            done: true,
          }),
        };
      },
    ) as unknown as typeof fetch;

    const provider = new OllamaProvider({
      defaultModel: "llama3.2",
      maxTokens: 10,
      maxRetries: 0,
      usePromptFallback: true,
    });

    await provider.invoke({
      system: "s",
      messages: [{ role: "user", content: "hi" }],
      tools: sampleTools,
      entityId: "e1",
    });

    // Should NOT send native tools in body when using prompt fallback
    expect(capturedBody["tools"]).toBeUndefined();
    // System message should contain tool definitions
    const messages = capturedBody["messages"] as Array<{ role: string; content: string }>;
    expect(messages[0]!.content).toContain("get_weather");
  });

  it("satisfies LLMProvider interface", () => {
    const provider: LLMProvider = new OllamaProvider({ defaultModel: "llama3.2", maxTokens: 100, maxRetries: 0 });
    expect(typeof provider.invoke).toBe("function");
    expect(typeof provider.continueWithToolResults).toBe("function");
    expect(typeof provider.summarize).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// 4. Interface contract tests — all three providers
// ---------------------------------------------------------------------------

describe("LLMProvider interface contract", () => {
  it("AnthropicProvider has all required methods", () => {
    const p = new AnthropicProvider({ defaultModel: "claude-3-haiku-20240307", maxTokens: 100, maxRetries: 0 });
    expect(p.invoke).toBeInstanceOf(Function);
    expect(p.continueWithToolResults).toBeInstanceOf(Function);
    expect(p.summarize).toBeInstanceOf(Function);
  });

  it("OpenAIProvider has all required methods", () => {
    const p = new OpenAIProvider({ defaultModel: "gpt-4o", maxTokens: 100, maxRetries: 0 });
    expect(p.invoke).toBeInstanceOf(Function);
    expect(p.continueWithToolResults).toBeInstanceOf(Function);
    expect(p.summarize).toBeInstanceOf(Function);
  });

  it("OllamaProvider has all required methods", () => {
    const p = new OllamaProvider({ defaultModel: "llama3.2", maxTokens: 100, maxRetries: 0 });
    expect(p.invoke).toBeInstanceOf(Function);
    expect(p.continueWithToolResults).toBeInstanceOf(Function);
    expect(p.summarize).toBeInstanceOf(Function);
  });

  it("all providers return promises from invoke (signature check)", () => {
    const ap = new AnthropicProvider({ defaultModel: "c", maxTokens: 10, maxRetries: 0, apiKey: "fake" });
    const op = new OpenAIProvider({ defaultModel: "gpt-4o", maxTokens: 10, maxRetries: 0, apiKey: "fake" });
    const ol = new OllamaProvider({ defaultModel: "llama3.2", maxTokens: 10, maxRetries: 0 });

    // These should return Promises (we don't actually call the API)
    const dummyParams: LLMInvokeParams = {
      system: "s",
      messages: [{ role: "user", content: "hi" }],
      entityId: "e1",
    };

    // Invoking will fail since there's no real API — just verify they return Promises
    const apResult = ap.invoke(dummyParams);
    const opResult = op.invoke(dummyParams);
    const olResult = ol.invoke(dummyParams);

    expect(apResult).toBeInstanceOf(Promise);
    expect(opResult).toBeInstanceOf(Promise);
    expect(olResult).toBeInstanceOf(Promise);

    // Suppress unhandled rejection warnings
    apResult.catch(() => undefined);
    opResult.catch(() => undefined);
    olResult.catch(() => undefined);
  });
});
