import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerLemonadeRoutes } from "./lemonade-api.js";
import type { AionimaConfig } from "@agi/config";

/**
 * s225 — Lemonade load must set ctx_size so Aion's ~14.6k-token prompt fits.
 *
 * Bug: agi forwarded only { model_name } to Lemonade /api/v1/load, so Lemonade
 * served at its 4096 default → HTTP 400 context_length_exceeded. Lemonade's
 * /api/v1/load accepts ctx_size + save_options; the proxy must derive a sane
 * ctx_size from the model's max_context_window, capped to a hot-config default.
 */

function makeApp(config: Partial<AionimaConfig>): FastifyInstance {
  const app = Fastify();
  registerLemonadeRoutes(app, { getConfig: () => config as AionimaConfig });
  return app;
}

describe("lemonade load — ctx_size derivation", () => {
  let loadBodies: Array<Record<string, unknown>>;

  beforeEach(() => {
    loadBodies = [];
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/api/v1/models")) {
        return new Response(
          JSON.stringify({
            data: [{ id: "Gemma-4-E2B-it-GGUF", checkpoint: "unsloth/gemma-4-E2B-it-GGUF:Q4_K_M", max_context_window: 131072 }],
          }),
          { status: 200 },
        );
      }
      if (u.endsWith("/api/v1/load")) {
        loadBodies.push(JSON.parse(String(init?.body ?? "{}")));
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("derives ctx_size from max_context_window, capped to the 32768 default", async () => {
    const app = makeApp({ providers: { lemonade: {} } as AionimaConfig["providers"] });
    const res = await app.inject({
      method: "POST",
      url: "/api/lemonade/models/load",
      payload: { model: "Gemma-4-E2B-it-GGUF" },
    });
    expect(res.statusCode).toBe(200);
    expect(loadBodies).toHaveLength(1);
    expect(loadBodies[0]).toMatchObject({
      model_name: "Gemma-4-E2B-it-GGUF",
      ctx_size: 32768,
      save_options: true,
    });
    await app.close();
  });

  it("respects an explicit caller ctx_size override", async () => {
    const app = makeApp({ providers: { lemonade: {} } as AionimaConfig["providers"] });
    await app.inject({
      method: "POST",
      url: "/api/lemonade/models/load",
      payload: { model: "Gemma-4-E2B-it-GGUF", ctx_size: 8192 },
    });
    expect(loadBodies[0]?.ctx_size).toBe(8192);
    await app.close();
  });

  it("honors a hot-config cap from gateway.json (providers.lemonade.ctxSize)", async () => {
    const app = makeApp({ providers: { lemonade: { ctxSize: 65536 } } as unknown as AionimaConfig["providers"] });
    await app.inject({
      method: "POST",
      url: "/api/lemonade/models/load",
      payload: { model: "Gemma-4-E2B-it-GGUF" },
    });
    // min(131072 model max, 65536 cap) = 65536
    expect(loadBodies[0]?.ctx_size).toBe(65536);
    await app.close();
  });

  it("falls back to the cap when the model is not in Lemonade's list", async () => {
    const app = makeApp({ providers: { lemonade: {} } as AionimaConfig["providers"] });
    await app.inject({
      method: "POST",
      url: "/api/lemonade/models/load",
      payload: { model: "some-model-not-installed" },
    });
    expect(loadBodies[0]?.ctx_size).toBe(32768);
    await app.close();
  });
});
