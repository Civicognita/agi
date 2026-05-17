/**
 * Connections API — OAuth provider connection management.
 *
 * Absorbed from agi-local-id Phase 2 (2026-05-16). Lists and deletes stored
 * OAuth connections (GitHub, Google, Discord). Tokens are never exposed here
 * — use /api/auth/device-flow/token for token retrieval.
 *
 * Routes:
 *   GET    /api/connections      — list all connections (no tokens)
 *   DELETE /api/connections/:id  — delete a connection by ID
 */

import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { IncomingMessage } from "node:http";
import { connections } from "@agi/db-schema";
import type { Db } from "@agi/db-schema/client";

export interface ConnectionsDeps {
  db: Db;
}

function isLoopback(ip: string): boolean {
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

function isPrivate(ip: string): boolean {
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
  return req.ip ?? req.socket?.remoteAddress ?? "unknown";
}

export function registerConnectionsRoutes(fastify: FastifyInstance, deps: ConnectionsDeps): void {
  const { db } = deps;

  // GET /api/connections
  fastify.get("/api/connections", async (request, reply) => {
    if (!isPrivate(getClientIp(request.raw))) {
      return reply.code(403).send({ error: "Connections API only available from private network" });
    }

    const rows = await db.select({
      id: connections.id,
      provider: connections.provider,
      role: connections.role,
      accountLabel: connections.accountLabel,
      scopes: connections.scopes,
      tokenExpiresAt: connections.tokenExpiresAt,
      createdAt: connections.createdAt,
      updatedAt: connections.updatedAt,
    }).from(connections);

    return reply.send(rows);
  });

  // DELETE /api/connections/:id
  fastify.delete("/api/connections/:id", async (request, reply) => {
    if (!isPrivate(getClientIp(request.raw))) {
      return reply.code(403).send({ error: "Connections API only available from private network" });
    }

    const { id } = request.params as { id: string };
    const [existing] = await db.select({ id: connections.id }).from(connections).where(eq(connections.id, id)).limit(1);

    if (!existing) return reply.code(404).send({ error: "Connection not found" });
    await db.delete(connections).where(eq(connections.id, id));
    return reply.send({ success: true });
  });
}
