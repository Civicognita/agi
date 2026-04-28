/**
 * VerificationManager — verification lifecycle + seal management (drizzle/Postgres).
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
import { and, asc, desc, eq } from "drizzle-orm";
import { ulid } from "ulid";
import type { Db } from "@agi/db-schema/client";
import { verificationRequests, seals } from "@agi/db-schema";
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

// ---------------------------------------------------------------------------
// DDL exports (kept for backward compat with index.ts)
// ---------------------------------------------------------------------------

export const CREATE_VERIFICATION_REQUESTS = "" as const;
export const CREATE_SEALS = "" as const;

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

function rowToRequest(row: typeof verificationRequests.$inferSelect): VerificationRequest {
  const proofPayload = row.proofPayload as string | Record<string, unknown>;

  return {
    id: row.id,
    entityId: row.entityId,
    entityType: row.entityType as VerificationEntityType,
    status: row.status as VerificationStatus,
    proof: {
      entityType: row.entityType as VerificationEntityType,
      proofType: row.proofType as VerificationProof["proofType"],
      proofPayload,
      submittedAt: row.proofSubmittedAt instanceof Date
        ? row.proofSubmittedAt.toISOString()
        : String(row.proofSubmittedAt),
      submittedBy: row.proofSubmittedBy,
    },
    reviewerId: row.reviewerId ?? null,
    decision: row.decision as VerificationRequest["decision"],
    decisionReason: row.decisionReason ?? null,
    decisionAt: row.decisionAt ? (row.decisionAt instanceof Date ? row.decisionAt.toISOString() : String(row.decisionAt)) : null,
    coaFingerprint: row.coaFingerprint ?? null,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
  };
}

function rowToSeal(row: typeof seals.$inferSelect): EntitySeal {
  return {
    sealId: row.sealId,
    entityId: row.entityId,
    entityType: row.entityType as VerificationEntityType,
    issuedAt: row.issuedAt instanceof Date ? row.issuedAt.toISOString() : String(row.issuedAt),
    issuedBy: row.issuedBy,
    coa: row.coa,
    alignment: {
      a_a: row.alignmentAa,
      u_u: row.alignmentUu,
      c_c: row.alignmentCc,
    },
    checksum: row.checksum,
    grid: row.grid,
    status: row.status as EntitySeal["status"],
  };
}

// ---------------------------------------------------------------------------
// Valid state transitions
// ---------------------------------------------------------------------------

const VALID_TRANSITIONS: Record<string, string[]> = {
  none: ["pending"],
  pending: ["approved", "rejected", "info_requested"],
  info_requested: ["pending"],
  approved: [],
  rejected: ["pending"],
  revoked: ["pending"],
};

// ---------------------------------------------------------------------------
// VerificationManager
// ---------------------------------------------------------------------------

export class VerificationManager {
  constructor(private readonly db: Db) {}

  // ---------------------------------------------------------------------------
  // Proof submission
  // ---------------------------------------------------------------------------

  async submitRequest(entityId: string, proof: VerificationProof): Promise<VerificationRequest> {
    const now = new Date();
    const id = ulid();

    const proofPayload = typeof proof.proofPayload === "string"
      ? JSON.parse(proof.proofPayload) as Record<string, unknown>
      : proof.proofPayload as Record<string, unknown>;

    await this.db.insert(verificationRequests).values({
      id,
      entityId,
      entityType: proof.entityType,
      status: "pending",
      proofType: proof.proofType,
      proofPayload: proofPayload as Record<string, unknown>,
      proofSubmittedAt: new Date(proof.submittedAt),
      proofSubmittedBy: proof.submittedBy,
      createdAt: now,
      updatedAt: now,
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
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // Review decisions
  // ---------------------------------------------------------------------------

  async processDecision(
    decision: ReviewDecision,
    coaFingerprint?: string,
  ): Promise<{ request: VerificationRequest; newTier: VerificationTier | null }> {
    const [row] = await this.db
      .select()
      .from(verificationRequests)
      .where(eq(verificationRequests.id, decision.requestId));

    if (!row) throw new Error(`Verification request not found: ${decision.requestId}`);
    if (row.status !== "pending") {
      throw new Error(`Cannot process decision on request in "${row.status}" status. Expected "pending".`);
    }

    const statusMap: Record<string, string> = {
      approve: "approved",
      reject: "rejected",
      request_info: "escalated",
    };

    const newStatus = statusMap[decision.decision];
    if (!newStatus) throw new Error(`Invalid decision: ${decision.decision}`);

    const now = new Date();

    await this.db.update(verificationRequests)
      .set({
        status: newStatus as typeof verificationRequests.$inferInsert["status"],
        reviewerId: decision.reviewerId,
        decision: decision.decision,
        decisionReason: decision.reason ?? null,
        decisionAt: now,
        coaFingerprint: coaFingerprint ?? null,
        updatedAt: now,
      })
      .where(eq(verificationRequests.id, decision.requestId));

    const [updatedRow] = await this.db
      .select()
      .from(verificationRequests)
      .where(eq(verificationRequests.id, decision.requestId));

    const request = rowToRequest(updatedRow!);
    const newTier: VerificationTier | null = decision.decision === "approve" ? "verified" : null;

    return { request, newTier };
  }

  // ---------------------------------------------------------------------------
  // Seal issuance
  // ---------------------------------------------------------------------------

  async issueSeal(params: SealIssuanceParams): Promise<EntitySeal> {
    if (params.alignment.a_a < SEAL_MIN_ALIGNMENT.a_a) {
      throw new Error(`A:A alignment ${params.alignment.a_a} below minimum ${SEAL_MIN_ALIGNMENT.a_a}`);
    }
    if (params.alignment.u_u < SEAL_MIN_ALIGNMENT.u_u) {
      throw new Error(`U:U alignment ${params.alignment.u_u} below minimum ${SEAL_MIN_ALIGNMENT.u_u}`);
    }
    if (params.alignment.c_c < SEAL_MIN_ALIGNMENT.c_c) {
      throw new Error(`C:C alignment ${params.alignment.c_c} below minimum ${SEAL_MIN_ALIGNMENT.c_c}`);
    }

    const now = new Date();
    const sealId = `seal-${params.entityId}-${Date.now()}`;

    // Determine entity type from latest verification request
    const [latestRow] = await this.db
      .select({ entityType: verificationRequests.entityType })
      .from(verificationRequests)
      .where(eq(verificationRequests.entityId, params.entityId))
      .orderBy(desc(verificationRequests.createdAt))
      .limit(1);

    const entityType: VerificationEntityType = (latestRow?.entityType as VerificationEntityType) ?? "#E";

    const checksumInput = JSON.stringify({
      sealId,
      entityId: params.entityId,
      entityType,
      issuedAt: now.toISOString(),
      issuedBy: params.issuedBy,
      coa: params.coa,
      alignment: params.alignment,
    });
    const checksum = createHash("sha256").update(checksumInput).digest("hex");
    const grid = generateGrid(params.alignment, params.coa, checksum);

    await this.db.insert(seals).values({
      sealId,
      entityId: params.entityId,
      entityType,
      issuedAt: now,
      issuedBy: params.issuedBy,
      coa: params.coa,
      alignmentAa: params.alignment.a_a,
      alignmentUu: params.alignment.u_u,
      alignmentCc: params.alignment.c_c,
      checksum,
      grid,
      status: "active",
    });

    return {
      sealId,
      entityId: params.entityId,
      entityType,
      issuedAt: now.toISOString(),
      issuedBy: params.issuedBy,
      coa: params.coa,
      alignment: params.alignment,
      checksum,
      grid,
      status: "active",
    };
  }

  async verifySeal(sealId: string): Promise<{
    valid: boolean;
    seal: EntitySeal | null;
    checksumOk: boolean;
  }> {
    const [row] = await this.db.select().from(seals).where(eq(seals.sealId, sealId));
    if (!row) return { valid: false, seal: null, checksumOk: false };

    const seal = rowToSeal(row);

    const checksumInput = JSON.stringify({
      sealId: seal.sealId,
      entityId: seal.entityId,
      entityType: seal.entityType,
      issuedAt: seal.issuedAt,
      issuedBy: seal.issuedBy,
      coa: seal.coa,
      alignment: seal.alignment,
    });
    const computedChecksum = createHash("sha256").update(checksumInput).digest("hex");
    const checksumOk = computedChecksum === seal.checksum;

    return { valid: seal.status === "active" && checksumOk, seal, checksumOk };
  }

  // ---------------------------------------------------------------------------
  // Revocation
  // ---------------------------------------------------------------------------

  async revoke(params: RevocationParams): Promise<{
    seal: EntitySeal | null;
    newTier: VerificationTier;
  }> {
    const now = new Date();

    // Revoke active seal if one exists
    const [sealRow] = await this.db
      .select()
      .from(seals)
      .where(and(eq(seals.entityId, params.entityId), eq(seals.status, "active")))
      .orderBy(desc(seals.issuedAt))
      .limit(1);

    let seal: EntitySeal | null = null;

    if (sealRow) {
      await this.db.update(seals)
        .set({
          status: "revoked",
          revokedAt: now,
          revokedBy: params.revokedBy,
          revokeReason: params.reason,
        })
        .where(eq(seals.sealId, sealRow.sealId));

      const [revokedRow] = await this.db.select().from(seals).where(eq(seals.sealId, sealRow.sealId));
      seal = rowToSeal(revokedRow!);
    }

    // Create revocation record
    const revokeId = ulid();
    await this.db.insert(verificationRequests).values({
      id: revokeId,
      entityId: params.entityId,
      entityType: sealRow?.entityType ?? "#E",
      status: "rejected",
      proofType: "revocation",
      proofPayload: { reason: params.reason } as Record<string, unknown>,
      proofSubmittedAt: now,
      proofSubmittedBy: params.revokedBy,
      createdAt: now,
      updatedAt: now,
    });

    return { seal, newTier: "unverified" };
  }

  // ---------------------------------------------------------------------------
  // Query helpers
  // ---------------------------------------------------------------------------

  async getPendingRequests(): Promise<VerificationRequest[]> {
    const rows = await this.db
      .select()
      .from(verificationRequests)
      .where(eq(verificationRequests.status, "pending"))
      .orderBy(asc(verificationRequests.createdAt));
    return rows.map(rowToRequest);
  }

  async getRequestHistory(entityId: string): Promise<VerificationRequest[]> {
    const rows = await this.db
      .select()
      .from(verificationRequests)
      .where(eq(verificationRequests.entityId, entityId))
      .orderBy(desc(verificationRequests.createdAt));
    return rows.map(rowToRequest);
  }

  async getLatestRequest(entityId: string): Promise<VerificationRequest | null> {
    const [row] = await this.db
      .select()
      .from(verificationRequests)
      .where(eq(verificationRequests.entityId, entityId))
      .orderBy(desc(verificationRequests.createdAt))
      .limit(1);
    return row ? rowToRequest(row) : null;
  }

  async getActiveSeal(entityId: string): Promise<EntitySeal | null> {
    const [row] = await this.db
      .select()
      .from(seals)
      .where(and(eq(seals.entityId, entityId), eq(seals.status, "active")))
      .orderBy(desc(seals.issuedAt))
      .limit(1);
    return row ? rowToSeal(row) : null;
  }

  async getSeal(sealId: string): Promise<EntitySeal | null> {
    const [row] = await this.db.select().from(seals).where(eq(seals.sealId, sealId));
    return row ? rowToSeal(row) : null;
  }

  isValidTransition(from: VerificationStatus, to: VerificationStatus): boolean {
    const allowed = VALID_TRANSITIONS[from];
    return allowed !== undefined && allowed.includes(to);
  }

  async getRevocationCount(entityId: string): Promise<number> {
    const history = await this.getRequestHistory(entityId);
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
