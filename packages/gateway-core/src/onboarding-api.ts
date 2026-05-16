/**
 * Onboarding API Routes — Fastify route registration for the firstboot onboarding flow.
 *
 * All endpoints are gated to private network only.
 * Secrets are stored via SecretsManager (TPM2-sealed) when available,
 * with process.env fallback for dev/migration.
 *
 * OAuth handoffs are now served internally by the gateway (absorbed from
 * agi-local-id Phase 2 — 2026-05-16). createHandoff() and pollHandoff()
 * are called directly instead of HTTP-proxying to id.ai.on.
 */

import type { FastifyInstance } from "fastify";
import type { IncomingMessage } from "node:http";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { readOnboardingState, writeOnboardingState } from "./onboarding-state.js";
import type { OnboardingState } from "./onboarding-state.js";
import { createComponentLogger } from "./logger.js";
import type { Logger } from "./logger.js";
import type { SecretsManager } from "./secrets.js";
import type { Db } from "@agi/db-schema/client";
import { createHandoff, pollHandoff } from "./handoff-api.js";

// ---------------------------------------------------------------------------
// ID Service URL resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the gateway's own base URL for internal onboarding HTTP calls.
 * Identity endpoints are now absorbed into the gateway (no separate local-ID
 * container); all calls that previously went to id.{domain} now go to the
 * gateway's root domain.
 */
function resolveIdServiceUrl(config: Record<string, unknown>): string {
  const hosting = config.hosting as Record<string, unknown> | undefined;
  const baseDomain = (hosting?.baseDomain as string) ?? "ai.on";
  return `https://${baseDomain}`;
}

// ---------------------------------------------------------------------------
// Helpers (same pattern as hosting-api.ts)
// ---------------------------------------------------------------------------

function isLoopback(ip: string): boolean {
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

function isPrivateNetwork(ip: string): boolean {
  if (isLoopback(ip)) return true;
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  const parts = v4.split(".").map(Number);
  if (parts.length === 4) {
    if (parts[0] === 10) return true;
    if (parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
  }
  if (ip.startsWith("fe80:")) return true;
  return false;
}

function getClientIp(req: IncomingMessage & { ip?: string }): string {
  // Use Fastify's req.ip when available — it handles proxy trust correctly
  // based on the trustProxy configuration. Only fall back to raw socket address.
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

function validateOllamaUrl(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    const hostname = url.hostname;
    // Block cloud metadata endpoints
    if (hostname === "169.254.169.254" || hostname === "metadata.google.internal") return false;
    // Block link-local and non-routable IPv6 ranges
    if (hostname.startsWith("fd") || hostname.startsWith("fe80")) return false;
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export interface OnboardingRouteDeps {
  logger?: Logger;
  secrets?: SecretsManager;
  config?: Record<string, unknown>;
  configPath?: string;
  /** Drizzle DB — enables direct handoff creation/polling without HTTP round-trip. */
  db?: Db;
  /** AES-256-GCM encryption key for OAuth token storage. */
  encKey?: Buffer;
  /** Gateway's own base URL for building handoff authUrl (e.g. "https://ai.on"). */
  gatewayBaseUrl?: string;
}

/**
 * Write a secret via SecretsManager (TPM2-sealed) if available,
 * otherwise set process.env directly as fallback.
 */
async function saveSecret(
  secrets: SecretsManager | undefined,
  name: string,
  value: string,
  log: ReturnType<typeof createComponentLogger>,
): Promise<void> {
  if (secrets) {
    try {
      await secrets.writeSecret(name, value);
      log.info(`Secret ${name} encrypted via TPM2`);
      return;
    } catch (e) {
      log.warn(`TPM2 encrypt failed for ${name}, falling back to process.env: ${String(e)}`);
    }
  }
  process.env[name] = value;
}

async function deriveAionimaIdServices(config: Record<string, unknown>): Promise<OnboardingState["aionimaIdServices"]> {
  try {
    const idUrl = resolveIdServiceUrl(config);
    const res = await fetch(`${idUrl}/api/auth/device-flow/status`, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const conns = await res.json() as Array<{ provider: string; role: string }>;
      if (conns.length > 0) return conns.map((c) => ({ provider: c.provider, role: c.role }));
    }
  } catch { /* ID service unreachable */ }
  return undefined;
}

// ---------------------------------------------------------------------------
// Handoff state — in-memory tracking of active handoff sessions
// ---------------------------------------------------------------------------

interface ActiveHandoff {
  handoffId: string;
  createdAt: number;
}

let activeHandoff: ActiveHandoff | null = null;

// ---------------------------------------------------------------------------
export function registerOnboardingRoutes(
  fastify: FastifyInstance,
  deps: OnboardingRouteDeps,
): void {
  const log = createComponentLogger(deps.logger, "onboarding-api");
  const secrets = deps.secrets;
  const dataDir = resolve(homedir(), ".agi");

  // Private network guard helper
  function guardPrivate(request: { raw: IncomingMessage }): string | null {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) return "Onboarding API only allowed from private network";
    return null;
  }

  // -----------------------------------------------------------------------
  // GET /api/onboarding/state — return current onboarding state
  // -----------------------------------------------------------------------

  fastify.get("/api/onboarding/state", async (request, reply) => {
    const err = guardPrivate(request);
    if (err) return reply.code(403).send({ error: err });

    const current = readOnboardingState(dataDir);
    const next: OnboardingState = { ...current, steps: { ...current.steps } };

    const cfg = readConfig();
    const owner = (cfg.owner ?? {}) as Record<string, unknown>;
    if (typeof owner.displayName === "string" && owner.displayName.trim().length > 0) {
      next.steps.ownerProfile = "completed";
    }

    const hasAiKeys = Boolean(
      (secrets?.readSecret("ANTHROPIC_API_KEY") ?? process.env["ANTHROPIC_API_KEY"] ?? "").trim() ||
      (secrets?.readSecret("OPENAI_API_KEY") ?? process.env["OPENAI_API_KEY"] ?? "").trim(),
    );
    if (hasAiKeys) {
      next.steps.aiKeys = "completed";
    }

    const idServices = await deriveAionimaIdServices(cfg);
    if (idServices && idServices.some((s) => s.provider === "github")) {
      next.steps.aionimaId = "completed";
    }

    const channels = (cfg.channels ?? {}) as Record<string, unknown>;
    const hasChannels = Object.values(channels).some((value) => {
      if (!value || typeof value !== "object") return false;
      const entry = value as Record<string, unknown>;
      if (entry.enabled === true) return true;
      return [
        "token",
        "apiKey",
        "appId",
        "appHash",
        "phone",
        "phoneNumber",
        "email",
        "clientId",
        "secret",
        "serverUrl",
        "host",
        "password",
      ].some((key) => typeof entry[key] === "string" && (entry[key] as string).trim().length > 0);
    });
    if (hasChannels) {
      next.steps.channels = "completed";
    }

    if (JSON.stringify(next) !== JSON.stringify(current)) {
      writeOnboardingState(next, dataDir);
    }

    return reply.send(next);
  });

  // -----------------------------------------------------------------------
  // PATCH /api/onboarding/state — partial merge of step statuses
  // -----------------------------------------------------------------------

  fastify.patch("/api/onboarding/state", async (request, reply) => {
    const err = guardPrivate(request);
    if (err) return reply.code(403).send({ error: err });
    const current = readOnboardingState(dataDir);
    const patch = request.body as Partial<OnboardingState>;

    const updated: OnboardingState = {
      ...current,
      ...patch,
      steps: {
        ...current.steps,
        ...patch.steps,
      },
    };

    writeOnboardingState(updated, dataDir);
    return reply.send(updated);
  });

  // -----------------------------------------------------------------------
  // POST /api/onboarding/reset — reset all steps to pending
  // -----------------------------------------------------------------------

  fastify.post("/api/onboarding/reset", async (request, reply) => {
    const err = guardPrivate(request);
    if (err) return reply.code(403).send({ error: err });
    const reset: OnboardingState = {
      firstbootCompleted: false,
      steps: {
        hosting: "pending",
        aionimaId: "pending",
        aiKeys: "pending",
        ownerProfile: "pending",
        channels: "pending",
        federation: "pending",
        zeroMeMind: "pending",
        zeroMeSoul: "pending",
        zeroMeSkill: "pending",
      },
    };

    writeOnboardingState(reset, dataDir);
    return reply.send(reset);
  });

  // -----------------------------------------------------------------------
  // Config read/write helper — reads/writes gateway.json
  // -----------------------------------------------------------------------

  function readConfig(): Record<string, unknown> {
    if (!deps.configPath) return {};
    try {
      const raw = readFileSync(deps.configPath, "utf8");
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  function writeConfig(cfg: Record<string, unknown>): void {
    if (!deps.configPath) return;
    writeFileSync(deps.configPath, JSON.stringify(cfg, null, 2) + "\n", "utf8");
  }

  // -----------------------------------------------------------------------
  // GET /api/onboarding/owner-profile — read current owner config
  // -----------------------------------------------------------------------

  fastify.get("/api/onboarding/owner-profile", async (request, reply) => {
    const err = guardPrivate(request);
    if (err) return reply.code(403).send({ error: err });

    const cfg = readConfig();
    const owner = (cfg.owner ?? {}) as Record<string, unknown>;
    return reply.send({
      displayName: owner.displayName ?? "",
      dmPolicy: owner.dmPolicy ?? "pairing",
    });
  });

  // -----------------------------------------------------------------------
  // POST /api/onboarding/owner-profile — save owner display name + DM policy
  // -----------------------------------------------------------------------

  fastify.post("/api/onboarding/owner-profile", async (request, reply) => {
    const err = guardPrivate(request);
    if (err) return reply.code(403).send({ error: err });

    const body = request.body as { displayName?: string; dmPolicy?: string };
    if (!body.displayName?.trim()) {
      return reply.code(400).send({ error: "displayName is required" });
    }

    const cfg = readConfig();
    const owner = (cfg.owner ?? {}) as Record<string, unknown>;
    owner.displayName = body.displayName.trim();
    if (body.dmPolicy === "open" || body.dmPolicy === "pairing") {
      owner.dmPolicy = body.dmPolicy;
    }
    cfg.owner = owner;
    writeConfig(cfg);

    // Register owner entity in Local-ID — creates #E0 + $A0
    const idBaseUrl = resolveIdServiceUrl(cfg);
    try {
      const res = await fetch(`${idBaseUrl}/api/entities/register-owner`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName: body.displayName.trim() }),
      });

      if (res.ok) {
        const data = (await res.json()) as {
          owner: { id: string; coaAlias: string; geid: string };
          agent: { id: string; coaAlias: string; geid: string };
          registrationId: string;
        };

        // Store entity references in config
        owner.entityId = data.owner.id;
        owner.coaAlias = data.owner.coaAlias;
        owner.geid = data.owner.geid;

        const agent = (cfg.agent ?? {}) as Record<string, unknown>;
        agent.entityId = data.agent.id;
        agent.coaAlias = data.agent.coaAlias;
        agent.geid = data.agent.geid;
        cfg.agent = agent;

        cfg.owner = owner;
        writeConfig(cfg);
        log.info(`Owner entity registered: ${data.owner.coaAlias} (${data.owner.geid})`);
        log.info(`Agent entity registered: ${data.agent.coaAlias} (${data.agent.geid})`);
      } else if (res.status === 409) {
        // Genesis owner already exists — not an error (re-onboarding scenario)
        log.info("Genesis owner already registered in Local-ID");
      } else {
        const errText = await res.text();
        log.warn(`Local-ID register-owner failed (non-fatal): ${res.status} ${errText}`);
      }
    } catch (e) {
      // Local-ID unreachable — non-fatal, entity can be created later
      log.warn(`Local-ID unreachable during owner registration (non-fatal): ${String(e)}`);
    }

    // Mark step completed
    const state = readOnboardingState(dataDir);
    state.steps.ownerProfile = "completed";
    writeOnboardingState(state, dataDir);

    log.info(`Owner profile saved: ${body.displayName}`);
    return reply.send({ ok: true });
  });

  // -----------------------------------------------------------------------
  // GET /api/onboarding/channels — read current channel config
  // -----------------------------------------------------------------------

  fastify.get("/api/onboarding/channels", async (request, reply) => {
    const err = guardPrivate(request);
    if (err) return reply.code(403).send({ error: err });

    const cfg = readConfig();
    const channels = (cfg.channels ?? []) as Array<{
      id: string;
      enabled: boolean;
      config: Record<string, string>;
    }>;
    const owner = (cfg.owner ?? {}) as Record<string, unknown>;
    const ownerChannels = (owner.channels ?? {}) as Record<string, string>;

    return reply.send({ channels, ownerChannels });
  });

  // -----------------------------------------------------------------------
  // POST /api/onboarding/channels — save a channel config
  // -----------------------------------------------------------------------

  fastify.post("/api/onboarding/channels", async (request, reply) => {
    const err = guardPrivate(request);
    if (err) return reply.code(403).send({ error: err });

    const body = request.body as {
      channelId: string;
      enabled: boolean;
      config: Record<string, string>;
      ownerId?: string;
    };

    if (!body.channelId) {
      return reply.code(400).send({ error: "channelId is required" });
    }

    const cfg = readConfig();

    // Update channels array
    const channels = (cfg.channels ?? []) as Array<{
      id: string;
      enabled: boolean;
      config: Record<string, string>;
    }>;

    const existingIdx = channels.findIndex((c) => c.id === body.channelId);
    const entry = {
      id: body.channelId,
      enabled: body.enabled,
      config: body.config,
    };

    if (existingIdx >= 0) {
      channels[existingIdx] = entry;
    } else {
      channels.push(entry);
    }
    cfg.channels = channels;

    // Update owner channel ID
    if (body.ownerId) {
      const owner = (cfg.owner ?? {}) as Record<string, unknown>;
      const ownerChannels = (owner.channels ?? {}) as Record<string, string>;
      ownerChannels[body.channelId] = body.ownerId;
      owner.channels = ownerChannels;
      cfg.owner = owner;
    }

    writeConfig(cfg);

    // Mark step completed
    const state = readOnboardingState(dataDir);
    state.steps.channels = "completed";
    writeOnboardingState(state, dataDir);

    log.info(`Channel ${body.channelId} configured`);
    return reply.send({ ok: true });
  });

  // -----------------------------------------------------------------------
  // POST /api/onboarding/ai-keys — validate and save API keys
  // -----------------------------------------------------------------------

  fastify.post("/api/onboarding/ai-keys", async (request, reply) => {
    const err = guardPrivate(request);
    if (err) return reply.code(403).send({ error: err });

    const body = request.body as {
      anthropic?: string;
      openai?: string;
      ollama?: { baseUrl?: string };
      agentProvider?: "anthropic" | "openai" | "ollama";
      agentModel?: string;
      saveOnly?: boolean;
    };

    // saveOnly: skip validation, just persist (keys already tested)
    if (body.saveOnly) {
      if (body.anthropic) await saveSecret(secrets, "ANTHROPIC_API_KEY", body.anthropic, log);
      if (body.openai) await saveSecret(secrets, "OPENAI_API_KEY", body.openai, log);

      // Persist Ollama baseUrl to config
      if (body.ollama?.baseUrl) {
        const cfg = readConfig();
        const providers = (cfg.providers ?? {}) as Record<string, unknown>;
        const ollama = (providers.ollama ?? {}) as Record<string, unknown>;
        ollama.baseUrl = body.ollama.baseUrl;
        providers.ollama = ollama;
        cfg.providers = providers;
        writeConfig(cfg);
      }

      // Persist agent provider/model to config
      if (body.agentProvider || body.agentModel) {
        const cfg = readConfig();
        const agent = (cfg.agent ?? {}) as Record<string, unknown>;
        if (body.agentProvider) agent.provider = body.agentProvider;
        if (body.agentModel) agent.model = body.agentModel;
        cfg.agent = agent;
        writeConfig(cfg);
      }

      if (body.anthropic || body.openai || body.ollama) {
        const state = readOnboardingState(dataDir);
        state.steps.aiKeys = "completed";
        writeOnboardingState(state, dataDir);
      }

      return reply.send({ ok: true, validated: { anthropic: !!body.anthropic, openai: !!body.openai, ollama: !!body.ollama } });
    }

    // Validate keys (test-only, no persistence)
    const validated: { anthropic: boolean; openai: boolean; ollama: boolean } = { anthropic: false, openai: false, ollama: false };

    if (body.anthropic) {
      try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": body.anthropic,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 1,
            messages: [{ role: "user", content: "hi" }],
          }),
        });
        validated.anthropic = res.status === 200;
      } catch (e) {
        log.warn(`Anthropic key validation fetch failed: ${String(e)}`);
      }
    }

    if (body.openai) {
      try {
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${body.openai}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            max_tokens: 1,
            messages: [{ role: "user", content: "hi" }],
          }),
        });
        validated.openai = res.status === 200;
      } catch (e) {
        log.warn(`OpenAI key validation fetch failed: ${String(e)}`);
      }
    }

    if (body.ollama) {
      try {
        const base = body.ollama.baseUrl ?? "http://localhost:11434";
        if (!validateOllamaUrl(base)) {
          return reply.code(400).send({ ok: false, error: "Invalid Ollama URL" });
        }
        const res = await fetch(`${base}/api/tags`);
        validated.ollama = res.ok;
      } catch (e) {
        log.warn(`Ollama connectivity test failed: ${String(e)}`);
      }
    }

    return reply.send({ ok: true, validated });
  });

  // -----------------------------------------------------------------------
  // POST /api/onboarding/aionima-id/start — create handoff (internal)
  // -----------------------------------------------------------------------

  fastify.post("/api/onboarding/aionima-id/start", async (request, reply) => {
    const err = guardPrivate(request);
    if (err) return reply.code(403).send({ error: err });

    if (deps.db && deps.encKey) {
      // Direct path — handoff created + auto-approved in-process (no HTTP hop)
      try {
        const baseUrl = deps.gatewayBaseUrl ?? resolveIdServiceUrl(readConfig());
        const result = await createHandoff(deps.db, deps.encKey, "onboarding", baseUrl, true);
        activeHandoff = { handoffId: result.handoffId, createdAt: Date.now() };
        log.info(`Handoff session created (direct): ${result.handoffId}`);
        return reply.send({ url: result.authUrl });
      } catch (e) {
        log.error(`Handoff create (direct) failed: ${String(e)}`);
        return reply.code(500).send({ error: "Failed to create handoff session" });
      }
    }

    // Legacy HTTP path — fallback when DB not wired (should not happen post Phase 2)
    try {
      const idBaseUrl = resolveIdServiceUrl(readConfig());
      const res = await fetch(`${idBaseUrl}/api/handoff/create`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      if (!res.ok) {
        const errText = await res.text();
        log.error(`Handoff create failed: ${res.status} ${errText}`);
        return reply.code(502).send({ error: "Failed to create handoff session" });
      }
      const data = (await res.json()) as { handoffId: string; authUrl: string };
      activeHandoff = { handoffId: data.handoffId, createdAt: Date.now() };
      log.info(`Handoff session created (http): ${data.handoffId}`);
      return reply.send({ url: data.authUrl });
    } catch (e) {
      log.error(`Handoff create fetch failed: ${String(e)}`);
      return reply.code(502).send({ error: "Cannot reach Aionima ID service" });
    }
  });

  // -----------------------------------------------------------------------
  // GET /api/onboarding/aionima-id/poll — poll handoff status
  // -----------------------------------------------------------------------

  fastify.get("/api/onboarding/aionima-id/poll", async (request, reply) => {
    const err = guardPrivate(request);
    if (err) return reply.code(403).send({ error: err });

    if (!activeHandoff) return reply.send({ status: "no_handoff" });

    // Expire stale handoffs (15 min)
    if (Date.now() - activeHandoff.createdAt > 15 * 60 * 1000) {
      activeHandoff = null;
      return reply.send({ status: "expired" });
    }

    let pollData: {
      status: string;
      services?: Array<{ provider: string; role: string; accountLabel?: string | null; accessToken?: string | null; refreshToken?: string | null }>;
    };

    if (deps.db && deps.encKey) {
      // Direct path — no HTTP hop
      try {
        pollData = await pollHandoff(deps.db, deps.encKey, activeHandoff.handoffId);
      } catch (e) {
        log.error(`Handoff poll (direct) failed: ${String(e)}`);
        return reply.send({ status: "pending" });
      }
    } else {
      // Legacy HTTP path
      try {
        const idBaseUrl = resolveIdServiceUrl(readConfig());
        const res = await fetch(`${idBaseUrl}/api/handoff/${activeHandoff.handoffId}/poll`);
        if (!res.ok) {
          if (res.status === 404) { activeHandoff = null; return reply.send({ status: "expired" }); }
          return reply.send({ status: "pending" });
        }
        pollData = (await res.json()) as typeof pollData;
      } catch (e) {
        log.error(`Handoff poll (http) failed: ${String(e)}`);
        return reply.send({ status: "pending" });
      }
    }

    if (pollData.status === "not_found" || pollData.status === "expired") {
      activeHandoff = null;
      return reply.send({ status: pollData.status });
    }

    if (pollData.status !== "completed" || !pollData.services) {
      return reply.send({ status: pollData.status });
    }

    // Store tokens via SecretsManager
    const connectedServices: Array<{ provider: string; role: string; accountLabel?: string }> = [];

    for (const svc of pollData.services) {
      const prefix = svc.role === "owner" ? "OWNER" : "AGENT";

      if (svc.provider === "google") {
        if (svc.refreshToken) await saveSecret(secrets, `${prefix}_EMAIL_REFRESH_TOKEN`, svc.refreshToken, log);
        if (svc.accessToken) await saveSecret(secrets, `${prefix}_EMAIL_ACCESS_TOKEN`, svc.accessToken, log);
      } else if (svc.provider === "github") {
        if (svc.accessToken) await saveSecret(secrets, `${prefix}_GITHUB_TOKEN`, svc.accessToken, log);
      }

      connectedServices.push({ provider: svc.provider, role: svc.role, accountLabel: svc.accountLabel ?? undefined });
      log.info(`Handoff: stored ${svc.provider} tokens for ${svc.role}`);
    }

    // Mark step completed
    const state = readOnboardingState(dataDir);
    state.steps.aionimaId = "completed";
    state.aionimaIdServices = connectedServices;
    writeOnboardingState(state, dataDir);

    activeHandoff = null;
    return reply.send({ status: "completed", services: connectedServices });
  });

  // -----------------------------------------------------------------------
  // GET /api/onboarding/aionima-id/status — return connected services
  // -----------------------------------------------------------------------

  fastify.get("/api/onboarding/aionima-id/status", async (request, reply) => {
    const err = guardPrivate(request);
    if (err) return reply.code(403).send({ error: err });

    const state = readOnboardingState(dataDir);
    const storedServices = state.aionimaIdServices ?? [];
    const derivedServices = storedServices.length > 0 ? storedServices : ((await deriveAionimaIdServices(readConfig())) ?? []);

    if (derivedServices.length > 0 && state.steps.aionimaId !== "completed") {
      state.steps.aionimaId = "completed";
      state.aionimaIdServices = derivedServices;
      writeOnboardingState(state, dataDir);
    }

    return reply.send({
      step: state.steps.aionimaId,
      hasActiveHandoff: activeHandoff !== null,
      services: derivedServices,
    });
  });

  // -----------------------------------------------------------------------
  // POST /api/onboarding/zero-me/chat — 0ME interview chat
  // -----------------------------------------------------------------------

  const ZERO_ME_SYSTEM_PROMPTS: Record<string, string> = {
    MIND: "You are interviewing the owner to understand their intellectual interests, curiosities, and areas of fascination. Ask thoughtful questions one at a time. After 3-5 exchanges, produce a structured summary of what you've learned. When complete, include the marker [0ME_COMPLETE] followed by the summary in markdown format.",
    SOUL: "You are interviewing the owner to understand their purpose, motivations, values, and what drives them. Ask thoughtful questions one at a time. After 3-5 exchanges, produce a structured summary. When complete, include the marker [0ME_COMPLETE] followed by the summary.",
    SKILL: "You are interviewing the owner to understand their professional skills, expertise, tools they use, and domains they work in. Ask thoughtful questions one at a time. After 3-5 exchanges, produce a structured summary. When complete, include the marker [0ME_COMPLETE] followed by the summary.",
  };

  fastify.post("/api/onboarding/zero-me/chat", async (request, reply) => {
    const err = guardPrivate(request);
    if (err) return reply.code(403).send({ error: err });

    const body = request.body as {
      domain: "MIND" | "SOUL" | "SKILL";
      messages: Array<{ role: string; content: string }>;
    };

    const systemPrompt = ZERO_ME_SYSTEM_PROMPTS[body.domain];
    if (!systemPrompt) {
      return reply.code(400).send({ error: `Unknown domain: ${body.domain}` });
    }

    const apiKey = secrets?.readSecret("ANTHROPIC_API_KEY") ?? process.env["ANTHROPIC_API_KEY"] ?? "";

    if (!apiKey) {
      return reply.code(400).send({ error: "ANTHROPIC_API_KEY not configured" });
    }

    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 1024,
          system: systemPrompt,
          messages: body.messages,
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        log.error(`Anthropic API error in zero-me/chat: status=${res.status} body=${errText}`);
        return reply.code(502).send({ error: "Anthropic API error", details: errText });
      }

      const data = (await res.json()) as {
        content: Array<{ type: string; text: string }>;
      };

      const text = data.content.find((c) => c.type === "text")?.text ?? "";
      return reply.send({ response: text });
    } catch (e) {
      log.error(`zero-me/chat fetch failed: ${String(e)}`);
      return reply.code(500).send({ error: "Internal error during chat" });
    }
  });

  // -----------------------------------------------------------------------
  // POST /api/onboarding/zero-me/save — save 0ME results
  // -----------------------------------------------------------------------

  fastify.post("/api/onboarding/zero-me/save", async (request, reply) => {
    const err = guardPrivate(request);
    if (err) return reply.code(403).send({ error: err });

    const body = request.body as { domain: string; content: string };

    if (!body.domain || !body.content) {
      return reply.code(400).send({ error: "domain and content are required" });
    }

    const zeroMeDir = join(dataDir, "0ME");
    mkdirSync(zeroMeDir, { recursive: true });

    const filePath = join(zeroMeDir, `${body.domain}.md`);
    writeFileSync(filePath, body.content, "utf8");

    // Mark the corresponding step as completed
    const state = readOnboardingState(dataDir);
    const domainUpper = body.domain.toUpperCase();
    if (domainUpper === "MIND") state.steps.zeroMeMind = "completed";
    else if (domainUpper === "SOUL") state.steps.zeroMeSoul = "completed";
    else if (domainUpper === "SKILL") state.steps.zeroMeSkill = "completed";
    writeOnboardingState(state, dataDir);

    log.info(`0ME/${body.domain}.md saved`);
    return reply.send({ ok: true });
  });

  // -----------------------------------------------------------------------
  // POST /api/onboarding/hosting — save hosting config
  // -----------------------------------------------------------------------

  fastify.post("/api/onboarding/hosting", async (request, reply) => {
    const err = guardPrivate(request);
    if (err) return reply.code(403).send({ error: err });

    const body = request.body as {
      baseDomain?: string;
    };

    const cfg = readConfig();

    // Save hosting base domain if provided
    if (body.baseDomain) {
      const hosting = (cfg.hosting ?? {}) as Record<string, unknown>;
      hosting.baseDomain = body.baseDomain;
      cfg.hosting = hosting;
    }

    writeConfig(cfg);

    const state = readOnboardingState(dataDir);
    state.steps.hosting = "completed";
    writeOnboardingState(state, dataDir);

    log.info("Hosting config saved");
    return reply.send({ ok: true });
  });

  // -----------------------------------------------------------------------
  // POST /api/onboarding/channels/oauth-start — channel-specific OAuth handoff
  // -----------------------------------------------------------------------

  fastify.post("/api/onboarding/channels/oauth-start", async (request, reply) => {
    const err = guardPrivate(request);
    if (err) return reply.code(403).send({ error: err });

    const body = request.body as { channelId: string };
    if (!body.channelId) {
      return reply.code(400).send({ error: "channelId is required" });
    }

    if (deps.db && deps.encKey) {
      // Direct path — no HTTP hop
      try {
        const baseUrl = deps.gatewayBaseUrl ?? resolveIdServiceUrl(readConfig());
        const result = await createHandoff(deps.db, deps.encKey, `channel:${body.channelId}`, baseUrl, true);
        activeHandoff = { handoffId: result.handoffId, createdAt: Date.now() };
        log.info(`Channel OAuth handoff created (direct) for ${body.channelId}`);
        return reply.send({ url: result.authUrl });
      } catch (e) {
        log.error(`Channel OAuth handoff (direct) failed: ${String(e)}`);
        return reply.code(500).send({ error: "Failed to create channel handoff" });
      }
    }

    // Legacy HTTP path
    const idBaseUrl = resolveIdServiceUrl(readConfig());
    try {
      const res = await fetch(`${idBaseUrl}/api/handoff/create`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ purpose: `channel:${body.channelId}` }),
      });
      if (!res.ok) return reply.code(502).send({ error: "Failed to create channel handoff" });
      const data = (await res.json()) as { handoffId: string; authUrl: string };
      activeHandoff = { handoffId: data.handoffId, createdAt: Date.now() };
      log.info(`Channel OAuth handoff created (http) for ${body.channelId}`);
      return reply.send({ url: data.authUrl });
    } catch (e) {
      log.error(`Channel OAuth handoff failed: ${String(e)}`);
      return reply.code(502).send({ error: "Cannot reach ID service" });
    }
  });

  // -----------------------------------------------------------------------
  // POST /api/onboarding/federation — save federation config
  // -----------------------------------------------------------------------

  fastify.post("/api/onboarding/federation", async (request, reply) => {
    const err = guardPrivate(request);
    if (err) return reply.code(403).send({ error: err });

    const body = request.body as {
      enabled?: boolean;
      publicUrl?: string;
      seedPeers?: string[];
    };

    const cfg = readConfig();
    const federation = (cfg.federation ?? {}) as Record<string, unknown>;

    if (body.enabled !== undefined) federation.enabled = body.enabled;
    if (body.publicUrl) federation.publicUrl = body.publicUrl;
    if (body.seedPeers) federation.seedPeers = body.seedPeers;

    cfg.federation = federation;
    writeConfig(cfg);

    // If enabling federation, attempt HIVE-ID registration
    if (body.enabled) {
      const idBaseUrl = resolveIdServiceUrl(cfg);
      try {
        await fetch(`${idBaseUrl}/hive/register/node`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            nodeId: "@N0",
            url: body.publicUrl ?? "unknown",
            publicKey: "",
            displayName: "Aionima Node",
          }),
        });
        log.info("Registered with HIVE-ID");
      } catch (e) {
        log.warn(`HIVE-ID registration failed (non-fatal): ${String(e)}`);
      }
    }

    const state = readOnboardingState(dataDir);
    state.steps.federation = body.enabled ? "completed" : "skipped";
    writeOnboardingState(state, dataDir);

    log.info(`Federation config saved (enabled: ${body.enabled ?? false})`);
    return reply.send({ ok: true });
  });

  // -----------------------------------------------------------------------
  // GET /api/onboarding/id-service-url — returns the Local-ID base URL
  // so the dashboard can call it directly for device flow OAuth.
  // All identity services live in Local-ID, not AGI.
  // -----------------------------------------------------------------------

  fastify.get("/api/onboarding/id-service-url", async (request, reply) => {
    const err = guardPrivate(request);
    if (err) return reply.code(403).send({ error: err });
    return reply.send({ url: resolveIdServiceUrl(readConfig()) });
  });
}
