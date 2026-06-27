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

/** Default served context window for Lemonade models. Lemonade itself
 *  defaults to 4096, which overflows on Aion's system-prompt + history
 *  (~14.6k tokens) → HTTP 400 context_length_exceeded. 32768 comfortably
 *  fits a long Aion turn while keeping the llama.cpp KV-cache bounded on
 *  CPU/iGPU boxes. Overridable per-deploy via gateway.json
 *  `providers.lemonade.ctxSize` (hot-reloaded — read at load time). */
const DEFAULT_CTX_CAP = 32768;

function resolveCtxCap(getConfig: () => AionimaConfig): number {
  const config = getConfig();
  const providers = (config.providers as Record<string, { ctxSize?: number }> | undefined) ?? {};
  const cap = providers["lemonade"]?.ctxSize;
  return typeof cap === "number" && cap > 0 ? cap : DEFAULT_CTX_CAP;
}

/** Pick a context size for a model load: the model's own trained context
 *  window (Lemonade reports `max_context_window`) clamped to `cap`. Falls
 *  back to `cap` when the model isn't in Lemonade's list or reports no max —
 *  still far larger than Lemonade's 4096 default, which is the bug. */
async function deriveCtxSize(
  baseUrl: string,
  modelName: string,
  cap: number,
): Promise<number> {
  const res = await lemonadeFetch<{
    data?: Array<{ id?: string; checkpoint?: string; max_context_window?: number }>;
  }>(baseUrl, "/api/v1/models", { timeoutMs: 8_000 });
  if (res.ok) {
    const models = res.data?.data ?? [];
    const match = models.find((m) => m.id === modelName || m.checkpoint === modelName);
    const maxCtx = match?.max_context_window ?? 0;
    if (maxCtx > 0) return Math.min(maxCtx, cap);
  }
  return cap;
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
      lemonadeFetch<{
        status: string;
        version: string;
        // Lemonade ≥0.17 returns model objects; earlier versions return strings.
        // We normalise to string (model_name) in the response below.
        model_loaded: string | Record<string, unknown> | null;
        all_models_loaded: Array<string | Record<string, unknown>>;
      }>(baseUrl, "/api/v1/health", { timeoutMs: 5_000 }),
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
    // Normalise model references to plain strings so the dashboard never has
    // to deal with object vs string variance from different Lemonade versions.
    const toModelName = (v: string | Record<string, unknown> | null | undefined): string | null => {
      if (!v) return null;
      if (typeof v === "string") return v;
      const name = (v as { model_name?: unknown }).model_name;
      return typeof name === "string" ? name : JSON.stringify(v);
    };
    return reply.send({
      installed: true,
      running: true,
      baseUrl,
      version: health.data.version,
      modelLoaded: toModelName(health.data.model_loaded),
      allModelsLoaded: health.data.all_models_loaded.map(toModelName).filter(Boolean) as string[],
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
    const body = request.body as { model?: string; ctx_size?: number } | undefined;
    if (!body?.model) return reply.code(400).send({ error: "model is required" });
    const baseUrl = resolveBaseUrl(getConfig);

    // Always set a context window large enough for Aion's prompt — caller
    // override wins, else derive from the model's max_context_window capped to
    // the hot-config default. save_options persists it so a re-load (or a
    // Lemonade restart) keeps the larger window instead of reverting to 4096.
    const ctxSize = body.ctx_size ?? (await deriveCtxSize(baseUrl, body.model, resolveCtxCap(getConfig)));
    logger?.info(`lemonade load: ${body.model} (ctx_size=${ctxSize})`);

    const result = await lemonadeFetch<unknown>(
      baseUrl, "/api/v1/load",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model_name: body.model, ctx_size: ctxSize, save_options: true }),
        timeoutMs: 60_000,
      },
    );
    if (!result.ok) return reply.code(result.status).send({ error: result.error });
    return reply.send({ ok: true, model: body.model, ctxSize });
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
