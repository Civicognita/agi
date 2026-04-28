/**
 * Lemonade proxy API — `/api/lemonade/*`
 *
 * Thin AGI-side surface that proxies to a locally-running Lemonade Server
 * (https://github.com/lemonade-sdk/lemonade) at the configured base URL.
 * The agi CLI, dashboard, and plugin agent tools all hit these routes;
 * direct shell-out to `lemonade` CLI is forbidden so AGI stays the
 * single point of orchestration.
 *
 * Why proxy instead of letting clients hit Lemonade directly:
 *   1. Auth + tier enforcement — Lemonade has no AGI-aware ACL; proxying
 *      lets us add tier gates later (sealed/verified) without touching
 *      Lemonade itself.
 *   2. Hot-config — Lemonade's baseUrl can change in `gateway.json`
 *      (`providers.lemonade.baseUrl`); clients should never have to
 *      re-resolve, the proxy handles it.
 *   3. Health degradation — when Lemonade is stopped or unreachable,
 *      AGI returns a clean 503 with a structured error so the dashboard
 *      can render an "Install runtime" CTA instead of network errors.
 */

import type { FastifyInstance } from "fastify";
import type { AionimaConfig } from "@agi/config";

// ---------------------------------------------------------------------------
// Deps + helpers
// ---------------------------------------------------------------------------

export interface LemonadeApiDeps {
  /** Returns the live (hot-reloaded) AionimaConfig snapshot. */
  getConfig: () => AionimaConfig;
  /** Optional logger for diagnostics. */
  logger?: { info: (m: string) => void; warn: (m: string) => void; error: (m: string) => void };
}

const DEFAULT_LEMONADE_URL = "http://127.0.0.1:13305";

/** Extract a human-readable error message from a Lemonade response body.
 *  Lemonade returns three different error shapes depending on the endpoint:
 *    - { error: "string" }                     (some pull/install errors)
 *    - { error: { message: "...", code, type } }  (most validation errors)
 *    - { error: { ... }, ... }                 (other shapes)
 *  Stringifying with `String(obj)` yields the literal "[object Object]",
 *  which is what we used to ship. This walks the common shapes and falls
 *  back to JSON for unknown ones. */
function extractErrorMessage(parsed: unknown): string | null {
  if (typeof parsed !== "object" || parsed === null) return null;
  const e = (parsed as { error?: unknown }).error;
  if (e === undefined || e === null) return null;
  if (typeof e === "string") return e;
  if (typeof e === "object") {
    const msg = (e as { message?: unknown }).message;
    if (typeof msg === "string") return msg;
    return JSON.stringify(e);
  }
  return String(e);
}

function resolveBaseUrl(getConfig: () => AionimaConfig): string {
  const config = getConfig();
  const providers = (config.providers as Record<string, { baseUrl?: string }> | undefined) ?? {};
  return providers["lemonade"]?.baseUrl ?? DEFAULT_LEMONADE_URL;
}

interface LemonadeFetchResult<T> {
  ok: true;
  data: T;
}
interface LemonadeFetchError {
  ok: false;
  status: number;
  error: string;
}
type LemonadeResult<T> = LemonadeFetchResult<T> | LemonadeFetchError;

/** Wrapped fetch with timeout + structured error shape. Lemonade returns
 *  JSON for both success and most errors; we surface its error message
 *  verbatim under our `error` field. */
async function lemonadeFetch<T>(
  baseUrl: string,
  path: string,
  init?: RequestInit & { timeoutMs?: number },
): Promise<LemonadeResult<T>> {
  const url = `${baseUrl.replace(/\/$/, "")}${path}`;
  const controller = new AbortController();
  const timeoutMs = init?.timeoutMs ?? 30_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = text.length > 0 ? JSON.parse(text) : {};
    } catch {
      parsed = text;
    }
    if (!res.ok) {
      const errMsg = extractErrorMessage(parsed) ?? `Lemonade ${res.status}: ${text.slice(0, 200)}`;
      return { ok: false, status: res.status, error: errMsg };
    }
    return { ok: true, data: parsed as T };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("aborted") || msg.includes("AbortError")) {
      return { ok: false, status: 504, error: `Lemonade request timed out after ${timeoutMs}ms` };
    }
    return { ok: false, status: 503, error: `Lemonade unreachable at ${baseUrl}: ${msg}` };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerLemonadeRoutes(
  fastify: FastifyInstance,
  deps: LemonadeApiDeps,
): void {
  const { getConfig, logger } = deps;

  // -------------------------------------------------------------------------
  // GET /api/lemonade/status
  //
  // Composite of /api/v1/health + /api/v1/system-info — the one call the
  // dashboard + agi doctor need to render full Lemonade state.
  // -------------------------------------------------------------------------

  fastify.get("/api/lemonade/status", async (_request, reply) => {
    const baseUrl = resolveBaseUrl(getConfig);
    const [health, sysinfo] = await Promise.all([
      lemonadeFetch<{ status: string; version: string; model_loaded: string | null; all_models_loaded: string[] }>(
        baseUrl, "/api/v1/health", { timeoutMs: 5_000 }),
      lemonadeFetch<{ devices: Record<string, unknown>; recipes: Record<string, unknown> }>(
        baseUrl, "/api/v1/system-info", { timeoutMs: 5_000 }),
    ]);
    if (!health.ok) {
      return reply.code(503).send({
        installed: false,
        running: false,
        baseUrl,
        error: health.error,
      });
    }
    return reply.send({
      installed: true,
      running: true,
      baseUrl,
      version: health.data.version,
      modelLoaded: health.data.model_loaded,
      allModelsLoaded: health.data.all_models_loaded,
      devices: sysinfo.ok ? sysinfo.data.devices : null,
      recipes: sysinfo.ok ? sysinfo.data.recipes : null,
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/lemonade/models — list installed models
  // -------------------------------------------------------------------------

  fastify.get("/api/lemonade/models", async (_request, reply) => {
    const baseUrl = resolveBaseUrl(getConfig);
    const result = await lemonadeFetch<{ data: Array<Record<string, unknown>> }>(
      baseUrl, "/api/v1/models", { timeoutMs: 10_000 });
    if (!result.ok) return reply.code(result.status).send({ error: result.error });
    return reply.send({ models: result.data.data ?? [] });
  });

  // -------------------------------------------------------------------------
  // POST /api/lemonade/models/pull — { model } pull a model from catalog
  // -------------------------------------------------------------------------

  fastify.post("/api/lemonade/models/pull", async (request, reply) => {
    const body = request.body as { model?: string } | undefined;
    if (!body?.model) return reply.code(400).send({ error: "model is required" });
    const baseUrl = resolveBaseUrl(getConfig);
    logger?.info(`lemonade pull: ${body.model}`);
    const result = await lemonadeFetch<unknown>(
      baseUrl, "/api/v1/pull",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: body.model }), timeoutMs: 600_000 },
    );
    if (!result.ok) return reply.code(result.status).send({ error: result.error });
    return reply.send({ ok: true, model: body.model, result: result.data });
  });

  // -------------------------------------------------------------------------
  // POST /api/lemonade/models/load — { model } load model into memory
  // -------------------------------------------------------------------------

  // Lemonade quirk: /pull accepts {model}, but /load /unload /delete
  // expect {model_name}. The proxy hides this — callers always send
  // `model` and we translate at the boundary.
  fastify.post("/api/lemonade/models/load", async (request, reply) => {
    const body = request.body as { model?: string } | undefined;
    if (!body?.model) return reply.code(400).send({ error: "model is required" });
    const baseUrl = resolveBaseUrl(getConfig);
    const result = await lemonadeFetch<unknown>(
      baseUrl, "/api/v1/load",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model_name: body.model }), timeoutMs: 60_000 },
    );
    if (!result.ok) return reply.code(result.status).send({ error: result.error });
    return reply.send({ ok: true, model: body.model });
  });

  // -------------------------------------------------------------------------
  // POST /api/lemonade/models/unload — { model } unload from memory
  // -------------------------------------------------------------------------

  fastify.post("/api/lemonade/models/unload", async (request, reply) => {
    const body = request.body as { model?: string } | undefined;
    if (!body?.model) return reply.code(400).send({ error: "model is required" });
    const baseUrl = resolveBaseUrl(getConfig);
    const result = await lemonadeFetch<unknown>(
      baseUrl, "/api/v1/unload",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model_name: body.model }), timeoutMs: 30_000 },
    );
    if (!result.ok) return reply.code(result.status).send({ error: result.error });
    return reply.send({ ok: true, model: body.model });
  });

  // -------------------------------------------------------------------------
  // POST /api/lemonade/models/delete — { model } delete from disk
  // -------------------------------------------------------------------------

  fastify.post("/api/lemonade/models/delete", async (request, reply) => {
    const body = request.body as { model?: string } | undefined;
    if (!body?.model) return reply.code(400).send({ error: "model is required" });
    const baseUrl = resolveBaseUrl(getConfig);
    logger?.info(`lemonade delete: ${body.model}`);
    const result = await lemonadeFetch<unknown>(
      baseUrl, "/api/v1/delete",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model_name: body.model }), timeoutMs: 30_000 },
    );
    if (!result.ok) return reply.code(result.status).send({ error: result.error });
    return reply.send({ ok: true, model: body.model });
  });

  // -------------------------------------------------------------------------
  // POST /api/lemonade/backends/install — { recipe, backend } install backend
  // (e.g. recipe="llamacpp", backend="rocm" → llamacpp-rocm runtime)
  // -------------------------------------------------------------------------

  fastify.post("/api/lemonade/backends/install", async (request, reply) => {
    const body = request.body as { recipe?: string; backend?: string } | undefined;
    if (!body?.recipe || !body?.backend) {
      return reply.code(400).send({ error: "recipe and backend are required" });
    }
    const baseUrl = resolveBaseUrl(getConfig);
    logger?.info(`lemonade install backend: ${body.recipe}:${body.backend}`);
    const result = await lemonadeFetch<unknown>(
      baseUrl, "/api/v1/install",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recipe: body.recipe, backend: body.backend }), timeoutMs: 600_000 },
    );
    if (!result.ok) return reply.code(result.status).send({ error: result.error });
    return reply.send({ ok: true, recipe: body.recipe, backend: body.backend });
  });

  // -------------------------------------------------------------------------
  // POST /api/lemonade/backends/uninstall — { recipe, backend }
  // -------------------------------------------------------------------------

  fastify.post("/api/lemonade/backends/uninstall", async (request, reply) => {
    const body = request.body as { recipe?: string; backend?: string } | undefined;
    if (!body?.recipe || !body?.backend) {
      return reply.code(400).send({ error: "recipe and backend are required" });
    }
    const baseUrl = resolveBaseUrl(getConfig);
    const result = await lemonadeFetch<unknown>(
      baseUrl, "/api/v1/uninstall",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recipe: body.recipe, backend: body.backend }), timeoutMs: 60_000 },
    );
    if (!result.ok) return reply.code(result.status).send({ error: result.error });
    return reply.send({ ok: true, recipe: body.recipe, backend: body.backend });
  });
}
