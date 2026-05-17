/**
 * Handoff API — short-lived secure token delivery between gateway and UI popups.
 *
 * Absorbed from agi-local-id Phase 2 (2026-05-16). Routes previously served
 * at id.ai.on are now served directly by the gateway.
 *
 * Local-mode fast path: requests originating from the private LAN are treated
 * as owner-authenticated (isOwner = true). The handoff is auto-approved on
 * CREATE — no login page interaction needed. The popup shows "Approved" and
 * closes.
 *
 * Routes:
 *   POST   /api/handoff/create      — create + optionally auto-approve
 *   GET    /api/handoff/:id         — serve approval HTML page
 *   POST   /api/handoff/:id/approve — explicit approve (session or owner)
 *   GET    /api/handoff/:id/poll    — poll status (one-shot; deletes on read)
 *
 * The background cleanup job is exported separately — wire it into server
 * startup via `startHandoffCleanup(db)`.
 */

import { randomBytes } from "node:crypto";
import { eq, lt } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { IncomingMessage } from "node:http";
import { connections, entities, geidLocal, handoffs, users } from "@agi/db-schema";
import type { Db } from "@agi/db-schema/client";
import { encryptToken, decryptToken } from "./crypto-tokens.js";
import { createComponentLogger } from "./logger.js";
import type { Logger } from "./logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ConnectionSnapshot {
  provider: string;
  role: string;
  accountLabel: string | null;
  accessToken: string | null;
  refreshToken: string | null;
}

export interface HandoffDeps {
  db: Db;
  encKey: Buffer;
  /** Base URL of this gateway (e.g. "https://ai.on"). Used to build authUrl. */
  gatewayBaseUrl: string;
  logger?: Logger;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

const TTL_MS = 15 * 60 * 1000; // 15 minutes

/** Map a purpose string to the provider IDs it allows. null = all providers. */
function purposeToProviderFilter(purpose: string | null): string[] | null {
  if (!purpose || purpose === "onboarding") return null;
  if (purpose.startsWith("channel:")) {
    const channel = purpose.slice("channel:".length);
    const map: Record<string, string[]> = {
      discord: ["discord"],
      gmail: ["google"],
      email: ["google"],
      github: ["github"],
    };
    return map[channel] ?? null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Internal helpers (shared with onboarding-api.ts)
// ---------------------------------------------------------------------------

/** Create a new handoff row and auto-approve if the caller is the owner. */
export async function createHandoff(
  db: Db,
  encKey: Buffer,
  purpose: string,
  gatewayBaseUrl: string,
  isOwner: boolean,
): Promise<{ handoffId: string; authUrl: string }> {
  const handoffId = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + TTL_MS);

  await db.insert(handoffs).values({
    id: handoffId,
    userId: null,
    status: "pending",
    connectedServices: null,
    purpose,
    expiresAt,
  });

  if (isOwner) {
    await autoApproveHandoff(db, encKey, handoffId, purpose);
  }

  const authUrl = `${gatewayBaseUrl}/api/handoff/${handoffId}`;
  return { handoffId, authUrl };
}

/** Poll a handoff. Returns status + decrypted services (one-shot: deletes row on completion). */
export async function pollHandoff(
  db: Db,
  encKey: Buffer,
  handoffId: string,
): Promise<{
  status: "pending" | "expired" | "not_found" | "completed";
  services?: Array<{ provider: string; role: string; accountLabel?: string | null; accessToken?: string | null; refreshToken?: string | null }>;
  user?: { userId: string; entityId: string; displayName: string; coaAlias: string; geid: string; role: string };
}> {
  if (!/^[0-9a-f]{64}$/.test(handoffId)) return { status: "not_found" };

  const [handoff] = await db.select().from(handoffs).where(eq(handoffs.id, handoffId)).limit(1);
  if (!handoff) return { status: "not_found" };

  if (handoff.expiresAt < new Date()) {
    await db.delete(handoffs).where(eq(handoffs.id, handoffId));
    return { status: "expired" };
  }

  if (handoff.status === "pending") return { status: "pending" };

  // "authenticated" — read services, delete row, return
  let services: ConnectionSnapshot[] = [];
  if (handoff.connectedServices) {
    try {
      services = JSON.parse(decryptToken(encKey, handoff.connectedServices)) as ConnectionSnapshot[];
    } catch { /* corrupt snapshot — return empty */ }
  }

  const userInfo = handoff.purpose === "dashboard-login"
    ? await resolveHandoffUserInfo(db, handoff.userId)
    : undefined;

  await db.delete(handoffs).where(eq(handoffs.id, handoffId));

  return {
    status: "completed",
    services: services.map((s) => ({
      provider: s.provider,
      role: s.role,
      accountLabel: s.accountLabel,
      accessToken: s.accessToken,
      refreshToken: s.refreshToken,
    })),
    ...(userInfo ? { user: userInfo } : {}),
  };
}

// ---------------------------------------------------------------------------
// Internal (non-exported) helpers
// ---------------------------------------------------------------------------

async function autoApproveHandoff(
  db: Db,
  encKey: Buffer,
  handoffId: string,
  purpose: string | null,
): Promise<void> {
  let allConnections = await db.select().from(connections);
  const filter = purposeToProviderFilter(purpose);
  if (filter) allConnections = allConnections.filter((c) => filter.includes(c.provider));

  if (allConnections.length === 0) {
    await db.update(handoffs).set({ status: "authenticated", connectedServices: null }).where(eq(handoffs.id, handoffId));
    return;
  }

  const snapshot: ConnectionSnapshot[] = allConnections.map((c) => ({
    provider: c.provider,
    role: c.role,
    accountLabel: c.accountLabel,
    accessToken: c.accessToken ? decryptToken(encKey, c.accessToken) : null,
    refreshToken: c.refreshToken ? decryptToken(encKey, c.refreshToken) : null,
  }));

  await db.update(handoffs)
    .set({ status: "authenticated", connectedServices: encryptToken(encKey, JSON.stringify(snapshot)) })
    .where(eq(handoffs.id, handoffId));
}


async function resolveHandoffUserInfo(
  db: Db,
  handoffUserId: string | null,
): Promise<{ userId: string; entityId: string; displayName: string; coaAlias: string; geid: string; role: string } | undefined> {
  if (handoffUserId) {
    const [user] = await db.select().from(users).where(eq(users.id, handoffUserId)).limit(1);
    if (!user || !user.entityId) return undefined;
    const [entity] = await db.select().from(entities).where(eq(entities.id, user.entityId)).limit(1);
    if (!entity) return undefined;
    const [geidRow] = await db.select().from(geidLocal).where(eq(geidLocal.entityId, entity.id)).limit(1);
    return {
      userId: user.id,
      entityId: entity.id,
      displayName: entity.displayName,
      coaAlias: entity.coaAlias,
      geid: geidRow?.geid ?? "",
      role: user.dashboardRole ?? "viewer",
    };
  }

  // Local mode owner auto-approval: find #E0 genesis owner entity
  const [ownerEntity] = await db.select().from(entities).where(eq(entities.coaAlias, "#E0")).limit(1);
  if (!ownerEntity) return undefined;
  const [geidRow] = await db.select().from(geidLocal).where(eq(geidLocal.entityId, ownerEntity.id)).limit(1);
  const [ownerUser] = ownerEntity.userId
    ? await db.select().from(users).where(eq(users.id, ownerEntity.userId)).limit(1)
    : [undefined];
  return {
    userId: ownerUser?.id ?? ownerEntity.id,
    entityId: ownerEntity.id,
    displayName: ownerEntity.displayName,
    coaAlias: ownerEntity.coaAlias,
    geid: geidRow?.geid ?? "",
    role: ownerUser?.dashboardRole ?? "admin",
  };
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerHandoffRoutes(fastify: FastifyInstance, deps: HandoffDeps): void {
  const { db, encKey, gatewayBaseUrl } = deps;
  const log = deps.logger
    ? createComponentLogger(deps.logger, "handoff-api")
    : { info: console.log, warn: console.warn, error: console.error };

  // POST /api/handoff/create
  fastify.post("/api/handoff/create", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    const isOwner = isPrivate(clientIp);
    const body = (request.body ?? {}) as { purpose?: string };
    const purpose = typeof body.purpose === "string" ? body.purpose : "onboarding";

    try {
      const result = await createHandoff(db, encKey, purpose, gatewayBaseUrl, isOwner);
      log.info(`Handoff created: ${result.handoffId} purpose=${purpose} autoApproved=${isOwner}`);
      return reply.send({ handoffId: result.handoffId, authUrl: result.authUrl });
    } catch (e) {
      log.error(`Handoff create failed: ${String(e)}`);
      return reply.code(500).send({ error: "Failed to create handoff" });
    }
  });

  // GET /api/handoff/:id — HTML approval page
  fastify.get("/api/handoff/:id", async (request, reply) => {
    const { id: handoffId } = request.params as { id: string };

    if (!/^[0-9a-f]{64}$/.test(handoffId)) {
      return reply.code(400).type("text/html").send("<h1>Invalid handoff ID</h1>");
    }

    const [handoff] = await db.select().from(handoffs).where(eq(handoffs.id, handoffId)).limit(1);

    if (!handoff) {
      return reply.code(404).type("text/html").send("<h1>Handoff not found or expired</h1>");
    }

    if (handoff.expiresAt < new Date()) {
      await db.delete(handoffs).where(eq(handoffs.id, handoffId));
      return reply.code(410).type("text/html").send("<h1>Handoff expired</h1>");
    }

    const clientIp = getClientIp(request.raw);
    const isOwner = isPrivate(clientIp);

    if (handoff.status !== "pending" || isOwner) {
      // Already approved or owner on private network — auto-approve + show success
      if (handoff.status === "pending" && isOwner) {
        await autoApproveHandoff(db, encKey, handoffId, handoff.purpose);
      }
      return reply.type("text/html").send(approvedPage());
    }

    // Non-owner, non-private: show a minimal "please use the dashboard" message
    return reply.type("text/html").send(pendingPage());
  });

  // POST /api/handoff/:id/approve
  fastify.post("/api/handoff/:id/approve", async (request, reply) => {
    const { id: handoffId } = request.params as { id: string };
    const clientIp = getClientIp(request.raw);
    const isOwner = isPrivate(clientIp);

    // Must be an authenticated dashboard session or owner on private network.
    // For Phase 2, we accept owner (private network) only — session-based approval
    // is a Phase 3 concern (entity/identity integration).
    if (!isOwner) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const [handoff] = await db.select().from(handoffs).where(eq(handoffs.id, handoffId)).limit(1);
    if (!handoff) return reply.code(404).send({ error: "Handoff not found" });
    if (handoff.expiresAt < new Date()) {
      await db.delete(handoffs).where(eq(handoffs.id, handoffId));
      return reply.code(410).send({ error: "Handoff expired" });
    }
    if (handoff.status !== "pending") return reply.code(409).send({ error: "Handoff already used" });

    await autoApproveHandoff(db, encKey, handoffId, handoff.purpose);
    return reply.send({ success: true });
  });

  // GET /api/handoff/:id/poll
  fastify.get("/api/handoff/:id/poll", async (request, reply) => {
    const { id: handoffId } = request.params as { id: string };
    const result = await pollHandoff(db, encKey, handoffId);

    if (result.status === "not_found") return reply.code(404).send({ status: "not_found" });
    return reply.send(result);
  });
}

// ---------------------------------------------------------------------------
// Background cleanup
// ---------------------------------------------------------------------------

export function startHandoffCleanup(db: Db): void {
  const INTERVAL_MS = 5 * 60 * 1000;

  const cleanup = async () => {
    try {
      await db.delete(handoffs).where(lt(handoffs.expiresAt, new Date()));
    } catch (e) {
      console.error("[handoff-cleanup] Failed to purge expired handoffs:", e);
    }
  };

  cleanup();
  setInterval(cleanup, INTERVAL_MS).unref();
}

// ---------------------------------------------------------------------------
// Inline HTML pages (no template engine dependency)
// ---------------------------------------------------------------------------

function approvedPage(): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Aionima — Approved</title>
<style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0f0f0f;color:#e5e5e5}
.card{text-align:center;padding:2rem;background:#1a1a1a;border-radius:12px;border:1px solid #2a2a2a}
h2{color:#4ade80;margin:0 0 .5rem}p{color:#888;margin:0}</style></head>
<body><div class="card"><h2>&#10003; Approved</h2><p>Identity verified. You can close this window.</p></div>
<script>setTimeout(function(){window.close()},1500)</script></body></html>`;
}

function pendingPage(): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Aionima — Handoff</title>
<style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0f0f0f;color:#e5e5e5}
.card{text-align:center;padding:2rem;background:#1a1a1a;border-radius:12px;border:1px solid #2a2a2a}
h2{margin:0 0 .5rem}p{color:#888;margin:0}</style></head>
<body><div class="card"><h2>Handoff Pending</h2><p>Please approve via the Aionima dashboard.</p></div></body></html>`;
}
