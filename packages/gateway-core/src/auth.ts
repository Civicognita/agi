/**
 * Gateway Auth Layer — Task #235
 *
 * Multi-method auth for gateway HTTP/WS:
 * - Token-based and password-based with constant-time comparison
 *   (crypto.timingSafeEqual) to prevent timing attacks.
 * - Rate limit auth attempts per IP (10 max, 1min window, 5min lockout).
 * - Loopback exempt.
 * - Reject oversized prompts (2MB hard cap, CWE-400).
 *
 * @see openclaw/src/gateway/auth.ts
 * @see openclaw/src/gateway/auth-rate-limit.ts
 */

import { timingSafeEqual, createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Auth configuration. */
export interface AuthConfig {
  /** Bearer tokens that grant access (at least one required). */
  tokens: string[];
  /** Optional password for password-based auth. */
  password?: string;
  /** Max auth attempts per IP before lockout (default: 10). */
  maxAttemptsPerWindow: number;
  /** Rate limit window in ms (default: 60 seconds). */
  rateLimitWindowMs: number;
  /** Lockout duration in ms (default: 5 minutes). */
  lockoutDurationMs: number;
  /** Maximum request body size in bytes (default: 2MB). */
  maxBodyBytes: number;
  /** IPs exempt from rate limiting (default: loopback). */
  exemptIps: string[];
}

/** Result of an authentication attempt. */
export interface AuthResult {
  /** Whether authentication succeeded. */
  authenticated: boolean;
  /** Method that succeeded (or was attempted). */
  method: "token" | "password" | "none";
  /** Reason for failure (if applicable). */
  reason?: string;
}

/** Rate limit tracking per IP. */
interface IpTracker {
  attempts: number;
  windowStart: number;
  lockedUntil: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: Omit<AuthConfig, "tokens"> = {
  maxAttemptsPerWindow: 10,
  rateLimitWindowMs: 60_000, // 1 minute
  lockoutDurationMs: 5 * 60_000, // 5 minutes
  maxBodyBytes: 2 * 1024 * 1024, // 2 MB
  exemptIps: ["127.0.0.1", "::1", "::ffff:127.0.0.1"],
};

// ---------------------------------------------------------------------------
// GatewayAuth
// ---------------------------------------------------------------------------

export class GatewayAuth {
  private config: AuthConfig;
  private readonly ipTrackers = new Map<string, IpTracker>();
  /** Pre-hashed tokens for constant-time comparison. */
  private tokenHashes: Buffer[];
  /** Pre-hashed password. */
  private passwordHash: Buffer | null;

  constructor(config: Pick<AuthConfig, "tokens"> & Partial<AuthConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Pre-hash tokens for constant-time comparison
    this.tokenHashes = this.config.tokens.map((t) => hashForComparison(t));

    this.passwordHash = this.config.password !== undefined
      ? hashForComparison(this.config.password)
      : null;
  }

  /** Hot-reload auth config — re-hash tokens and password. */
  reloadConfig(config: Pick<AuthConfig, "tokens"> & Partial<AuthConfig>): void {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.tokenHashes = this.config.tokens.map((t) => hashForComparison(t));
    this.passwordHash = this.config.password !== undefined
      ? hashForComparison(this.config.password)
      : null;
  }

  /** True when at least one token or password is configured. */
  get hasCredentials(): boolean {
    return this.tokenHashes.length > 0 || this.passwordHash !== null;
  }

  // ---------------------------------------------------------------------------
  // Authentication
  // ---------------------------------------------------------------------------

  /**
   * Authenticate a request.
   *
   * @param ip - Client IP address.
   * @param token - Bearer token (from Authorization header).
   * @param password - Password (from X-Auth-Password header or body).
   * @returns Authentication result.
   */
  authenticate(
    ip: string,
    token?: string,
    password?: string,
  ): AuthResult {
    // Check IP lockout (skip for exempt IPs)
    if (!this.isExempt(ip)) {
      const lockoutResult = this.checkIpLockout(ip);
      if (lockoutResult !== null) return lockoutResult;
    }

    // Try token auth
    if (token !== undefined && token.length > 0) {
      const tokenHash = hashForComparison(token);
      const matches = this.tokenHashes.some((h) => safeCompare(tokenHash, h));

      if (matches) {
        this.resetIpTracker(ip);
        return { authenticated: true, method: "token" };
      }

      this.recordFailure(ip);
      return {
        authenticated: false,
        method: "token",
        reason: "Invalid token",
      };
    }

    // Try password auth
    if (password !== undefined && password.length > 0 && this.passwordHash !== null) {
      const pwHash = hashForComparison(password);
      if (safeCompare(pwHash, this.passwordHash)) {
        this.resetIpTracker(ip);
        return { authenticated: true, method: "password" };
      }

      this.recordFailure(ip);
      return {
        authenticated: false,
        method: "password",
        reason: "Invalid password",
      };
    }

    // No credentials provided
    if (!this.isExempt(ip)) {
      this.recordFailure(ip);
    }

    return {
      authenticated: false,
      method: "none",
      reason: "No credentials provided",
    };
  }

  // ---------------------------------------------------------------------------
  // Body size check
  // ---------------------------------------------------------------------------

  /**
   * Check if a request body exceeds the maximum allowed size.
   * Returns null if OK, or an error message if too large.
   */
  checkBodySize(sizeBytes: number): string | null {
    if (sizeBytes > this.config.maxBodyBytes) {
      return `Request body exceeds maximum size of ${String(this.config.maxBodyBytes)} bytes (got ${String(sizeBytes)})`;
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // IP rate limiting
  // ---------------------------------------------------------------------------

  private isExempt(ip: string): boolean {
    return this.config.exemptIps.includes(ip);
  }

  private checkIpLockout(ip: string): AuthResult | null {
    const tracker = this.ipTrackers.get(ip);
    if (tracker === undefined) return null;

    const now = Date.now();

    // Check lockout
    if (tracker.lockedUntil > now) {
      const remainMs = tracker.lockedUntil - now;
      return {
        authenticated: false,
        method: "none",
        reason: `IP locked out. Retry after ${String(Math.ceil(remainMs / 1000))}s`,
      };
    }

    // Reset window if expired
    if (now - tracker.windowStart >= this.config.rateLimitWindowMs) {
      tracker.attempts = 0;
      tracker.windowStart = now;
    }

    return null;
  }

  private recordFailure(ip: string): void {
    if (this.isExempt(ip)) return;

    const now = Date.now();
    let tracker = this.ipTrackers.get(ip);

    if (tracker === undefined) {
      tracker = { attempts: 0, windowStart: now, lockedUntil: 0 };
      this.ipTrackers.set(ip, tracker);
    }

    // Reset window if expired
    if (now - tracker.windowStart >= this.config.rateLimitWindowMs) {
      tracker.attempts = 0;
      tracker.windowStart = now;
    }

    tracker.attempts++;

    // Lockout if exceeded
    if (tracker.attempts >= this.config.maxAttemptsPerWindow) {
      tracker.lockedUntil = now + this.config.lockoutDurationMs;
    }
  }

  private resetIpTracker(ip: string): void {
    this.ipTrackers.delete(ip);
  }

  // ---------------------------------------------------------------------------
  // Diagnostics
  // ---------------------------------------------------------------------------

  /** Get current lockout status for an IP. */
  getIpStatus(ip: string): { attempts: number; locked: boolean; lockRemainMs: number } {
    const tracker = this.ipTrackers.get(ip);
    if (tracker === undefined) {
      return { attempts: 0, locked: false, lockRemainMs: 0 };
    }

    const now = Date.now();
    const locked = tracker.lockedUntil > now;
    const lockRemainMs = locked ? tracker.lockedUntil - now : 0;

    return { attempts: tracker.attempts, locked, lockRemainMs };
  }

  /** Clear all IP trackers. */
  reset(): void {
    this.ipTrackers.clear();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Hash a string for constant-time comparison. */
function hashForComparison(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/** Constant-time comparison of two buffers. */
function safeCompare(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
