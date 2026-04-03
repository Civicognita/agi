/**
 * Comms & Notifications API Routes — Fastify route registration.
 *
 * All endpoints are gated to private network only.
 */

import type { FastifyInstance } from "fastify";
import type { IncomingMessage } from "node:http";
import type { CommsLog } from "@aionima/entity-model";
import type { NotificationStore } from "@aionima/entity-model";

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
}

export function registerCommsRoutes(
  fastify: FastifyInstance,
  deps: CommsRouteDeps,
): void {
  const { commsLog, notificationStore } = deps;

  function guardPrivate(request: { raw: IncomingMessage }): string | null {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) return "Comms API only allowed from private network";
    return null;
  }

  // -------------------------------------------------------------------------
  // GET /api/comms — paginated comms log
  // -------------------------------------------------------------------------

  fastify.get<{
    Querystring: { channel?: string; direction?: string; limit?: string; offset?: string };
  }>("/api/comms", async (request, reply) => {
    const err = guardPrivate(request);
    if (err !== null) return reply.code(403).send({ error: err });

    const { channel, direction } = request.query;
    const limit = Math.min(Number(request.query.limit) || 50, 200);
    const offset = Number(request.query.offset) || 0;

    const entries = commsLog.query({ channel, direction, limit, offset });
    const total = commsLog.count({ channel, direction });

    return reply.send({ entries, total });
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

    const notifications = notificationStore.getRecent({ limit, unreadOnly });
    const unreadCount = notificationStore.countUnread();

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

    notificationStore.markRead(ids);
    return reply.send({ ok: true });
  });

  // -------------------------------------------------------------------------
  // POST /api/notifications/read-all — mark all notifications as read
  // -------------------------------------------------------------------------

  fastify.post("/api/notifications/read-all", async (request, reply) => {
    const err = guardPrivate(request);
    if (err !== null) return reply.code(403).send({ error: err });

    notificationStore.markAllRead();
    return reply.send({ ok: true });
  });
}
