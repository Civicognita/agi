/**
 * Seal Verification Library — Task #157
 *
 * Isomorphic Ed25519 signature verification for 0R seals.
 *
 * Two implementations:
 *   1. Node.js: uses `crypto.verify` (imported from seal-signer)
 *   2. Browser: uses WebCrypto API (SubtleCrypto.verify)
 *
 * The browser implementation is designed for the public verification portal.
 * It receives the public key as base64-encoded SPKI DER and verifies
 * signatures entirely client-side — no server calls needed.
 *
 * @see seal-signer.ts for the signing side
 */

import type { SealPayload } from "./seal-signer.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Verification result with diagnostic details. */
export interface SealVerificationResult {
  /** Whether the signature is valid AND the seal is not revoked. */
  valid: boolean;
  /** Whether the Ed25519 signature matches the payload. */
  signatureValid: boolean;
  /** Whether the checksum matches recomputed value. */
  checksumValid: boolean;
  /** Whether the seal is marked as revoked. */
  revoked: boolean;
  /** Human-readable status message. */
  message: string;
  /** Seal payload (present even if invalid, for diagnostics). */
  payload: SealPayload | null;
}

/** Compact seal bundle for portal verification. */
export interface SealBundle {
  payload: SealPayload;
  signature: string;
  publicKey: string;
  status: "active" | "revoked";
}

// ---------------------------------------------------------------------------
// Canonical serialization (must match seal-signer.ts)
// ---------------------------------------------------------------------------

function canonicalize(payload: SealPayload): string {
  return JSON.stringify(payload, Object.keys(payload).sort());
}

// ---------------------------------------------------------------------------
// WebCrypto verification (browser-compatible)
// ---------------------------------------------------------------------------

/**
 * Verify an Ed25519 seal signature using the WebCrypto API.
 * Works in modern browsers and Deno. Does NOT work in Node.js < 20
 * (use verifySignature from seal-signer.ts for Node.js).
 *
 * @param bundle - The seal bundle containing payload, signature, and public key.
 * @returns Verification result with diagnostics.
 */
export async function verifySealWebCrypto(
  bundle: SealBundle,
): Promise<SealVerificationResult> {
  try {
    // Import public key from SPKI DER
    const pubKeyBytes = base64ToArrayBuffer(bundle.publicKey);
    const cryptoKey = await crypto.subtle.importKey(
      "spki",
      pubKeyBytes,
      { name: "Ed25519" },
      false,
      ["verify"],
    );

    // Verify signature
    const canonical = canonicalize(bundle.payload);
    const messageBytes = new TextEncoder().encode(canonical);
    const signatureBytes = hexToArrayBuffer(bundle.signature);

    const signatureValid = await crypto.subtle.verify(
      "Ed25519",
      cryptoKey,
      signatureBytes,
      messageBytes,
    );

    // Verify checksum (SHA-256 of payload minus checksum field)
    const checksumValid = await verifyChecksum(bundle.payload);

    const revoked = bundle.status === "revoked";
    const valid = signatureValid && checksumValid && !revoked;

    let message: string;
    if (!signatureValid) {
      message = "INVALID: Ed25519 signature does not match payload. Seal may be tampered.";
    } else if (!checksumValid) {
      message = "INVALID: Checksum mismatch. Seal content may be altered.";
    } else if (revoked) {
      message = "REVOKED: This seal has been revoked by the issuing authority.";
    } else {
      message = "VALID: Seal signature verified. Entity is 0R sealed.";
    }

    return {
      valid,
      signatureValid,
      checksumValid,
      revoked,
      message,
      payload: bundle.payload,
    };
  } catch (err) {
    return {
      valid: false,
      signatureValid: false,
      checksumValid: false,
      revoked: false,
      message: `Verification error: ${err instanceof Error ? err.message : String(err)}`,
      payload: bundle.payload,
    };
  }
}

// ---------------------------------------------------------------------------
// Checksum verification (WebCrypto)
// ---------------------------------------------------------------------------

async function verifyChecksum(payload: SealPayload): Promise<boolean> {
  // Reconstruct the checksum input (same as seal-signer's issueSeal)
  const checksumInput = JSON.stringify({
    sealId: payload.sealId,
    entityId: payload.entityId,
    entityType: payload.entityType,
    issuedAt: payload.issuedAt,
    issuedBy: payload.issuedBy,
    coa: payload.coa,
    alignment: payload.alignment,
  });

  const messageBytes = new TextEncoder().encode(checksumInput);
  const hashBuffer = await crypto.subtle.digest("SHA-256", messageBytes);
  const computed = arrayBufferToHex(hashBuffer);

  return computed === payload.checksum;
}

// ---------------------------------------------------------------------------
// Encoding helpers
// ---------------------------------------------------------------------------

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer as ArrayBuffer;
}

function hexToArrayBuffer(hex: string): ArrayBuffer {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes.buffer as ArrayBuffer;
}

function arrayBufferToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

// ---------------------------------------------------------------------------
// Bundle parsing
// ---------------------------------------------------------------------------

/**
 * Parse a JSON string into a SealBundle.
 * Returns null if the string is not a valid seal bundle.
 */
export function parseSealBundle(json: string): SealBundle | null {
  try {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== "object" || parsed === null) return null;

    const obj = parsed as Record<string, unknown>;
    if (
      typeof obj["payload"] !== "object" || obj["payload"] === null ||
      typeof obj["signature"] !== "string" ||
      typeof obj["publicKey"] !== "string" ||
      (obj["status"] !== "active" && obj["status"] !== "revoked")
    ) {
      return null;
    }

    const payload = obj["payload"] as Record<string, unknown>;
    if (
      typeof payload["sealId"] !== "string" ||
      typeof payload["entityId"] !== "string" ||
      typeof payload["entityType"] !== "string" ||
      typeof payload["issuedAt"] !== "string" ||
      typeof payload["issuedBy"] !== "string" ||
      typeof payload["coa"] !== "string" ||
      typeof payload["checksum"] !== "string" ||
      typeof payload["alignment"] !== "object" || payload["alignment"] === null
    ) {
      return null;
    }

    return parsed as SealBundle;
  } catch {
    return null;
  }
}
