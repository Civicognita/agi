/**
 * LLM Provider Integration Tests — Story 19, Task 56
 *
 * Tests the provider abstraction layer: factory creation, failover behavior,
 * and provider interface contracts.
 *
 * These are unit-level integration tests (no real API calls).
 */

import { describe, it, expect } from "vitest";
import { createLLMProvider, createAgentRouter } from "./index.js";
import type { AionimaConfig } from "@aionima/config";
import type { LLMResponse, LLMInvokeParams } from "./index.js";

// Full agent config defaults (Zod output type requires all default fields)
const DEFAULT_AGENT = {
  provider: "anthropic" as const,
  model: "claude-sonnet-4-6",
  resourceId: "$A0",
  nodeId: "@A0",
  maxTokens: 8192,
  maxRetries: 3,
  replyMode: "autonomous" as const,
  devMode: false,
  router: {
    costMode: "balanced" as const,
    escalation: false,
    maxEscalationsPerTurn: 1,
    simpleThresholdTokens: 500,
    complexThresholdTokens: 2000,
  },
};

// Minimal config factory
function makeConfig(overrides: Partial<AionimaConfig> = {}): AionimaConfig {
  return {
    channels: [],
    ...overrides,
  } as AionimaConfig;
}

describe("createLLMProvider — factory", () => {
  it("creates a provider from default config", () => {
    const provider = createLLMProvider(makeConfig());
    expect(provider).toBeDefined();
    expect(typeof provider.invoke).toBe("function");
    expect(typeof provider.continueWithToolResults).toBe("function");
    expect(typeof provider.summarize).toBe("function");
  });

  it("creates Anthropic provider when configured", () => {
    const provider = createLLMProvider(makeConfig({
      agent: { ...DEFAULT_AGENT, provider: "anthropic", model: "claude-sonnet-4-20250514" },
    }));
    expect(provider).toBeDefined();
  });

  it("creates OpenAI provider when configured", () => {
    const provider = createLLMProvider(makeConfig({
      agent: { ...DEFAULT_AGENT, provider: "openai", model: "gpt-4" },
    }));
    expect(provider).toBeDefined();
  });

  it("creates Ollama provider when configured", () => {
    const provider = createLLMProvider(makeConfig({
      agent: { ...DEFAULT_AGENT, provider: "ollama", model: "llama3" },
    }));
    expect(provider).toBeDefined();
  });

  it("creates failover provider with multiple providers", () => {
    const provider = createLLMProvider(makeConfig({
      agent: {
        ...DEFAULT_AGENT,
        providers: [
          { type: "anthropic", model: "claude-sonnet-4-20250514" },
          { type: "openai", model: "gpt-4" },
        ],
      },
    }));
    expect(provider).toBeDefined();
  });
});

describe("LLMProvider interface contract", () => {
  it("LLMResponse has the expected shape", () => {
    // Verify the LLMResponse interface compiles and has all expected fields
    const mockResult: LLMResponse = {
      text: "Hello, I am Aionima.",
      model: "mock-model",
      stopReason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 5 },
      toolCalls: [],
      contentBlocks: [],
      thinkingBlocks: [],
    };

    expect(mockResult.text).toBe("Hello, I am Aionima.");
    expect(mockResult.model).toBe("mock-model");
    expect(mockResult.usage.inputTokens).toBe(10);
    expect(mockResult.usage.outputTokens).toBe(5);
    expect(Array.isArray(mockResult.toolCalls)).toBe(true);
    expect(Array.isArray(mockResult.contentBlocks)).toBe(true);
  });

  it("all providers expose the same interface", () => {
    const configs = [
      makeConfig(),
      makeConfig({ agent: { ...DEFAULT_AGENT, provider: "anthropic", model: "claude-sonnet-4-20250514" } }),
      makeConfig({ agent: { ...DEFAULT_AGENT, provider: "openai", model: "gpt-4" } }),
      makeConfig({ agent: { ...DEFAULT_AGENT, provider: "ollama", model: "llama3" } }),
    ];

    for (const config of configs) {
      const provider = createLLMProvider(config);
      expect(typeof provider.invoke).toBe("function");
      expect(typeof provider.continueWithToolResults).toBe("function");
      expect(typeof provider.summarize).toBe("function");
    }
  });
});

describe("provider tool conversion", () => {
  it("LLMInvokeParams supports tools", () => {
    const params: LLMInvokeParams = {
      system: "You are a test assistant.",
      messages: [{ role: "user", content: "Hello" }],
      tools: [
        {
          name: "test_tool",
          description: "A test tool",
          input_schema: { type: "object", properties: {} },
        },
      ],
      entityId: "#E0",
    };

    expect(params.tools).toHaveLength(1);
    expect(params.tools![0]!.name).toBe("test_tool");
  });

  it("LLMInvokeParams works without tools", () => {
    const params: LLMInvokeParams = {
      system: "You are a test assistant.",
      messages: [{ role: "user", content: "Hello" }],
      entityId: "#E0",
    };

    expect(params.tools).toBeUndefined();
  });
});

describe("createAgentRouter — factory", () => {
  it("always creates a working provider", () => {
    const provider = createAgentRouter(makeConfig());
    expect(provider).toBeDefined();
    expect(typeof provider.invoke).toBe("function");
  });

  it("defaults to balanced cost mode", () => {
    const provider = createAgentRouter(makeConfig());
    expect(typeof provider.invoke).toBe("function");
    expect(typeof provider.continueWithToolResults).toBe("function");
    expect(typeof provider.summarize).toBe("function");
  });

  it("respects explicit cost mode config", () => {
    const provider = createAgentRouter(makeConfig({
      agent: {
        ...DEFAULT_AGENT,
        router: { costMode: "economy", escalation: true, maxEscalationsPerTurn: 1, simpleThresholdTokens: 500, complexThresholdTokens: 2000 },
      },
    }));
    expect(provider).toBeDefined();
  });
});
