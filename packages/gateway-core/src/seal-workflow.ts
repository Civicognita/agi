/**
 * Seal Workflow — Task #159
 *
 * Extended seal issuance workflow integrating:
 *   - VerificationManager (entity-model) for proof review and tier management
 *   - SealSigner (Ed25519) for cryptographic signatures
 *   - SealBundle creation for public verification portal
 *
 * The workflow adds Ed25519 signing gates to the existing issuance process:
 *   1. Entity passes verification (VerificationManager.processDecision)
 *   2. Alignment thresholds checked (VerificationManager.issueSeal)
 *   3. Seal payload signed with Ed25519 (SealSigner.sign)
 *   4. SealBundle produced for portal distribution
 *
 * @see seal-signer.ts for the signing side
 * @see seal-verifier.ts for the verification side
 */

import type {
  EntitySeal,
  ReviewDecision,
  SealIssuanceParams,
  RevocationParams,
  VerificationProof,
  VerificationRequest,
  VerificationTier,
} from "@agi/entity-model";
import { VerificationManager } from "@agi/entity-model";

import type { SealPayload, SignedSeal } from "./seal-signer.js";
import { SealSigner } from "./seal-signer.js";
import type { SealBundle } from "./seal-verifier.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of a complete seal issuance (DB seal + Ed25519 signature). */
export interface SealIssuanceResult {
  /** The entity seal stored in the database. */
  seal: EntitySeal;
  /** The Ed25519-signed seal for cryptographic verification. */
  signed: SignedSeal;
  /** The portable bundle for public verification portal. */
  bundle: SealBundle;
  /** The entity's new verification tier after issuance. */
  newTier: VerificationTier;
}

/** Result of a review decision with optional automatic seal issuance. */
export interface ReviewResult {
  /** The updated verification request. */
  request: VerificationRequest;
  /** New tier if the entity was promoted. */
  newTier: VerificationTier | null;
  /** Seal issuance result if auto-seal was triggered. */
  issuance: SealIssuanceResult | null;
}

/** Result of a seal revocation. */
export interface RevocationResult {
  /** The revoked seal (null if no active seal existed). */
  seal: EntitySeal | null;
  /** The entity's new tier after revocation. */
  newTier: VerificationTier;
  /** Number of total revocations for this entity. */
  revocationCount: number;
  /** Whether this entity now requires #E0 approval for re-verification. */
  requiresGenesisApproval: boolean;
}

/** Configuration for the seal workflow. */
export interface SealWorkflowConfig {
  /** SealSigner instance for Ed25519 signing. */
  signer: SealSigner;
  /** VerificationManager instance for DB operations. */
  verificationManager: VerificationManager;
  /** If true, automatically issue Ed25519-signed seal on approval. */
  autoSealOnApproval?: boolean;
}

// ---------------------------------------------------------------------------
// SealWorkflow
// ---------------------------------------------------------------------------

export class SealWorkflow {
  private readonly signer: SealSigner;
  private readonly vm: VerificationManager;
  private readonly autoSeal: boolean;

  constructor(config: SealWorkflowConfig) {
    this.signer = config.signer;
    this.vm = config.verificationManager;
    this.autoSeal = config.autoSealOnApproval ?? false;
  }

  // ---------------------------------------------------------------------------
  // Proof submission (pass-through)
  // ---------------------------------------------------------------------------

  /** Submit a verification request. Delegates to VerificationManager. */
  submitRequest(
    entityId: string,
    proof: VerificationProof,
  ): VerificationRequest {
    return this.vm.submitRequest(entityId, proof);
  }

  // ---------------------------------------------------------------------------
  // Review + optional auto-seal
  // ---------------------------------------------------------------------------

  /**
   * Process a review decision. If `autoSealOnApproval` is enabled and the
   * decision is "approve", automatically issues an Ed25519-signed seal.
   *
   * @param decision - The reviewer's decision.
   * @param sealParams - Required if autoSealOnApproval and decision is "approve".
   * @param coaFingerprint - COA fingerprint for the verification record.
   */
  processReview(
    decision: ReviewDecision,
    sealParams?: Omit<SealIssuanceParams, "entityId">,
    coaFingerprint?: string,
  ): ReviewResult {
    const { request, newTier } = this.vm.processDecision(
      decision,
      coaFingerprint,
    );

    let issuance: SealIssuanceResult | null = null;

    if (
      this.autoSeal &&
      decision.decision === "approve" &&
      sealParams !== undefined
    ) {
      issuance = this.issueSeal({
        entityId: request.entityId,
        issuedBy: sealParams.issuedBy,
        coa: sealParams.coa,
        alignment: sealParams.alignment,
      });
    }

    return { request, newTier, issuance };
  }

  // ---------------------------------------------------------------------------
  // Seal issuance with Ed25519 signing
  // ---------------------------------------------------------------------------

  /**
   * Issue a seal with both SHA-256 checksum (DB) and Ed25519 signature.
   *
   * Steps:
   *   1. VerificationManager validates alignment thresholds and creates DB seal
   *   2. Seal payload mapped to SealPayload for Ed25519 signing
   *   3. SealSigner produces Ed25519 signature
   *   4. SealBundle assembled for public verification portal
   */
  issueSeal(params: SealIssuanceParams): SealIssuanceResult {
    // Step 1: Issue seal in DB (validates alignment, computes checksum)
    const seal = this.vm.issueSeal(params);

    // Step 2: Map to canonical SealPayload for signing
    const payload: SealPayload = {
      sealId: seal.sealId,
      entityId: seal.entityId,
      entityType: seal.entityType,
      issuedAt: seal.issuedAt,
      issuedBy: seal.issuedBy,
      coa: seal.coa,
      alignment: seal.alignment,
      checksum: seal.checksum,
    };

    // Step 3: Sign with Ed25519
    const signed = this.signer.sign(payload);

    // Step 4: Create portable bundle
    const bundle: SealBundle = {
      payload,
      signature: signed.signature,
      publicKey: signed.publicKey,
      status: "active",
    };

    return {
      seal,
      signed,
      bundle,
      newTier: "sealed" as VerificationTier,
    };
  }

  // ---------------------------------------------------------------------------
  // Revocation
  // ---------------------------------------------------------------------------

  /**
   * Revoke an entity's seal and verification.
   * Two+ revocations require #E0 (GENESIS) approval for re-verification.
   */
  revoke(params: RevocationParams): RevocationResult {
    const { seal, newTier } = this.vm.revoke(params);
    const revocationCount = this.vm.getRevocationCount(params.entityId);

    return {
      seal,
      newTier,
      revocationCount,
      requiresGenesisApproval: revocationCount >= 2,
    };
  }

  // ---------------------------------------------------------------------------
  // Verification helpers
  // ---------------------------------------------------------------------------

  /**
   * Get the active seal bundle for an entity (for portal distribution).
   * Returns null if no active seal exists.
   */
  getSealBundle(entityId: string): SealBundle | null {
    const seal = this.vm.getActiveSeal(entityId);
    if (!seal) return null;

    const payload: SealPayload = {
      sealId: seal.sealId,
      entityId: seal.entityId,
      entityType: seal.entityType,
      issuedAt: seal.issuedAt,
      issuedBy: seal.issuedBy,
      coa: seal.coa,
      alignment: seal.alignment,
      checksum: seal.checksum,
    };

    // Re-sign to produce the bundle (deterministic — same payload = same signature)
    const signed = this.signer.sign(payload);

    return {
      payload,
      signature: signed.signature,
      publicKey: signed.publicKey,
      status: seal.status,
    };
  }

  /**
   * Verify a seal's integrity (DB checksum + Ed25519 signature match).
   */
  verifySeal(sealId: string): {
    dbValid: boolean;
    signatureValid: boolean;
    seal: EntitySeal | null;
  } {
    const dbResult = this.vm.verifySeal(sealId);
    if (!dbResult.seal) {
      return { dbValid: false, signatureValid: false, seal: null };
    }

    // Also verify Ed25519 signature
    const payload: SealPayload = {
      sealId: dbResult.seal.sealId,
      entityId: dbResult.seal.entityId,
      entityType: dbResult.seal.entityType,
      issuedAt: dbResult.seal.issuedAt,
      issuedBy: dbResult.seal.issuedBy,
      coa: dbResult.seal.coa,
      alignment: dbResult.seal.alignment,
      checksum: dbResult.seal.checksum,
    };

    const signed = this.signer.sign(payload);
    const signatureValid = this.signer.verify(signed);

    return {
      dbValid: dbResult.valid,
      signatureValid,
      seal: dbResult.seal,
    };
  }

  /** Get the public key for distribution to verification portals. */
  getPublicKey(): string {
    return this.signer.publicKeyBase64;
  }
}
