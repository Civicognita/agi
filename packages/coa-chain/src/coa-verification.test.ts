/**
 * Tests for the Cross-Node COA Verification system.
 *
 * Covers:
 * - hash-chain.ts: HashChainBuilder, canonicalize, hashContent, signCOAHash, verifyCOASignature
 * - chain-verifier.ts: verifyChain, verifyRecordHash, verifyRecordSignature
 * - coa-api.ts: handleCOAChainRequest
 * - co-verification.ts: CoVerificationManager
 */

import { describe, it, expect, beforeEach } from "vitest";
import { generateKeyPairSync } from "node:crypto";

import {
  HashChainBuilder,
  canonicalize,
  hashContent,
  signCOAHash,
  verifyCOASignature,
  type COAHashContent,
  type HashedCOARecord,
} from "./hash-chain.js";

import {
  verifyChain,
  verifyRecordHash,
  verifyRecordSignature,
} from "./chain-verifier.js";

import {
  handleCOAChainRequest,
  type COAChainStore,
  type EntityConsentChecker,
} from "./coa-api.js";

import { CoVerificationManager, DEFAULT_THRESHOLD } from "./co-verification.js";

// ---------------------------------------------------------------------------
// Shared test keys
// ---------------------------------------------------------------------------

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const { privateKey: altPrivateKey, publicKey: altPublicKey } = generateKeyPairSync("ed25519");

const NODE_ID = "node-alpha";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildChain(
  count: number,
  nodeId: string = NODE_ID,
  privKey = privateKey,
): HashedCOARecord[] {
  const builder = new HashChainBuilder(privKey, nodeId);
  const records: HashedCOARecord[] = [];
  for (let i = 0; i < count; i++) {
    records.push(
      builder.append({
        fingerprint: `$A0.#E0.@A0.C${String(i + 1).padStart(3, "0")}`,
        nodeId,
        entityGeid: "#E0",
        workType: "message_in",
        action: "create",
        timestamp: `2025-01-01T00:00:0${i}.000Z`,
      }),
    );
  }
  return records;
}

function makeContent(overrides: Partial<COAHashContent> = {}): COAHashContent {
  return {
    fingerprint: "$A0.#E0.@A0.C001",
    nodeId: NODE_ID,
    entityGeid: "#E0",
    workType: "message_in",
    action: "create",
    payloadHash: null,
    prevHash: null,
    timestamp: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// HashChainBuilder
// ---------------------------------------------------------------------------

describe("HashChainBuilder", () => {
  it("append() creates a record with correct coaHash", () => {
    const builder = new HashChainBuilder(privateKey, NODE_ID);
    const record = builder.append({
      fingerprint: "$A0.#E0.@A0.C001",
      nodeId: NODE_ID,
      entityGeid: "#E0",
      workType: "message_in",
      action: "create",
      timestamp: "2025-01-01T00:00:00.000Z",
    });

    // The coaHash should match a recomputed hash of the record's content
    const expectedHash = hashContent({
      fingerprint: record.fingerprint,
      nodeId: record.nodeId,
      entityGeid: record.entityGeid,
      workType: record.workType,
      action: record.action,
      payloadHash: record.payloadHash,
      prevHash: record.prevHash,
      timestamp: record.timestamp,
    });

    expect(record.coaHash).toBe(expectedHash);
  });

  it("append() links records via prevHash (second record's prevHash = first record's coaHash)", () => {
    const builder = new HashChainBuilder(privateKey, NODE_ID);
    const first = builder.append({
      fingerprint: "$A0.#E0.@A0.C001",
      nodeId: NODE_ID,
      entityGeid: "#E0",
      workType: "message_in",
      action: "create",
      timestamp: "2025-01-01T00:00:00.000Z",
    });
    const second = builder.append({
      fingerprint: "$A0.#E0.@A0.C002",
      nodeId: NODE_ID,
      entityGeid: "#E0",
      workType: "message_out",
      action: "send",
      timestamp: "2025-01-01T00:00:01.000Z",
    });

    expect(second.prevHash).toBe(first.coaHash);
  });

  it("getLatestHash() returns null initially, then updates after append", () => {
    const builder = new HashChainBuilder(privateKey, NODE_ID);
    expect(builder.getLatestHash()).toBeNull();

    const record = builder.append({
      fingerprint: "$A0.#E0.@A0.C001",
      nodeId: NODE_ID,
      entityGeid: "#E0",
      workType: "message_in",
      action: "create",
      timestamp: "2025-01-01T00:00:00.000Z",
    });

    expect(builder.getLatestHash()).toBe(record.coaHash);
  });

  it("getLatestHash() updates to the most recent record after multiple appends", () => {
    const builder = new HashChainBuilder(privateKey, NODE_ID);
    builder.append({
      fingerprint: "$A0.#E0.@A0.C001",
      nodeId: NODE_ID,
      entityGeid: "#E0",
      workType: "message_in",
      action: "create",
      timestamp: "2025-01-01T00:00:00.000Z",
    });
    const second = builder.append({
      fingerprint: "$A0.#E0.@A0.C002",
      nodeId: NODE_ID,
      entityGeid: "#E0",
      workType: "message_out",
      action: "send",
      timestamp: "2025-01-01T00:00:01.000Z",
    });

    expect(builder.getLatestHash()).toBe(second.coaHash);
  });
});

// ---------------------------------------------------------------------------
// canonicalize
// ---------------------------------------------------------------------------

describe("canonicalize", () => {
  it("is deterministic (same input = same output)", () => {
    const content = makeContent();
    expect(canonicalize(content)).toBe(canonicalize(content));
  });

  it("produces alphabetically-ordered keys", () => {
    const content = makeContent();
    const json = canonicalize(content);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const keys = Object.keys(parsed);
    const sorted = [...keys].sort();
    expect(keys).toEqual(sorted);
  });

  it("treats null payloadHash and prevHash as empty string", () => {
    const withNull = makeContent({ payloadHash: null, prevHash: null });
    const json = JSON.parse(canonicalize(withNull)) as { payloadHash: string; prevHash: string };
    expect(json.payloadHash).toBe("");
    expect(json.prevHash).toBe("");
  });
});

// ---------------------------------------------------------------------------
// hashContent
// ---------------------------------------------------------------------------

describe("hashContent", () => {
  it("produces different hashes for different content", () => {
    const a = makeContent({ action: "create" });
    const b = makeContent({ action: "delete" });
    expect(hashContent(a)).not.toBe(hashContent(b));
  });

  it("produces the same hash for identical content", () => {
    const content = makeContent();
    expect(hashContent(content)).toBe(hashContent(content));
  });

  it("returns a 64-character hex string (SHA-256)", () => {
    const hash = hashContent(makeContent());
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ---------------------------------------------------------------------------
// signCOAHash / verifyCOASignature
// ---------------------------------------------------------------------------

describe("signCOAHash / verifyCOASignature", () => {
  it("produces a valid signature verifiable by verifyCOASignature()", () => {
    const coaHash = hashContent(makeContent());
    const signature = signCOAHash(coaHash, privateKey);
    expect(verifyCOASignature(coaHash, signature, publicKey)).toBe(true);
  });

  it("fails to verify with a different key", () => {
    const coaHash = hashContent(makeContent());
    const signature = signCOAHash(coaHash, privateKey);
    expect(verifyCOASignature(coaHash, signature, altPublicKey)).toBe(false);
  });

  it("fails to verify a tampered hash", () => {
    const coaHash = hashContent(makeContent());
    const signature = signCOAHash(coaHash, privateKey);
    const tamperedHash = hashContent(makeContent({ action: "delete" }));
    expect(verifyCOASignature(tamperedHash, signature, publicKey)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Chain Verifier — verifyChain
// ---------------------------------------------------------------------------

describe("verifyChain", () => {
  it("returns valid=true for a properly linked chain", () => {
    const records = buildChain(3);
    const knownKeys = new Map([[NODE_ID, publicKey]]);
    const report = verifyChain(records, { knownKeys });

    expect(report.valid).toBe(true);
    expect(report.recordCount).toBe(3);
    expect(report.validCount).toBe(3);
    expect(report.hashFailures).toBe(0);
    expect(report.linkFailures).toBe(0);
    expect(report.signatureFailures).toBe(0);
  });

  it("detects hash tampering (modified coaHash)", () => {
    const records = buildChain(3);

    // Tamper the first record's coaHash
    const tampered = records.map((r, i) =>
      i === 0 ? { ...r, coaHash: "0".repeat(64) } : r,
    );

    const knownKeys = new Map([[NODE_ID, publicKey]]);
    const report = verifyChain(tampered, { knownKeys });

    expect(report.valid).toBe(false);
    expect(report.hashFailures).toBeGreaterThan(0);
  });

  it("detects link breaks (wrong prevHash on a record)", () => {
    const records = buildChain(3);

    // Break the prevHash of the second record
    const broken = records.map((r, i) =>
      i === 1 ? { ...r, prevHash: "b".repeat(64) } : r,
    );

    const report = verifyChain(broken);
    expect(report.valid).toBe(false);
    expect(report.linkFailures).toBeGreaterThan(0);
    expect(report.gaps.length).toBeGreaterThan(0);
  });

  it("detects signature forgery (wrong key used for signing)", () => {
    // Build chain with altPrivateKey but verify against publicKey (mismatch)
    const records = buildChain(2, NODE_ID, altPrivateKey);
    const knownKeys = new Map([[NODE_ID, publicKey]]);
    const report = verifyChain(records, { knownKeys });

    expect(report.valid).toBe(false);
    expect(report.signatureFailures).toBeGreaterThan(0);
  });

  it("reports unknown signers when key not in knownKeys", () => {
    const records = buildChain(2);
    // No knownKeys provided — signers are unknown
    const report = verifyChain(records, { knownKeys: new Map() });

    expect(report.unknownSigners).toBe(2);
    // Chain is still valid in terms of hashes and links
    expect(report.hashFailures).toBe(0);
    expect(report.linkFailures).toBe(0);
  });

  it("with empty chain returns valid with zero counts", () => {
    const report = verifyChain([]);

    expect(report.valid).toBe(true);
    expect(report.recordCount).toBe(0);
    expect(report.validCount).toBe(0);
    expect(report.hashFailures).toBe(0);
    expect(report.linkFailures).toBe(0);
    expect(report.signatureFailures).toBe(0);
  });

  it("onlyFailures option filters out passing records", () => {
    const records = buildChain(3);
    const knownKeys = new Map([[NODE_ID, publicKey]]);

    // All pass — with onlyFailures, report.records should be empty
    const reportFiltered = verifyChain(records, { knownKeys, onlyFailures: true });
    expect(reportFiltered.records.length).toBe(0);

    // Without onlyFailures, all records are included
    const reportFull = verifyChain(records, { knownKeys, onlyFailures: false });
    expect(reportFull.records.length).toBe(3);
  });

  it("onlyFailures includes only failing records when there is a failure", () => {
    const records = buildChain(3);
    const broken = records.map((r, i) =>
      i === 1 ? { ...r, coaHash: "c".repeat(64) } : r,
    );
    const report = verifyChain(broken, { onlyFailures: true });

    // Only the tampered record (and the one after, which has a broken link) should appear
    expect(report.records.length).toBeGreaterThan(0);
    expect(report.records.every(r => r.error !== null)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Chain Verifier — verifyRecordHash
// ---------------------------------------------------------------------------

describe("verifyRecordHash", () => {
  it("returns true for a valid record", () => {
    const builder = new HashChainBuilder(privateKey, NODE_ID);
    const record = builder.append({
      fingerprint: "$A0.#E0.@A0.C001",
      nodeId: NODE_ID,
      entityGeid: "#E0",
      workType: "message_in",
      action: "create",
      timestamp: "2025-01-01T00:00:00.000Z",
    });

    expect(verifyRecordHash(record)).toBe(true);
  });

  it("returns false for a tampered record", () => {
    const builder = new HashChainBuilder(privateKey, NODE_ID);
    const record = builder.append({
      fingerprint: "$A0.#E0.@A0.C001",
      nodeId: NODE_ID,
      entityGeid: "#E0",
      workType: "message_in",
      action: "create",
      timestamp: "2025-01-01T00:00:00.000Z",
    });

    const tampered: HashedCOARecord = { ...record, action: "delete" };
    expect(verifyRecordHash(tampered)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Chain Verifier — verifyRecordSignature
// ---------------------------------------------------------------------------

describe("verifyRecordSignature", () => {
  it("returns true for a valid signature", () => {
    const builder = new HashChainBuilder(privateKey, NODE_ID);
    const record = builder.append({
      fingerprint: "$A0.#E0.@A0.C001",
      nodeId: NODE_ID,
      entityGeid: "#E0",
      workType: "message_in",
      action: "create",
      timestamp: "2025-01-01T00:00:00.000Z",
    });

    expect(verifyRecordSignature(record, publicKey)).toBe(true);
  });

  it("returns false when verified against the wrong public key", () => {
    const builder = new HashChainBuilder(privateKey, NODE_ID);
    const record = builder.append({
      fingerprint: "$A0.#E0.@A0.C001",
      nodeId: NODE_ID,
      entityGeid: "#E0",
      workType: "message_in",
      action: "create",
      timestamp: "2025-01-01T00:00:00.000Z",
    });

    expect(verifyRecordSignature(record, altPublicKey)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// COA API — handleCOAChainRequest
// ---------------------------------------------------------------------------

describe("handleCOAChainRequest", () => {
  const VALID_FP = "$A0.#E0.@A0.C001";
  const sampleRecords = buildChain(3);

  function makeStore(overrides?: Partial<COAChainStore>): COAChainStore {
    return {
      async getChainUpTo(_fp, _limit, _offset) {
        return sampleRecords;
      },
      async getRecord(_fp) {
        return sampleRecords[0] ?? null;
      },
      async getChainLength(_fp) {
        return sampleRecords.length;
      },
      ...overrides,
    };
  }

  function makeConsent(shareable = true): EntityConsentChecker {
    return {
      async isShareable(_fp) {
        return shareable;
      },
    };
  }

  it("returns chain data for a valid fingerprint", async () => {
    const result = await handleCOAChainRequest(
      { fingerprint: VALID_FP },
      makeStore(),
      makeConsent(true),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.fingerprint).toBe(VALID_FP);
    expect(result.data.chain).toEqual(sampleRecords);
    expect(result.data.pagination.total).toBe(3);
  });

  it("returns 403 when entity consent is denied", async () => {
    const result = await handleCOAChainRequest(
      { fingerprint: VALID_FP },
      makeStore(),
      makeConsent(false),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.status).toBe(403);
    expect(result.error.code).toBe("CONSENT_DENIED");
  });

  it("returns 404 when fingerprint not found in store", async () => {
    const notFoundStore = makeStore({
      async getChainUpTo(_fp, _limit, _offset) {
        return null;
      },
    });

    const result = await handleCOAChainRequest(
      { fingerprint: VALID_FP },
      notFoundStore,
      makeConsent(true),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.status).toBe(404);
    expect(result.error.code).toBe("NOT_FOUND");
  });

  it("respects pagination (limit and offset)", async () => {
    const paginatedStore = makeStore({
      async getChainUpTo(_fp, limit, offset) {
        return sampleRecords.slice(offset, offset + limit);
      },
      async getChainLength(_fp) {
        return 10;
      },
    });

    const result = await handleCOAChainRequest(
      { fingerprint: VALID_FP, limit: 2, offset: 0 },
      paginatedStore,
      makeConsent(true),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.pagination.limit).toBe(2);
    expect(result.data.pagination.offset).toBe(0);
    expect(result.data.pagination.total).toBe(10);
    expect(result.data.pagination.hasMore).toBe(true);
  });

  it("hasMore is false when offset + limit >= total", async () => {
    const store = makeStore({
      async getChainLength(_fp) {
        return 3;
      },
    });

    const result = await handleCOAChainRequest(
      { fingerprint: VALID_FP, limit: 5, offset: 0 },
      store,
      makeConsent(true),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.pagination.hasMore).toBe(false);
  });

  it("returns 400 for invalid fingerprint format (too few segments)", async () => {
    const result = await handleCOAChainRequest(
      { fingerprint: "$A0.#E0.@A0" },
      makeStore(),
      makeConsent(true),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.status).toBe(400);
    expect(result.error.code).toBe("INVALID_REQUEST");
  });

  it("returns 400 for empty fingerprint", async () => {
    const result = await handleCOAChainRequest(
      { fingerprint: "" },
      makeStore(),
      makeConsent(true),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.status).toBe(400);
    expect(result.error.code).toBe("INVALID_REQUEST");
  });
});

// ---------------------------------------------------------------------------
// Co-Verification Manager
// ---------------------------------------------------------------------------

describe("CoVerificationManager", () => {
  let manager: CoVerificationManager;
  const records = buildChain(2);

  beforeEach(() => {
    manager = new CoVerificationManager();
  });

  function makeResponse(
    requestId: string,
    verifierNode: string,
    vote: "confirmed" | "disputed" | "inconclusive" = "confirmed",
  ) {
    return {
      requestId,
      verifierNode,
      vote,
      chainValid: true,
      signaturesValid: true,
      anomalies: [],
      respondedAt: new Date().toISOString(),
    };
  }

  it("createRequest() creates a pending claim", () => {
    const req = manager.createRequest(
      "node-a",
      "node-d",
      "$A0.#E0.@A0.C001",
      ["node-b", "node-c", "node-e"],
      records,
    );

    expect(req.requestId).toBeTruthy();
    const claim = manager.getClaim(req.requestId)!;
    expect(claim).not.toBeNull();
    expect(claim.status).toBe("pending");
    expect(claim.requestingNode).toBe("node-a");
    expect(claim.claimNode).toBe("node-d");
    expect(claim.verifiers).toEqual(["node-b", "node-c", "node-e"]);
  });

  it("recordResponse() records a vote and returns the updated claim", () => {
    const req = manager.createRequest(
      "node-a",
      "node-d",
      "$A0.#E0.@A0.C001",
      ["node-b", "node-c", "node-e"],
      records,
    );

    const updated = manager.recordResponse(makeResponse(req.requestId, "node-b"));
    expect(updated).not.toBeNull();
    expect(updated!.responses.length).toBe(1);
  });

  it("claim becomes 'confirmed' when threshold is met", () => {
    const req = manager.createRequest(
      "node-a",
      "node-d",
      "$A0.#E0.@A0.C001",
      ["node-b", "node-c", "node-e"],
      records,
      3,
    );

    manager.recordResponse(makeResponse(req.requestId, "node-b", "confirmed"));
    manager.recordResponse(makeResponse(req.requestId, "node-c", "confirmed"));
    const result = manager.recordResponse(makeResponse(req.requestId, "node-e", "confirmed"));

    expect(result!.status).toBe("confirmed");
    expect(result!.resolvedAt).not.toBeNull();
  });

  it("claim becomes 'disputed' when majority dispute with enough responses", () => {
    const req = manager.createRequest(
      "node-a",
      "node-d",
      "$A0.#E0.@A0.C001",
      ["node-b", "node-c", "node-e", "node-f", "node-g"],
      records,
      3,
    );

    // 3 disputes out of 5 verifiers = majority, and >= threshold responses
    manager.recordResponse(makeResponse(req.requestId, "node-b", "disputed"));
    manager.recordResponse(makeResponse(req.requestId, "node-c", "disputed"));
    const result = manager.recordResponse(makeResponse(req.requestId, "node-e", "disputed"));

    expect(result!.status).toBe("disputed");
  });

  it("duplicate responses from same verifier are ignored", () => {
    const req = manager.createRequest(
      "node-a",
      "node-d",
      "$A0.#E0.@A0.C001",
      ["node-b", "node-c", "node-e"],
      records,
    );

    manager.recordResponse(makeResponse(req.requestId, "node-b", "confirmed"));
    // Same verifier again
    manager.recordResponse(makeResponse(req.requestId, "node-b", "confirmed"));

    const claim = manager.getClaim(req.requestId)!;
    expect(claim.responses.length).toBe(1);
  });

  it("responses from non-designated verifiers are ignored", () => {
    const req = manager.createRequest(
      "node-a",
      "node-d",
      "$A0.#E0.@A0.C001",
      ["node-b", "node-c"],
      records,
    );

    // node-x is not a designated verifier
    manager.recordResponse(makeResponse(req.requestId, "node-x", "confirmed"));

    const claim = manager.getClaim(req.requestId)!;
    expect(claim.responses.length).toBe(0);
  });

  it("recordResponse() returns null for unknown requestId", () => {
    const result = manager.recordResponse(makeResponse("nonexistent-id", "node-b"));
    expect(result).toBeNull();
  });

  it("expireClaims() marks overdue pending claims as expired", () => {
    const req = manager.createRequest(
      "node-a",
      "node-d",
      "$A0.#E0.@A0.C001",
      ["node-b"],
      records,
    );

    // Far future 'now' to trigger expiry
    const futureNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const expiredCount = manager.expireClaims(futureNow);

    expect(expiredCount).toBe(1);
    const claim = manager.getClaim(req.requestId)!;
    expect(claim.status).toBe("expired");
    expect(claim.resolvedAt).not.toBeNull();
  });

  it("expireClaims() does not expire already-resolved claims", () => {
    const req = manager.createRequest(
      "node-a",
      "node-d",
      "$A0.#E0.@A0.C001",
      ["node-b", "node-c", "node-e"],
      records,
      3,
    );

    // Confirm the claim first
    manager.recordResponse(makeResponse(req.requestId, "node-b", "confirmed"));
    manager.recordResponse(makeResponse(req.requestId, "node-c", "confirmed"));
    manager.recordResponse(makeResponse(req.requestId, "node-e", "confirmed"));

    const claim = manager.getClaim(req.requestId)!;
    expect(claim.status).toBe("confirmed");

    // Now try to expire
    const futureNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const expiredCount = manager.expireClaims(futureNow);

    expect(expiredCount).toBe(0);
    expect(claim.status).toBe("confirmed");
  });

  it("checkTrustUpgrade() returns eligible when criteria are met (30 days + 3 verifications)", () => {
    const nodeId = "node-candidate";
    const level2Nodes = new Set(["node-l2-a", "node-l2-b", "node-l2-c"]);

    // Register the node as first seen 35 days ago
    const firstSeen = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000);
    manager.registerNodeFirstSeen(nodeId, firstSeen.toISOString());

    // Create 3 confirmed verifications from L2 nodes
    for (let i = 0; i < 3; i++) {
      const verifier = `node-l2-${["a", "b", "c"][i]!}`;
      const req = manager.createRequest(
        "node-a",
        nodeId,
        `$A0.#E0.@A0.C00${i + 1}`,
        [verifier],
        records,
        1,
      );
      manager.recordResponse(makeResponse(req.requestId, verifier, "confirmed"));
    }

    const check = manager.checkTrustUpgrade(nodeId, level2Nodes);
    expect(check.eligible).toBe(true);
    expect(check.missing.length).toBe(0);
    expect(check.operationalDays).toBeGreaterThanOrEqual(35);
    expect(check.level2Verifications).toBe(3);
  });

  it("checkTrustUpgrade() returns not eligible when operational days insufficient", () => {
    const nodeId = "node-new";
    const level2Nodes = new Set(["node-l2-a"]);

    // Only 5 days old
    const firstSeen = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    manager.registerNodeFirstSeen(nodeId, firstSeen.toISOString());

    // Give enough verifications
    for (let i = 0; i < 3; i++) {
      const req = manager.createRequest("node-a", nodeId, `$A0.#E0.@A0.C00${i + 1}`, ["node-l2-a"], records, 1);
      manager.recordResponse(makeResponse(req.requestId, "node-l2-a", "confirmed"));
    }

    const check = manager.checkTrustUpgrade(nodeId, level2Nodes);
    expect(check.eligible).toBe(false);
    expect(check.missing.length).toBeGreaterThan(0);
    expect(check.missing[0]).toMatch(/days/);
  });

  it("checkTrustUpgrade() returns not eligible when insufficient verifications", () => {
    const nodeId = "node-unverified";
    const level2Nodes = new Set<string>();

    // Old enough
    const firstSeen = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    manager.registerNodeFirstSeen(nodeId, firstSeen.toISOString());

    // No verifications at all
    const check = manager.checkTrustUpgrade(nodeId, level2Nodes);
    expect(check.eligible).toBe(false);
    expect(check.missing.some(m => /verification/i.test(m))).toBe(true);
  });

  it("checkTrustUpgrade() returns not eligible when node has never been seen", () => {
    const nodeId = "node-unknown";
    const level2Nodes = new Set<string>();

    const check = manager.checkTrustUpgrade(nodeId, level2Nodes);
    expect(check.eligible).toBe(false);
    expect(check.operationalDays).toBe(0);
  });

  it("registerNodeFirstSeen() only stores the first timestamp", () => {
    const nodeId = "node-test";

    const firstTime = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
    const laterTime = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();

    manager.registerNodeFirstSeen(nodeId, firstTime);
    manager.registerNodeFirstSeen(nodeId, laterTime);

    // The check should reflect the first timestamp (20 days), not the second (5 days)
    const check = manager.checkTrustUpgrade(nodeId, new Set());
    expect(check.operationalDays).toBeGreaterThanOrEqual(19);
  });

  it("DEFAULT_THRESHOLD is 3", () => {
    expect(DEFAULT_THRESHOLD).toBe(3);
  });
});
