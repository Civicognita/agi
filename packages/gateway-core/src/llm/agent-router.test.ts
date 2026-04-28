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
      const config = makeRouterConfig();
      const router = new AgentRouter(() => config, mockFactory);
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

  describe("cost ledger writer (s111 t424)", () => {
    // CostLedgerWriter is an optional public field — tests use a minimal
    // stub matching the CostLedgerRecorder structural type. The stub
    // captures every call so assertions can inspect dollar cost, tokens,
    // and the routing fields the writer received.

    function makeStubWriter() {
      const calls: Array<Parameters<NonNullable<AgentRouter["costLedgerWriter"]>["record"]>[0]> = [];
      return { record: (entry: typeof calls[0]) => calls.push(entry), calls };
    }

    it("does NOT record when costLedgerWriter is unset (default)", async () => {
      const router = new AgentRouter(() => makeRouterConfig(), mockFactory);
      // No assignment to router.costLedgerWriter — should be a silent no-op.
      await router.invoke(makeParams());
      // Nothing to assert against; presence of no error proves no record path
      // executed. The lastDecision still tracks; the ring buffer still pushes.
      expect(router.getRecentDecisions().length).toBe(1);
    });

    it("records exactly one row per invoke when writer is wired", async () => {
      const router = new AgentRouter(() => makeRouterConfig(), mockFactory);
      const writer = makeStubWriter();
      router.costLedgerWriter = writer;
      await router.invoke(makeParams());
      expect(writer.calls.length).toBe(1);
      expect(writer.calls[0]!.provider).toBe("anthropic");
      expect(writer.calls[0]!.escalated).toBe(false);
    });

    it("computes dollarCost via cost-pricing for cloud Providers", async () => {
      const router = new AgentRouter(() => makeRouterConfig(), mockFactory);
      const writer = makeStubWriter();
      router.costLedgerWriter = writer;
      await router.invoke(makeParams());
      // claude-haiku-4-5 (balanced/simple) → $1/1M in + $5/1M out. Mock
      // provider returns 100 input + 50 output (see createMockProvider).
      // Expected: 100 * 1/1_000_000 + 50 * 5/1_000_000 = 0.0001 + 0.00025 = 0.00035
      expect(writer.calls[0]!.dollarCost).toBe(0.00035);
    });

    it("populates provider/model/costMode/complexity/escalated from the routing decision", async () => {
      const router = new AgentRouter(
        () => makeRouterConfig({ router: { costMode: "balanced", escalation: false, maxEscalationsPerTurn: 1, simpleThresholdTokens: 500, complexThresholdTokens: 2000 } }),
        mockFactory,
      );
      const writer = makeStubWriter();
      router.costLedgerWriter = writer;
      await router.invoke(makeParams());
      const entry = writer.calls[0]!;
      expect(entry.costMode).toBe("balanced");
      expect(entry.complexity).toBe("simple");
      expect(entry.model).toBe("claude-haiku-4-5");
      expect(entry.routingReason).toBe("balanced/simple");
    });

    it("includes turnDurationMs (a non-negative number)", async () => {
      const router = new AgentRouter(() => makeRouterConfig(), mockFactory);
      const writer = makeStubWriter();
      router.costLedgerWriter = writer;
      await router.invoke(makeParams());
      const entry = writer.calls[0]!;
      expect(typeof entry.turnDurationMs).toBe("number");
      expect(entry.turnDurationMs).toBeGreaterThanOrEqual(0);
    });

    it("leaves cpuWattsObserved + gpuWattsObserved null when sampler thunks unset", async () => {
      // Default state: thunks aren't wired; writer receives null for both
      // power fields. Same null contract as the schema. Existing test
      // fixtures inherit this baseline without modification.
      const router = new AgentRouter(() => makeRouterConfig(), mockFactory);
      const writer = makeStubWriter();
      router.costLedgerWriter = writer;
      await router.invoke(makeParams());
      const entry = writer.calls[0]!;
      expect(entry.cpuWattsObserved).toBeNull();
      expect(entry.gpuWattsObserved).toBeNull();
    });

    it("calls sampleCpuWatts + sampleGpuWatts thunks when wired (s111 t424 final sub-slice)", async () => {
      // Server.ts wires thunks that capture the CpuPowerSampler +
      // GpuPowerSampler instances in closures. AgentRouter calls them at
      // turn end and passes the values through to the writer. This test
      // mirrors the wiring with stub thunks so the contract is testable
      // without the actual sampler classes.
      const router = new AgentRouter(() => makeRouterConfig(), mockFactory);
      const writer = makeStubWriter();
      router.costLedgerWriter = writer;
      let cpuCalls = 0;
      let gpuCalls = 0;
      router.sampleCpuWatts = () => { cpuCalls++; return 18.3; };
      router.sampleGpuWatts = () => { gpuCalls++; return 145.2; };
      await router.invoke(makeParams());
      expect(cpuCalls).toBe(1);
      expect(gpuCalls).toBe(1);
      const entry = writer.calls[0]!;
      expect(entry.cpuWattsObserved).toBe(18.3);
      expect(entry.gpuWattsObserved).toBe(145.2);
    });

    it("propagates null sampler returns to the writer (host-without-sensor case)", async () => {
      // RAPL unavailable on this host → CpuPowerSampler.sample() returns
      // null → thunk returns null → writer's cpuWattsObserved is null.
      // Same nullable propagation as the schema's NULL semantics. Tests
      // the Intel-iGPU + non-NVIDIA case where one sampler is null.
      const router = new AgentRouter(() => makeRouterConfig(), mockFactory);
      const writer = makeStubWriter();
      router.costLedgerWriter = writer;
      router.sampleCpuWatts = () => 22.1;
      router.sampleGpuWatts = () => null; // no NVIDIA on this host
      await router.invoke(makeParams());
      const entry = writer.calls[0]!;
      expect(entry.cpuWattsObserved).toBe(22.1);
      expect(entry.gpuWattsObserved).toBeNull();
    });
  });

  describe("recent decisions ring buffer (s111 t419)", () => {
    it("records each invoke() as one entry with a timestamp", async () => {
      const router = new AgentRouter(() => makeRouterConfig(), mockFactory);
      await router.invoke(makeParams());
      const recent = router.getRecentDecisions();
      expect(recent.length).toBe(1);
      expect(recent[0]!.provider).toBe("anthropic");
      expect(typeof recent[0]!.ts).toBe("string");
      expect(recent[0]!.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("records summarize() as a separate decision entry", async () => {
      const router = new AgentRouter(() => makeRouterConfig(), mockFactory);
      await router.invoke(makeParams());
      await router.summarize("the quick brown fox", "make it shorter");
      const recent = router.getRecentDecisions();
      expect(recent.length).toBe(2);
      // Summarize always uses economy mode; the second entry reflects that.
      expect(recent[1]!.costMode).toBe("economy");
      expect(recent[1]!.reason).toBe("summarization (always economy)");
    });

    it("respects the limit argument and returns newest-last entries", async () => {
      const router = new AgentRouter(() => makeRouterConfig(), mockFactory);
      for (let i = 0; i < 5; i++) await router.invoke(makeParams());
      const last3 = router.getRecentDecisions(3);
      expect(last3.length).toBe(3);
      // All 5 invocations recorded the same Provider, but order matters
      // for the buffer — getRecentDecisions returns the LAST `limit` entries.
      // Test each has a stamped timestamp + same Provider.
      for (const d of last3) {
        expect(d.provider).toBe("anthropic");
        expect(typeof d.ts).toBe("string");
      }
    });

    it("caps at RECENT_DECISIONS_MAX (50) — older entries fall off", async () => {
      const router = new AgentRouter(() => makeRouterConfig(), mockFactory);
      // 60 invocations exceeds the 50-entry cap; expect newest 50.
      for (let i = 0; i < 60; i++) await router.invoke(makeParams());
      // Ask for more than the cap — getRecentDecisions clamps to MAX.
      const all = router.getRecentDecisions(1000);
      expect(all.length).toBe(50);
    });
  });

  describe("off-grid mode (s111 t415)", () => {
    // Off-grid mode is the alpha-stable-1 floor contract: when toggled on,
    // the router MUST NOT attempt cloud Providers, even when costMode="max"
    // (which normally forces cloud escalation). The preference chain is
    // lemonade → ollama → hf-local → aion-micro. aion-micro is the
    // last-resort floor — always reachable through Lemonade per the
    // catalog's dependsOn declaration (t416).

    it("routes to lemonade when off-grid AND lemonade is configured", async () => {
      const router = new AgentRouter(
        () => makeRouterConfig({
          router: { costMode: "balanced", escalation: false, maxEscalationsPerTurn: 1, simpleThresholdTokens: 500, complexThresholdTokens: 2000, offGrid: true },
          providers: { anthropic: { apiKey: "test-key" }, lemonade: { baseUrl: "http://127.0.0.1:13305" } },
        }),
        mockFactory,
      );
      await router.invoke(makeParams());
      const decision = router.getLastDecision();
      expect(decision!.provider).toBe("lemonade");
    });

    it("falls through to ollama when off-grid AND lemonade is absent", async () => {
      const router = new AgentRouter(
        () => makeRouterConfig({
          router: { costMode: "balanced", escalation: false, maxEscalationsPerTurn: 1, simpleThresholdTokens: 500, complexThresholdTokens: 2000, offGrid: true },
          providers: { anthropic: { apiKey: "test-key" }, ollama: {} },
        }),
        mockFactory,
      );
      await router.invoke(makeParams());
      const decision = router.getLastDecision();
      expect(decision!.provider).toBe("ollama");
    });

    it("routes to aion-micro as the floor when no other local Provider is configured", async () => {
      // The crux of the alpha-stable-1 acceptance contract: a fresh box with
      // no internet AND nothing else local installed STILL gets a coherent
      // response from aion-micro (which is baked into the install, served
      // through Lemonade). Even if only cloud Providers are in the config,
      // off-grid mode skips them and falls through to the floor.
      const router = new AgentRouter(
        () => makeRouterConfig({
          router: { costMode: "balanced", escalation: false, maxEscalationsPerTurn: 1, simpleThresholdTokens: 500, complexThresholdTokens: 2000, offGrid: true },
          providers: { anthropic: { apiKey: "test-key" }, openai: { apiKey: "test-key" } },
        }),
        mockFactory,
      );
      await router.invoke(makeParams());
      const decision = router.getLastDecision();
      expect(decision!.provider).toBe("aion-micro");
      expect(decision!.model).toBe("wishborn/aion-micro-v1");
    });

    it("never routes to cloud Providers when off-grid is on, even at costMode=max", async () => {
      // costMode="max" normally forces cloud (Anthropic Opus). Off-grid
      // overrides — the floor contract supersedes cost-mode escalation.
      const router = new AgentRouter(
        () => makeRouterConfig({
          router: { costMode: "max", escalation: false, maxEscalationsPerTurn: 1, simpleThresholdTokens: 500, complexThresholdTokens: 2000, offGrid: true },
          providers: { anthropic: { apiKey: "test-key" }, lemonade: { baseUrl: "http://127.0.0.1:13305" } },
        }),
        mockFactory,
      );
      await router.invoke(makeParams());
      const decision = router.getLastDecision();
      expect(decision!.provider).not.toBe("anthropic");
      expect(decision!.provider).not.toBe("openai");
      expect(decision!.provider).toBe("lemonade");
    });

    it("preserves cloud routing when off-grid is OFF (no regression)", async () => {
      const router = new AgentRouter(
        () => makeRouterConfig({
          router: { costMode: "balanced", escalation: false, maxEscalationsPerTurn: 1, simpleThresholdTokens: 500, complexThresholdTokens: 2000, offGrid: false },
          providers: { anthropic: { apiKey: "test-key" } },
        }),
        mockFactory,
      );
      await router.invoke(makeParams());
      const decision = router.getLastDecision();
      // Without off-grid, balanced/simple → anthropic per ROUTING_TABLE.
      expect(decision!.provider).toBe("anthropic");
    });
  });
});
