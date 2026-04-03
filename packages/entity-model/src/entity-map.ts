/**
 * Entity Map — portable signed profile for cross-node federation.
 *
 * An EntityMap is a dual-signed document that travels with an entity
 * across the network. The entity signs it ("I claim this"), and the
 * home node counter-signs it ("I attest to it").
 */

import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import type { GEID } from "./geid.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EntityMapPersona {
  bio: string | null;
  skills: string[];
  interests: string[];
}

export interface EntityMapImpact {
  totalImpScore: number;
  interactionCount: number;
  topWorkTypes: string[];
}

export interface EntityMapChannel {
  channel: string;
  handle: string | null;
  verified: boolean;
}

export interface EntityMapHomeNode {
  nodeId: string;
  endpoint: string;
  publicKey: string;
}

export interface EntityMap {
  geid: GEID;
  address: string;
  displayName: string;
  entityType: string;
  verificationTier: string;
  sealId: string | null;
  persona: EntityMapPersona | null;
  impact: EntityMapImpact;
  channels: EntityMapChannel[];
  homeNode: EntityMapHomeNode;
  issuedAt: string;
  expiresAt: string;
  version: number;
  signature: string;
  nodeEndorsement: string;
}

/** Parameters for generating an EntityMap (before signing). */
export interface GenerateEntityMapParams {
  geid: GEID;
  address: string;
  displayName: string;
  entityType: string;
  verificationTier: string;
  sealId?: string | null;
  persona?: EntityMapPersona | null;
  impact: EntityMapImpact;
  channels: EntityMapChannel[];
  homeNode: EntityMapHomeNode;
  version?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default EntityMap TTL: 24 hours in milliseconds. */
const ENTITY_MAP_TTL_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Canonical form for signing
// ---------------------------------------------------------------------------

/**
 * Produce the canonical JSON for signing. Excludes `signature` and
 * `nodeEndorsement` fields — those are computed over this canonical form.
 */
function canonicalize(map: Omit<EntityMap, "signature" | "nodeEndorsement">): string {
  return JSON.stringify({
    geid: map.geid,
    address: map.address,
    displayName: map.displayName,
    entityType: map.entityType,
    verificationTier: map.verificationTier,
    sealId: map.sealId,
    persona: map.persona,
    impact: map.impact,
    channels: map.channels,
    homeNode: map.homeNode,
    issuedAt: map.issuedAt,
    expiresAt: map.expiresAt,
    version: map.version,
  });
}

// ---------------------------------------------------------------------------
// Generation & Signing
// ---------------------------------------------------------------------------

/**
 * Generate and dual-sign an EntityMap.
 *
 * @param params - Entity data to include in the map.
 * @param entityPrivateKeyPem - Entity's Ed25519 private key (PEM).
 * @param nodePrivateKeyPem - Home node's Ed25519 private key (PEM).
 * @returns Fully signed EntityMap.
 */
export function generateEntityMap(
  params: GenerateEntityMapParams,
  entityPrivateKeyPem: string,
  nodePrivateKeyPem: string,
): EntityMap {
  const now = new Date();
  const issuedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + ENTITY_MAP_TTL_MS).toISOString();

  const unsigned: Omit<EntityMap, "signature" | "nodeEndorsement"> = {
    geid: params.geid,
    address: params.address,
    displayName: params.displayName,
    entityType: params.entityType,
    verificationTier: params.verificationTier,
    sealId: params.sealId ?? null,
    persona: params.persona ?? null,
    impact: params.impact,
    channels: params.channels,
    homeNode: params.homeNode,
    issuedAt,
    expiresAt,
    version: params.version ?? 1,
  };

  const canonical = canonicalize(unsigned);

  // Entity signature
  const entityKey = createPrivateKey(entityPrivateKeyPem);
  const signature = sign(null, Buffer.from(canonical), entityKey).toString("hex");

  // Node counter-signature (signs the entity's signature + canonical)
  const nodeKey = createPrivateKey(nodePrivateKeyPem);
  const endorsementPayload = `${signature}:${canonical}`;
  const nodeEndorsement = sign(null, Buffer.from(endorsementPayload), nodeKey).toString("hex");

  return { ...unsigned, signature, nodeEndorsement };
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

/**
 * Verify an EntityMap's entity signature.
 *
 * @param map - The EntityMap to verify.
 * @param entityPublicKeyPem - Entity's Ed25519 public key (PEM).
 * @returns true if the entity signature is valid.
 */
export function verifyEntityMapSignature(
  map: EntityMap,
  entityPublicKeyPem: string,
): boolean {
  const unsigned: Omit<EntityMap, "signature" | "nodeEndorsement"> = {
    geid: map.geid,
    address: map.address,
    displayName: map.displayName,
    entityType: map.entityType,
    verificationTier: map.verificationTier,
    sealId: map.sealId,
    persona: map.persona,
    impact: map.impact,
    channels: map.channels,
    homeNode: map.homeNode,
    issuedAt: map.issuedAt,
    expiresAt: map.expiresAt,
    version: map.version,
  };

  const canonical = canonicalize(unsigned);
  const publicKey = createPublicKey(entityPublicKeyPem);
  const signatureBuffer = Buffer.from(map.signature, "hex");

  return verify(null, Buffer.from(canonical), publicKey, signatureBuffer);
}

/**
 * Verify an EntityMap's node endorsement.
 *
 * @param map - The EntityMap to verify.
 * @param nodePublicKeyPem - Home node's Ed25519 public key (PEM).
 * @returns true if the node endorsement is valid.
 */
export function verifyEntityMapEndorsement(
  map: EntityMap,
  nodePublicKeyPem: string,
): boolean {
  const unsigned: Omit<EntityMap, "signature" | "nodeEndorsement"> = {
    geid: map.geid,
    address: map.address,
    displayName: map.displayName,
    entityType: map.entityType,
    verificationTier: map.verificationTier,
    sealId: map.sealId,
    persona: map.persona,
    impact: map.impact,
    channels: map.channels,
    homeNode: map.homeNode,
    issuedAt: map.issuedAt,
    expiresAt: map.expiresAt,
    version: map.version,
  };

  const canonical = canonicalize(unsigned);
  const endorsementPayload = `${map.signature}:${canonical}`;
  const publicKey = createPublicKey(nodePublicKeyPem);
  const signatureBuffer = Buffer.from(map.nodeEndorsement, "hex");

  return verify(null, Buffer.from(endorsementPayload), publicKey, signatureBuffer);
}

/**
 * Check if an EntityMap has expired.
 */
export function isEntityMapExpired(map: EntityMap): boolean {
  return new Date(map.expiresAt).getTime() < Date.now();
}

/**
 * Fully verify an EntityMap: entity signature, node endorsement, and expiry.
 */
export function verifyEntityMap(
  map: EntityMap,
  entityPublicKeyPem: string,
  nodePublicKeyPem: string,
): { valid: boolean; reason?: string } {
  if (isEntityMapExpired(map)) {
    return { valid: false, reason: "Entity map expired" };
  }
  if (!verifyEntityMapSignature(map, entityPublicKeyPem)) {
    return { valid: false, reason: "Invalid entity signature" };
  }
  if (!verifyEntityMapEndorsement(map, nodePublicKeyPem)) {
    return { valid: false, reason: "Invalid node endorsement" };
  }
  return { valid: true };
}
