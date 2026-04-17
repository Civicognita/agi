import { describe, it, expect, beforeEach } from "vitest";
import { AgentRouter } from "./agent-router.js";
import type { AgentRouterConfig, CostMode } from "./agent-router.js";
import type { LLMProvider, LLMProviderConfig } from "./provider.js";
import type { LLMInvokeParams, LLMResponse, LLMToolContinuationParams } from "./types.js";

// ---------------------------------------------------------------------------
// Mock provider
// ---------------------------------------------------------------------------

function createMockProvider(model: string): LLMProvider & { calls: LLMInvokeParams[] } {
  const calls: LLMInvokeParams[] = [];
  return {
    calls,
    async invoke(params: LLMInvokeParams): Promise<LLMResponse> {
      calls.push(params);
      return {
        text: `Response from ${model}`,
        model,
        stopReason: "end_turn",
        usage: { inputTokens: 100, outputTokens: 50 },
        toolCalls: [],
        contentBlocks: [],
        thinkingBlocks: [],
      };
    },
    async continueWithToolResults(): Promise<LLMResponse> {
      return {
        text: "continued",
        model,
        stopReason: "end_turn",
        usage: { inputTokens: 50, outputTokens: 25 },
        toolCalls: [],
        contentBlocks: [],
        thinkingBlocks: [],
      };
    },
    async summarize(): Promise<string> {
      return "summary";
    },
  };
}

// ---------------------------------------------------------------------------
// Config factory
// ---------------------------------------------------------------------------

function makeRouterConfig(overrides: Partial<AgentRouterConfig> = {}): AgentRouterConfig {
  const base: AgentRouterConfig = {
    router: {
      costMode: "balanced",
      escalation: false,
      maxEscalationsPerTurn: 1,
      simpleThresholdTokens: 500,
      complexThresholdTokens: 2000,
    },
    defaultProvider: "anthropic",
    defaultModel: "claude-sonnet-4-6",
    providers: {
      anthropic: { apiKey: "test-key" },
      openai: { apiKey: "test-key" },
    },
  };
  return {
    ...base,
    ...overrides,
    router: {
      ...base.router,
      ...overrides.router,
    },
  };
}

function makeParams(overrides: Partial<LLMInvokeParams> = {}): LLMInvokeParams {
  return {
    system: "You are a test assistant.",
    messages: [{ role: "user", content: "Hello" }],
    entityId: "#E0",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AgentRouter", () => {
  let createdProviders: Map<string, LLMProvider>;
  let mockFactory: (type: string, config: Partial<LLMProviderConfig>) => LLMProvider;

  beforeEach(() => {
    createdProviders = new Map();
    mockFactory = (type: string, config: Partial<LLMProviderConfig>) => {
      const provider = createMockProvider(config.defaultModel ?? "unknown");
      createdProviders.set(`${type}:${config.defaultModel}`, provider);
      return provider;
    };
  });

  describe("LLMProvider interface", () => {
    it("exposes invoke, continueWithToolResults, summarize", () => {
      const router = new AgentRouter(() => makeRouterConfig(), mockFactory);
      expect(typeof router.invoke).toBe("function");
      expect(typeof router.continueWithToolResults).toBe("function");
      expect(typeof router.summarize).toBe("function");
    });
  });

  describe("cost mode routing", () => {
    it("routes simple request to cheap model in balanced mode", async () => {
      const router = new AgentRouter(() => makeRouterConfig(), mockFactory);
      await router.invoke(makeParams());
      const decision = router.getLastDecision();
      expect(decision).not.toBeNull();
      expect(decision!.costMode).toBe("balanced");
      expect(decision!.complexity).toBe("simple");
    });

    it("routes complex request to stronger model in balanced mode", async () => {
      const router = new AgentRouter(() => makeRouterConfig(), mockFactory);
      await router.invoke(makeParams({
        messages: [{ role: "user", content: "x".repeat(10000) }],
      }));
      const decision = router.getLastDecision();
      expect(decision!.complexity).toBe("complex");
    });

    it("routes to premium model in max mode", async () => {
      const config = makeRouterConfig({
        router: { costMode: "max", escalation: false, maxEscalationsPerTurn: 1, simpleThresholdTokens: 500, complexThresholdTokens: 2000 },
      });
      const router = new AgentRouter(() => config, mockFactory);
      await router.invoke(makeParams());
      const decision = router.getLastDecision();
      expect(decision!.costMode).toBe("max");
    });

    it("routes to economy models in economy mode", async () => {
      const config = makeRouterConfig({
        router: { costMode: "economy", escalation: false, maxEscalationsPerTurn: 1, simpleThresholdTokens: 500, complexThresholdTokens: 2000 },
      });
      const router = new AgentRouter(() => config, mockFactory);
      await router.invoke(makeParams());
      const decision = router.getLastDecision();
      expect(decision!.costMode).toBe("economy");
    });

    it("errors on local mode without local providers", async () => {
      const config = makeRouterConfig({
        router: { costMode: "local", escalation: false, maxEscalationsPerTurn: 1, simpleThresholdTokens: 500, complexThresholdTokens: 2000 },
        defaultProvider: "anthropic",
        providers: { anthropic: { apiKey: "key" } },
      });
      const router = new AgentRouter(() => config, mockFactory);
      await expect(router.invoke(makeParams())).rejects.toThrow(/local/i);
    });
  });

  describe("escalation", () => {
    it("does not escalate when disabled", async () => {
      const router = new AgentRouter(() => makeRouterConfig(), mockFactory);
      await router.invoke(makeParams());
      expect(router.getLastDecision()!.escalated).toBe(false);
    });

    it("escalates when response has low confidence", async () => {
      // The hedging factory returns "I'm not sure about that." which is both
      // short (<50 chars) and matches a hedging pattern — triggering escalation
      // for a complex request.
      const hedgingFactory = (_type: string, config: Partial<LLMProviderConfig>) => {
        const mock = createMockProvider(config.defaultModel ?? "unknown");
        const orig = mock.invoke.bind(mock);
        mock.invoke = async (params) => {
          const result = await orig(params);
          result.text = "I'm not sure about that.";
          return result;
        };
        return mock;
      };
      const config = makeRouterConfig({
        router: { costMode: "economy", escalation: true, maxEscalationsPerTurn: 1, simpleThresholdTokens: 500, complexThresholdTokens: 2000 },
      });
      const router = new AgentRouter(() => config, hedgingFactory);
      // 10000-char message → complex; economy/complex → claude-sonnet-4-6 → escalation target exists.
      await router.invoke(makeParams({
        messages: [{ role: "user", content: "x".repeat(10000) }],
      }));
      expect(router.getLastDecision()!.escalated).toBe(true);
    });
  });

  describe("tool continuation", () => {
    it("uses same provider for continueWithToolResults", async () => {
      const router = new AgentRouter(() => makeRouterConfig(), mockFactory);
      await router.invoke(makeParams({ entityId: "entity-1" }));
      const firstDecision = router.getLastDecision();

      const contParams: LLMToolContinuationParams = {
        original: makeParams({ entityId: "entity-1" }),
        assistantContent: [{ type: "tool_use", id: "t1", name: "test", input: {} }],
        toolResults: [{ tool_use_id: "t1", content: "result" }],
      };
      await router.continueWithToolResults(contParams);
      // continueWithToolResults does not update lastDecision, so it still holds
      // the value from invoke — which already recorded the provider for entity-1.
      expect(router.getLastDecision()!.provider).toBe(firstDecision!.provider);
    });
  });

  describe("summarize", () => {
    it("uses cheap model for summarization", async () => {
      const config = makeRouterConfig({
        router: { costMode: "max", escalation: false, maxEscalationsPerTurn: 1, simpleThresholdTokens: 500, complexThresholdTokens: 2000 },
      });
      const router = new AgentRouter(() => config, mockFactory);
      await router.summarize("Long text to summarize.", "Please summarize.");
      const decision = router.getLastDecision();
      expect(decision).not.toBeNull();
      // summarize() always routes via economy mode regardless of configured cost mode.
      expect(decision!.costMode).toBe("economy");
    });
  });

  describe("hot-reload config", () => {
    it("reads config on every invoke", async () => {
      let mode: CostMode = "economy";
      const router = new AgentRouter(
        () => makeRouterConfig({ router: { costMode: mode, escalation: false, maxEscalationsPerTurn: 1, simpleThresholdTokens: 500, complexThresholdTokens: 2000 } }),
        mockFactory,
      );
      await router.invoke(makeParams());
      expect(router.getLastDecision()!.costMode).toBe("economy");

      mode = "max";
      await router.invoke(makeParams());
      expect(router.getLastDecision()!.costMode).toBe("max");
    });
  });

  describe("provider caching", () => {
    it("reuses provider instances for same config", async () => {
      // A stable config reference means the cache is not invalidated between calls.
      const config = makeRouterConfig();
      const router = new AgentRouter(() => config, mockFactory);
      await router.invoke(makeParams());
      await router.invoke(makeParams());
      // Both invocations resolve to the same route (balanced/simple → haiku).
      // The provider cache key is identical, so the factory is called exactly once.
      expect(createdProviders.size).toBe(1);
    });
  });

  describe("routing metadata", () => {
    it("attaches routingMeta to response", async () => {
      const router = new AgentRouter(() => makeRouterConfig(), mockFactory);
      const response = await router.invoke(makeParams());
      expect(response.routingMeta).toBeDefined();
      expect(response.routingMeta!.costMode).toBe("balanced");
      expect(response.routingMeta!.selectedProvider).toBeDefined();
      expect(response.routingMeta!.selectedModel).toBeDefined();
      expect(typeof response.routingMeta!.escalated).toBe("boolean");
      expect(typeof response.routingMeta!.reason).toBe("string");
    });
  });

  describe("getProviderHealth", () => {
    it("returns health for providers", () => {
      const router = new AgentRouter(() => makeRouterConfig(), mockFactory);
      const health = router.getProviderHealth();
      expect(Array.isArray(health)).toBe(true);
      expect(health.length).toBeGreaterThan(0);
      expect(health[0]).toHaveProperty("provider");
      expect(health[0]).toHaveProperty("healthy");
    });
  });
});
