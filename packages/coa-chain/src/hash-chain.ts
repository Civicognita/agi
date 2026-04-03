/**
 * Content-Addressed COA Hash Chain — Task #200
 *
 * Extends COA records with cryptographic integrity:
 * - coa_hash: SHA-256 of the record's canonical content
 * - prev_hash: hash of the previous record (linked list)
 * - node_signature: Ed25519 signature by the originating node
 *
 * This produces an append-only, tamper-evident chain where any
 * modification breaks the hash linkage.
 */

import { createHash, sign, verify, type KeyObject } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Fields included in the canonical hash computation. */
export interface COAHashContent {
  fingerprint: string;
  nodeId: string;
  /** Entity's GEID (global identifier) for cross-node verification. */
  entityGeid: string;
  workType: string;
  action: string;
  payloadHash: string | null;
  prevHash: string | null;
  timestamp: string;
}

/** A COA record with hash chain fields attached. */
export interface HashedCOARecord extends COAHashContent {
  /** SHA-256 hash of the canonical content. */
  coaHash: string;
  /** Ed25519 signature over coaHash by the originating node. */
  nodeSignature: string;
}

/** Parameters to create a new hash-chain record. */
export interface CreateHashedRecordParams {
  fingerprint: string;
  nodeId: string;
  entityGeid: string;
  workType: string;
  action: string;
  payloadHash?: string | null;
  timestamp?: string;
}

// ---------------------------------------------------------------------------
// Canonical serialization
// ---------------------------------------------------------------------------

/**
 * Produce the canonical byte string for hashing.
 *
 * Uses a deterministic key-sorted JSON with null-safe values so that
 * every node computes the same hash for the same logical record.
 */
export function canonicalize(content: COAHashContent): string {
  // Deterministic field order (alphabetical)
  const obj = {
    action: content.action,
    entityGeid: content.entityGeid,
    fingerprint: content.fingerprint,
    nodeId: content.nodeId,
    payloadHash: content.payloadHash ?? "",
    prevHash: content.prevHash ?? "",
    timestamp: content.timestamp,
    workType: content.workType,
  };
  return JSON.stringify(obj);
}

/**
 * SHA-256 hash of canonical content, returned as hex.
 */
export function hashContent(content: COAHashContent): string {
  const canonical = canonicalize(content);
  return createHash("sha256").update(canonical).digest("hex");
}

// ---------------------------------------------------------------------------
// Hash chain builder
// ---------------------------------------------------------------------------

/**
 * Builds content-addressed COA records with hash linking and Ed25519 signatures.
 *
 * Each record's `coaHash` covers its own content plus `prevHash`, forming
 * an append-only chain. Any modification to a prior record invalidates
 * all subsequent hashes.
 */
export class HashChainBuilder {
  private prevHash: string | null;
  private readonly nodePrivateKey: KeyObject;
  private readonly nodeId: string;

  constructor(nodePrivateKey: KeyObject, nodeId: string, prevHash?: string | null) {
    this.nodePrivateKey = nodePrivateKey;
    this.nodeId = nodeId;
    this.prevHash = prevHash ?? null;
  }

  /**
   * Get the hash of the most recently appended record.
   * Returns null if no records have been appended.
   */
  getLatestHash(): string | null {
    return this.prevHash;
  }

  /**
   * Append a new record to the chain.
   *
   * Computes coa_hash, links to prev_hash, and signs with the node key.
   */
  append(params: CreateHashedRecordParams): HashedCOARecord {
    const timestamp = params.timestamp ?? new Date().toISOString();

    const content: COAHashContent = {
      fingerprint: params.fingerprint,
      nodeId: this.nodeId,
      entityGeid: params.entityGeid,
      workType: params.workType,
      action: params.action,
      payloadHash: params.payloadHash ?? null,
      prevHash: this.prevHash,
      timestamp,
    };

    const coaHash = hashContent(content);

    // Ed25519 signature over the hash
    const sigBuffer = sign(null, Buffer.from(coaHash, "hex"), this.nodePrivateKey);
    const nodeSignature = sigBuffer.toString("hex");

    this.prevHash = coaHash;

    return {
      ...content,
      coaHash,
      nodeSignature,
    };
  }
}

// ---------------------------------------------------------------------------
// Signature helpers
// ---------------------------------------------------------------------------

/**
 * Sign a COA hash with an Ed25519 private key.
 */
export function signCOAHash(coaHash: string, privateKey: KeyObject): string {
  return sign(null, Buffer.from(coaHash, "hex"), privateKey).toString("hex");
}

/**
 * Verify a COA hash signature against a node's Ed25519 public key.
 */
export function verifyCOASignature(
  coaHash: string,
  signature: string,
  publicKey: KeyObject,
): boolean {
  return verify(
    null,
    Buffer.from(coaHash, "hex"),
    publicKey,
    Buffer.from(signature, "hex"),
  );
}
