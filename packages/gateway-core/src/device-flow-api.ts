/**
 * Device Flow API — RFC 8628 OAuth 2.0 Device Authorization Grant.
 *
 * Absorbed from agi-local-id Phase 2 (2026-05-16).
 *
 * GitHub: public client — device flow works without client_secret.
 * Google/Discord: require client_secret held by Hive-ID. These providers
 * delegate through Hive-ID which brokers the token exchange (not yet
 * implemented — returns 501 with clear reason).
 *
 * Routes:
 *   POST  /api/auth/device-flow/start   — initiate with provider
 *   GET   /api/auth/device-flow/poll    — poll provider token endpoint
 *   GET   /api/auth/device-flow/status  — list stored connections (no tokens)
 *   GET   /api/auth/device-flow/token   — get decrypted token (LAN only)
 *   POST  /api/auth/device-flow/refresh — refresh Google token (Hive-ID gated)
 */

import { eq, and } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { IncomingMessage } from "node:http";
import { connections, handoffs } from "@agi/db-schema";
import type { Db } from "@agi/db-schema/client";
import { encryptToken, decryptToken } from "./crypto-tokens.js";
import { resolveOrCreateOwnerUserId, upsertConnection } from "./oauth-connection-store.js";
import { createComponentLogger } from "./logger.js";
import type { Logger } from "./logger.js";
import { IDENTITY_PROVIDERS } from "./identity-providers.js";

// ---------------------------------------------------------------------------
// Provider configuration
// ---------------------------------------------------------------------------

// GitHub's public client id + device endpoints come from the canonical identity
// registry (story #212) — single source of truth, no duplicated constant here.
const GITHUB_CLIENT_ID = IDENTITY_PROVIDERS.github.hostedClientId!;
const HIVE_ID_URL = "https://id.aionima.ai";

// `discord` is a *channel* provider (not on the identity page), so it stays in
// this device-flow-only table alongside the GitHub entry sourced from the SSOT.
type ProviderName = "github" | "google" | "discord";

const HIVE_BROKERED_PROVIDERS = new Set<ProviderName>(["google", "discord"]);

const PROVIDERS: Record<ProviderName, {
  deviceCodeUrl: string;
  tokenUrl: string;
  scopes: string;
  grantType: string;
}> = {
  github: {
    deviceCodeUrl: IDENTITY_PROVIDERS.github.endpoints!.deviceCodeUrl!,
    tokenUrl: IDENTITY_PROVIDERS.github.endpoints!.tokenUrl,
    scopes: IDENTITY_PROVIDERS.github.scopes.join(" "),
    grantType: "urn:ietf:params:oauth:grant-type:device_code",
  },
  google: {
    deviceCodeUrl: "https://oauth2.googleapis.com/device/code",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: "https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/userinfo.email",
    grantType: "urn:ietf:params:oauth:grant-type:device_code",
  },
  discord: {
    deviceCodeUrl: "https://discord.com/api/v10/oauth2/device/authorize",
    tokenUrl: "https://discord.com/api/v10/oauth2/token",
    scopes: "identify guilds",
    grantType: "urn:ietf:params:oauth:grant-type:device_code",
  },
};

interface DeviceSessionData {
  provider: ProviderName;
  role: string;
  interval: number;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DeviceFlowDeps {
  db: Db;
  encKey: Buffer;
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

async function fetchAccountLabel(provider: ProviderName, accessToken: string, tokenType: string): Promise<string> {
  // The account-label lookup hits a DIFFERENT host than the token endpoint
  // (api.github.com vs github.com). Without a timeout a slow/blocked userinfo
  // host would hang the whole completion poll indefinitely → the UI sits on
  // "waiting for approval" forever (story #218). The label is non-critical, so
  // bound it tightly and fall back to "" on timeout/error.
  const labelTimeout = AbortSignal.timeout(8000);
  try {
    if (provider === "github") {
      const res = await fetch("https://api.github.com/user", {
        headers: { Authorization: `${tokenType} ${accessToken}`, "User-Agent": "Aionima-Gateway" },
        signal: labelTimeout,
      });
      const u = await res.json() as { login?: string };
      return u.login ?? "";
    }
    if (provider === "google") {
      const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: labelTimeout,
      });
      const u = await res.json() as { email?: string };
      return u.email ?? "";
    }
    if (provider === "discord") {
      const res = await fetch("https://discord.com/api/v10/users/@me", {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: labelTimeout,
      });
      const u = await res.json() as { global_name?: string; username?: string };
      return u.global_name ?? u.username ?? "";
    }
  } catch { /* non-fatal */ }
  return "";
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerDeviceFlowRoutes(fastify: FastifyInstance, deps: DeviceFlowDeps): void {
  const { db, encKey } = deps;
  const log = deps.logger
    ? createComponentLogger(deps.logger, "device-flow-api")
    : { info: console.log, warn: console.warn, error: console.error };

  // POST /api/auth/device-flow/start
  fastify.post("/api/auth/device-flow/start", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivate(clientIp)) return reply.code(403).send({ error: "Device flow only available from private network" });

    const body = (request.body ?? {}) as { provider?: string; role?: string };
    const provider = body.provider as ProviderName | undefined;
    const role = body.role ?? "owner";

    if (!provider || !(provider in PROVIDERS)) {
      return reply.code(400).send({ error: `Invalid provider. Supported: ${Object.keys(PROVIDERS).join(", ")}` });
    }

    if (HIVE_BROKERED_PROVIDERS.has(provider)) {
      // Check Hive-ID reachability
      try {
        const healthRes = await fetch(`${HIVE_ID_URL}/health`, { signal: AbortSignal.timeout(3000) });
        if (!healthRes.ok) throw new Error("unhealthy");
      } catch {
        return reply.code(503).send({
          error: `${provider} authentication requires Hive-ID (${HIVE_ID_URL}) which is not reachable.`,
          reason: "hive_id_required",
        });
      }
      return reply.code(501).send({
        error: `${provider} device flow via Hive-ID is not yet implemented.`,
        reason: "not_implemented",
      });
    }

    const clientId = GITHUB_CLIENT_ID; // only GitHub is LOCAL_PROVIDERS
    const providerCfg = PROVIDERS[provider];

    const params = new URLSearchParams();
    params.set("client_id", clientId);
    params.set("scope", providerCfg.scopes);

    let data: {
      device_code: string;
      user_code: string;
      verification_uri?: string;
      verification_url?: string;
      expires_in: number;
      interval?: number;
    };

    try {
      const res = await fetch(providerCfg.deviceCodeUrl, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return reply.code(502).send({ error: `Provider returned ${res.status}: ${text.slice(0, 200)}` });
      }
      data = await res.json() as typeof data;
    } catch (err) {
      return reply.code(502).send({ error: `Failed to reach ${provider}: ${err instanceof Error ? err.message : String(err)}` });
    }

    const sessionData: DeviceSessionData = { provider, role, interval: data.interval ?? 5 };

    await db.insert(handoffs).values({
      id: data.device_code,
      userId: null,
      status: "pending",
      connectedServices: encryptToken(encKey, JSON.stringify(sessionData)),
      purpose: "device-flow",
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
    });

    log.info(`Device flow started: provider=${provider} role=${role}`);

    return reply.send({
      deviceCode: data.device_code,
      userCode: data.user_code,
      verificationUri: data.verification_uri ?? data.verification_url ?? "",
      expiresIn: data.expires_in,
      interval: data.interval ?? 5,
    });
  });

  // GET /api/auth/device-flow/poll?deviceCode=...
  fastify.get("/api/auth/device-flow/poll", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivate(clientIp)) return reply.code(403).send({ error: "Device flow only available from private network" });

    const deviceCode = (request.query as Record<string, string>).deviceCode;
    if (!deviceCode) return reply.code(400).send({ error: "deviceCode query parameter is required" });

    // Whole-handler guard: ANY throw (DB read, token decrypt/parse, handoff
    // delete, …) returns {status:"error"} with the real message — never an
    // unhandled 500 that the frontend poll loop would treat as transient and
    // spin/blow up on (story #218 follow-up). The surfaced message also tells
    // us the actual cause.
    try {
    const [sessionRow] = await db
      .select()
      .from(handoffs)
      .where(and(eq(handoffs.id, deviceCode), eq(handoffs.purpose, "device-flow")))
      .limit(1);

    if (!sessionRow) return reply.send({ status: "expired" });
    if (new Date() > sessionRow.expiresAt) {
      await db.delete(handoffs).where(eq(handoffs.id, deviceCode));
      return reply.send({ status: "expired" });
    }

    // Decrypt the session. If the key can't open it (e.g. the encryption key
    // rotated between start and poll, or the row is corrupt), the session is
    // unrecoverable — drop it and report expired so the user cleanly restarts,
    // rather than 500-ing every poll.
    let sessionData: DeviceSessionData;
    try {
      sessionData = JSON.parse(decryptToken(encKey, sessionRow.connectedServices!)) as DeviceSessionData;
    } catch (err) {
      log.error(`Device flow: session decrypt failed (unrecoverable) — ${err instanceof Error ? err.message : String(err)}`);
      await db.delete(handoffs).where(eq(handoffs.id, deviceCode)).catch(() => {});
      return reply.send({ status: "expired", error: "session_unreadable" });
    }
    const { provider } = sessionData;
    const providerCfg = PROVIDERS[provider];

    const params = new URLSearchParams();
    params.set("client_id", GITHUB_CLIENT_ID);
    params.set("device_code", deviceCode);
    params.set("grant_type", providerCfg.grantType);

    let data: Record<string, unknown>;
    try {
      const res = await fetch(providerCfg.tokenUrl, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
        signal: AbortSignal.timeout(10_000),
      });
      data = await res.json() as Record<string, unknown>;
    } catch (err) {
      return reply.send({ status: "error", error: `Token poll failed: ${err instanceof Error ? err.message : String(err)}` });
    }

    const error = data.error as string | undefined;

    if (error === "authorization_pending") return reply.send({ status: "pending", interval: sessionData.interval });
    if (error === "slow_down") {
      const newInterval = sessionData.interval + 5;
      await db.update(handoffs)
        .set({ connectedServices: encryptToken(encKey, JSON.stringify({ ...sessionData, interval: newInterval } satisfies DeviceSessionData)) })
        .where(eq(handoffs.id, deviceCode));
      return reply.send({ status: "pending", interval: newInterval });
    }
    if (error === "expired_token" || error === "access_denied") {
      await db.delete(handoffs).where(eq(handoffs.id, deviceCode));
      return reply.send({ status: "expired", error });
    }
    if (error) return reply.send({ status: "error", error: String(data.error_description ?? error) });

    // Authorization granted
    const accessToken = data.access_token as string;
    const refreshToken = data.refresh_token as string | undefined;
    const tokenType = (data.token_type as string | undefined) ?? "Bearer";
    const scope = data.scope as string | undefined;
    const expiresIn = data.expires_in as number | undefined;

    const accountLabel = await fetchAccountLabel(provider, accessToken, tokenType);

    // Persist the connection. Any failure here must surface as a clear error —
    // NOT an unhandled 500, which the frontend poll loop would silently treat
    // as transient and keep spinning on "waiting" forever (story #218).
    try {
      const userId = await resolveOrCreateOwnerUserId(db, accountLabel);
      // Shared store (story #213) — single upsert path for both OAuth ingress flows.
      await upsertConnection(db, encKey, userId, {
        provider,
        role: sessionData.role,
        accountLabel,
        accessToken,
        refreshToken: refreshToken ?? null,
        tokenExpiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
        scopes: scope ?? null,
      });
    } catch (err) {
      log.error(`Device flow: token obtained but persistence failed: ${err instanceof Error ? err.message : String(err)}`);
      return reply.send({ status: "error", error: `Authorized, but saving the connection failed: ${err instanceof Error ? err.message : String(err)}` });
    }

    await db.delete(handoffs).where(eq(handoffs.id, deviceCode));

    log.info(`Device flow completed: provider=${provider} role=${sessionData.role} user=${accountLabel}`);
    return reply.send({ status: "completed", provider, role: sessionData.role, accountLabel });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`Device flow poll failed: ${msg}`);
      return reply.send({ status: "error", error: `Device flow poll failed: ${msg}` });
    }
  });

  // GET /api/auth/device-flow/status
  fastify.get("/api/auth/device-flow/status", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivate(clientIp)) return reply.code(403).send({ error: "Status only available from private network" });

    const rows = await db.select({
      provider: connections.provider,
      role: connections.role,
      accountLabel: connections.accountLabel,
      scopes: connections.scopes,
      tokenExpiresAt: connections.tokenExpiresAt,
      updatedAt: connections.updatedAt,
    }).from(connections);

    return reply.send(rows);
  });

  // GET /api/auth/device-flow/token?provider=github&role=owner
  fastify.get("/api/auth/device-flow/token", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivate(clientIp)) return reply.code(403).send({ error: "Token retrieval only available from private network" });

    const { provider, role } = request.query as { provider?: string; role?: string };
    if (!provider) return reply.code(400).send({ error: "provider query param required" });

    const [row] = await db
      .select()
      .from(connections)
      .where(and(eq(connections.provider, provider), eq(connections.role, role ?? "owner")))
      .limit(1);

    if (!row?.accessToken) return reply.code(404).send({ error: "no such connection" });

    let accessToken: string;
    try {
      accessToken = decryptToken(encKey, row.accessToken);
    } catch {
      return reply.code(500).send({ error: "connection token corrupt" });
    }

    return reply.send({
      provider: row.provider,
      role: row.role,
      accountLabel: row.accountLabel,
      accessToken,
      tokenType: "Bearer",
      tokenExpiresAt: row.tokenExpiresAt?.toISOString() ?? null,
      scopes: row.scopes,
    });
  });

  // DELETE /api/auth/device-flow/connection?provider=...&role=...
  fastify.delete("/api/auth/device-flow/connection", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivate(clientIp)) return reply.code(403).send({ error: "Only available from private network" });

    const { provider, role } = request.query as { provider?: string; role?: string };
    if (!provider) return reply.code(400).send({ error: "provider query param required" });

    const result = await db.delete(connections).where(
      and(eq(connections.provider, provider), eq(connections.role, role ?? "owner")),
    );

    log.info(`Connection removed: provider=${provider} role=${role ?? "owner"} rows=${result.rowCount ?? 0}`);
    return reply.send({ ok: true });
  });

  // POST /api/auth/device-flow/refresh
  fastify.post("/api/auth/device-flow/refresh", async (request, reply) => {
    const clientIp = getClientIp(request.raw);
    if (!isPrivate(clientIp)) return reply.code(403).send({ error: "Token refresh only available from private network" });

    const body = (request.body ?? {}) as { provider?: string; role?: string };
    if (body.provider !== "google") {
      return reply.code(400).send({ error: "Token refresh is only supported for Google" });
    }

    try {
      const healthRes = await fetch(`${HIVE_ID_URL}/health`, { signal: AbortSignal.timeout(3000) });
      if (!healthRes.ok) throw new Error("unhealthy");
    } catch {
      return reply.code(503).send({
        error: `Token refresh requires Hive-ID (${HIVE_ID_URL}) which is not reachable.`,
        reason: "hive_id_required",
      });
    }
    return reply.code(501).send({ error: "Token refresh via Hive-ID is not yet implemented.", reason: "not_implemented" });
  });
}
