import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import type { AionimaConfig } from "@agi/config";
import { registerProvidersRoutes, type ProviderCatalogEntry, type ActiveProviderState } from "./providers-api.js";

function makeApp(config: Partial<AionimaConfig>, opts: { inspect?: () => Promise<Array<Pick<ProviderCatalogEntry, "id" | "health" | "modelCount">>> } = {}) {
  const app = Fastify({ logger: false });
  registerProvidersRoutes(app, {
    readConfig: () => config as AionimaConfig,
    inspectProviders: opts.inspect,
  });
  return app;
}

describe("providers-api — GET /api/providers (s111 t372)", () => {
  it("returns the canonical 6-Provider catalog with stable tiers", async () => {
    const app = makeApp({});
    const res = await app.inject({ method: "GET", url: "/api/providers" });
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

  it("marks cloud Providers without an API key as no-key", async () => {
    const app = makeApp({});
    const res = await app.inject({ method: "GET", url: "/api/providers" });
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
    const res = await app.inject({ method: "GET", url: "/api/providers" });
    const body = res.json() as { providers: ProviderCatalogEntry[] };
    expect(body.providers.find((p) => p.id === "anthropic")?.health).toBe("healthy");
    expect(body.providers.find((p) => p.id === "openai")?.health).toBe("healthy");
    await app.close();
  });

  it("local Providers + aion-micro + HF are all marked offGridCapable", async () => {
    const app = makeApp({});
    const res = await app.inject({ method: "GET", url: "/api/providers" });
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
    const res = await app.inject({ method: "GET", url: "/api/providers" });
    const body = res.json() as { providers: ProviderCatalogEntry[] };
    expect(body.providers.find((p) => p.id === "ollama")?.modelCount).toBe(5);
    expect(body.providers.find((p) => p.id === "lemonade")?.health).toBe("degraded");
    expect(body.providers.find((p) => p.id === "lemonade")?.modelCount).toBe(1);
    await app.close();
  });

  it("inspectProviders failures degrade silently to config-only catalog", async () => {
    const app = makeApp({}, { inspect: async () => { throw new Error("inspection failed"); } });
    const res = await app.inject({ method: "GET", url: "/api/providers" });
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
    const res = await app.inject({ method: "GET", url: "/api/providers/aion-micro" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as ProviderCatalogEntry;
    expect(body.id).toBe("aion-micro");
    expect(body.tier).toBe("floor");
    expect(body.offGridCapable).toBe(true);
    await app.close();
  });

  it("returns 404 for unknown provider id", async () => {
    const app = makeApp({});
    const res = await app.inject({ method: "GET", url: "/api/providers/nope" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "unknown provider: nope" });
    await app.close();
  });
});
