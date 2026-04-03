/**
 * Visitor Authentication — federated challenge-response auth.
 *
 * Visitors from remote nodes authenticate by proving they hold
 * the private key corresponding to their GEID. No password is
 * stored locally; sessions have a TTL.
 *
 * Flow:
 * 1. Visitor presents GEID + home node ID
 * 2. Local node issues a challenge (random nonce)
 * 3. Visitor signs the challenge with their GEID private key
 * 4. Local node verifies the signature
 * 5. Optionally cross-checks with the home node
 * 6. Issues a session token
 */

import { randomBytes, verify, createHmac, timingSafeEqual } from "node:crypto";
import type { GEID } from "@aionima/entity-model";
import { isValidGEID, publicKeyFromGEID } from "@aionima/entity-model";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VisitorChallenge {
  challenge: string;
  geid: GEID;
  homeNodeId: string;
  createdAt: number;
  expiresAt: number;
}

export interface VisitorSession {
  geid: GEID;
  homeNodeId: string;
  entityId: string | null;
  role: string;
  issuedAt: number;
  expiresAt: number;
}

export interface VisitorAuthConfig {
  /** Challenge TTL in ms (default: 5 minutes). */
  challengeTtlMs?: number;
  /** Session TTL in ms (default: 1 hour). */
  sessionTtlMs?: number;
  /** Secret for signing session tokens. */
  sessionSecret: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_SESSION_TTL_MS = 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// VisitorAuthManager
// ---------------------------------------------------------------------------

export class VisitorAuthManager {
  private readonly challenges = new Map<string, VisitorChallenge>();
  private readonly challengeTtlMs: number;
  private readonly sessionTtlMs: number;
  private readonly sessionSecret: string;

  constructor(config: VisitorAuthConfig) {
    this.challengeTtlMs = config.challengeTtlMs ?? DEFAULT_CHALLENGE_TTL_MS;
    this.sessionTtlMs = config.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
    this.sessionSecret = config.sessionSecret;
  }

  /**
   * Issue a challenge for a visitor.
   */
  issueChallenge(geid: string, homeNodeId: string): VisitorChallenge | null {
    if (!isValidGEID(geid)) return null;

    const challenge: VisitorChallenge = {
      challenge: randomBytes(32).toString("hex"),
      geid: geid as GEID,
      homeNodeId,
      createdAt: Date.now(),
      expiresAt: Date.now() + this.challengeTtlMs,
    };

    this.challenges.set(challenge.challenge, challenge);
    this.cleanupExpired();

    return challenge;
  }

  /**
   * Verify a visitor's challenge response.
   *
   * @param challengeNonce - The challenge that was issued.
   * @param signatureHex - Ed25519 signature over the challenge nonce.
   * @returns Session token if valid, null otherwise.
   */
  verifyChallenge(
    challengeNonce: string,
    signatureHex: string,
  ): { session: VisitorSession; token: string } | null {
    const challenge = this.challenges.get(challengeNonce);
    if (!challenge) return null;

    // Expire check
    if (Date.now() > challenge.expiresAt) {
      this.challenges.delete(challengeNonce);
      return null;
    }

    // Verify signature using GEID-derived public key
    try {
      const publicKey = publicKeyFromGEID(challenge.geid);
      const signatureBuffer = Buffer.from(signatureHex, "hex");
      const valid = verify(
        null,
        Buffer.from(challengeNonce),
        publicKey,
        signatureBuffer,
      );

      if (!valid) return null;
    } catch {
      return null;
    }

    // Challenge consumed
    this.challenges.delete(challengeNonce);

    // Create session
    const now = Date.now();
    const session: VisitorSession = {
      geid: challenge.geid,
      homeNodeId: challenge.homeNodeId,
      entityId: null,
      role: "visitor",
      issuedAt: now,
      expiresAt: now + this.sessionTtlMs,
    };

    const token = this.signSession(session);
    return { session, token };
  }

  /**
   * Verify a visitor session token.
   */
  verifySession(token: string): VisitorSession | null {
    const dotIdx = token.indexOf(".");
    if (dotIdx === -1) return null;

    const data = token.slice(0, dotIdx);
    const sig = token.slice(dotIdx + 1);

    const expectedSig = createHmac("sha256", this.sessionSecret)
      .update(data)
      .digest("base64url");

    const sigBuf = Buffer.from(sig);
    const expectedBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) return null;

    try {
      const session = JSON.parse(
        Buffer.from(data, "base64url").toString(),
      ) as VisitorSession;

      if (Date.now() > session.expiresAt) return null;
      return session;
    } catch {
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private signSession(session: VisitorSession): string {
    const data = Buffer.from(JSON.stringify(session)).toString("base64url");
    const sig = createHmac("sha256", this.sessionSecret)
      .update(data)
      .digest("base64url");
    return `${data}.${sig}`;
  }

  private cleanupExpired(): void {
    const now = Date.now();
    for (const [key, challenge] of this.challenges) {
      if (now > challenge.expiresAt) {
        this.challenges.delete(key);
      }
    }
  }
}
