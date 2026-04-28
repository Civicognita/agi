/**
 * WhatsApp Security — Task #164
 *
 * Security adapter for WhatsApp:
 *   - Webhook signature verification (HMAC-SHA256)
 *   - Per-user rate limiting (sliding window)
 *   - Phone number allowlist (hashed)
 *
 * @see https://developers.facebook.com/docs/whatsapp/cloud-api/guides/set-up-webhooks
 */

import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import type { ChannelSecurityAdapter } from "@agi/channel-sdk";

// ---------------------------------------------------------------------------
// Webhook signature verification
// ---------------------------------------------------------------------------

/**
 * Verify the HMAC-SHA256 signature of a WhatsApp webhook request.
 *
 * @param rawBody - The raw request body as a string or Buffer.
 * @param signature - The X-Hub-Signature-256 header value (e.g., "sha256=abc...").
 * @param appSecret - The app secret used as the HMAC key.
 * @returns true if the signature is valid, false if tampered.
 */
export function verifyWebhookSignature(
  rawBody: string | Buffer,
  signature: string,
  appSecret: string,
): boolean {
  if (!signature.startsWith("sha256=")) return false;

  const expectedSig = signature.slice("sha256=".length);
  const computedSig = createHmac("sha256", appSecret)
    .update(rawBody)
    .digest("hex");

  // Timing-safe comparison to prevent timing attacks
  try {
    return timingSafeEqual(
      Buffer.from(expectedSig, "hex"),
      Buffer.from(computedSig, "hex"),
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Security adapter
// ---------------------------------------------------------------------------

export interface WhatsAppSecurityConfig {
  /** Allowed phone number hashes (SHA-256). Empty = all allowed. */
  allowedPhoneHashes?: string[];
  /** Max messages per user per minute (default: 20). */
  rateLimitPerMinute?: number;
}

/**
 * Create a security adapter for WhatsApp with rate limiting and allowlist.
 *
 * Phone numbers are compared as SHA-256 hashes — plaintext numbers are
 * never stored or compared in this adapter.
 */
export function createSecurityAdapter(
  config: WhatsAppSecurityConfig,
): ChannelSecurityAdapter {
  const allowSet = new Set(config.allowedPhoneHashes ?? []);
  const rateLimit = config.rateLimitPerMinute ?? 20;
  const rateBuckets = new Map<string, number[]>();

  return {
    isAllowed: async (channelUserId: string) => {
      // channelUserId is already a SHA-256 hash of the phone number
      if (allowSet.size > 0 && !allowSet.has(channelUserId)) {
        return false;
      }

      // Sliding-window rate limit
      const now = Date.now();
      const windowMs = 60_000;
      const bucket = rateBuckets.get(channelUserId) ?? [];
      const active = bucket.filter((t) => now - t < windowMs);

      if (active.length >= rateLimit) {
        rateBuckets.set(channelUserId, active);
        return false;
      }

      active.push(now);
      rateBuckets.set(channelUserId, active);
      return true;
    },

    getAllowlist: async () => [...allowSet],
  };
}

// ---------------------------------------------------------------------------
// Phone hash helper (re-export for convenience)
// ---------------------------------------------------------------------------

/**
 * Hash a plaintext phone number for use in the allowlist.
 * Use this when configuring allowed phone numbers.
 */
export function hashPhoneForAllowlist(phoneNumber: string): string {
  return createHash("sha256").update(phoneNumber).digest("hex");
}
