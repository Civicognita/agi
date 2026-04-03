/**
 * Hash Chain Verification Library — Task #202
 *
 * Verifies the integrity of a COA hash chain:
 * - prev_hash linkage (each record's prevHash matches prior record's coaHash)
 * - Content hash integrity (recomputing hash from canonical fields matches coaHash)
 * - Node signature validity (Ed25519 verification against known public keys)
 * - Gap detection (missing records in the chain sequence)
 *
 * Portable: uses only Node.js crypto (works in Node.js; browser support
 * via WebCrypto would need a separate thin wrapper).
 */

import { verify, type KeyObject } from "node:crypto";

import type { HashedCOARecord } from "./hash-chain.js";
import { hashContent } from "./hash-chain.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of verifying a single record in the chain. */
export interface RecordVerification {
  fingerprint: string;
  coaHash: string;
  /** Whether the content hash recomputes correctly. */
  hashValid: boolean;
  /** Whether prev_hash links to the prior record's coaHash. */
  linkValid: boolean;
  /** Whether the Ed25519 node signature is valid. */
  signatureValid: boolean | null;
  /** Null = valid, otherwise describes the problem. */
  error: string | null;
}

/** Overall chain verification report. */
export interface ChainVerificationReport {
  /** Whether the entire chain passed all checks. */
  valid: boolean;
  /** Number of records verified. */
  recordCount: number;
  /** Number of records that passed all checks. */
  validCount: number;
  /** Number of records with hash mismatches. */
  hashFailures: number;
  /** Number of records with broken prev_hash links. */
  linkFailures: number;
  /** Number of records with invalid signatures. */
  signatureFailures: number;
  /** Number of records where the signing key was unknown. */
  unknownSigners: number;
  /** Detected gaps in the chain (missing records). */
  gaps: ChainGap[];
  /** Per-record details (only includes failures if onlyFailures=true). */
  records: RecordVerification[];
}

/** A gap detected in the chain sequence. */
export interface ChainGap {
  /** Index in the supplied array where the gap starts. */
  afterIndex: number;
  /** Expected prev_hash at the gap. */
  expectedPrevHash: string;
  /** Actual prev_hash found. */
  actualPrevHash: string | null;
}

/** Options for chain verification. */
export interface VerifyChainOptions {
  /** Map of nodeId → Ed25519 public key for signature verification. */
  knownKeys?: Map<string, KeyObject>;
  /** Only include failed records in the report. Default false. */
  onlyFailures?: boolean;
  /** Expected prev_hash of the first record (null for genesis). Default null. */
  expectedFirstPrevHash?: string | null;
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

/**
 * Verify a COA hash chain end-to-end.
 *
 * Checks:
 * 1. Each record's coaHash matches recomputed hash from canonical fields
 * 2. Each record's prevHash matches the prior record's coaHash
 * 3. Node signatures are valid against known public keys
 * 4. No gaps in the chain linkage
 *
 * @param records - Ordered array of hashed COA records (oldest first)
 * @param options - Verification options
 * @returns Structured verification report
 */
export function verifyChain(
  records: HashedCOARecord[],
  options?: VerifyChainOptions,
): ChainVerificationReport {
  const knownKeys = options?.knownKeys ?? new Map<string, KeyObject>();
  const onlyFailures = options?.onlyFailures ?? false;
  const expectedFirstPrevHash = options?.expectedFirstPrevHash ?? null;

  const report: ChainVerificationReport = {
    valid: true,
    recordCount: records.length,
    validCount: 0,
    hashFailures: 0,
    linkFailures: 0,
    signatureFailures: 0,
    unknownSigners: 0,
    gaps: [],
    records: [],
  };

  if (records.length === 0) {
    return report;
  }

  let expectedPrevHash: string | null = expectedFirstPrevHash;

  for (let i = 0; i < records.length; i++) {
    const record = records[i]!;
    const verification: RecordVerification = {
      fingerprint: record.fingerprint,
      coaHash: record.coaHash,
      hashValid: true,
      linkValid: true,
      signatureValid: null,
      error: null,
    };

    // 1. Recompute content hash
    const recomputed = hashContent(record);
    if (recomputed !== record.coaHash) {
      verification.hashValid = false;
      verification.error = `Hash mismatch: expected ${recomputed}, got ${record.coaHash}`;
      report.hashFailures++;
      report.valid = false;
    }

    // 2. Verify prev_hash linkage
    if (record.prevHash !== expectedPrevHash) {
      verification.linkValid = false;
      const msg = `Link broken at index ${i}: expected prevHash=${expectedPrevHash}, got ${record.prevHash}`;
      verification.error = verification.error ? `${verification.error}; ${msg}` : msg;
      report.linkFailures++;
      report.valid = false;

      // Record gap
      report.gaps.push({
        afterIndex: i - 1,
        expectedPrevHash: expectedPrevHash ?? "(genesis)",
        actualPrevHash: record.prevHash,
      });
    }

    // 3. Verify node signature
    const nodeKey = knownKeys.get(record.nodeId);
    if (nodeKey) {
      try {
        const sigValid = verify(
          null,
          Buffer.from(record.coaHash, "hex"),
          nodeKey,
          Buffer.from(record.nodeSignature, "hex"),
        );
        verification.signatureValid = sigValid;
        if (!sigValid) {
          const msg = `Invalid signature from node ${record.nodeId}`;
          verification.error = verification.error ? `${verification.error}; ${msg}` : msg;
          report.signatureFailures++;
          report.valid = false;
        }
      } catch {
        verification.signatureValid = false;
        const msg = `Signature verification error for node ${record.nodeId}`;
        verification.error = verification.error ? `${verification.error}; ${msg}` : msg;
        report.signatureFailures++;
        report.valid = false;
      }
    } else {
      report.unknownSigners++;
    }

    // Update expected prev hash for next iteration
    expectedPrevHash = record.coaHash;

    // Track valid count
    if (verification.hashValid && verification.linkValid && verification.signatureValid !== false) {
      report.validCount++;
    }

    // Add to report
    if (!onlyFailures || verification.error !== null) {
      report.records.push(verification);
    }
  }

  return report;
}

/**
 * Verify a single record's content hash (no chain context needed).
 *
 * Useful for quick spot-checks without loading the full chain.
 */
export function verifyRecordHash(record: HashedCOARecord): boolean {
  return hashContent(record) === record.coaHash;
}

/**
 * Verify a single record's node signature.
 */
export function verifyRecordSignature(
  record: HashedCOARecord,
  publicKey: KeyObject,
): boolean {
  try {
    return verify(
      null,
      Buffer.from(record.coaHash, "hex"),
      publicKey,
      Buffer.from(record.nodeSignature, "hex"),
    );
  } catch {
    return false;
  }
}
