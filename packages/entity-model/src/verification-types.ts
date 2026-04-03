/**
 * 0R Verification Types — Task #132
 *
 * Types for the verification flow: proof submission, review queue,
 * seal generation, and tier access control.
 *
 * @see docs/governance/0r-verification-protocol.md
 */

// ---------------------------------------------------------------------------
// Verification Status (state machine)
// ---------------------------------------------------------------------------

/**
 * Verification request status — 5-state machine:
 *
 * ```
 * none → pending → approved → sealed
 *                → rejected
 *                → info_requested → pending (resubmit)
 * sealed → revoked
 * verified → revoked
 * ```
 */
export type VerificationStatus =
  | "none"
  | "pending"
  | "approved"
  | "rejected"
  | "info_requested"
  | "revoked";

/** Entity type codes for verification purposes. */
export type VerificationEntityType = "#E" | "#R" | "#N";

// ---------------------------------------------------------------------------
// Proof types by entity type
// ---------------------------------------------------------------------------

/** Proof types accepted for #E (human individuals). */
export type HumanProofType = "telegram_account" | "email_domain" | "voucher";

/** Proof types accepted for #R (resources / AI systems). */
export type ResourceProofType = "provenance_coa" | "deployment_manifest" | "origin_declaration";

/** Proof types accepted for #N (nodes / infrastructure). */
export type NodeProofType = "infra_attestation" | "network_declaration" | "operator_coa";

/** All proof types. */
export type ProofType = HumanProofType | ResourceProofType | NodeProofType;

// ---------------------------------------------------------------------------
// Verification Proof
// ---------------------------------------------------------------------------

export interface VerificationProof {
  entityType: VerificationEntityType;
  proofType: ProofType;
  proofPayload: string | Record<string, unknown>;
  submittedAt: string; // ISO-8601
  submittedBy: string; // entity_id of submitter (usually self)
}

// ---------------------------------------------------------------------------
// Verification Request (queue record)
// ---------------------------------------------------------------------------

export interface VerificationRequest {
  id: string; // ULID
  entityId: string;
  entityType: VerificationEntityType;
  status: VerificationStatus;
  proof: VerificationProof;
  reviewerId: string | null;
  decision: "approve" | "reject" | "request_info" | null;
  decisionReason: string | null;
  decisionAt: string | null;
  coaFingerprint: string | null;
  createdAt: string; // ISO-8601
  updatedAt: string; // ISO-8601
}

// ---------------------------------------------------------------------------
// Entity Seal (0SEAL)
// ---------------------------------------------------------------------------

export interface SealAlignment {
  /** Agenda alignment (0.0–1.0). */
  a_a: number;
  /** Understanding alignment (0.0–1.0). */
  u_u: number;
  /** Confidence alignment (0.0–1.0). */
  c_c: number;
}

export interface EntitySeal {
  sealId: string; // "seal-<entity_id>-<timestamp>"
  entityId: string;
  entityType: VerificationEntityType;
  issuedAt: string; // ISO-8601
  issuedBy: string; // entity_id of issuing reviewer
  coa: string; // Full COA fingerprint at time of issuance
  alignment: SealAlignment;
  checksum: string; // SHA-256 of seal content
  grid: string; // 0EMOJI compact grid (3x3)
  status: "active" | "revoked";
}

// ---------------------------------------------------------------------------
// Review decisions
// ---------------------------------------------------------------------------

export interface ReviewDecision {
  requestId: string;
  reviewerId: string;
  decision: "approve" | "reject" | "request_info";
  reason?: string;
}

export interface SealIssuanceParams {
  entityId: string;
  issuedBy: string;
  coa: string;
  alignment: SealAlignment;
}

export interface RevocationParams {
  entityId: string;
  revokedBy: string;
  reason: string;
}

// ---------------------------------------------------------------------------
// Tier access control
// ---------------------------------------------------------------------------

/** Agent autonomy level derived from verification tier. */
export type AutonomyLevel = "supervised" | "standard" | "full";

/** Minimum seal alignment thresholds. */
export const SEAL_MIN_ALIGNMENT: Readonly<SealAlignment> = {
  a_a: 0.70,
  u_u: 0.70,
  c_c: 0.55,
};

// ---------------------------------------------------------------------------
// Tier utilities
// ---------------------------------------------------------------------------

import type { VerificationTier } from "./types.js";

const TIER_RANKS: Record<VerificationTier, number> = {
  unverified: 0,
  verified: 1,
  sealed: 2,
};

/** Get the numeric rank of a tier for comparison. */
export function tierRank(tier: VerificationTier): number {
  return TIER_RANKS[tier] ?? -1;
}

/** Check if an entity's tier meets the minimum required tier. */
export function meetsMinimumTier(
  entityTier: VerificationTier,
  requiredTier: VerificationTier,
): boolean {
  return tierRank(entityTier) >= tierRank(requiredTier);
}

/** Resolve agent autonomy level from verification tier. */
export function resolveAutonomy(tier: VerificationTier): AutonomyLevel {
  const map: Record<VerificationTier, AutonomyLevel> = {
    unverified: "supervised",
    verified: "standard",
    sealed: "full",
  };
  return map[tier] ?? "supervised";
}
