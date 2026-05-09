import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import type { AionimaConfig } from "@agi/config";
import { registerProvidersRoutes, timeoutMultiplierForTier, type ProviderCatalogEntry, type ActiveProviderState } from "./providers-api.js";

function makeApp(
  config: Partial<AionimaConfig>,
  opts: {
    inspect?: () => Promise<Array<Pick<ProviderCatalogEntry, "id" | "health" | "modelCount">>>;
    patch?: (dotPath: string, value: unknown) => void;
    omitPatch?: boolean;
  } = {},
) {
  const app = Fastify({ logger: false });
  // Stateful config so PUT tests observe their own writes via subsequent reads.
  const liveConfig: Record<string, unknown> = JSON.parse(JSON.stringify(config));
  registerProvidersRoutes(app, {
    readConfig: () => liveConfig as AionimaConfig,
    inspectProviders: opts.inspect,
    patchConfig: opts.omitPatch === true ? undefined : (opts.patch ?? ((dotPath, value) => {
      const keys = dotPath.split(".");
      let current = liveConfig;
      for (let i = 0; i < keys.length - 1; i++) {
        const k = keys[i]!;
        if (current[k] == null || typeof current[k] !== "object") current[k] = {};
        current = current[k] as Record<string, unknown>;
      }
      const leaf = keys[keys.length - 1]!;
      if (value == null) delete current[leaf]; else current[leaf] = value;
    })),
  });
  return app;
}

describe("providers-api — GET /api/providers (s111 t372)", () => {
  it("returns the canonical 6-Provider catalog with stable tiers", async () => {
    const app = makeApp({});
    const res = await app.inject({ method: "GET", url: "/api/providers/catalog" });
    expect(res.statusCode).toBe(200);

    const body = res.json() as { providers: ProviderCatalogEntry[]; generatedAt: string };
    expect(body.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const ids = body.providers.map((p) => p.id);
    expect(ids).toEqual([
      "aion-micro",
      "huggingface",
      "ollama",
      "lemonade",
      "anthropic",
      "openai",
    ]);

    expect(body.providers.find((p) => p.id === "aion-micro")?.tier).toBe("floor");
    expect(body.providers.find((p) => p.id === "huggingface")?.tier).toBe("core");
    expect(body.providers.find((p) => p.id === "ollama")?.tier).toBe("local");
    expect(body.providers.find((p) => p.id === "lemonade")?.tier).toBe("local");
    expect(body.providers.find((p) => p.id === "anthropic")?.tier).toBe("cloud");
    expect(body.providers.find((p) => p.id === "openai")?.tier).toBe("cloud");

    await app.close();
  });

  it("populates timeoutMultiplier per tier (s111 t411 — relaxed local timeouts)", async () => {
    const app = makeApp({});
    const res = await app.inject({ method: "GET", url: "/api/providers/catalog" });
    const body = res.json() as { providers: ProviderCatalogEntry[] };
    // Cloud Providers stay at the cloud-tuned 1.0 baseline.
    expect(body.providers.find((p) => p.id === "anthropic")?.timeoutMultiplier).toBe(1.0);
    expect(body.providers.find((p) => p.id === "openai")?.timeoutMultiplier).toBe(1.0);
    // Every non-cloud tier (floor/core/local) gets the relaxed 6.0 multiplier
    // because CPU-bound local inference can take 30-60s+ for first token alone.
    expect(body.providers.find((p) => p.id === "aion-micro")?.timeoutMultiplier).toBe(6.0);
    expect(body.providers.find((p) => p.id === "huggingface")?.timeoutMultiplier).toBe(6.0);
    expect(body.providers.find((p) => p.id === "ollama")?.timeoutMultiplier).toBe(6.0);
    expect(body.providers.find((p) => p.id === "lemonade")?.timeoutMultiplier).toBe(6.0);
    await app.close();
  });

  it("timeoutMultiplierForTier helper returns the right value for each tier", () => {
    expect(timeoutMultiplierForTier("cloud")).toBe(1.0);
    expect(timeoutMultiplierForTier("floor")).toBe(6.0);
    expect(timeoutMultiplierForTier("core")).toBe(6.0);
    expect(timeoutMultiplierForTier("local")).toBe(6.0);
  });

  it("populates defaultModel per Provider where applicable (s111 t416)", async () => {
    const app = makeApp({});
    const res = await app.inject({ method: "GET", url: "/api/providers/catalog" });
    const body = res.json() as { providers: ProviderCatalogEntry[] };
    // aion-micro mirrors factory.ts + AionMicroManager.DEFAULT_MODEL.
    expect(body.providers.find((p) => p.id === "aion-micro")?.defaultModel).toBe("wishborn/aion-micro-v1");
    // Local Provider defaults match factory.ts createSingleProvider switch.
    expect(body.providers.find((p) => p.id === "ollama")?.defaultModel).toBe("llama3.1");
    expect(body.providers.find((p) => p.id === "lemonade")?.defaultModel).toBe("default");
    // Cloud Providers omit defaultModel — agent.model config drives selection
    // on a per-call basis, so no useful default fits in the catalog.
    expect(body.providers.find((p) => p.id === "anthropic")?.defaultModel).toBeUndefined();
    expect(body.providers.find((p) => p.id === "openai")?.defaultModel).toBeUndefined();
    await app.close();
  });

  it("GET /api/providers/recent-decisions returns the ring buffer (s111 t419)", async () => {
    const stamp = "2026-04-26T01:23:45.000Z";
    const fakeDecisions = [
      { provider: "anthropic", model: "claude-haiku-4-5", reason: "balanced/simple", complexity: "simple", costMode: "balanced", escalated: false, ts: stamp },
      { provider: "lemonade", model: "default", reason: "local/moderate", complexity: "moderate", costMode: "local", escalated: false, ts: stamp },
    ];
    const app = Fastify({ logger: false });
    registerProvidersRoutes(app, {
      readConfig: () => ({} as AionimaConfig),
      getRecentDecisions: (limit) => fakeDecisions.slice(-limit),
    });
    const res = await app.inject({ method: "GET", url: "/api/providers/recent-decisions?limit=10" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { decisions: typeof fakeDecisions; generatedAt: string };
    expect(body.decisions.length).toBe(2);
    expect(body.decisions[1]!.provider).toBe("lemonade");
    expect(body.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    await app.close();
  });

  it("GET /api/providers/recent-decisions returns empty list when thunk omitted (s111 t419)", async () => {
    // Thunk-less fixture (test harness, early-boot stub provider). The
    // endpoint must not throw — UI hides the hero when decisions is empty.
    const app = makeApp({});
    const res = await app.inject({ method: "GET", url: "/api/providers/recent-decisions" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { decisions: unknown[] };
    expect(body.decisions).toEqual([]);
    await app.close();
  });

  it("declares aion-micro depends on lemonade for runtime serving (s111 t416)", async () => {
    const app = makeApp({});
    const res = await app.inject({ method: "GET", url: "/api/providers/catalog" });
    const body = res.json() as { providers: ProviderCatalogEntry[] };
    // aion-micro is served by the Lemonade backplane (Phase K.4) — the
    // catalog UI uses this to render "Requires: Lemonade" on the card and
    // to grey out aion-micro when its dependency is unhealthy.
    expect(body.providers.find((p) => p.id === "aion-micro")?.dependsOn).toEqual(["lemonade"]);
    // Other Providers have no inter-Provider dependencies — dependsOn is
    // omitted (undefined) rather than an empty array, matching the
    // optional-field convention in the rest of the catalog.
    expect(body.providers.find((p) => p.id === "ollama")?.dependsOn).toBeUndefined();
    expect(body.providers.find((p) => p.id === "lemonade")?.dependsOn).toBeUndefined();
    expect(body.providers.find((p) => p.id === "huggingface")?.dependsOn).toBeUndefined();
    expect(body.providers.find((p) => p.id === "anthropic")?.dependsOn).toBeUndefined();
    expect(body.providers.find((p) => p.id === "openai")?.dependsOn).toBeUndefined();
    await app.close();
  });

  it("marks cloud Providers without an API key as no-key", async () => {
    const app = makeApp({});
    const res = await app.inject({ method: "GET", url: "/api/providers/catalog" });
    const body = res.json() as { providers: ProviderCatalogEntry[] };
    const anthropic = body.providers.find((p) => p.id === "anthropic")!;
    const openai = body.providers.find((p) => p.id === "openai")!;
    expect(anthropic.health).toBe("no-key");
    expect(openai.health).toBe("no-key");
    await app.close();
  });

  it("marks cloud Providers with a configured API key as healthy", async () => {
    const app = makeApp({
      providers: { anthropic: { apiKey: "sk-test" }, openai: { apiKey: "sk-test" } },
    } as Partial<AionimaConfig>);
    const res = await app.inject({ method: "GET", url: "/api/providers/catalog" });
    const body = res.json() as { providers: ProviderCatalogEntry[] };
    expect(body.providers.find((p) => p.id === "anthropic")?.health).toBe("healthy");
    expect(body.providers.find((p) => p.id === "openai")?.health).toBe("healthy");
    await app.close();
  });

  it("local Providers + aion-micro + HF are all marked offGridCapable", async () => {
    const app = makeApp({});
    const res = await app.inject({ method: "GET", url: "/api/providers/catalog" });
    const body = res.json() as { providers: ProviderCatalogEntry[] };
    expect(body.providers.find((p) => p.id === "aion-micro")?.offGridCapable).toBe(true);
    expect(body.providers.find((p) => p.id === "huggingface")?.offGridCapable).toBe(true);
    expect(body.providers.find((p) => p.id === "ollama")?.offGridCapable).toBe(true);
    expect(body.providers.find((p) => p.id === "lemonade")?.offGridCapable).toBe(true);
    expect(body.providers.find((p) => p.id === "anthropic")?.offGridCapable).toBe(false);
    expect(body.providers.find((p) => p.id === "openai")?.offGridCapable).toBe(false);
    await app.close();
  });

  it("inspectProviders thunk results override config-only health + modelCount", async () => {
    const app = makeApp({}, {
      inspect: async () => [
        { id: "ollama", health: "healthy", modelCount: 5 },
        { id: "lemonade", health: "degraded", modelCount: 1 },
      ],
    });
    const res = await app.inject({ method: "GET", url: "/api/providers/catalog" });
    const body = res.json() as { providers: ProviderCatalogEntry[] };
    expect(body.providers.find((p) => p.id === "ollama")?.modelCount).toBe(5);
    expect(body.providers.find((p) => p.id === "lemonade")?.health).toBe("degraded");
    expect(body.providers.find((p) => p.id === "lemonade")?.modelCount).toBe(1);
    await app.close();
  });

  it("inspectProviders failures degrade silently to config-only catalog", async () => {
    const app = makeApp({}, { inspect: async () => { throw new Error("inspection failed"); } });
    const res = await app.inject({ method: "GET", url: "/api/providers/catalog" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { providers: ProviderCatalogEntry[] };
    expect(body.providers).toHaveLength(6);
    await app.close();
  });
});

describe("providers-api — GET /api/providers/active (s111 t372)", () => {
  it("returns active provider + router config from agent.* layout", async () => {
    const app = makeApp({
      agent: {
        provider: "ollama",
        model: "qwen2.5:7b-instruct",
        router: { costMode: "local", escalation: true, simpleThresholdTokens: 500, complexThresholdTokens: 2000, maxEscalationsPerTurn: 1 },
      },
    } as Partial<AionimaConfig>);
    const res = await app.inject({ method: "GET", url: "/api/providers/active" });
    const body = res.json() as ActiveProviderState;
    expect(body.activeProviderId).toBe("ollama");
    expect(body.activeModel).toBe("qwen2.5:7b-instruct");
    expect(body.router.costMode).toBe("local");
    expect(body.router.escalation).toBe(true);
    expect(body.router.simpleThresholdTokens).toBe(500);
    expect(body.router.complexThresholdTokens).toBe(2000);
    expect(body.router.maxEscalationsPerTurn).toBe(1);
    expect(body.offGridMode).toBe(false);
    await app.close();
  });

  it("falls back to anthropic + claude-sonnet-4-6 when agent block missing", async () => {
    const app = makeApp({});
    const res = await app.inject({ method: "GET", url: "/api/providers/active" });
    const body = res.json() as ActiveProviderState;
    expect(body.activeProviderId).toBe("anthropic");
    expect(body.activeModel).toBe("claude-sonnet-4-6");
    expect(body.router.costMode).toBe("balanced");
    expect(body.router.escalation).toBe(false);
    expect(body.offGridMode).toBe(false);
    await app.close();
  });
});

describe("providers-api — GET /api/providers/:id (s111 t372)", () => {
  it("returns the catalog entry for a known provider", async () => {
    const app = makeApp({});
    const res = await app.inject({ method: "GET", url: "/api/providers/catalog/aion-micro" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as ProviderCatalogEntry;
    expect(body.id).toBe("aion-micro");
    expect(body.tier).toBe("floor");
    expect(body.offGridCapable).toBe(true);
    await app.close();
  });

  it("returns 404 for unknown provider id", async () => {
    const app = makeApp({});
    const res = await app.inject({ method: "GET", url: "/api/providers/catalog/nope" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "unknown provider: nope" });
    await app.close();
  });
});

describe("providers-api — PUT /api/providers/active (s111 t372 slice 2/2)", () => {
  it("switches active provider + model and reflects the change in next GET", async () => {
    const app = makeApp({ agent: { provider: "anthropic", model: "claude-sonnet-4-6" } } as Partial<AionimaConfig>);
    const put = await app.inject({
      method: "PUT", url: "/api/providers/active",
      payload: { providerId: "ollama", model: "qwen2.5:7b-instruct" },
    });
    expect(put.statusCode).toBe(200);
    const body = put.json() as ActiveProviderState;
    expect(body.activeProviderId).toBe("ollama");
    expect(body.activeModel).toBe("qwen2.5:7b-instruct");

    const get = await app.inject({ method: "GET", url: "/api/providers/active" });
    expect((get.json() as ActiveProviderState).activeProviderId).toBe("ollama");
    await app.close();
  });

  it("rejects unknown providerId with 400 + valid-id list", async () => {
    const app = makeApp({});
    const res = await app.inject({
      method: "PUT", url: "/api/providers/active",
      payload: { providerId: "nope" },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: string; validIds: string[] };
    expect(body.error).toContain("unknown providerId");
    expect(body.validIds).toContain("aion-micro");
    expect(body.validIds).toContain("ollama");
    await app.close();
  });

  it("rejects missing providerId with 400", async () => {
    const app = makeApp({});
    const res = await app.inject({ method: "PUT", url: "/api/providers/active", payload: {} });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toContain("providerId required");
    await app.close();
  });

  it("returns 503 when patchConfig is not wired", async () => {
    const app = makeApp({}, { omitPatch: true });
    const res = await app.inject({
      method: "PUT", url: "/api/providers/active",
      payload: { providerId: "ollama" },
    });
    expect(res.statusCode).toBe(503);
    await app.close();
  });
});

describe("providers-api — PUT /api/providers/router (s111 t372 slice 2/2)", () => {
  it("patches costMode + escalation + thresholds atomically", async () => {
    const app = makeApp({ agent: { router: { costMode: "balanced", escalation: false } } } as Partial<AionimaConfig>);
    const res = await app.inject({
      method: "PUT", url: "/api/providers/router",
      payload: {
        costMode: "local",
        escalation: true,
        simpleThresholdTokens: 500,
        complexThresholdTokens: 2000,
        maxEscalationsPerTurn: 1,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as ActiveProviderState;
    expect(body.router.costMode).toBe("local");
    expect(body.router.escalation).toBe(true);
    expect(body.router.simpleThresholdTokens).toBe(500);
    expect(body.router.complexThresholdTokens).toBe(2000);
    expect(body.router.maxEscalationsPerTurn).toBe(1);
    await app.close();
  });

  it("toggles offGridMode (off-grid framing per memory feedback_off_grid_means_any_local_model)", async () => {
    const app = makeApp({});
    const res = await app.inject({
      method: "PUT", url: "/api/providers/router",
      payload: { offGridMode: true },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as ActiveProviderState).offGridMode).toBe(true);
    await app.close();
  });

  it("rejects invalid costMode with detailed validation error", async () => {
    const app = makeApp({});
    const res = await app.inject({
      method: "PUT", url: "/api/providers/router",
      payload: { costMode: "extreme" },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: string; details: string[] };
    expect(body.error).toBe("validation failed");
    expect(body.details.join(" ")).toContain("local|economy|balanced|max");
    await app.close();
  });

  it("rejects negative threshold tokens", async () => {
    const app = makeApp({});
    const res = await app.inject({
      method: "PUT", url: "/api/providers/router",
      payload: { simpleThresholdTokens: -1, complexThresholdTokens: 0 },
    });
    expect(res.statusCode).toBe(400);
    const details = (res.json() as { details: string[] }).details;
    expect(details).toContain("simpleThresholdTokens must be a positive integer");
    expect(details).toContain("complexThresholdTokens must be a positive integer");
    await app.close();
  });

  it("rejects non-boolean escalation / offGridMode", async () => {
    const app = makeApp({});
    const res = await app.inject({
      method: "PUT", url: "/api/providers/router",
      payload: { escalation: "yes" as unknown as boolean, offGridMode: 1 as unknown as boolean },
    });
    expect(res.statusCode).toBe(400);
    const details = (res.json() as { details: string[] }).details;
    expect(details).toContain("escalation must be boolean");
    expect(details).toContain("offGridMode must be boolean");
    await app.close();
  });

  it("returns 503 when patchConfig is not wired", async () => {
    const app = makeApp({}, { omitPatch: true });
    const res = await app.inject({
      method: "PUT", url: "/api/providers/router",
      payload: { costMode: "local" },
    });
    expect(res.statusCode).toBe(503);
    await app.close();
  });

  it("partial patches leave other router fields untouched", async () => {
    const app = makeApp({
      agent: { router: { costMode: "balanced", escalation: true, simpleThresholdTokens: 500, complexThresholdTokens: 2000 } },
    } as Partial<AionimaConfig>);
    const res = await app.inject({
      method: "PUT", url: "/api/providers/router",
      payload: { costMode: "local" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as ActiveProviderState;
    expect(body.router.costMode).toBe("local");
    expect(body.router.escalation).toBe(true);
    expect(body.router.simpleThresholdTokens).toBe(500);
    expect(body.router.complexThresholdTokens).toBe(2000);
    await app.close();
  });
});

describe("providers-api — PUT /api/providers/router floor/ceiling (s129 t510)", () => {
  it("patches floor + ceiling + escalation triggers atomically", async () => {
    const app = makeApp({});
    const res = await app.inject({
      method: "PUT", url: "/api/providers/router",
      payload: {
        floor: "economy",
        ceiling: "max",
        escalateOnLowConfidence: true,
        escalateOnTimeoutSec: 30,
        parallelRace: true,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as ActiveProviderState;
    expect(body.router.floor).toBe("economy");
    expect(body.router.ceiling).toBe("max");
    expect(body.router.escalateOnLowConfidence).toBe(true);
    expect(body.router.escalateOnTimeoutSec).toBe(30);
    expect(body.router.parallelRace).toBe(true);
    await app.close();
  });

  it("rejects floor > ceiling on the tier scale", async () => {
    const app = makeApp({});
    const res = await app.inject({
      method: "PUT", url: "/api/providers/router",
      payload: { floor: "max", ceiling: "local" },
    });
    expect(res.statusCode).toBe(400);
    const details = (res.json() as { details: string[] }).details;
    expect(details.join(" ")).toContain("floor must be <= ceiling");
    await app.close();
  });

  it("rejects invalid tier values for floor/ceiling", async () => {
    const app = makeApp({});
    const res = await app.inject({
      method: "PUT", url: "/api/providers/router",
      payload: { floor: "extreme", ceiling: "ultra" },
    });
    expect(res.statusCode).toBe(400);
    const details = (res.json() as { details: string[] }).details;
    expect(details.some((d) => d.startsWith("floor must be one of"))).toBe(true);
    expect(details.some((d) => d.startsWith("ceiling must be one of"))).toBe(true);
    await app.close();
  });

  it("accepts escalateOnTimeoutSec=null (off) but rejects 0 or negative", async () => {
    const app = makeApp({});
    const okRes = await app.inject({
      method: "PUT", url: "/api/providers/router",
      payload: { escalateOnTimeoutSec: null },
    });
    expect(okRes.statusCode).toBe(200);

    const badRes = await app.inject({
      method: "PUT", url: "/api/providers/router",
      payload: { escalateOnTimeoutSec: 0 },
    });
    expect(badRes.statusCode).toBe(400);
    const details = (badRes.json() as { details: string[] }).details;
    expect(details.join(" ")).toContain("escalateOnTimeoutSec must be null or a positive integer");
    await app.close();
  });

  it("derives floor/ceiling on read when only legacy costMode is set", async () => {
    const app = makeApp({
      agent: { router: { costMode: "economy", escalation: true } },
    } as Partial<AionimaConfig>);
    const res = await app.inject({ method: "GET", url: "/api/providers/active" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as ActiveProviderState;
    expect(body.router.floor).toBe("economy");
    expect(body.router.ceiling).toBe("max");
    expect(body.router.escalateOnLowConfidence).toBe(true);
    await app.close();
  });
});

describe("providers-api — GET /api/providers/:id/models (cycle 140)", () => {
  it("returns 404 for unknown provider ids", async () => {
    const app = makeApp({});
    const res = await app.inject({ method: "GET", url: "/api/providers/bogus/models" });
    expect(res.statusCode).toBe(404);
    const body = res.json() as { error: string; validIds: string[] };
    expect(body.error).toMatch(/unknown provider/);
    expect(body.validIds).toContain("ollama");
    expect(body.validIds).toContain("lemonade");
    await app.close();
  });

  it("returns the hardcoded aion-micro model entry", async () => {
    const app = makeApp({});
    const res = await app.inject({ method: "GET", url: "/api/providers/aion-micro/models" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { models: Array<{ id: string; label?: string }> | null };
    expect(body.models).not.toBeNull();
    expect(body.models).toHaveLength(1);
    const [m] = body.models!;
    expect(m?.id).toBe("wishborn/aion-micro-v1");
    expect(m?.label).toBe("aion-micro v1");
    await app.close();
  });

  it("returns null for huggingface (delegated to /api/hf/models)", async () => {
    const app = makeApp({});
    const res = await app.inject({ method: "GET", url: "/api/providers/huggingface/models" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { models: unknown };
    expect(body.models).toBeNull();
    await app.close();
  });

  it("returns null for cloud providers without an API key (anthropic, openai)", async () => {
    // Cycle 142: with no apiKey configured AND no env var, getModelsForBuiltin
    // short-circuits to null before any fetch. We clear env vars defensively
    // since the test runner may inherit them from the dev shell.
    const prevAnth = process.env["ANTHROPIC_API_KEY"];
    const prevOpenai = process.env["OPENAI_API_KEY"];
    delete process.env["ANTHROPIC_API_KEY"];
    delete process.env["OPENAI_API_KEY"];
    try {
      const app = makeApp({});
      for (const id of ["anthropic", "openai"]) {
        const res = await app.inject({ method: "GET", url: `/api/providers/${id}/models` });
        expect(res.statusCode).toBe(200);
        const body = res.json() as { models: unknown };
        expect(body.models).toBeNull();
      }
      await app.close();
    } finally {
      if (prevAnth !== undefined) process.env["ANTHROPIC_API_KEY"] = prevAnth;
      if (prevOpenai !== undefined) process.env["OPENAI_API_KEY"] = prevOpenai;
    }
  });

  it("returns null when anthropic API rejects the key (401)", async () => {
    // Cycle 142: with a clearly-bad key, the live REST call returns 401 →
    // res.ok is false → we return null. No mocking needed; api.anthropic.com
    // is reachable from the test VM with internet.
    const app = makeApp({
      providers: { anthropic: { apiKey: "sk-ant-invalid-test-key" } } as Record<string, unknown>,
    } as Partial<AionimaConfig>);
    const res = await app.inject({ method: "GET", url: "/api/providers/anthropic/models" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { models: unknown };
    expect(body.models).toBeNull();
    await app.close();
  }, 15_000);

  it("returns null when openai API rejects the key (401)", async () => {
    const app = makeApp({
      providers: { openai: { apiKey: "sk-invalid-test-key" } } as Record<string, unknown>,
    } as Partial<AionimaConfig>);
    const res = await app.inject({ method: "GET", url: "/api/providers/openai/models" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { models: unknown };
    expect(body.models).toBeNull();
    await app.close();
  }, 15_000);

  it("returns null when ollama is unreachable (network errors swallowed)", async () => {
    // Default config has no ollama baseUrl → falls back to 127.0.0.1:11434.
    // Test VM may or may not have Ollama running; either way, the contract
    // is "errors swallowed → null." If Ollama IS running, this test still
    // proves the success-path codepath returns models[].
    const app = makeApp({
      providers: { ollama: { baseUrl: "http://127.0.0.1:1" } } as Record<string, unknown>,
    } as Partial<AionimaConfig>);
    const res = await app.inject({ method: "GET", url: "/api/providers/ollama/models" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { models: unknown };
    // Port 1 is reserved (TCPMUX), refuses connection → null
    expect(body.models).toBeNull();
    await app.close();
  });

  it("returns null when lemonade is unreachable", async () => {
    const app = makeApp({
      providers: { lemonade: { baseUrl: "http://127.0.0.1:1" } } as Record<string, unknown>,
    } as Partial<AionimaConfig>);
    const res = await app.inject({ method: "GET", url: "/api/providers/lemonade/models" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { models: unknown };
    expect(body.models).toBeNull();
    await app.close();
  });
});
