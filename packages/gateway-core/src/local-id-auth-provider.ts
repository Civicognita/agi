/**
 * Local-ID Auth Provider — authenticates dashboard users via
 * Local-ID handoff flow instead of internal username/password.
 *
 * Uses the same HMAC session tokens as DashboardUserStore for
 * backward compatibility — tokens from either provider are valid.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { createComponentLogger } from "./logger.js";
import type { Logger } from "./logger.js";
import type { DashboardSession, DashboardRole } from "./dashboard-user-store.js";

// ---------------------------------------------------------------------------
// Token signing (same algorithm as DashboardUserStore)
// ---------------------------------------------------------------------------

function signToken(payload: object, secret: string): string {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${sig}`;
}

function verifyToken<T>(token: string, secret: string): T | null {
  const dotIdx = token.indexOf(".");
  if (dotIdx === -1) return null;

  const data = token.slice(0, dotIdx);
  const sig = token.slice(dotIdx + 1);

  const expectedSig = createHmac("sha256", secret).update(data).digest("base64url");
  if (sig.length !== expectedSig.length) return null;
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) return null;

  try {
    return JSON.parse(Buffer.from(data, "base64url").toString()) as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LocalIdUserInfo {
  userId: string;
  entityId: string;
  displayName: string;
  coaAlias: string;
  geid: string;
  role: string;
}

export interface LoginStartResult {
  handoffId: string;
  authUrl: string;
}

export interface LoginPollResult {
  status: "pending" | "completed" | "expired" | "not_found";
  token?: string;
  user?: LocalIdUserInfo;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class LocalIdAuthProvider {
  private readonly idBaseUrl: string;
  private readonly secret: string;
  private readonly sessionTtlMs: number;
  private readonly log: ReturnType<typeof createComponentLogger>;

  constructor(
    idBaseUrl: string,
    signingSecret: string,
    sessionTtlMs = 86400000,
    logger?: Logger,
  ) {
    this.idBaseUrl = idBaseUrl;
    this.secret = signingSecret;
    this.sessionTtlMs = sessionTtlMs;
    this.log = createComponentLogger(logger, "local-id-auth");
  }

  /**
   * Check if Local-ID service is reachable.
   */
  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.idBaseUrl}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Create a handoff for dashboard login.
   * Returns handoffId + authUrl for the user to visit.
   */
  async startLogin(): Promise<LoginStartResult> {
    const res = await fetch(`${this.idBaseUrl}/api/handoff/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ purpose: "dashboard-login" }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Handoff create failed: ${res.status} ${text}`);
    }

    const data = (await res.json()) as { handoffId: string; authUrl: string };
    this.log.info(`Dashboard login handoff created: ${data.handoffId.slice(0, 8)}...`);
    return data;
  }

  /**
   * Poll a handoff for completion.
   * When completed, signs a session token and returns it.
   */
  async pollLogin(handoffId: string): Promise<LoginPollResult> {
    const res = await fetch(`${this.idBaseUrl}/api/handoff/${handoffId}/poll`);

    if (!res.ok) {
      if (res.status === 404) return { status: "not_found" };
      return { status: "pending" };
    }

    const data = (await res.json()) as {
      status: string;
      services?: unknown[];
      user?: LocalIdUserInfo;
    };

    if (data.status === "pending") {
      return { status: "pending" };
    }

    if (data.status === "expired") {
      return { status: "expired" };
    }

    if (data.status === "completed") {
      if (!data.user) {
        // Handoff completed but no user info — shouldn't happen for dashboard-login
        this.log.warn("Handoff completed without user info");
        return { status: "completed" };
      }

      // Sign a session token — role comes from Local-ID (Phase 3)
      const now = Date.now();
      const session: DashboardSession = {
        userId: data.user.userId,
        username: data.user.displayName,
        role: (data.user.role ?? "admin") as DashboardRole,
        issuedAt: now,
        expiresAt: now + this.sessionTtlMs,
      };

      const token = signToken(session, this.secret);
      this.log.info(`Dashboard login completed for entity ${data.user.coaAlias}`);

      return {
        status: "completed",
        token,
        user: data.user,
      };
    }

    return { status: "pending" };
  }

  /**
   * Verify a session token.
   * Uses the same HMAC algorithm as DashboardUserStore.
   */
  verifySession(token: string): DashboardSession | null {
    const session = verifyToken<DashboardSession>(token, this.secret);
    if (!session) return null;
    if (Date.now() > session.expiresAt) return null;
    return session;
  }
}
