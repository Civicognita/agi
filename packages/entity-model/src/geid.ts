/**
 * Global Entity ID (GEID) System — Task #194
 *
 * Self-sovereign identity for cross-node entity federation.
 * Each entity can generate an Ed25519 keypair and derive a GEID
 * from the public key.
 *
 * GEID Format: geid:<base58-encoded-public-key>
 *
 * Features:
 * - Ed25519 keypair generation per entity
 * - GEID derivation from public key
 * - Identity statement signing (links local entity ID to GEID)
 * - Cross-node entity linking with explicit consent (opt-in, default private)
 * - Local entity ID → GEID mapping storage
 */

import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";

// ---------------------------------------------------------------------------
// Base58 encoding (Bitcoin-style, no external deps)
// ---------------------------------------------------------------------------

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function encodeBase58(buffer: Uint8Array): string {
  const digits = [0];
  for (const byte of buffer) {
    let carry = byte;
    for (let j = 0; j < digits.length; j++) {
      carry += (digits[j] as number) << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }

  // Leading zeros
  let output = "";
  for (const byte of buffer) {
    if (byte !== 0) break;
    output += BASE58_ALPHABET[0];
  }

  for (let i = digits.length - 1; i >= 0; i--) {
    output += BASE58_ALPHABET[digits[i] as number];
  }

  return output;
}

function decodeBase58(str: string): Uint8Array {
  const bytes = [0];
  for (const char of str) {
    const idx = BASE58_ALPHABET.indexOf(char);
    if (idx === -1) throw new Error(`Invalid base58 character: ${char}`);

    let carry = idx;
    for (let j = 0; j < bytes.length; j++) {
      carry += (bytes[j] as number) * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  // Leading ones (base58 zeros)
  const leadingOnes = str.match(/^1*/)?.[0]?.length ?? 0;
  const result = new Uint8Array(leadingOnes + bytes.length);
  // Leading zeros already set by Uint8Array constructor
  for (let i = 0; i < bytes.length; i++) {
    result[leadingOnes + bytes.length - 1 - i] = bytes[i] as number;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** GEID format: geid:<base58-public-key> */
export type GEID = string & { readonly __brand: unique symbol };

/** Entity keypair for federation identity. */
export interface EntityKeypair {
  /** PEM-encoded PKCS8 private key. */
  privateKeyPem: string;
  /** PEM-encoded SPKI public key. */
  publicKeyPem: string;
  /** The derived GEID. */
  geid: GEID;
  /** Raw public key bytes as base58. */
  publicKeyBase58: string;
}

/** Identity statement linking local entity ID to GEID. */
export interface IdentityStatement {
  /** The GEID being claimed. */
  geid: GEID;
  /** Local entity ID on this node. */
  localEntityId: string;
  /** Node ID (@N format) making the binding. */
  nodeId: string;
  /** ISO timestamp of statement creation. */
  timestamp: string;
  /** Ed25519 signature over the canonical statement (hex). */
  signature: string;
}

/** GEID mapping record (stored in database). */
export interface GEIDMapping {
  localEntityId: string;
  geid: GEID;
  publicKeyPem: string;
  /** Whether this entity opts into cross-node discovery. */
  discoverable: boolean;
  /** ISO timestamp of GEID creation. */
  createdAt: string;
}

/** Consent status for cross-node linking. */
export type FederationConsent = "none" | "opted_in" | "opted_out";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const GEID_PREFIX = "geid:" as const;

// ---------------------------------------------------------------------------
// GEID generation and management
// ---------------------------------------------------------------------------

/**
 * Generate a new Ed25519 keypair and derive a GEID.
 */
export function generateEntityKeypair(): EntityKeypair {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");

  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }) as string;

  // Extract raw 32-byte public key from SPKI DER
  const spkiDer = publicKey.export({ type: "spki", format: "der" }) as Buffer;
  // Ed25519 SPKI DER: 12-byte header + 32-byte key
  const rawPublicKey = spkiDer.subarray(12);
  const publicKeyBase58 = encodeBase58(rawPublicKey);

  const geid = `${GEID_PREFIX}${publicKeyBase58}` as GEID;

  return { privateKeyPem, publicKeyPem, geid, publicKeyBase58 };
}

/**
 * Derive a GEID from a PEM-encoded public key.
 */
export function deriveGEID(publicKeyPem: string): GEID {
  const publicKey = createPublicKey(publicKeyPem);
  const spkiDer = publicKey.export({ type: "spki", format: "der" }) as Buffer;
  const rawPublicKey = spkiDer.subarray(12);
  const base58 = encodeBase58(rawPublicKey);
  return `${GEID_PREFIX}${base58}` as GEID;
}

/**
 * Validate a GEID format.
 */
export function isValidGEID(geid: string): geid is GEID {
  if (!geid.startsWith(GEID_PREFIX)) return false;
  const base58Part = geid.slice(GEID_PREFIX.length);
  if (base58Part.length < 20 || base58Part.length > 50) return false;

  // Validate base58 characters
  for (const char of base58Part) {
    if (!BASE58_ALPHABET.includes(char)) return false;
  }
  return true;
}

/**
 * Extract the base58 public key from a GEID.
 */
export function extractPublicKeyBase58(geid: GEID): string {
  return geid.slice(GEID_PREFIX.length);
}

// ---------------------------------------------------------------------------
// Identity statement signing
// ---------------------------------------------------------------------------

/**
 * Create and sign an identity statement linking a local entity to a GEID.
 */
export function signIdentityStatement(
  privateKeyPem: string,
  geid: GEID,
  localEntityId: string,
  nodeId: string,
): IdentityStatement {
  const timestamp = new Date().toISOString();

  const canonical = canonicalizeStatement(geid, localEntityId, nodeId, timestamp);
  const privateKey = createPrivateKey(privateKeyPem);
  const signature = sign(null, Buffer.from(canonical), privateKey).toString("hex");

  return { geid, localEntityId, nodeId, timestamp, signature };
}

/**
 * Verify an identity statement's signature.
 */
export function verifyIdentityStatement(
  statement: IdentityStatement,
  publicKeyPem: string,
): boolean {
  const canonical = canonicalizeStatement(
    statement.geid,
    statement.localEntityId,
    statement.nodeId,
    statement.timestamp,
  );

  const publicKey = createPublicKey(publicKeyPem);
  const signatureBuffer = Buffer.from(statement.signature, "hex");

  return verify(null, Buffer.from(canonical), publicKey, signatureBuffer);
}

/**
 * Reconstruct a public key PEM from a GEID's base58 public key.
 */
export function publicKeyFromGEID(geid: GEID): KeyObject {
  const base58 = extractPublicKeyBase58(geid);
  const rawKey = decodeBase58(base58);

  // Build SPKI DER: 12-byte Ed25519 header + 32-byte key
  const ED25519_SPKI_HEADER = Buffer.from([
    0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
  ]);
  const spkiDer = Buffer.concat([ED25519_SPKI_HEADER, rawKey]);

  return createPublicKey({ key: spkiDer, format: "der", type: "spki" });
}

// ---------------------------------------------------------------------------
// COA address format: <entity_alias>[.<agent_alias>]@<node_alias>
// ---------------------------------------------------------------------------

/** Parsed COA address parts. */
export interface COAAddress {
  entityAlias: string;
  agentAlias: string | null;
  nodeAlias: string | null;
}

/**
 * Format a COA address string.
 * Examples: "#E0@#O0", "#E0.$A0@#O0", "#E3" (local, no node)
 */
export function formatAddress(
  entityAlias: string,
  nodeAlias?: string | null,
  agentAlias?: string | null,
): string {
  let addr = entityAlias;
  if (agentAlias) addr += `.${agentAlias}`;
  if (nodeAlias) addr += `@${nodeAlias}`;
  return addr;
}

/**
 * Parse a COA address string into its components.
 * Returns null if the format is invalid.
 */
export function parseAddress(address: string): COAAddress | null {
  // Split on @ first to separate node
  const atIdx = address.indexOf("@");
  let localPart: string;
  let nodeAlias: string | null = null;

  if (atIdx >= 0) {
    localPart = address.slice(0, atIdx);
    nodeAlias = address.slice(atIdx + 1);
    if (!nodeAlias) return null;
  } else {
    localPart = address;
  }

  // Split local part on . to separate agent
  const dotIdx = localPart.indexOf(".");
  let entityAlias: string;
  let agentAlias: string | null = null;

  if (dotIdx >= 0) {
    entityAlias = localPart.slice(0, dotIdx);
    agentAlias = localPart.slice(dotIdx + 1);
    if (!agentAlias) return null;
  } else {
    entityAlias = localPart;
  }

  if (!entityAlias) return null;

  return { entityAlias, agentAlias, nodeAlias };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function canonicalizeStatement(
  geid: string,
  localEntityId: string,
  nodeId: string,
  timestamp: string,
): string {
  return JSON.stringify({
    geid,
    localEntityId,
    nodeId,
    timestamp,
  });
}
