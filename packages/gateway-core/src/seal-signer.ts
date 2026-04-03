/**
 * Ed25519 Seal Signer — Task #156
 *
 * Isolated signing service for 0R cryptographic seals.
 * Uses Node.js built-in Ed25519 (no external crypto dependencies).
 *
 * Key management:
 *   - GENESIS private key loaded from file or env var
 *   - Public key derivable from private key
 *   - Keys stored as PEM (PKCS8 private, SPKI public)
 *
 * The signer is intentionally isolated from the VerificationManager.
 * It only receives a canonical payload and returns a signature.
 * This separation prevents accidental key leakage through the
 * broader application surface.
 *
 * @see core/0SEAL.md
 */

import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Seal payload to be signed — deterministic JSON structure. */
export interface SealPayload {
  sealId: string;
  entityId: string;
  entityType: string;
  issuedAt: string;
  issuedBy: string;
  coa: string;
  alignment: {
    a_a: number;
    u_u: number;
    c_c: number;
  };
  checksum: string;
}

/** Signed seal — payload + Ed25519 signature. */
export interface SignedSeal {
  payload: SealPayload;
  /** Ed25519 signature as hex string. */
  signature: string;
  /** Public key as base64-encoded SPKI DER for verification. */
  publicKey: string;
}

/** Signer configuration. */
export interface SealSignerConfig {
  /** Path to GENESIS private key file (PEM format). */
  privateKeyPath?: string;
  /** Private key as PEM string (alternative to file path). */
  privateKeyPem?: string;
  /** Env var name for private key (default: GENESIS_PRIVATE_KEY). */
  envVar?: string;
}

// ---------------------------------------------------------------------------
// Canonical payload serialization
// ---------------------------------------------------------------------------

/**
 * Serialize a seal payload to a canonical JSON string.
 * Keys are sorted alphabetically at all levels to ensure
 * deterministic serialization across platforms.
 */
export function canonicalize(payload: SealPayload): string {
  return JSON.stringify(payload, Object.keys(payload).sort());
}

// ---------------------------------------------------------------------------
// SealSigner
// ---------------------------------------------------------------------------

export class SealSigner {
  private readonly privateKey: KeyObject;
  private readonly publicKey: KeyObject;
  /** Base64-encoded SPKI DER public key for distribution. */
  readonly publicKeyBase64: string;

  constructor(config: SealSignerConfig) {
    this.privateKey = loadPrivateKey(config);
    this.publicKey = createPublicKey(this.privateKey);
    this.publicKeyBase64 = this.publicKey
      .export({ type: "spki", format: "der" })
      .toString("base64");
  }

  // ---------------------------------------------------------------------------
  // Signing
  // ---------------------------------------------------------------------------

  /**
   * Sign a seal payload with the GENESIS Ed25519 private key.
   *
   * @returns SignedSeal containing the payload, hex signature, and public key.
   */
  sign(payload: SealPayload): SignedSeal {
    const canonical = canonicalize(payload);
    const signatureBuffer = sign(null, Buffer.from(canonical), this.privateKey);

    return {
      payload,
      signature: signatureBuffer.toString("hex"),
      publicKey: this.publicKeyBase64,
    };
  }

  // ---------------------------------------------------------------------------
  // Verification (server-side, for testing and diagnostics)
  // ---------------------------------------------------------------------------

  /**
   * Verify a signed seal using this signer's public key.
   * For client-side verification, use the standalone verify function.
   */
  verify(signedSeal: SignedSeal): boolean {
    const canonical = canonicalize(signedSeal.payload);
    const signatureBuffer = Buffer.from(signedSeal.signature, "hex");
    return verify(null, Buffer.from(canonical), this.publicKey, signatureBuffer);
  }

  // ---------------------------------------------------------------------------
  // Key management
  // ---------------------------------------------------------------------------

  /** Get the public key in PEM format (for distribution). */
  getPublicKeyPem(): string {
    return this.publicKey.export({ type: "spki", format: "pem" }) as string;
  }
}

// ---------------------------------------------------------------------------
// Key generation utility
// ---------------------------------------------------------------------------

/**
 * Generate a new Ed25519 keypair and optionally write to files.
 *
 * @returns Object with PEM-encoded private and public keys.
 */
export function generateKeypair(writeTo?: {
  privateKeyPath: string;
  publicKeyPath: string;
}): { privateKeyPem: string; publicKeyPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");

  const privateKeyPem = privateKey.export({
    type: "pkcs8",
    format: "pem",
  }) as string;
  const publicKeyPem = publicKey.export({
    type: "spki",
    format: "pem",
  }) as string;

  if (writeTo !== undefined) {
    const privDir = dirname(writeTo.privateKeyPath);
    if (!existsSync(privDir)) mkdirSync(privDir, { recursive: true });
    writeFileSync(writeTo.privateKeyPath, privateKeyPem, { mode: 0o600 });

    const pubDir = dirname(writeTo.publicKeyPath);
    if (!existsSync(pubDir)) mkdirSync(pubDir, { recursive: true });
    writeFileSync(writeTo.publicKeyPath, publicKeyPem, { mode: 0o644 });
  }

  return { privateKeyPem, publicKeyPem };
}

// ---------------------------------------------------------------------------
// Standalone verification (no private key needed)
// ---------------------------------------------------------------------------

/**
 * Verify an Ed25519 signature using a base64-encoded SPKI public key.
 * Works server-side (Node.js crypto).
 * For browser, use WebCrypto version in seal-verifier.ts.
 */
export function verifySignature(
  payload: SealPayload,
  signatureHex: string,
  publicKeyBase64: string,
): boolean {
  const pubKeyDer = Buffer.from(publicKeyBase64, "base64");
  const pubKey = createPublicKey({
    key: pubKeyDer,
    format: "der",
    type: "spki",
  });

  const canonical = canonicalize(payload);
  const signatureBuffer = Buffer.from(signatureHex, "hex");

  return verify(null, Buffer.from(canonical), pubKey, signatureBuffer);
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function loadPrivateKey(config: SealSignerConfig): KeyObject {
  // Priority: explicit PEM > file path > env var
  if (config.privateKeyPem !== undefined) {
    return createPrivateKey(config.privateKeyPem);
  }

  if (config.privateKeyPath !== undefined) {
    if (!existsSync(config.privateKeyPath)) {
      throw new Error(
        `GENESIS private key not found at ${config.privateKeyPath}. ` +
        `Generate with: generateKeypair({ privateKeyPath: "..." })`,
      );
    }
    const pem = readFileSync(config.privateKeyPath, "utf-8");
    return createPrivateKey(pem);
  }

  const envVar = config.envVar ?? "GENESIS_PRIVATE_KEY";
  const envValue = process.env[envVar];
  if (envValue !== undefined && envValue.length > 0) {
    return createPrivateKey(envValue);
  }

  throw new Error(
    `No GENESIS private key provided. Set one of: ` +
    `privateKeyPem, privateKeyPath, or ${envVar} env var.`,
  );
}
