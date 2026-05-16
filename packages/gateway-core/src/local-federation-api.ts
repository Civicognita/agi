/**
 * Local Federation API — self-describing endpoints for this gateway node.
 *
 * Absorbed from agi-local-id Phase 3 (2026-05-16).
 *
 * /.well-known/mycelium-node.json is handled by server-runtime-state.ts
 * via deps.federationNode (existing infrastructure — not duplicated here).
 *
 * Routes added here:
 *   GET  /federation/whoami   — return caller's resolved identity
 *   POST /federation/verify   — verify a GEID against the local entity store
 *
 * Note: the gateway's existing FederationNode implementation already serves
 * the manifest. These routes complement it with the AGI-absorbed equivalents
 * of the local-ID federation endpoints.
 */

import type { FastifyInstance } from "fastify";
import type { IncomingMessage } from "node:http";
import { eq } from "drizzle-orm";
import type { Db } from "@agi/db-schema/client";
import { entities, geidLocal } from "@agi/db-schema";

const HIVE_ID_URL = "https://id.aionima.ai";

export interface LocalFederationDeps {
  db: Db;
  /** Gateway base URL for building manifest URLs (e.g. "https://ai.on"). */
  gatewayBaseUrl: string;
  /** Node ID (e.g. "@A0"). Used in whoami response. */
  nodeId?: string;
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

export function registerLocalFederationRoutes(fastify: FastifyInstance, deps: LocalFederationDeps): void {
  const { db, gatewayBaseUrl, nodeId } = deps;

  // GET /federation/whoami — return caller's network identity
  fastify.get("/federation/whoami", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    const isOwner = isPrivate(clientIp);

    if (!isOwner) {
      return reply.send({
        identified: false,
        source: "anonymous",
        hint: "Access from a private network or provide a Bearer token",
      });
    }

    return reply.send({
      identified: true,
      source: "private-network",
      isOwner: true,
      nodeId: nodeId ?? null,
    });
  });

  // POST /federation/verify — verify a GEID against local entity store
  fastify.post("/federation/verify", async (request, reply) => {
    const body = (request.body ?? {}) as { geid?: string; nodeId?: string };

    if (body.geid) {
      // Check local entity store first (offline-capable)
      const [geidRow] = await db
        .select()
        .from(geidLocal)
        .where(eq(geidLocal.geid, body.geid))
        .limit(1);

      if (geidRow) {
        const [entity] = await db
          .select()
          .from(entities)
          .where(eq(entities.id, geidRow.entityId))
          .limit(1);

        return reply.send({
          geid: body.geid,
          known: true,
          source: "local",
          publicKey: geidRow.publicKeyPem,
          homeNodeUrl: gatewayBaseUrl,
          displayName: entity?.displayName ?? null,
          trustTier: entity?.verificationTier ?? "unverified",
        });
      }

      // Not in local store — direct caller to Hive-ID for authoritative lookup
      return reply.send({
        geid: body.geid,
        known: false,
        source: "local",
        hint: "GEID not in local store. Query the HIVE registry for authoritative lookup.",
        hiveIdUrl: HIVE_ID_URL,
      });
    }

    return reply.code(400).send({ error: "Provide geid or nodeId to verify" });
  });
}
