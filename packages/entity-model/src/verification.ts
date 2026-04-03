/**
 * Verification Manager — Tasks #132-#134
 *
 * Manages the full 0R verification lifecycle:
 *   - Proof submission and queue management
 *   - Review decisions (approve / reject / request_info)
 *   - Tier promotion (unverified → verified → sealed)
 *   - Seal generation with SHA-256 checksum
 *   - Revocation with forward-only history
 *
 * @see docs/governance/0r-verification-protocol.md
 */

import { createHash } from "node:crypto";
import { ulid } from "ulid";

import type { Database } from "./db.js";
import type { VerificationTier } from "./types.js";
import type {
  VerificationRequest,
  VerificationProof,
  EntitySeal,
  SealAlignment,
  ReviewDecision,
  SealIssuanceParams,
  RevocationParams,
  VerificationStatus,
  VerificationEntityType,
} from "./verification-types.js";
import { SEAL_MIN_ALIGNMENT } from "./verification-types.js";

import type BetterSqlite3 from "better-sqlite3";

// ---------------------------------------------------------------------------
// DDL
// ---------------------------------------------------------------------------

export const CREATE_VERIFICATION_REQUESTS = `
CREATE TABLE IF NOT EXISTS verification_requests (
  id                TEXT NOT NULL PRIMARY KEY,
  entity_id         TEXT NOT NULL REFERENCES entities(id),
  entity_type       TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending',
  proof_type        TEXT NOT NULL,
  proof_payload     TEXT NOT NULL,
  proof_submitted_at TEXT NOT NULL,
  proof_submitted_by TEXT NOT NULL,
  reviewer_id       TEXT,
  decision          TEXT,
  decision_reason   TEXT,
  decision_at       TEXT,
  coa_fingerprint   TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
)` as const;

export const CREATE_SEALS = `
CREATE TABLE IF NOT EXISTS seals (
  seal_id      TEXT NOT NULL PRIMARY KEY,
  entity_id    TEXT NOT NULL REFERENCES entities(id),
  entity_type  TEXT NOT NULL,
  issued_at    TEXT NOT NULL,
  issued_by    TEXT NOT NULL,
  coa          TEXT NOT NULL,
  alignment_aa REAL NOT NULL,
  alignment_uu REAL NOT NULL,
  alignment_cc REAL NOT NULL,
  checksum     TEXT NOT NULL,
  grid         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'active',
  revoked_at   TEXT,
  revoked_by   TEXT,
  revoke_reason TEXT
)` as const;

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface VerificationRequestRow {
  id: string;
  entity_id: string;
  entity_type: string;
  status: string;
  proof_type: string;
  proof_payload: string;
  proof_submitted_at: string;
  proof_submitted_by: string;
  reviewer_id: string | null;
  decision: string | null;
  decision_reason: string | null;
  decision_at: string | null;
  coa_fingerprint: string | null;
  created_at: string;
  updated_at: string;
}

interface SealRow {
  seal_id: string;
  entity_id: string;
  entity_type: string;
  issued_at: string;
  issued_by: string;
  coa: string;
  alignment_aa: number;
  alignment_uu: number;
  alignment_cc: number;
  checksum: string;
  grid: string;
  status: string;
  revoked_at: string | null;
  revoked_by: string | null;
  revoke_reason: string | null;
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

function rowToRequest(row: VerificationRequestRow): VerificationRequest {
  let proofPayload: string | Record<string, unknown>;
  try {
    proofPayload = JSON.parse(row.proof_payload) as Record<string, unknown>;
  } catch {
    proofPayload = row.proof_payload;
  }

  return {
    id: row.id,
    entityId: row.entity_id,
    entityType: row.entity_type as VerificationEntityType,
    status: row.status as VerificationStatus,
    proof: {
      entityType: row.entity_type as VerificationEntityType,
      proofType: row.proof_type as VerificationProof["proofType"],
      proofPayload,
      submittedAt: row.proof_submitted_at,
      submittedBy: row.proof_submitted_by,
    },
    reviewerId: row.reviewer_id,
    decision: row.decision as VerificationRequest["decision"],
    decisionReason: row.decision_reason,
    decisionAt: row.decision_at,
    coaFingerprint: row.coa_fingerprint,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToSeal(row: SealRow): EntitySeal {
  return {
    sealId: row.seal_id,
    entityId: row.entity_id,
    entityType: row.entity_type as VerificationEntityType,
    issuedAt: row.issued_at,
    issuedBy: row.issued_by,
    coa: row.coa,
    alignment: {
      a_a: row.alignment_aa,
      u_u: row.alignment_uu,
      c_c: row.alignment_cc,
    },
    checksum: row.checksum,
    grid: row.grid,
    status: row.status as EntitySeal["status"],
  };
}

// ---------------------------------------------------------------------------
// Statement parameter shapes
// ---------------------------------------------------------------------------

interface InsertRequestParams {
  id: string;
  entity_id: string;
  entity_type: string;
  status: string;
  proof_type: string;
  proof_payload: string;
  proof_submitted_at: string;
  proof_submitted_by: string;
  created_at: string;
  updated_at: string;
}

interface UpdateDecisionParams {
  id: string;
  status: string;
  reviewer_id: string;
  decision: string;
  decision_reason: string | null;
  decision_at: string;
  coa_fingerprint: string | null;
  updated_at: string;
}

interface InsertSealParams {
  seal_id: string;
  entity_id: string;
  entity_type: string;
  issued_at: string;
  issued_by: string;
  coa: string;
  alignment_aa: number;
  alignment_uu: number;
  alignment_cc: number;
  checksum: string;
  grid: string;
  status: string;
}

interface RevokeSealParams {
  seal_id: string;
  status: string;
  revoked_at: string;
  revoked_by: string;
  revoke_reason: string;
}

// ---------------------------------------------------------------------------
// Valid state transitions
// ---------------------------------------------------------------------------

const VALID_TRANSITIONS: Record<string, string[]> = {
  none: ["pending"],
  pending: ["approved", "rejected", "info_requested"],
  info_requested: ["pending"],
  approved: [],
  rejected: ["pending"], // can re-submit
  revoked: ["pending"], // re-verification
};

// ---------------------------------------------------------------------------
// VerificationManager
// ---------------------------------------------------------------------------

export class VerificationManager {
  private readonly stmtInsertRequest: BetterSqlite3.Statement<[InsertRequestParams]>;
  private readonly stmtUpdateDecision: BetterSqlite3.Statement<[UpdateDecisionParams]>;
  private readonly stmtGetRequest: BetterSqlite3.Statement<[string], VerificationRequestRow>;
  private readonly stmtGetPendingRequests: BetterSqlite3.Statement<[], VerificationRequestRow>;
  private readonly stmtGetRequestsByEntity: BetterSqlite3.Statement<[string], VerificationRequestRow>;
  private readonly stmtGetLatestRequest: BetterSqlite3.Statement<[string], VerificationRequestRow>;

  private readonly stmtInsertSeal: BetterSqlite3.Statement<[InsertSealParams]>;
  private readonly stmtRevokeSeal: BetterSqlite3.Statement<[RevokeSealParams]>;
  private readonly stmtGetSeal: BetterSqlite3.Statement<[string], SealRow>;
  private readonly stmtGetActiveSeal: BetterSqlite3.Statement<[string], SealRow>;

  constructor(db: Database) {
    this.stmtInsertRequest = db.prepare<[InsertRequestParams]>(`
      INSERT INTO verification_requests (
        id, entity_id, entity_type, status, proof_type, proof_payload,
        proof_submitted_at, proof_submitted_by, created_at, updated_at
      ) VALUES (
        @id, @entity_id, @entity_type, @status, @proof_type, @proof_payload,
        @proof_submitted_at, @proof_submitted_by, @created_at, @updated_at
      )
    `);

    this.stmtUpdateDecision = db.prepare<[UpdateDecisionParams]>(`
      UPDATE verification_requests
      SET status = @status, reviewer_id = @reviewer_id, decision = @decision,
          decision_reason = @decision_reason, decision_at = @decision_at,
          coa_fingerprint = @coa_fingerprint, updated_at = @updated_at
      WHERE id = @id
    `);

    this.stmtGetRequest = db.prepare<[string], VerificationRequestRow>(`
      SELECT * FROM verification_requests WHERE id = ?
    `);

    this.stmtGetPendingRequests = db.prepare<[], VerificationRequestRow>(`
      SELECT * FROM verification_requests
      WHERE status = 'pending'
      ORDER BY created_at ASC
    `);

    this.stmtGetRequestsByEntity = db.prepare<[string], VerificationRequestRow>(`
      SELECT * FROM verification_requests
      WHERE entity_id = ?
      ORDER BY created_at DESC
    `);

    this.stmtGetLatestRequest = db.prepare<[string], VerificationRequestRow>(`
      SELECT * FROM verification_requests
      WHERE entity_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `);

    this.stmtInsertSeal = db.prepare<[InsertSealParams]>(`
      INSERT INTO seals (
        seal_id, entity_id, entity_type, issued_at, issued_by,
        coa, alignment_aa, alignment_uu, alignment_cc, checksum, grid, status
      ) VALUES (
        @seal_id, @entity_id, @entity_type, @issued_at, @issued_by,
        @coa, @alignment_aa, @alignment_uu, @alignment_cc, @checksum, @grid, @status
      )
    `);

    this.stmtRevokeSeal = db.prepare<[RevokeSealParams]>(`
      UPDATE seals
      SET status = @status, revoked_at = @revoked_at,
          revoked_by = @revoked_by, revoke_reason = @revoke_reason
      WHERE seal_id = @seal_id
    `);

    this.stmtGetSeal = db.prepare<[string], SealRow>(`
      SELECT * FROM seals WHERE seal_id = ?
    `);

    this.stmtGetActiveSeal = db.prepare<[string], SealRow>(`
      SELECT * FROM seals WHERE entity_id = ? AND status = 'active'
      ORDER BY issued_at DESC LIMIT 1
    `);
  }

  // ---------------------------------------------------------------------------
  // Proof submission
  // ---------------------------------------------------------------------------

  /**
   * Submit a verification request for an entity.
   * Transitions status from none/rejected/revoked → pending.
   */
  submitRequest(
    entityId: string,
    proof: VerificationProof,
  ): VerificationRequest {
    const now = new Date().toISOString();
    const id = ulid();

    const payloadStr = typeof proof.proofPayload === "string"
      ? proof.proofPayload
      : JSON.stringify(proof.proofPayload);

    this.stmtInsertRequest.run({
      id,
      entity_id: entityId,
      entity_type: proof.entityType,
      status: "pending",
      proof_type: proof.proofType,
      proof_payload: payloadStr,
      proof_submitted_at: proof.submittedAt,
      proof_submitted_by: proof.submittedBy,
      created_at: now,
      updated_at: now,
    });

    return {
      id,
      entityId,
      entityType: proof.entityType,
      status: "pending",
      proof,
      reviewerId: null,
      decision: null,
      decisionReason: null,
      decisionAt: null,
      coaFingerprint: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  // ---------------------------------------------------------------------------
  // Review decisions
  // ---------------------------------------------------------------------------

  /**
   * Process a review decision on a pending verification request.
   *
   * - `approve`: sets status to "approved", returns the new tier ("verified")
   * - `reject`: sets status to "rejected"
   * - `request_info`: sets status to "info_requested"
   */
  processDecision(
    decision: ReviewDecision,
    coaFingerprint?: string,
  ): { request: VerificationRequest; newTier: VerificationTier | null } {
    const row = this.stmtGetRequest.get(decision.requestId);
    if (!row) {
      throw new Error(`Verification request not found: ${decision.requestId}`);
    }

    if (row.status !== "pending") {
      throw new Error(
        `Cannot process decision on request in "${row.status}" status. Expected "pending".`,
      );
    }

    const statusMap: Record<string, VerificationStatus> = {
      approve: "approved",
      reject: "rejected",
      request_info: "info_requested",
    };

    const newStatus = statusMap[decision.decision];
    if (!newStatus) {
      throw new Error(`Invalid decision: ${decision.decision}`);
    }

    const now = new Date().toISOString();

    this.stmtUpdateDecision.run({
      id: decision.requestId,
      status: newStatus,
      reviewer_id: decision.reviewerId,
      decision: decision.decision,
      decision_reason: decision.reason ?? null,
      decision_at: now,
      coa_fingerprint: coaFingerprint ?? null,
      updated_at: now,
    });

    const updatedRow = this.stmtGetRequest.get(decision.requestId)!;
    const request = rowToRequest(updatedRow);

    // On approval, the caller should update entity.verificationTier to "verified"
    const newTier: VerificationTier | null =
      decision.decision === "approve" ? "verified" : null;

    return { request, newTier };
  }

  // ---------------------------------------------------------------------------
  // Seal issuance
  // ---------------------------------------------------------------------------

  /**
   * Issue a seal for a verified entity, promoting to "sealed" tier.
   *
   * @throws If alignment doesn't meet minimum thresholds.
   */
  issueSeal(params: SealIssuanceParams): EntitySeal {
    // Validate alignment thresholds
    if (params.alignment.a_a < SEAL_MIN_ALIGNMENT.a_a) {
      throw new Error(
        `A:A alignment ${params.alignment.a_a} below minimum ${SEAL_MIN_ALIGNMENT.a_a}`,
      );
    }
    if (params.alignment.u_u < SEAL_MIN_ALIGNMENT.u_u) {
      throw new Error(
        `U:U alignment ${params.alignment.u_u} below minimum ${SEAL_MIN_ALIGNMENT.u_u}`,
      );
    }
    if (params.alignment.c_c < SEAL_MIN_ALIGNMENT.c_c) {
      throw new Error(
        `C:C alignment ${params.alignment.c_c} below minimum ${SEAL_MIN_ALIGNMENT.c_c}`,
      );
    }

    const now = new Date().toISOString();
    const sealId = `seal-${params.entityId}-${Date.now()}`;

    // Determine entity type from latest verification request
    const latestRow = this.stmtGetLatestRequest.get(params.entityId);
    const entityType: VerificationEntityType =
      (latestRow?.entity_type as VerificationEntityType) ?? "#E";

    // Compute checksum (SHA-256 of seal content)
    const checksumInput = JSON.stringify({
      sealId,
      entityId: params.entityId,
      entityType,
      issuedAt: now,
      issuedBy: params.issuedBy,
      coa: params.coa,
      alignment: params.alignment,
    });
    const checksum = createHash("sha256").update(checksumInput).digest("hex");

    // Generate 0EMOJI grid
    const grid = generateGrid(params.alignment, params.coa, checksum);

    this.stmtInsertSeal.run({
      seal_id: sealId,
      entity_id: params.entityId,
      entity_type: entityType,
      issued_at: now,
      issued_by: params.issuedBy,
      coa: params.coa,
      alignment_aa: params.alignment.a_a,
      alignment_uu: params.alignment.u_u,
      alignment_cc: params.alignment.c_c,
      checksum,
      grid,
      status: "active",
    });

    return {
      sealId,
      entityId: params.entityId,
      entityType,
      issuedAt: now,
      issuedBy: params.issuedBy,
      coa: params.coa,
      alignment: params.alignment,
      checksum,
      grid,
      status: "active",
    };
  }

  /**
   * Verify a seal's checksum integrity.
   */
  verifySeal(sealId: string): {
    valid: boolean;
    seal: EntitySeal | null;
    checksumOk: boolean;
  } {
    const row = this.stmtGetSeal.get(sealId);
    if (!row) {
      return { valid: false, seal: null, checksumOk: false };
    }

    const seal = rowToSeal(row);

    // Recompute checksum
    const checksumInput = JSON.stringify({
      sealId: seal.sealId,
      entityId: seal.entityId,
      entityType: seal.entityType,
      issuedAt: seal.issuedAt,
      issuedBy: seal.issuedBy,
      coa: seal.coa,
      alignment: seal.alignment,
    });
    const computedChecksum = createHash("sha256")
      .update(checksumInput)
      .digest("hex");

    const checksumOk = computedChecksum === seal.checksum;

    return {
      valid: seal.status === "active" && checksumOk,
      seal,
      checksumOk,
    };
  }

  // ---------------------------------------------------------------------------
  // Revocation
  // ---------------------------------------------------------------------------

  /**
   * Revoke an entity's verification/seal.
   * The entity is downgraded to "unverified".
   * Historical $imp scores are NOT changed (forward-only ledger).
   */
  revoke(params: RevocationParams): {
    seal: EntitySeal | null;
    newTier: VerificationTier;
  } {
    const now = new Date().toISOString();

    // Revoke active seal if one exists
    const sealRow = this.stmtGetActiveSeal.get(params.entityId);
    let seal: EntitySeal | null = null;

    if (sealRow) {
      this.stmtRevokeSeal.run({
        seal_id: sealRow.seal_id,
        status: "revoked",
        revoked_at: now,
        revoked_by: params.revokedBy,
        revoke_reason: params.reason,
      });

      const revokedRow = this.stmtGetSeal.get(sealRow.seal_id)!;
      seal = rowToSeal(revokedRow);
    }

    // Create a revocation record in the verification queue
    const revokeId = ulid();
    this.stmtInsertRequest.run({
      id: revokeId,
      entity_id: params.entityId,
      entity_type: sealRow?.entity_type ?? "#E",
      status: "revoked",
      proof_type: "revocation",
      proof_payload: JSON.stringify({ reason: params.reason }),
      proof_submitted_at: now,
      proof_submitted_by: params.revokedBy,
      created_at: now,
      updated_at: now,
    });

    return { seal, newTier: "unverified" };
  }

  // ---------------------------------------------------------------------------
  // Query helpers
  // ---------------------------------------------------------------------------

  /** Get all pending verification requests (review queue). */
  getPendingRequests(): VerificationRequest[] {
    const rows = this.stmtGetPendingRequests.all();
    return rows.map(rowToRequest);
  }

  /** Get all verification requests for an entity (history). */
  getRequestHistory(entityId: string): VerificationRequest[] {
    const rows = this.stmtGetRequestsByEntity.all(entityId);
    return rows.map(rowToRequest);
  }

  /** Get the latest verification request for an entity. */
  getLatestRequest(entityId: string): VerificationRequest | null {
    const row = this.stmtGetLatestRequest.get(entityId);
    return row ? rowToRequest(row) : null;
  }

  /** Get the active seal for an entity. */
  getActiveSeal(entityId: string): EntitySeal | null {
    const row = this.stmtGetActiveSeal.get(entityId);
    return row ? rowToSeal(row) : null;
  }

  /** Get a seal by ID. */
  getSeal(sealId: string): EntitySeal | null {
    const row = this.stmtGetSeal.get(sealId);
    return row ? rowToSeal(row) : null;
  }

  /**
   * Check if a state transition is valid.
   */
  isValidTransition(from: VerificationStatus, to: VerificationStatus): boolean {
    const allowed = VALID_TRANSITIONS[from];
    return allowed !== undefined && allowed.includes(to);
  }

  /**
   * Count revocations for an entity.
   * Two+ revocations require #E0 approval for re-verification.
   */
  getRevocationCount(entityId: string): number {
    const history = this.getRequestHistory(entityId);
    return history.filter((r) => r.status === "revoked").length;
  }
}

// ---------------------------------------------------------------------------
// Seal grid generation
// ---------------------------------------------------------------------------

function alignmentToEmoji(value: number): string {
  if (value >= 0.9) return "++";
  if (value >= 0.7) return "+?";
  if (value >= 0.55) return "??";
  if (value >= 0.3) return "?-";
  return "--";
}

function generateGrid(
  alignment: SealAlignment,
  coa: string,
  checksum: string,
): string {
  const row1 = `${alignmentToEmoji(alignment.a_a)} ${alignmentToEmoji(alignment.u_u)} ${alignmentToEmoji(alignment.c_c)}`;
  const coaPrefix = coa.substring(0, 2).padEnd(2, "?");
  const impIndicator = "$$";
  const tierMarker = "++";
  const row2 = `${coaPrefix} ${impIndicator} ${tierMarker}`;
  const c1 = checksum.substring(0, 2);
  const c2 = checksum.substring(2, 4);
  const c3 = checksum.substring(4, 6);
  const row3 = `${c1} ${c2} ${c3}`;

  return `${row1}\n${row2}\n${row3}`;
}
