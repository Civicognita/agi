/**
 * Comms & Notifications API Routes — Fastify route registration.
 *
 * All endpoints are gated to private network only.
 */

import type { FastifyInstance } from "fastify";
import type { IncomingMessage } from "node:http";
import type { CommsLog } from "@agi/entity-model";
import type { NotificationStore } from "@agi/entity-model";
import type { ChannelAmbientLog } from "./channel-ambient-log.js";
import type { ModerationFlagStore, FlagAction, FlagStatus, FlagSeverity } from "./moderation-flag-store.js";

// ---------------------------------------------------------------------------
// Helpers (same as hosting-api.ts / server-runtime-state.ts)
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

function getClientIp(req: IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    const first = forwarded.split(",")[0];
    return first !== undefined ? first.trim() : "unknown";
  }
  return req.socket.remoteAddress ?? "unknown";
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export interface CommsRouteDeps {
  commsLog: CommsLog;
  notificationStore: NotificationStore;
  channelAmbientLog?: ChannelAmbientLog;
  moderationFlagStore?: ModerationFlagStore;
}

export function registerCommsRoutes(
  fastify: FastifyInstance,
  deps: CommsRouteDeps,
): void {
  const { commsLog, notificationStore, channelAmbientLog, moderationFlagStore } = deps;

  function guardPrivate(request: { raw: IncomingMessage }): string | null {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) return "Comms API only allowed from private network";
    return null;
  }

  // -------------------------------------------------------------------------
  // GET /api/comms — paginated comms log
  // -------------------------------------------------------------------------

  fastify.get<{
    Querystring: { channel?: string; direction?: string; limit?: string; offset?: string; date?: string };
  }>("/api/comms", async (request, reply) => {
    const err = guardPrivate(request);
    if (err !== null) return reply.code(403).send({ error: err });

    const { channel, direction, date } = request.query;
    const limit = Math.min(Number(request.query.limit) || 50, 200);
    const offset = Number(request.query.offset) || 0;

    // commsLog.query + commsLog.count are async (drizzle/pg under the
    // hood) — without awaiting, the reply serializes unresolved Promises
    // as `{}` and the client crashes when it tries to iterate `entries`.
    // Same bug class as v0.4.65's dashboard-api recentActivity fix.
    const [entries, total] = await Promise.all([
      commsLog.query({ channel, direction, date, limit, offset }),
      commsLog.count({ channel, direction, date }),
    ]);

    return reply.send({ entries, total });
  });

  // -------------------------------------------------------------------------
  // GET /api/comms/ambient — ambient channel log for a given day
  // -------------------------------------------------------------------------

  fastify.get<{
    Querystring: { channelId?: string; date?: string; limit?: string };
  }>("/api/comms/ambient", (request, reply) => {
    const err = guardPrivate(request);
    if (err !== null) return reply.code(403).send({ error: err });

    if (channelAmbientLog === undefined) {
      return reply.code(503).send({ error: "Ambient log not available" });
    }

    const { channelId, date } = request.query;
    if (!channelId) return reply.code(400).send({ error: "channelId is required" });

    const targetDate = date ?? new Date().toISOString().slice(0, 10);
    const limit = Math.min(Number(request.query.limit) || 200, 500);
    const entries = channelAmbientLog.getDateContext(channelId, targetDate, limit);

    return reply.send({ entries, date: targetDate });
  });

  // -------------------------------------------------------------------------
  // GET /api/comms/stats — per-channel message counts (today + all-time)
  // -------------------------------------------------------------------------

  fastify.get("/api/comms/stats", async (request, reply) => {
    const err = guardPrivate(request);
    if (err !== null) return reply.code(403).send({ error: err });

    const today = new Date().toISOString().slice(0, 10);

    // Pull all channel counts in parallel — one query per tracked channel.
    const channels = ["discord", "gmail", "telegram", "signal", "whatsapp", "email", "slack"];
    const results = await Promise.all(
      channels.map(async (ch) => {
        const [total, todayTotal] = await Promise.all([
          commsLog.count({ channel: ch }),
          commsLog.count({ channel: ch, date: today }),
        ]);
        return { channel: ch, total, todayTotal };
      }),
    );

    const byChannel: Record<string, { today: number; total: number }> = {};
    let todayTotal = 0;
    for (const r of results) {
      if (r.total > 0 || r.todayTotal > 0) {
        byChannel[r.channel] = { today: r.todayTotal, total: r.total };
        todayTotal += r.todayTotal;
      }
    }

    return reply.send({ byChannel, todayTotal });
  });

  // -------------------------------------------------------------------------
  // GET /api/agent/events — outbound comms entries projected as AgentEventEntry
  // -------------------------------------------------------------------------

  fastify.get<{
    Querystring: { channel?: string; kind?: string; limit?: string; date?: string };
  }>("/api/agent/events", async (request, reply) => {
    const err = guardPrivate(request);
    if (err !== null) return reply.code(403).send({ error: err });

    const { channel, date } = request.query;
    const limit = Math.min(Number(request.query.limit) || 50, 200);

    // Currently only "respond" events come from the comms log (outbound entries).
    // Other kinds (tool, memory, route) will be added when agent pipeline hooks exist.
    const [entries, total] = await Promise.all([
      commsLog.query({ direction: "outbound", channel, date, limit }),
      commsLog.count({ direction: "outbound", channel, date }),
    ]);

    const events = entries.map((e) => ({
      id: e.id,
      ts: e.createdAt,
      kind: "respond" as const,
      agentLabel: "Aion",
      channel: e.channel,
      target: e.senderName ?? e.senderId,
      summary: e.preview,
      entityId: e.entityId,
    }));

    return reply.send({ events, total });
  });

  // -------------------------------------------------------------------------
  // GET /api/moderation/flags — list moderation flags (newest first)
  // -------------------------------------------------------------------------

  fastify.get<{
    Querystring: { status?: string; severity?: string; channel?: string; limit?: string };
  }>("/api/moderation/flags", (request, reply) => {
    const err = guardPrivate(request);
    if (err !== null) return reply.code(403).send({ error: err });

    if (moderationFlagStore === undefined) {
      return reply.code(503).send({ error: "Moderation store not available" });
    }

    const { status, severity, channel } = request.query;
    const limit = Math.min(Number(request.query.limit) || 50, 200);

    const flags = moderationFlagStore.list({
      status: status as FlagStatus | undefined,
      severity: severity as FlagSeverity | undefined,
      channel,
      limit,
    });
    const total = moderationFlagStore.count({
      status: status as FlagStatus | undefined,
      severity: severity as FlagSeverity | undefined,
      channel,
    });

    return reply.send({ flags, total });
  });

  // -------------------------------------------------------------------------
  // POST /api/moderation/:id/action — apply an action to a flag
  // -------------------------------------------------------------------------

  fastify.post<{
    Params: { id: string };
    Body: { kind: FlagAction["kind"]; moderatorId?: string; note?: string };
  }>("/api/moderation/:id/action", (request, reply) => {
    const err = guardPrivate(request);
    if (err !== null) return reply.code(403).send({ error: err });

    if (moderationFlagStore === undefined) {
      return reply.code(503).send({ error: "Moderation store not available" });
    }

    const { id } = request.params;
    const body = request.body as { kind: FlagAction["kind"]; moderatorId?: string; note?: string };

    if (!body.kind) return reply.code(400).send({ error: "kind is required" });

    const action: FlagAction = {
      kind: body.kind,
      moderatorId: body.moderatorId ?? "owner",
      at: new Date().toISOString(),
      note: body.note,
    };

    const updated = moderationFlagStore.action(id, action);
    if (updated === null) return reply.code(404).send({ error: "Flag not found" });

    return reply.send(updated);
  });

  // -------------------------------------------------------------------------
  // GET /api/notifications — recent notifications
  // -------------------------------------------------------------------------

  fastify.get<{
    Querystring: { limit?: string; unreadOnly?: string };
  }>("/api/notifications", async (request, reply) => {
    const err = guardPrivate(request);
    if (err !== null) return reply.code(403).send({ error: err });

    const limit = Math.min(Number(request.query.limit) || 50, 200);
    const unreadOnly = request.query.unreadOnly === "true";

    // async store methods must be awaited — otherwise `notifications`
    // serializes as `{}` and the client's setNotifications(items)
    // plants a non-array into state, which then crashes the next
    // WS notification:new handler with "_e is not iterable".
    const [notifications, unreadCount] = await Promise.all([
      notificationStore.getRecent({ limit, unreadOnly }),
      notificationStore.countUnread(),
    ]);

    return reply.send({ notifications, unreadCount });
  });

  // -------------------------------------------------------------------------
  // POST /api/notifications/read — mark specific notifications as read
  // -------------------------------------------------------------------------

  fastify.post<{
    Body: { ids: string[] };
  }>("/api/notifications/read", async (request, reply) => {
    const err = guardPrivate(request);
    if (err !== null) return reply.code(403).send({ error: err });

    const { ids } = request.body as { ids: string[] };
    if (!Array.isArray(ids)) {
      return reply.code(400).send({ error: "ids must be an array" });
    }

    await notificationStore.markRead(ids);
    return reply.send({ ok: true });
  });

  // -------------------------------------------------------------------------
  // POST /api/notifications/read-all — mark all notifications as read
  // -------------------------------------------------------------------------

  fastify.post("/api/notifications/read-all", async (request, reply) => {
    const err = guardPrivate(request);
    if (err !== null) return reply.code(403).send({ error: err });

    await notificationStore.markAllRead();
    return reply.send({ ok: true });
  });
}
