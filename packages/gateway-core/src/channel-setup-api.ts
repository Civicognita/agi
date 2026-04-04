/**
 * Channel Setup API routes — guided setup wizard for messaging channels.
 *
 * OAuth channels (gmail, discord) use the ID service handoff flow.
 * Non-OAuth channels (telegram, signal, whatsapp) use direct credential testing.
 *
 * All endpoints are gated to private network only.
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import { readFileSync, writeFileSync } from "node:fs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const OAUTH_CHANNELS = new Set(["gmail", "discord"]);

interface ActiveChannelHandoff {
  handoffId: string;
  channelId: string;
  createdAt: number;
}

// In-memory tracking of active channel handoff sessions (keyed by handoffId)
const activeHandoffs = new Map<string, ActiveChannelHandoff>();

// ---------------------------------------------------------------------------
// Deps interface
// ---------------------------------------------------------------------------

export interface ChannelSetupDeps {
  isPrivateNetwork: (ip: string) => boolean;
  getClientIp: (req: FastifyRequest) => string;
  idServiceBaseUrl: string | null;
  configPath: string;
}

// ---------------------------------------------------------------------------
// Config read/write helpers — mirrors the pattern in onboarding-api.ts
// ---------------------------------------------------------------------------

function readConfig(configPath: string): Record<string, unknown> {
  try {
    const raw = readFileSync(configPath, "utf8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function writeConfig(configPath: string, cfg: Record<string, unknown>): void {
  writeFileSync(configPath, JSON.stringify(cfg, null, 2) + "\n", "utf8");
}

// ---------------------------------------------------------------------------
// Channel test logic — raw HTTP calls, no channel plugin imports
// ---------------------------------------------------------------------------

async function testChannel(
  channelId: string,
  config: Record<string, string>,
): Promise<{ ok: boolean; error?: string; details?: string }> {
  switch (channelId) {
    case "telegram": {
      const token = config.botToken;
      if (!token) return { ok: false, error: "Bot token is required" };
      try {
        const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
        const data = (await res.json()) as { ok: boolean; result?: { username: string } };
        if (data.ok) return { ok: true, details: `Bot: @${data.result?.username}` };
        return { ok: false, error: "Invalid bot token" };
      } catch {
        return { ok: false, error: "Failed to reach Telegram API" };
      }
    }
    case "discord": {
      const token = config.botToken;
      if (!token) return { ok: false, error: "Bot token is required" };
      try {
        const res = await fetch("https://discord.com/api/v10/users/@me", {
          headers: { Authorization: `Bot ${token}` },
        });
        if (res.ok) {
          const data = (await res.json()) as { username: string };
          return { ok: true, details: `Bot: ${data.username}` };
        }
        return { ok: false, error: "Invalid bot token" };
      } catch {
        return { ok: false, error: "Failed to reach Discord API" };
      }
    }
    case "gmail": {
      const refreshToken = config.refreshToken;
      if (!refreshToken) return { ok: false, error: "Refresh token is required" };
      return { ok: true, details: `Account: ${config.account ?? "configured"}` };
    }
    case "signal": {
      const apiUrl = config.apiUrl ?? "http://localhost:8080";
      try {
        const res = await fetch(`${apiUrl}/v1/about`, { signal: AbortSignal.timeout(5000) });
        if (res.ok) return { ok: true, details: "Signal CLI API is reachable" };
        return { ok: false, error: `Signal API returned ${res.status}` };
      } catch {
        return { ok: false, error: "Failed to reach Signal CLI API" };
      }
    }
    case "whatsapp": {
      const token = config.accessToken;
      const phoneNumberId = config.phoneNumberId;
      if (!token || !phoneNumberId) {
        return { ok: false, error: "Access token and phone number ID are required" };
      }
      try {
        const res = await fetch(`https://graph.facebook.com/v18.0/${phoneNumberId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) return { ok: true, details: "WhatsApp Business API connected" };
        return { ok: false, error: "Invalid credentials" };
      } catch {
        return { ok: false, error: "Failed to reach WhatsApp API" };
      }
    }
    default:
      return { ok: false, error: `Unknown channel: ${channelId}` };
  }
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerChannelSetupRoutes(
  fastify: FastifyInstance,
  deps: ChannelSetupDeps,
): void {
  const { isPrivateNetwork, getClientIp, idServiceBaseUrl, configPath } = deps;

  function guardPrivate(req: FastifyRequest): string | null {
    const ip = getClientIp(req);
    if (!isPrivateNetwork(ip)) return "Channel setup API only allowed from private network";
    return null;
  }

  // -------------------------------------------------------------------------
  // POST /api/channels/setup/start — begin OAuth handoff or reject non-OAuth
  // -------------------------------------------------------------------------

  fastify.post("/api/channels/setup/start", async (req, reply) => {
    const err = guardPrivate(req);
    if (err) return reply.code(403).send({ error: err });

    const body = req.body as { channelId?: string };
    if (!body.channelId) {
      return reply.code(400).send({ error: "channelId is required" });
    }

    const { channelId } = body;

    if (!OAUTH_CHANNELS.has(channelId)) {
      return reply.code(400).send({ error: "Channel does not use OAuth" });
    }

    if (!idServiceBaseUrl) {
      return reply.code(503).send({ error: "ID service is not configured" });
    }

    const purpose = `channel:${channelId}`;

    try {
      const res = await fetch(`${idServiceBaseUrl}/api/handoff/create`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ purpose }),
      });

      if (!res.ok) {
        const errText = await res.text();
        return reply.code(502).send({ error: `Failed to create handoff session: ${errText}` });
      }

      const data = (await res.json()) as { handoffId: string; authUrl: string };

      activeHandoffs.set(data.handoffId, {
        handoffId: data.handoffId,
        channelId,
        createdAt: Date.now(),
      });

      return reply.send({ handoffId: data.handoffId, popupUrl: data.authUrl });
    } catch {
      return reply.code(502).send({ error: "Cannot reach Aionima ID service" });
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/channels/setup/poll — poll handoff for completion
  // -------------------------------------------------------------------------

  fastify.get("/api/channels/setup/poll", async (req, reply) => {
    const err = guardPrivate(req);
    if (err) return reply.code(403).send({ error: err });

    const query = req.query as { handoffId?: string };
    if (!query.handoffId) {
      return reply.code(400).send({ error: "handoffId query parameter is required" });
    }

    const { handoffId } = query;
    const handoff = activeHandoffs.get(handoffId);

    if (!handoff) {
      return reply.send({ status: "error", error: "Handoff not found or already consumed" });
    }

    // Expire stale handoffs (15 min)
    if (Date.now() - handoff.createdAt > 15 * 60 * 1000) {
      activeHandoffs.delete(handoffId);
      return reply.send({ status: "error", error: "Handoff expired" });
    }

    if (!idServiceBaseUrl) {
      return reply.code(503).send({ error: "ID service is not configured" });
    }

    try {
      const res = await fetch(`${idServiceBaseUrl}/api/handoff/${handoffId}/poll`);

      if (!res.ok) {
        if (res.status === 404) {
          activeHandoffs.delete(handoffId);
          return reply.send({ status: "error", error: "Handoff not found on ID service" });
        }
        return reply.send({ status: "pending" });
      }

      const data = (await res.json()) as {
        status: string;
        services?: Array<{
          provider: string;
          role: string;
          accountLabel?: string;
          refreshToken?: string;
          accessToken?: string;
          clientId?: string;
          clientSecret?: string;
        }>;
      };

      if (data.status !== "completed" || !data.services?.length) {
        return reply.send({ status: data.status === "completed" ? "pending" : data.status });
      }

      // Collect tokens from the first matching service entry
      const svc = data.services[0]!;
      const tokens: Record<string, string> = {};
      if (svc.refreshToken) tokens.refreshToken = svc.refreshToken;
      if (svc.accessToken) tokens.accessToken = svc.accessToken;
      if (svc.clientId) tokens.clientId = svc.clientId;
      if (svc.clientSecret) tokens.clientSecret = svc.clientSecret;

      activeHandoffs.delete(handoffId);

      return reply.send({
        status: "complete",
        tokens,
        accountLabel: svc.accountLabel ?? "",
      });
    } catch {
      return reply.send({ status: "pending" });
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/channels/setup/test — test channel credentials
  // -------------------------------------------------------------------------

  fastify.post("/api/channels/setup/test", async (req, reply) => {
    const err = guardPrivate(req);
    if (err) return reply.code(403).send({ error: err });

    const body = req.body as { channelId?: string; config?: Record<string, string> };
    if (!body.channelId) {
      return reply.code(400).send({ error: "channelId is required" });
    }

    const result = await testChannel(body.channelId, body.config ?? {});
    return reply.send(result);
  });

  // -------------------------------------------------------------------------
  // POST /api/channels/setup/save — persist channel config to aionima.json
  // -------------------------------------------------------------------------

  fastify.post("/api/channels/setup/save", async (req, reply) => {
    const err = guardPrivate(req);
    if (err) return reply.code(403).send({ error: err });

    const body = req.body as {
      channelId?: string;
      config?: Record<string, string>;
      ownerChannelId?: string;
      enabled?: boolean;
    };

    if (!body.channelId) {
      return reply.code(400).send({ error: "channelId is required" });
    }

    const cfg = readConfig(configPath);

    // Update channels array — mirrors onboarding-api.ts POST /api/onboarding/channels
    const channels = (cfg.channels ?? []) as Array<{
      id: string;
      enabled: boolean;
      config: Record<string, string>;
    }>;

    const entry = {
      id: body.channelId,
      enabled: body.enabled ?? true,
      config: body.config ?? {},
    };

    const existingIdx = channels.findIndex((c) => c.id === body.channelId);
    if (existingIdx >= 0) {
      channels[existingIdx] = entry;
    } else {
      channels.push(entry);
    }
    cfg.channels = channels;

    // Update owner channel ID
    if (body.ownerChannelId) {
      const owner = (cfg.owner ?? {}) as Record<string, unknown>;
      const ownerChannels = (owner.channels ?? {}) as Record<string, string>;
      ownerChannels[body.channelId] = body.ownerChannelId;
      owner.channels = ownerChannels;
      cfg.owner = owner;
    }

    writeConfig(configPath, cfg);

    return reply.send({ ok: true });
  });
}
