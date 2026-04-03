/**
 * 0R Verification System Tests — Task #132
 *
 * Covers:
 *   - verification-types.ts: tierRank, meetsMinimumTier, resolveAutonomy, SEAL_MIN_ALIGNMENT
 *   - verification.ts: VerificationManager full lifecycle
 *   - schema.sql.ts DDL: verification_requests and seals tables
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createDatabase } from "./db.js";
import type { Database } from "./db.js";
import { EntityStore } from "./store.js";
import { ImpactRecorder } from "./impact.js";
import { VerificationManager } from "./verification.js";
import {
  tierRank,
  meetsMinimumTier,
  resolveAutonomy,
  SEAL_MIN_ALIGNMENT,
} from "./verification-types.js";
import type { VerificationProof, SealIssuanceParams } from "./verification-types.js";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Build a minimal valid VerificationProof for a human entity. */
function makeProof(entityId: string, overrides?: Partial<VerificationProof>): VerificationProof {
  return {
    entityType: "#E",
    proofType: "telegram_account",
    proofPayload: { handle: "@alice" },
    submittedAt: new Date().toISOString(),
    submittedBy: entityId,
    ...overrides,
  };
}

/** Build SealIssuanceParams that pass alignment thresholds by default. */
function makeSealParams(entityId: string, overrides?: Partial<SealIssuanceParams>): SealIssuanceParams {
  return {
    entityId,
    issuedBy: "reviewer-001",
    coa: "$A0.#E0.@A0.C001",
    alignment: { a_a: 0.85, u_u: 0.80, c_c: 0.70 },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Shared test state
// ---------------------------------------------------------------------------

let db: Database;
let store: EntityStore;
let manager: VerificationManager;

beforeEach(() => {
  db = createDatabase(":memory:");
  store = new EntityStore(db);
  manager = new VerificationManager(db);
});

// ===========================================================================
// 1. verification-types.ts — pure utility functions
// ===========================================================================

describe("tierRank", () => {
  it("returns 0 for unverified", () => {
    expect(tierRank("unverified")).toBe(0);
  });

  it("returns 1 for verified", () => {
    expect(tierRank("verified")).toBe(1);
  });

  it("returns 2 for sealed", () => {
    expect(tierRank("sealed")).toBe(2);
  });
});

describe("meetsMinimumTier", () => {
  it("unverified meets unverified", () => {
    expect(meetsMinimumTier("unverified", "unverified")).toBe(true);
  });

  it("unverified does not meet verified", () => {
    expect(meetsMinimumTier("unverified", "verified")).toBe(false);
  });

  it("unverified does not meet sealed", () => {
    expect(meetsMinimumTier("unverified", "sealed")).toBe(false);
  });

  it("verified meets unverified", () => {
    expect(meetsMinimumTier("verified", "unverified")).toBe(true);
  });

  it("verified meets verified", () => {
    expect(meetsMinimumTier("verified", "verified")).toBe(true);
  });

  it("verified does not meet sealed", () => {
    expect(meetsMinimumTier("verified", "sealed")).toBe(false);
  });

  it("sealed meets unverified", () => {
    expect(meetsMinimumTier("sealed", "unverified")).toBe(true);
  });

  it("sealed meets verified", () => {
    expect(meetsMinimumTier("sealed", "verified")).toBe(true);
  });

  it("sealed meets sealed", () => {
    expect(meetsMinimumTier("sealed", "sealed")).toBe(true);
  });
});

describe("resolveAutonomy", () => {
  it("unverified → supervised", () => {
    expect(resolveAutonomy("unverified")).toBe("supervised");
  });

  it("verified → standard", () => {
    expect(resolveAutonomy("verified")).toBe("standard");
  });

  it("sealed → full", () => {
    expect(resolveAutonomy("sealed")).toBe("full");
  });
});

describe("SEAL_MIN_ALIGNMENT", () => {
  it("a_a minimum is 0.70", () => {
    expect(SEAL_MIN_ALIGNMENT.a_a).toBe(0.70);
  });

  it("u_u minimum is 0.70", () => {
    expect(SEAL_MIN_ALIGNMENT.u_u).toBe(0.70);
  });

  it("c_c minimum is 0.55", () => {
    expect(SEAL_MIN_ALIGNMENT.c_c).toBe(0.55);
  });

  it("is a readonly object (all three keys present)", () => {
    const keys = Object.keys(SEAL_MIN_ALIGNMENT);
    expect(keys).toContain("a_a");
    expect(keys).toContain("u_u");
    expect(keys).toContain("c_c");
    expect(keys.length).toBe(3);
  });
});

// ===========================================================================
// 2. Schema DDL — tables created successfully
// ===========================================================================

describe("Schema DDL", () => {
  it("verification_requests table exists and is queryable", () => {
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='verification_requests'")
      .all();
    expect(rows.length).toBe(1);
  });

  it("seals table exists and is queryable", () => {
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='seals'")
      .all();
    expect(rows.length).toBe(1);
  });

  it("verification_requests columns include all expected fields", () => {
    const cols = db.prepare("PRAGMA table_info(verification_requests)").all() as Array<{ name: string }>;
    const names = cols.map((c) => c.name);
    expect(names).toContain("id");
    expect(names).toContain("entity_id");
    expect(names).toContain("entity_type");
    expect(names).toContain("status");
    expect(names).toContain("proof_type");
    expect(names).toContain("proof_payload");
    expect(names).toContain("proof_submitted_at");
    expect(names).toContain("proof_submitted_by");
    expect(names).toContain("reviewer_id");
    expect(names).toContain("decision");
    expect(names).toContain("decision_reason");
    expect(names).toContain("decision_at");
    expect(names).toContain("coa_fingerprint");
    expect(names).toContain("created_at");
    expect(names).toContain("updated_at");
  });

  it("seals columns include all expected fields", () => {
    const cols = db.prepare("PRAGMA table_info(seals)").all() as Array<{ name: string }>;
    const names = cols.map((c) => c.name);
    expect(names).toContain("seal_id");
    expect(names).toContain("entity_id");
    expect(names).toContain("entity_type");
    expect(names).toContain("issued_at");
    expect(names).toContain("issued_by");
    expect(names).toContain("coa");
    expect(names).toContain("alignment_aa");
    expect(names).toContain("alignment_uu");
    expect(names).toContain("alignment_cc");
    expect(names).toContain("checksum");
    expect(names).toContain("grid");
    expect(names).toContain("status");
    expect(names).toContain("revoked_at");
    expect(names).toContain("revoked_by");
    expect(names).toContain("revoke_reason");
  });

  it("verification_requests default status is pending", () => {
    const entity = store.createEntity({ type: "E", displayName: "Alice" });
    const req = manager.submitRequest(entity.id, makeProof(entity.id));
    expect(req.status).toBe("pending");
  });

  it("seals default status is active", () => {
    const entity = store.createEntity({ type: "E", displayName: "Alice" });
    manager.submitRequest(entity.id, makeProof(entity.id));
    const seal = manager.issueSeal(makeSealParams(entity.id));
    expect(seal.status).toBe("active");
  });
});

// ===========================================================================
// 3. VerificationManager — Proof submission
// ===========================================================================

describe("VerificationManager.submitRequest", () => {
  it("creates a request with status pending", () => {
    const entity = store.createEntity({ type: "E", displayName: "Alice" });
    const req = manager.submitRequest(entity.id, makeProof(entity.id));
    expect(req.status).toBe("pending");
  });

  it("returns a request with a non-empty ULID-style id", () => {
    const entity = store.createEntity({ type: "E", displayName: "Alice" });
    const req = manager.submitRequest(entity.id, makeProof(entity.id));
    expect(req.id).toBeTruthy();
    expect(typeof req.id).toBe("string");
    expect(req.id.length).toBeGreaterThan(0);
  });

  it("stores entityId correctly", () => {
    const entity = store.createEntity({ type: "E", displayName: "Alice" });
    const req = manager.submitRequest(entity.id, makeProof(entity.id));
    expect(req.entityId).toBe(entity.id);
  });

  it("stores entityType from proof", () => {
    const entity = store.createEntity({ type: "E", displayName: "Alice" });
    const req = manager.submitRequest(entity.id, makeProof(entity.id, { entityType: "#E" }));
    expect(req.entityType).toBe("#E");
  });

  it("stores proof fields: proofType, proofPayload, submittedAt, submittedBy", () => {
    const entity = store.createEntity({ type: "E", displayName: "Alice" });
    const now = new Date().toISOString();
    const proof = makeProof(entity.id, {
      proofType: "email_domain",
      proofPayload: "alice@example.com",
      submittedAt: now,
      submittedBy: entity.id,
    });
    const req = manager.submitRequest(entity.id, proof);
    expect(req.proof.proofType).toBe("email_domain");
    expect(req.proof.proofPayload).toBe("alice@example.com");
    expect(req.proof.submittedAt).toBe(now);
    expect(req.proof.submittedBy).toBe(entity.id);
  });

  it("stores object proofPayload round-tripped through JSON", () => {
    const entity = store.createEntity({ type: "E", displayName: "Alice" });
    const proof = makeProof(entity.id, { proofPayload: { handle: "@alice", id: 99 } });
    const req = manager.submitRequest(entity.id, proof);
    expect(req.proof.proofPayload).toEqual({ handle: "@alice", id: 99 });
  });

  it("sets reviewerId, decision, decisionReason, decisionAt, coaFingerprint to null initially", () => {
    const entity = store.createEntity({ type: "E", displayName: "Alice" });
    const req = manager.submitRequest(entity.id, makeProof(entity.id));
    expect(req.reviewerId).toBeNull();
    expect(req.decision).toBeNull();
    expect(req.decisionReason).toBeNull();
    expect(req.decisionAt).toBeNull();
    expect(req.coaFingerprint).toBeNull();
  });

  it("sets ISO-8601 createdAt and updatedAt timestamps", () => {
    const entity = store.createEntity({ type: "E", displayName: "Alice" });
    const before = new Date().toISOString();
    const req = manager.submitRequest(entity.id, makeProof(entity.id));
    const after = new Date().toISOString();
    expect(req.createdAt >= before).toBe(true);
    expect(req.createdAt <= after).toBe(true);
    expect(req.updatedAt >= before).toBe(true);
    expect(req.updatedAt <= after).toBe(true);
  });

  it("multiple submissions for same entity each create separate requests", () => {
    const entity = store.createEntity({ type: "E", displayName: "Alice" });
    const r1 = manager.submitRequest(entity.id, makeProof(entity.id));
    const r2 = manager.submitRequest(entity.id, makeProof(entity.id));
    expect(r1.id).not.toBe(r2.id);
    expect(manager.getRequestHistory(entity.id).length).toBe(2);
  });

  it("supports #R entity type with provenance_coa proof", () => {
    const entity = store.createEntity({ type: "E", displayName: "Resource System" });
    const proof = makeProof(entity.id, {
      entityType: "#R",
      proofType: "provenance_coa",
      proofPayload: { coa: "$A0.#E0.@A0.C001" },
    });
    const req = manager.submitRequest(entity.id, proof);
    expect(req.entityType).toBe("#R");
    expect(req.proof.proofType).toBe("provenance_coa");
  });
});

// ===========================================================================
// 4. VerificationManager — Review decisions
// ===========================================================================

describe("VerificationManager.processDecision — approve", () => {
  it("approve sets status to approved", () => {
    const entity = store.createEntity({ type: "E", displayName: "Alice" });
    const req = manager.submitRequest(entity.id, makeProof(entity.id));
    const { request } = manager.processDecision({
      requestId: req.id,
      reviewerId: "reviewer-001",
      decision: "approve",
    });
    expect(request.status).toBe("approved");
  });

  it("approve returns newTier = 'verified'", () => {
    const entity = store.createEntity({ type: "E", displayName: "Alice" });
    const req = manager.submitRequest(entity.id, makeProof(entity.id));
    const { newTier } = manager.processDecision({
      requestId: req.id,
      reviewerId: "reviewer-001",
      decision: "approve",
    });
    expect(newTier).toBe("verified");
  });

  it("approve stores reviewerId", () => {
    const entity = store.createEntity({ type: "E", displayName: "Alice" });
    const req = manager.submitRequest(entity.id, makeProof(entity.id));
    const { request } = manager.processDecision({
      requestId: req.id,
      reviewerId: "reviewer-xyz",
      decision: "approve",
    });
    expect(request.reviewerId).toBe("reviewer-xyz");
  });

  it("approve stores decision field", () => {
    const entity = store.createEntity({ type: "E", displayName: "Alice" });
    const req = manager.submitRequest(entity.id, makeProof(entity.id));
    const { request } = manager.processDecision({
      requestId: req.id,
      reviewerId: "reviewer-001",
      decision: "approve",
    });
    expect(request.decision).toBe("approve");
  });

  it("approve stores decisionAt as ISO-8601 timestamp", () => {
    const entity = store.createEntity({ type: "E", displayName: "Alice" });
    const req = manager.submitRequest(entity.id, makeProof(entity.id));
    const before = new Date().toISOString();
    const { request } = manager.processDecision({
      requestId: req.id,
      reviewerId: "reviewer-001",
      decision: "approve",
    });
    const after = new Date().toISOString();
    expect(request.decisionAt).not.toBeNull();
    expect(request.decisionAt! >= before).toBe(true);
    expect(request.decisionAt! <= after).toBe(true);
  });

  it("approve stores optional reason", () => {
    const entity = store.createEntity({ type: "E", displayName: "Alice" });
    const req = manager.submitRequest(entity.id, makeProof(entity.id));
    const { request } = manager.processDecision({
      requestId: req.id,
      reviewerId: "reviewer-001",
      decision: "approve",
      reason: "Identity confirmed via Telegram",
    });
    expect(request.decisionReason).toBe("Identity confirmed via Telegram");
  });

  it("approve stores optional coaFingerprint", () => {
    const entity = store.createEntity({ type: "E", displayName: "Alice" });
    const req = manager.submitRequest(entity.id, makeProof(entity.id));
    const { request } = manager.processDecision(
      { requestId: req.id, reviewerId: "reviewer-001", decision: "approve" },
      "$A0.#E0.@A0.C001",
    );
    expect(request.coaFingerprint).toBe("$A0.#E0.@A0.C001");
  });
});

describe("VerificationManager.processDecision — reject", () => {
  it("reject sets status to rejected", () => {
    const entity = store.createEntity({ type: "E", displayName: "Bob" });
    const req = manager.submitRequest(entity.id, makeProof(entity.id));
    const { request } = manager.processDecision({
      requestId: req.id,
      reviewerId: "reviewer-001",
      decision: "reject",
      reason: "Proof insufficient",
    });
    expect(request.status).toBe("rejected");
  });

  it("reject returns newTier = null", () => {
    const entity = store.createEntity({ type: "E", displayName: "Bob" });
    const req = manager.submitRequest(entity.id, makeProof(entity.id));
    const { newTier } = manager.processDecision({
      requestId: req.id,
      reviewerId: "reviewer-001",
      decision: "reject",
    });
    expect(newTier).toBeNull();
  });
});

describe("VerificationManager.processDecision — request_info", () => {
  it("request_info sets status to info_requested", () => {
    const entity = store.createEntity({ type: "E", displayName: "Carol" });
    const req = manager.submitRequest(entity.id, makeProof(entity.id));
    const { request } = manager.processDecision({
      requestId: req.id,
      reviewerId: "reviewer-001",
      decision: "request_info",
      reason: "Need additional documents",
    });
    expect(request.status).toBe("info_requested");
  });

  it("request_info returns newTier = null", () => {
    const entity = store.createEntity({ type: "E", displayName: "Carol" });
    const req = manager.submitRequest(entity.id, makeProof(entity.id));
    const { newTier } = manager.processDecision({
      requestId: req.id,
      reviewerId: "reviewer-001",
      decision: "request_info",
    });
    expect(newTier).toBeNull();
  });
});

describe("VerificationManager.processDecision — invalid decisions", () => {
  it("throws if request not found", () => {
    expect(() =>
      manager.processDecision({
        requestId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        reviewerId: "reviewer-001",
        decision: "approve",
      })
    ).toThrow(/not found/i);
  });

  it("throws on decision for approved (non-pending) request", () => {
    const entity = store.createEntity({ type: "E", displayName: "Alice" });
    const req = manager.submitRequest(entity.id, makeProof(entity.id));
    manager.processDecision({ requestId: req.id, reviewerId: "rev-1", decision: "approve" });

    expect(() =>
      manager.processDecision({ requestId: req.id, reviewerId: "rev-2", decision: "reject" })
    ).toThrow(/pending/i);
  });

  it("throws on decision for rejected (non-pending) request", () => {
    const entity = store.createEntity({ type: "E", displayName: "Alice" });
    const req = manager.submitRequest(entity.id, makeProof(entity.id));
    manager.processDecision({ requestId: req.id, reviewerId: "rev-1", decision: "reject" });

    expect(() =>
      manager.processDecision({ requestId: req.id, reviewerId: "rev-2", decision: "approve" })
    ).toThrow(/pending/i);
  });

  it("throws on decision for info_requested (non-pending) request", () => {
    const entity = store.createEntity({ type: "E", displayName: "Alice" });
    const req = manager.submitRequest(entity.id, makeProof(entity.id));
    manager.processDecision({ requestId: req.id, reviewerId: "rev-1", decision: "request_info" });

    expect(() =>
      manager.processDecision({ requestId: req.id, reviewerId: "rev-2", decision: "approve" })
    ).toThrow(/pending/i);
  });
});

// ===========================================================================
// 5. VerificationManager — Seal issuance
// ===========================================================================

describe("VerificationManager.issueSeal", () => {
  it("returns a seal with status active", () => {
    const entity = store.createEntity({ type: "E", displayName: "Alice" });
    manager.submitRequest(entity.id, makeProof(entity.id));
    const seal = manager.issueSeal(makeSealParams(entity.id));
    expect(seal.status).toBe("active");
  });

  it("seal sealId has seal-<entityId>- prefix", () => {
    const entity = store.createEntity({ type: "E", displayName: "Alice" });
    manager.submitRequest(entity.id, makeProof(entity.id));
    const seal = manager.issueSeal(makeSealParams(entity.id));
    expect(seal.sealId.startsWith(`seal-${entity.id}-`)).toBe(true);
  });

  it("seal stores entityId, issuedBy, coa correctly", () => {
    const entity = store.createEntity({ type: "E", displayName: "Alice" });
    manager.submitRequest(entity.id, makeProof(entity.id));
    const seal = manager.issueSeal(makeSealParams(entity.id, {
      issuedBy: "reviewer-007",
      coa: "$A0.#E0.@A0.C042",
    }));
    expect(seal.entityId).toBe(entity.id);
    expect(seal.issuedBy).toBe("reviewer-007");
    expect(seal.coa).toBe("$A0.#E0.@A0.C042");
  });

  it("seal stores alignment values", () => {
    const entity = store.createEntity({ type: "E", displayName: "Alice" });
    manager.submitRequest(entity.id, makeProof(entity.id));
    const seal = manager.issueSeal(makeSealParams(entity.id, {
      alignment: { a_a: 0.92, u_u: 0.75, c_c: 0.60 },
    }));
    expect(seal.alignment.a_a).toBeCloseTo(0.92);
    expect(seal.alignment.u_u).toBeCloseTo(0.75);
    expect(seal.alignment.c_c).toBeCloseTo(0.60);
  });

  it("seal has non-empty checksum (64-char hex SHA-256)", () => {
    const entity = store.createEntity({ type: "E", displayName: "Alice" });
    manager.submitRequest(entity.id, makeProof(entity.id));
    const seal = manager.issueSeal(makeSealParams(entity.id));
    expect(seal.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it("seal has a 3-line grid", () => {
    const entity = store.createEntity({ type: "E", displayName: "Alice" });
    manager.submitRequest(entity.id, makeProof(entity.id));
    const seal = manager.issueSeal(makeSealParams(entity.id));
    const lines = seal.grid.split("\n");
    expect(lines.length).toBe(3);
  });

  it("seal grid rows are non-empty strings", () => {
    const entity = store.createEntity({ type: "E", displayName: "Alice" });
    manager.submitRequest(entity.id, makeProof(entity.id));
    const seal = manager.issueSeal(makeSealParams(entity.id));
    const lines = seal.grid.split("\n");
    for (const line of lines) {
      expect(line.length).toBeGreaterThan(0);
    }
  });

  it("seal issuedAt is an ISO-8601 timestamp", () => {
    const entity = store.createEntity({ type: "E", displayName: "Alice" });
    manager.submitRequest(entity.id, makeProof(entity.id));
    const before = new Date().toISOString();
    const seal = manager.issueSeal(makeSealParams(entity.id));
    const after = new Date().toISOString();
    expect(seal.issuedAt >= before).toBe(true);
    expect(seal.issuedAt <= after).toBe(true);
  });

  it("entityType on seal is inferred from latest verification request (#E)", () => {
    const entity = store.createEntity({ type: "E", displayName: "Alice" });
    manager.submitRequest(entity.id, makeProof(entity.id, { entityType: "#E" }));
    const seal = manager.issueSeal(makeSealParams(entity.id));
    expect(seal.entityType).toBe("#E");
  });

  it("entityType defaults to #E when no prior request exists", () => {
    // Issue a seal with no prior verification request (edge case)
    const entity = store.createEntity({ type: "E", displayName: "NoRequest" });
    const seal = manager.issueSeal(makeSealParams(entity.id));
    expect(seal.entityType).toBe("#E");
  });

  it("getSeal retrieves the issued seal by ID", () => {
    const entity = store.createEntity({ type: "E", displayName: "Alice" });
    manager.submitRequest(entity.id, makeProof(entity.id));
    const issued = manager.issueSeal(makeSealParams(entity.id));
    const fetched = manager.getSeal(issued.sealId);
    expect(fetched).not.toBeNull();
    expect(fetched!.sealId).toBe(issued.sealId);
    expect(fetched!.checksum).toBe(issued.checksum);
  });

  it("getActiveSeal returns the latest active seal for entity", () => {
    const entity = store.createEntity({ type: "E", displayName: "Alice" });
    manager.submitRequest(entity.id, makeProof(entity.id));
    const issued = manager.issueSeal(makeSealParams(entity.id));
    const active = manager.getActiveSeal(entity.id);
    expect(active).not.toBeNull();
    expect(active!.sealId).toBe(issued.sealId);
  });

  it("getActiveSeal returns null for entity with no seal", () => {
    const entity = store.createEntity({ type: "E", displayName: "NoSeal" });
    expect(manager.getActiveSeal(entity.id)).toBeNull();
  });
});

// ===========================================================================
// 6. VerificationManager — Seal validation (verifySeal)
// ===========================================================================

describe("VerificationManager.verifySeal", () => {
  it("returns checksumOk=true for a freshly issued seal", () => {
    const entity = store.createEntity({ type: "E", displayName: "Alice" });
    manager.submitRequest(entity.id, makeProof(entity.id));
    const seal = manager.issueSeal(makeSealParams(entity.id));
    const result = manager.verifySeal(seal.sealId);
    expect(result.checksumOk).toBe(true);
  });

  it("returns valid=true for an active seal with correct checksum", () => {
    const entity = store.createEntity({ type: "E", displayName: "Alice" });
    manager.submitRequest(entity.id, makeProof(entity.id));
    const seal = manager.issueSeal(makeSealParams(entity.id));
    const result = manager.verifySeal(seal.sealId);
    expect(result.valid).toBe(true);
  });

  it("returns the seal object", () => {
    const entity = store.createEntity({ type: "E", displayName: "Alice" });
    manager.submitRequest(entity.id, makeProof(entity.id));
    const issued = manager.issueSeal(makeSealParams(entity.id));
    const result = manager.verifySeal(issued.sealId);
    expect(result.seal).not.toBeNull();
    expect(result.seal!.sealId).toBe(issued.sealId);
  });

  it("returns valid=false and checksumOk=false for non-existent sealId", () => {
    const result = manager.verifySeal("seal-does-not-exist-00000");
    expect(result.valid).toBe(false);
    expect(result.checksumOk).toBe(false);
    expect(result.seal).toBeNull();
  });

  it("returns valid=false for a revoked seal even if checksum is ok", () => {
    const entity = store.createEntity({ type: "E", displayName: "Alice" });
    manager.submitRequest(entity.id, makeProof(entity.id));
    const seal = manager.issueSeal(makeSealParams(entity.id));

    manager.revoke({ entityId: entity.id, revokedBy: "admin", reason: "Test revocation" });

    const result = manager.verifySeal(seal.sealId);
    expect(result.valid).toBe(false);
    expect(result.checksumOk).toBe(true); // checksum itself is still intact
  });
});

// ===========================================================================
// 7. VerificationManager — Alignment threshold enforcement
// ===========================================================================

describe("VerificationManager.issueSeal — alignment threshold enforcement", () => {
  it("throws when a_a is below 0.70", () => {
    const entity = store.createEntity({ type: "E", displayName: "Alice" });
    manager.submitRequest(entity.id, makeProof(entity.id));
    expect(() =>
      manager.issueSeal(makeSealParams(entity.id, {
        alignment: { a_a: 0.69, u_u: 0.80, c_c: 0.60 },
      }))
    ).toThrow(/0\.69.*0\.70|A:A/i);
  });

  it("throws when u_u is below 0.70", () => {
    const entity = store.createEntity({ type: "E", displayName: "Alice" });
    manager.submitRequest(entity.id, makeProof(entity.id));
    expect(() =>
      manager.issueSeal(makeSealParams(entity.id, {
        alignment: { a_a: 0.80, u_u: 0.69, c_c: 0.60 },
      }))
    ).toThrow(/0\.69.*0\.70|U:U/i);
  });

  it("throws when c_c is below 0.55", () => {
    const entity = store.createEntity({ type: "E", displayName: "Alice" });
    manager.submitRequest(entity.id, makeProof(entity.id));
    expect(() =>
      manager.issueSeal(makeSealParams(entity.id, {
        alignment: { a_a: 0.80, u_u: 0.80, c_c: 0.54 },
      }))
    ).toThrow(/0\.54.*0\.55|C:C/i);
  });

  it("succeeds at exactly the a_a minimum threshold of 0.70", () => {
    const entity = store.createEntity({ type: "E", displayName: "Alice" });
    manager.submitRequest(entity.id, makeProof(entity.id));
    expect(() =>
      manager.issueSeal(makeSealParams(entity.id, {
        alignment: { a_a: 0.70, u_u: 0.70, c_c: 0.55 },
      }))
    ).not.toThrow();
  });

  it("succeeds at exactly the c_c minimum threshold of 0.55", () => {
    const entity = store.createEntity({ type: "E", displayName: "Alice" });
    manager.submitRequest(entity.id, makeProof(entity.id));
    expect(() =>
      manager.issueSeal(makeSealParams(entity.id, {
        alignment: { a_a: 0.70, u_u: 0.70, c_c: 0.55 },
      }))
    ).not.toThrow();
  });
});

// ===========================================================================
// 8. VerificationManager — Revocation
// ===========================================================================

describe("VerificationManager.revoke", () => {
  it("revokes the active seal (seal status becomes revoked)", () => {
    const entity = store.createEntity({ type: "E", displayName: "Alice" });
    manager.submitRequest(entity.id, makeProof(entity.id));
    const seal = manager.issueSeal(makeSealParams(entity.id));

    manager.revoke({ entityId: entity.id, revokedBy: "admin", reason: "Policy violation" });

    const fetched = manager.getSeal(seal.sealId);
    expect(fetched!.status).toBe("revoked");
  });

  it("returns newTier = 'unverified' after revocation", () => {
    const entity = store.createEntity({ type: "E", displayName: "Alice" });
    manager.submitRequest(entity.id, makeProof(entity.id));
    manager.issueSeal(makeSealParams(entity.id));

    const { newTier } = manager.revoke({
      entityId: entity.id,
      revokedBy: "admin",
      reason: "Policy violation",
    });
    expect(newTier).toBe("unverified");
  });

  it("returns the revoked seal object", () => {
    const entity = store.createEntity({ type: "E", displayName: "Alice" });
    manager.submitRequest(entity.id, makeProof(entity.id));
    const issued = manager.issueSeal(makeSealParams(entity.id));

    const { seal } = manager.revoke({
      entityId: entity.id,
      revokedBy: "admin",
      reason: "Reason",
    });
    expect(seal).not.toBeNull();
    expect(seal!.sealId).toBe(issued.sealId);
    expect(seal!.status).toBe("revoked");
  });

  it("revoke adds a revocation record to the request history", () => {
    const entity = store.createEntity({ type: "E", displayName: "Alice" });
    manager.submitRequest(entity.id, makeProof(entity.id));
    manager.issueSeal(makeSealParams(entity.id));

    manager.revoke({ entityId: entity.id, revokedBy: "admin", reason: "Cause" });

    const history = manager.getRequestHistory(entity.id);
    const revokedRecords = history.filter((r) => r.status === "revoked");
    expect(revokedRecords.length).toBeGreaterThanOrEqual(1);
  });

  it("revoke with no active seal returns seal=null but still records history", () => {
    const entity = store.createEntity({ type: "E", displayName: "NoSeal" });
    const { seal, newTier } = manager.revoke({
      entityId: entity.id,
      revokedBy: "admin",
      reason: "No seal case",
    });
    expect(seal).toBeNull();
    expect(newTier).toBe("unverified");

    // Revocation record still created
    const history = manager.getRequestHistory(entity.id);
    expect(history.some((r) => r.status === "revoked")).toBe(true);
  });

  it("getActiveSeal returns null after revocation", () => {
    const entity = store.createEntity({ type: "E", displayName: "Alice" });
    manager.submitRequest(entity.id, makeProof(entity.id));
    manager.issueSeal(makeSealParams(entity.id));

    manager.revoke({ entityId: entity.id, revokedBy: "admin", reason: "Test" });

    expect(manager.getActiveSeal(entity.id)).toBeNull();
  });
});

// ===========================================================================
// 9. VerificationManager — Re-verification after revocation
// ===========================================================================

describe("VerificationManager — Re-verification after revocation", () => {
  it("allows new submitRequest after revocation", () => {
    const entity = store.createEntity({ type: "E", displayName: "Alice" });
    manager.submitRequest(entity.id, makeProof(entity.id));
    manager.issueSeal(makeSealParams(entity.id));
    manager.revoke({ entityId: entity.id, revokedBy: "admin", reason: "Reset" });

    // Should not throw
    const newReq = manager.submitRequest(entity.id, makeProof(entity.id));
    expect(newReq.status).toBe("pending");
  });

  it("re-verification request appears in getPendingRequests", () => {
    const entity = store.createEntity({ type: "E", displayName: "Alice" });
    // Move the first request through to approved so it leaves the pending queue
    const req = manager.submitRequest(entity.id, makeProof(entity.id));
    manager.processDecision({ requestId: req.id, reviewerId: "rev", decision: "approve" });
    manager.issueSeal(makeSealParams(entity.id));
    manager.revoke({ entityId: entity.id, revokedBy: "admin", reason: "Reset" });

    // No pending entries for this entity at this point
    expect(manager.getPendingRequests().filter((r) => r.entityId === entity.id).length).toBe(0);

    // Submit a re-verification request
    manager.submitRequest(entity.id, makeProof(entity.id));

    const pending = manager.getPendingRequests();
    const entityPending = pending.filter((r) => r.entityId === entity.id);
    expect(entityPending.length).toBe(1);
  });
});

// ===========================================================================
// 10. VerificationManager — Revocation count
// ===========================================================================

describe("VerificationManager.getRevocationCount", () => {
  it("returns 0 for entity with no revocations", () => {
    const entity = store.createEntity({ type: "E", displayName: "Clean" });
    expect(manager.getRevocationCount(entity.id)).toBe(0);
  });

  it("returns 1 after one revocation", () => {
    const entity = store.createEntity({ type: "E", displayName: "Alice" });
    manager.submitRequest(entity.id, makeProof(entity.id));
    manager.issueSeal(makeSealParams(entity.id));
    manager.revoke({ entityId: entity.id, revokedBy: "admin", reason: "First" });

    expect(manager.getRevocationCount(entity.id)).toBe(1);
  });

  it("returns 2 after two revocations", async () => {
    const entity = store.createEntity({ type: "E", displayName: "Alice" });

    // First cycle
    manager.submitRequest(entity.id, makeProof(entity.id));
    manager.issueSeal(makeSealParams(entity.id));
    manager.revoke({ entityId: entity.id, revokedBy: "admin", reason: "First" });

    // Second cycle
    await new Promise((r) => setTimeout(r, 5));
    manager.submitRequest(entity.id, makeProof(entity.id));
    manager.revoke({ entityId: entity.id, revokedBy: "admin", reason: "Second" });

    expect(manager.getRevocationCount(entity.id)).toBe(2);
  });

  it("counts only revocations for the given entity, not others", () => {
    const alice = store.createEntity({ type: "E", displayName: "Alice" });
    const bob = store.createEntity({ type: "E", displayName: "Bob" });

    manager.submitRequest(alice.id, makeProof(alice.id));
    manager.issueSeal(makeSealParams(alice.id));
    manager.revoke({ entityId: alice.id, revokedBy: "admin", reason: "Alice revoked" });

    expect(manager.getRevocationCount(alice.id)).toBe(1);
    expect(manager.getRevocationCount(bob.id)).toBe(0);
  });
});

// ===========================================================================
// 11. VerificationManager — Queue (getPendingRequests)
// ===========================================================================

describe("VerificationManager.getPendingRequests", () => {
  it("returns only pending requests", () => {
    const e1 = store.createEntity({ type: "E", displayName: "Alice" });
    const e2 = store.createEntity({ type: "E", displayName: "Bob" });
    const e3 = store.createEntity({ type: "E", displayName: "Carol" });

    const r1 = manager.submitRequest(e1.id, makeProof(e1.id));
    const r2 = manager.submitRequest(e2.id, makeProof(e2.id));
    manager.submitRequest(e3.id, makeProof(e3.id));

    // Approve e1 and reject e2 — both leave pending queue
    manager.processDecision({ requestId: r1.id, reviewerId: "rev", decision: "approve" });
    manager.processDecision({ requestId: r2.id, reviewerId: "rev", decision: "reject" });

    const pending = manager.getPendingRequests();
    expect(pending.every((r) => r.status === "pending")).toBe(true);
    // Only e3's request should remain pending
    expect(pending.some((r) => r.entityId === e3.id)).toBe(true);
    expect(pending.some((r) => r.entityId === e1.id)).toBe(false);
    expect(pending.some((r) => r.entityId === e2.id)).toBe(false);
  });

  it("returns empty array when no pending requests exist", () => {
    expect(manager.getPendingRequests()).toEqual([]);
  });

  it("returns requests ordered by created_at ASC (oldest first)", async () => {
    const e1 = store.createEntity({ type: "E", displayName: "First" });
    const e2 = store.createEntity({ type: "E", displayName: "Second" });

    const r1 = manager.submitRequest(e1.id, makeProof(e1.id));
    await new Promise((res) => setTimeout(res, 5));
    const r2 = manager.submitRequest(e2.id, makeProof(e2.id));

    const pending = manager.getPendingRequests();
    expect(pending[0]!.id).toBe(r1.id);
    expect(pending[1]!.id).toBe(r2.id);
  });
});

// ===========================================================================
// 12. VerificationManager — History (getRequestHistory)
// ===========================================================================

describe("VerificationManager.getRequestHistory", () => {
  it("returns all requests for entity ordered by created_at DESC", async () => {
    const entity = store.createEntity({ type: "E", displayName: "Alice" });
    const r1 = manager.submitRequest(entity.id, makeProof(entity.id));
    await new Promise((res) => setTimeout(res, 5));
    const r2 = manager.submitRequest(entity.id, makeProof(entity.id));

    const history = manager.getRequestHistory(entity.id);
    expect(history.length).toBe(2);
    // DESC: newest first
    expect(history[0]!.id).toBe(r2.id);
    expect(history[1]!.id).toBe(r1.id);
  });

  it("returns empty array for entity with no requests", () => {
    const entity = store.createEntity({ type: "E", displayName: "Ghost" });
    expect(manager.getRequestHistory(entity.id)).toEqual([]);
  });

  it("includes requests of all statuses in history", () => {
    const entity = store.createEntity({ type: "E", displayName: "Alice" });
    const r1 = manager.submitRequest(entity.id, makeProof(entity.id));
    manager.processDecision({ requestId: r1.id, reviewerId: "rev", decision: "reject" });

    const r2 = manager.submitRequest(entity.id, makeProof(entity.id));
    manager.processDecision({ requestId: r2.id, reviewerId: "rev", decision: "approve" });

    const history = manager.getRequestHistory(entity.id);
    const statuses = history.map((r) => r.status);
    expect(statuses).toContain("rejected");
    expect(statuses).toContain("approved");
  });

  it("only returns history for the given entity", () => {
    const alice = store.createEntity({ type: "E", displayName: "Alice" });
    const bob = store.createEntity({ type: "E", displayName: "Bob" });

    manager.submitRequest(alice.id, makeProof(alice.id));
    manager.submitRequest(bob.id, makeProof(bob.id));
    manager.submitRequest(bob.id, makeProof(bob.id));

    expect(manager.getRequestHistory(alice.id).length).toBe(1);
    expect(manager.getRequestHistory(bob.id).length).toBe(2);
  });
});

// ===========================================================================
// 13. VerificationManager — getLatestRequest
// ===========================================================================

describe("VerificationManager.getLatestRequest", () => {
  it("returns null for entity with no requests", () => {
    const entity = store.createEntity({ type: "E", displayName: "Empty" });
    expect(manager.getLatestRequest(entity.id)).toBeNull();
  });

  it("returns the most recently created request", async () => {
    const entity = store.createEntity({ type: "E", displayName: "Alice" });
    manager.submitRequest(entity.id, makeProof(entity.id));
    await new Promise((res) => setTimeout(res, 5));
    const r2 = manager.submitRequest(entity.id, makeProof(entity.id));

    const latest = manager.getLatestRequest(entity.id);
    expect(latest!.id).toBe(r2.id);
  });
});

// ===========================================================================
// 14. VerificationManager — State transition validation
// ===========================================================================

describe("VerificationManager.isValidTransition", () => {
  // Valid transitions
  it("none → pending is valid", () => {
    expect(manager.isValidTransition("none", "pending")).toBe(true);
  });

  it("pending → approved is valid", () => {
    expect(manager.isValidTransition("pending", "approved")).toBe(true);
  });

  it("pending → rejected is valid", () => {
    expect(manager.isValidTransition("pending", "rejected")).toBe(true);
  });

  it("pending → info_requested is valid", () => {
    expect(manager.isValidTransition("pending", "info_requested")).toBe(true);
  });

  it("info_requested → pending is valid", () => {
    expect(manager.isValidTransition("info_requested", "pending")).toBe(true);
  });

  it("rejected → pending is valid (re-submission)", () => {
    expect(manager.isValidTransition("rejected", "pending")).toBe(true);
  });

  it("revoked → pending is valid (re-verification)", () => {
    expect(manager.isValidTransition("revoked", "pending")).toBe(true);
  });

  // Invalid transitions
  it("none → approved is invalid", () => {
    expect(manager.isValidTransition("none", "approved")).toBe(false);
  });

  it("approved → rejected is invalid (forward-only from approved)", () => {
    expect(manager.isValidTransition("approved", "rejected")).toBe(false);
  });

  it("approved → pending is invalid (cannot un-approve)", () => {
    expect(manager.isValidTransition("approved", "pending")).toBe(false);
  });

  it("pending → revoked is invalid (must go through approved/rejected first)", () => {
    expect(manager.isValidTransition("pending", "revoked")).toBe(false);
  });

  it("none → revoked is invalid", () => {
    expect(manager.isValidTransition("none", "revoked")).toBe(false);
  });

  it("rejected → approved is invalid (must re-submit)", () => {
    expect(manager.isValidTransition("rejected", "approved")).toBe(false);
  });
});

// ===========================================================================
// 15. Forward-only ledger: $imp balance not changed on revocation
// ===========================================================================

describe("Forward-only $imp ledger — revocation does not alter historical scores", () => {
  it("ImpactRecorder balance is unchanged after entity revocation", () => {
    // Create entity and a COA chain row to satisfy FK on impact_interactions
    const entity = store.createEntity({ type: "E", displayName: "Alice" });
    const coaFingerprint = "$A0.#E0.@A0.C001";
    db.prepare(`
      INSERT INTO coa_chains (fingerprint, resource_id, entity_id, node_id, chain_counter, work_type, created_at)
      VALUES (?, '$A0', ?, '@A0', 1, 'message_in', ?)
    `).run(coaFingerprint, entity.id, new Date().toISOString());

    const recorder = new ImpactRecorder(db);

    // Record impact before verification/sealing
    recorder.record({ entityId: entity.id, coaFingerprint, quant: 1, boolLabel: "0TRUE" }); // +1.0
    recorder.record({ entityId: entity.id, coaFingerprint, quant: 2, boolLabel: "TRUE" });  // +1.0

    const balanceBefore = recorder.getBalance(entity.id);

    // Go through full verification and seal
    const req = manager.submitRequest(entity.id, makeProof(entity.id));
    manager.processDecision({ requestId: req.id, reviewerId: "rev", decision: "approve" });
    manager.issueSeal(makeSealParams(entity.id));

    // Record more impact while sealed
    recorder.record({ entityId: entity.id, coaFingerprint, quant: 1, boolLabel: "0TRUE" }); // +1.0
    const balanceSealed = recorder.getBalance(entity.id);
    expect(balanceSealed).toBeCloseTo(balanceBefore + 1.0);

    // Revoke
    manager.revoke({ entityId: entity.id, revokedBy: "admin", reason: "Policy violation" });

    // Balance must be exactly the same as before revocation (forward-only ledger)
    const balanceAfterRevoke = recorder.getBalance(entity.id);
    expect(balanceAfterRevoke).toBeCloseTo(balanceSealed);
  });

  it("revocation record itself does not add an impact interaction", () => {
    const entity = store.createEntity({ type: "E", displayName: "Bob" });
    const coaFingerprint = "$A0.#E0.@A0.C002";
    db.prepare(`
      INSERT INTO coa_chains (fingerprint, resource_id, entity_id, node_id, chain_counter, work_type, created_at)
      VALUES (?, '$A0', ?, '@A0', 2, 'message_in', ?)
    `).run(coaFingerprint, entity.id, new Date().toISOString());

    const recorder = new ImpactRecorder(db);
    recorder.record({ entityId: entity.id, coaFingerprint, quant: 1, boolLabel: "0TRUE" });

    const balanceBefore = recorder.getBalance(entity.id);

    manager.submitRequest(entity.id, makeProof(entity.id));
    manager.issueSeal(makeSealParams(entity.id));
    manager.revoke({ entityId: entity.id, revokedBy: "admin", reason: "Test" });

    // Revocation only touches verification tables, not impact_interactions
    const historyCount = recorder.getHistory(entity.id).length;
    expect(historyCount).toBe(1);
    expect(recorder.getBalance(entity.id)).toBeCloseTo(balanceBefore);
  });
});
