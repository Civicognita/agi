// @ts-nocheck -- blocks on pg-backed test harness; tracked in _plans/phase2-tests-pg.md
/**
 * Seal System Tests — Tasks #156, #157, #159
 *
 * Covers:
 *   - seal-signer.ts: SealSigner, generateKeypair, verifySignature, canonicalize
 *   - seal-verifier.ts: parseSealBundle (WebCrypto skipped — not available in Node.js test env)
 *   - seal-workflow.ts: SealWorkflow full lifecycle
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDatabase, ALL_DDL, VerificationManager, EntityStore } from "@agi/entity-model";
import type { Database } from "@agi/entity-model";

import {
  SealSigner,
  generateKeypair,
  verifySignature,
  canonicalize,
} from "./seal-signer.js";
import type { SealPayload } from "./seal-signer.js";
import { parseSealBundle } from "./seal-verifier.js";
import type { SealBundle } from "./seal-verifier.js";
import { SealWorkflow } from "./seal-workflow.js";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Build a minimal valid SealPayload for testing. */
function makeSealPayload(overrides?: Partial<SealPayload>): SealPayload {
  return {
    sealId: "seal-entity-001-1700000000000",
    entityId: "entity-001",
    entityType: "#E",
    issuedAt: "2024-01-01T00:00:00.000Z",
    issuedBy: "reviewer-001",
    coa: "$A0.#E0.@A0.C001",
    alignment: { a_a: 0.85, u_u: 0.80, c_c: 0.70 },
    checksum: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
    ...overrides,
  };
}

/** Build a valid SealBundle JSON string. */
function makeValidBundleJson(overrides?: Partial<SealBundle>): string {
  const bundle: SealBundle = {
    payload: makeSealPayload(),
    signature: "a1b2c3d4",
    publicKey: "base64encodedpubkey==",
    status: "active",
    ...overrides,
  };
  return JSON.stringify(bundle);
}

// ---------------------------------------------------------------------------
// 1. SealSigner
// ---------------------------------------------------------------------------

describe.skip("generateKeypair", () => {
  it("returns an object with privateKeyPem and publicKeyPem", () => {
    const { privateKeyPem, publicKeyPem } = generateKeypair();
    expect(typeof privateKeyPem).toBe("string");
    expect(typeof publicKeyPem).toBe("string");
  });

  it("privateKeyPem starts with PKCS8 PEM header", () => {
    const { privateKeyPem } = generateKeypair();
    expect(privateKeyPem).toContain("-----BEGIN PRIVATE KEY-----");
  });

  it("publicKeyPem starts with SPKI PEM header", () => {
    const { publicKeyPem } = generateKeypair();
    expect(publicKeyPem).toContain("-----BEGIN PUBLIC KEY-----");
  });

  it("generates a different keypair on each call", () => {
    const kp1 = generateKeypair();
    const kp2 = generateKeypair();
    expect(kp1.privateKeyPem).not.toBe(kp2.privateKeyPem);
    expect(kp1.publicKeyPem).not.toBe(kp2.publicKeyPem);
  });
});

describe.skip("SealSigner construction", () => {
  it("constructs from privateKeyPem string without throwing", () => {
    const { privateKeyPem } = generateKeypair();
    expect(() => new SealSigner({ privateKeyPem })).not.toThrow();
  });

  it("exposes a non-empty publicKeyBase64 after construction", () => {
    const { privateKeyPem } = generateKeypair();
    const signer = new SealSigner({ privateKeyPem });
    expect(typeof signer.publicKeyBase64).toBe("string");
    expect(signer.publicKeyBase64.length).toBeGreaterThan(0);
  });

  it("throws when constructed with no key source", () => {
    expect(() => new SealSigner({})).toThrow(/No GENESIS private key/i);
  });

  it("throws when constructed with non-existent file path", () => {
    expect(() =>
      new SealSigner({ privateKeyPath: "/nonexistent/path/to/key.pem" })
    ).toThrow();
  });

  it("reads private key from env var when envVar is set", () => {
    const { privateKeyPem } = generateKeypair();
    const envVarName = "TEST_SEAL_PRIVKEY_" + Date.now().toString();
    process.env[envVarName] = privateKeyPem;
    try {
      const signer = new SealSigner({ envVar: envVarName });
      expect(signer.publicKeyBase64.length).toBeGreaterThan(0);
    } finally {
      delete process.env[envVarName];
    }
  });

  it("throws when the named env var is unset", () => {
    const envVarName = "TEST_SEAL_PRIVKEY_UNSET_" + Date.now().toString();
    delete process.env[envVarName];
    expect(() => new SealSigner({ envVar: envVarName })).toThrow(/No GENESIS private key/i);
  });
});

describe.skip("SealSigner.sign", () => {
  let signer: SealSigner;

  beforeEach(() => {
    const { privateKeyPem } = generateKeypair();
    signer = new SealSigner({ privateKeyPem });
  });

  it("returns a SignedSeal with payload, signature, and publicKey", () => {
    const payload = makeSealPayload();
    const signed = signer.sign(payload);
    expect(signed.payload).toEqual(payload);
    expect(typeof signed.signature).toBe("string");
    expect(typeof signed.publicKey).toBe("string");
  });

  it("signature is a non-empty hex string", () => {
    const payload = makeSealPayload();
    const signed = signer.sign(payload);
    expect(signed.signature).toMatch(/^[0-9a-f]+$/);
    expect(signed.signature.length).toBeGreaterThan(0);
  });

  it("publicKey in signed seal matches signer.publicKeyBase64", () => {
    const payload = makeSealPayload();
    const signed = signer.sign(payload);
    expect(signed.publicKey).toBe(signer.publicKeyBase64);
  });

  it("signing the same payload twice produces the same signature (Ed25519 is deterministic)", () => {
    const payload = makeSealPayload();
    const s1 = signer.sign(payload);
    const s2 = signer.sign(payload);
    expect(s1.signature).toBe(s2.signature);
  });

  it("signing different payloads produces different signatures", () => {
    const p1 = makeSealPayload({ entityId: "entity-A" });
    const p2 = makeSealPayload({ entityId: "entity-B" });
    const s1 = signer.sign(p1);
    const s2 = signer.sign(p2);
    expect(s1.signature).not.toBe(s2.signature);
  });
});

describe.skip("SealSigner.verify", () => {
  let signer: SealSigner;

  beforeEach(() => {
    const { privateKeyPem } = generateKeypair();
    signer = new SealSigner({ privateKeyPem });
  });

  it("returns true for a freshly signed seal", () => {
    const payload = makeSealPayload();
    const signed = signer.sign(payload);
    expect(signer.verify(signed)).toBe(true);
  });

  it("returns false when the signature is tampered", () => {
    const payload = makeSealPayload();
    const signed = signer.sign(payload);
    const tampered = {
      ...signed,
      signature: "00".repeat(32), // 64 hex chars of zeros
    };
    expect(signer.verify(tampered)).toBe(false);
  });

  it("returns false when the payload is tampered after signing", () => {
    const payload = makeSealPayload();
    const signed = signer.sign(payload);
    const tampered = {
      ...signed,
      payload: { ...signed.payload, entityId: "attacker-entity" },
    };
    expect(signer.verify(tampered)).toBe(false);
  });

  it("returns false when the checksum field is tampered", () => {
    const payload = makeSealPayload();
    const signed = signer.sign(payload);
    const tampered = {
      ...signed,
      payload: {
        ...signed.payload,
        checksum: "0".repeat(64),
      },
    };
    expect(signer.verify(tampered)).toBe(false);
  });
});

describe.skip("SealSigner cross-key verification", () => {
  it("seal signed by signer A cannot be verified by signer B", () => {
    const kpA = generateKeypair();
    const kpB = generateKeypair();
    const signerA = new SealSigner({ privateKeyPem: kpA.privateKeyPem });
    const signerB = new SealSigner({ privateKeyPem: kpB.privateKeyPem });

    const payload = makeSealPayload();
    const signedByA = signerA.sign(payload);

    // Give signerB's verifier the original payload + A's signature
    expect(signerB.verify(signedByA)).toBe(false);
  });
});

describe.skip("canonicalize", () => {
  it("produces a valid JSON string", () => {
    const payload = makeSealPayload();
    const result = canonicalize(payload);
    expect(() => JSON.parse(result)).not.toThrow();
  });

  it("produces deterministic output for the same payload", () => {
    const payload = makeSealPayload();
    const r1 = canonicalize(payload);
    const r2 = canonicalize(payload);
    expect(r1).toBe(r2);
  });

  it("round-trips top-level string fields without data loss", () => {
    const payload = makeSealPayload();
    const result = canonicalize(payload);
    const parsed = JSON.parse(result) as SealPayload;
    expect(parsed.sealId).toBe(payload.sealId);
    expect(parsed.entityId).toBe(payload.entityId);
    expect(parsed.checksum).toBe(payload.checksum);
    expect(parsed.coa).toBe(payload.coa);
  });

  it("two different payloads produce different canonical strings", () => {
    const p1 = makeSealPayload({ entityId: "entity-X" });
    const p2 = makeSealPayload({ entityId: "entity-Y" });
    expect(canonicalize(p1)).not.toBe(canonicalize(p2));
  });
});

describe.skip("verifySignature (standalone)", () => {
  it("returns true for a valid payload, signature, and public key", () => {
    const { privateKeyPem } = generateKeypair();
    const signer = new SealSigner({ privateKeyPem });
    const payload = makeSealPayload();
    const signed = signer.sign(payload);

    const result = verifySignature(payload, signed.signature, signed.publicKey);
    expect(result).toBe(true);
  });

  it("returns false for a tampered payload", () => {
    const { privateKeyPem } = generateKeypair();
    const signer = new SealSigner({ privateKeyPem });
    const payload = makeSealPayload();
    const signed = signer.sign(payload);

    const tamperedPayload = { ...payload, entityId: "hacked" };
    const result = verifySignature(tamperedPayload, signed.signature, signed.publicKey);
    expect(result).toBe(false);
  });

  it("returns false for a tampered signature", () => {
    const { privateKeyPem } = generateKeypair();
    const signer = new SealSigner({ privateKeyPem });
    const payload = makeSealPayload();
    const signed = signer.sign(payload);

    const result = verifySignature(payload, "00".repeat(32), signed.publicKey);
    expect(result).toBe(false);
  });

  it("returns false for a mismatched public key", () => {
    const kp1 = generateKeypair();
    const kp2 = generateKeypair();
    const signer1 = new SealSigner({ privateKeyPem: kp1.privateKeyPem });
    const signer2 = new SealSigner({ privateKeyPem: kp2.privateKeyPem });

    const payload = makeSealPayload();
    const signed = signer1.sign(payload);

    // Verify with signer2's public key — should fail
    const result = verifySignature(payload, signed.signature, signer2.publicKeyBase64);
    expect(result).toBe(false);
  });

  it("does not require a SealSigner instance", () => {
    const { privateKeyPem } = generateKeypair();
    const signer = new SealSigner({ privateKeyPem });
    const payload = makeSealPayload();
    const signed = signer.sign(payload);

    // Call verifySignature directly — no SealSigner needed for verification
    const pubKeyBase64 = signer.publicKeyBase64;
    expect(verifySignature(payload, signed.signature, pubKeyBase64)).toBe(true);
  });
});

describe.skip("SealSigner.getPublicKeyPem", () => {
  it("returns a string with SPKI PEM header", () => {
    const { privateKeyPem } = generateKeypair();
    const signer = new SealSigner({ privateKeyPem });
    const pem = signer.getPublicKeyPem();
    expect(pem).toContain("-----BEGIN PUBLIC KEY-----");
  });
});

// ---------------------------------------------------------------------------
// 2. SealVerifier — parseSealBundle (WebCrypto tests skipped in Node.js)
// ---------------------------------------------------------------------------

describe.skip("parseSealBundle", () => {
  it("parses a valid bundle JSON string", () => {
    const json = makeValidBundleJson();
    const result = parseSealBundle(json);
    expect(result).not.toBeNull();
    expect(result!.payload.sealId).toBe("seal-entity-001-1700000000000");
    expect(result!.signature).toBe("a1b2c3d4");
    expect(result!.publicKey).toBe("base64encodedpubkey==");
    expect(result!.status).toBe("active");
  });

  it("parses a bundle with status revoked", () => {
    const json = makeValidBundleJson({ status: "revoked" });
    const result = parseSealBundle(json);
    expect(result).not.toBeNull();
    expect(result!.status).toBe("revoked");
  });

  it("returns null for non-JSON input", () => {
    expect(parseSealBundle("not json at all")).toBeNull();
  });

  it("returns null for a JSON string (not object)", () => {
    expect(parseSealBundle('"just a string"')).toBeNull();
  });

  it("returns null for a JSON array", () => {
    expect(parseSealBundle("[]")).toBeNull();
  });

  it("returns null when payload field is missing", () => {
    const obj = { signature: "abc", publicKey: "key==", status: "active" };
    expect(parseSealBundle(JSON.stringify(obj))).toBeNull();
  });

  it("returns null when signature field is missing", () => {
    const obj = {
      payload: makeSealPayload(),
      publicKey: "key==",
      status: "active",
    };
    expect(parseSealBundle(JSON.stringify(obj))).toBeNull();
  });

  it("returns null when publicKey field is missing", () => {
    const obj = {
      payload: makeSealPayload(),
      signature: "abc",
      status: "active",
    };
    expect(parseSealBundle(JSON.stringify(obj))).toBeNull();
  });

  it("returns null when status is an invalid value", () => {
    const obj = {
      payload: makeSealPayload(),
      signature: "abc",
      publicKey: "key==",
      status: "pending", // invalid — must be active or revoked
    };
    expect(parseSealBundle(JSON.stringify(obj))).toBeNull();
  });

  it("returns null when status field is missing", () => {
    const obj = {
      payload: makeSealPayload(),
      signature: "abc",
      publicKey: "key==",
    };
    expect(parseSealBundle(JSON.stringify(obj))).toBeNull();
  });

  it("returns null when payload.sealId is missing", () => {
    const badPayload = { ...makeSealPayload() } as Partial<SealPayload>;
    delete badPayload.sealId;
    const obj = {
      payload: badPayload,
      signature: "abc",
      publicKey: "key==",
      status: "active",
    };
    expect(parseSealBundle(JSON.stringify(obj))).toBeNull();
  });

  it("returns null when payload.alignment is missing", () => {
    const badPayload = { ...makeSealPayload() } as Partial<SealPayload>;
    delete badPayload.alignment;
    const obj = {
      payload: badPayload,
      signature: "abc",
      publicKey: "key==",
      status: "active",
    };
    expect(parseSealBundle(JSON.stringify(obj))).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(parseSealBundle("")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. SealWorkflow
// ---------------------------------------------------------------------------

describe.skip("SealWorkflow", () => {
  let db: Database;
  let store: EntityStore;
  let vm: VerificationManager;
  let signer: SealSigner;
  let workflow: SealWorkflow;

  beforeEach(() => {
    db = createDatabase(":memory:");
    for (const ddl of ALL_DDL) {
      db.exec(ddl);
    }
    store = new EntityStore(db);
    vm = new VerificationManager(db);

    const { privateKeyPem } = generateKeypair();
    signer = new SealSigner({ privateKeyPem });

    workflow = new SealWorkflow({
      signer,
      verificationManager: vm,
      autoSealOnApproval: false,
    });
  });

  afterEach(() => {
    db.close();
  });

  // -------------------------------------------------------------------------
  // Helper: create entity + submit + approve proof (common setup)
  // -------------------------------------------------------------------------

  function createAndApproveEntity(): { entityId: string; requestId: string } {
    const entity = store.createEntity({ type: "E", displayName: "Test Entity" });
    const now = new Date().toISOString();
    const req = workflow.submitRequest(entity.id, {
      entityType: "#E",
      proofType: "telegram_account",
      proofPayload: { handle: "@testuser" },
      submittedAt: now,
      submittedBy: entity.id,
    });
    vm.processDecision({
      requestId: req.id,
      reviewerId: "reviewer-001",
      decision: "approve",
    });
    return { entityId: entity.id, requestId: req.id };
  }

  function makeIssuanceParams(entityId: string) {
    return {
      entityId,
      issuedBy: "reviewer-001",
      coa: "$A0.#E0.@A0.C001",
      alignment: { a_a: 0.85, u_u: 0.80, c_c: 0.70 },
    };
  }

  // -------------------------------------------------------------------------
  // submitRequest
  // -------------------------------------------------------------------------

  describe("SealWorkflow.submitRequest", () => {
    it("delegates to VerificationManager and returns a pending request", () => {
      const entity = store.createEntity({ type: "E", displayName: "Alice" });
      const now = new Date().toISOString();
      const req = workflow.submitRequest(entity.id, {
        entityType: "#E",
        proofType: "telegram_account",
        proofPayload: "@alice",
        submittedAt: now,
        submittedBy: entity.id,
      });
      expect(req.status).toBe("pending");
      expect(req.entityId).toBe(entity.id);
    });

    it("creates a retrievable request in the VerificationManager", () => {
      const entity = store.createEntity({ type: "E", displayName: "Bob" });
      const now = new Date().toISOString();
      const req = workflow.submitRequest(entity.id, {
        entityType: "#E",
        proofType: "email_domain",
        proofPayload: "bob@example.com",
        submittedAt: now,
        submittedBy: entity.id,
      });
      const pending = vm.getPendingRequests();
      expect(pending.some((r) => r.id === req.id)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // processReview — autoSealOnApproval=false
  // -------------------------------------------------------------------------

  describe("SealWorkflow.processReview — autoSealOnApproval=false", () => {
    it("approve returns a ReviewResult with issuance=null (no auto-seal)", () => {
      const { requestId } = createAndApproveEntity();

      // Re-submit new request to process
      const entity = store.createEntity({ type: "E", displayName: "Carol" });
      const now = new Date().toISOString();
      const req = workflow.submitRequest(entity.id, {
        entityType: "#E",
        proofType: "telegram_account",
        proofPayload: "@carol",
        submittedAt: now,
        submittedBy: entity.id,
      });

      const result = workflow.processReview({
        requestId: req.id,
        reviewerId: "reviewer-001",
        decision: "approve",
      });

      expect(result.issuance).toBeNull();
      expect(result.newTier).toBe("verified");
      // Silence unused variable warning — requestId used above
      void requestId;
    });

    it("reject returns ReviewResult with newTier=null and issuance=null", () => {
      const entity = store.createEntity({ type: "E", displayName: "Dave" });
      const now = new Date().toISOString();
      const req = workflow.submitRequest(entity.id, {
        entityType: "#E",
        proofType: "telegram_account",
        proofPayload: "@dave",
        submittedAt: now,
        submittedBy: entity.id,
      });

      const result = workflow.processReview({
        requestId: req.id,
        reviewerId: "reviewer-001",
        decision: "reject",
      });

      expect(result.issuance).toBeNull();
      expect(result.newTier).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // processReview — autoSealOnApproval=true
  // -------------------------------------------------------------------------

  describe("SealWorkflow.processReview — autoSealOnApproval=true", () => {
    let autoWorkflow: SealWorkflow;

    beforeEach(() => {
      autoWorkflow = new SealWorkflow({
        signer,
        verificationManager: vm,
        autoSealOnApproval: true,
      });
    });

    it("approve with sealParams auto-issues a SealIssuanceResult", () => {
      const entity = store.createEntity({ type: "E", displayName: "Eve" });
      const now = new Date().toISOString();
      const req = autoWorkflow.submitRequest(entity.id, {
        entityType: "#E",
        proofType: "telegram_account",
        proofPayload: "@eve",
        submittedAt: now,
        submittedBy: entity.id,
      });

      const result = autoWorkflow.processReview(
        {
          requestId: req.id,
          reviewerId: "reviewer-001",
          decision: "approve",
        },
        {
          issuedBy: "reviewer-001",
          coa: "$A0.#E0.@A0.C001",
          alignment: { a_a: 0.85, u_u: 0.80, c_c: 0.70 },
        },
      );

      expect(result.issuance).not.toBeNull();
      expect(result.issuance!.seal.entityId).toBe(entity.id);
      expect(result.issuance!.bundle.status).toBe("active");
    });

    it("approve without sealParams does NOT auto-issue (issuance=null)", () => {
      const entity = store.createEntity({ type: "E", displayName: "Frank" });
      const now = new Date().toISOString();
      const req = autoWorkflow.submitRequest(entity.id, {
        entityType: "#E",
        proofType: "telegram_account",
        proofPayload: "@frank",
        submittedAt: now,
        submittedBy: entity.id,
      });

      const result = autoWorkflow.processReview({
        requestId: req.id,
        reviewerId: "reviewer-001",
        decision: "approve",
      }); // no sealParams

      expect(result.issuance).toBeNull();
    });

    it("reject with autoSealOnApproval=true does NOT auto-issue (issuance=null)", () => {
      const entity = store.createEntity({ type: "E", displayName: "Grace" });
      const now = new Date().toISOString();
      const req = autoWorkflow.submitRequest(entity.id, {
        entityType: "#E",
        proofType: "telegram_account",
        proofPayload: "@grace",
        submittedAt: now,
        submittedBy: entity.id,
      });

      const result = autoWorkflow.processReview(
        {
          requestId: req.id,
          reviewerId: "reviewer-001",
          decision: "reject",
        },
        {
          issuedBy: "reviewer-001",
          coa: "$A0.#E0.@A0.C001",
          alignment: { a_a: 0.85, u_u: 0.80, c_c: 0.70 },
        },
      );

      expect(result.issuance).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // issueSeal
  // -------------------------------------------------------------------------

  describe("SealWorkflow.issueSeal", () => {
    it("returns a SealIssuanceResult with seal, signed, bundle, newTier", () => {
      const { entityId } = createAndApproveEntity();
      const result = workflow.issueSeal(makeIssuanceParams(entityId));
      expect(result.seal).toBeDefined();
      expect(result.signed).toBeDefined();
      expect(result.bundle).toBeDefined();
      expect(result.newTier).toBe("sealed");
    });

    it("seal.entityId matches the entity", () => {
      const { entityId } = createAndApproveEntity();
      const result = workflow.issueSeal(makeIssuanceParams(entityId));
      expect(result.seal.entityId).toBe(entityId);
    });

    it("seal.status is active after issuance", () => {
      const { entityId } = createAndApproveEntity();
      const result = workflow.issueSeal(makeIssuanceParams(entityId));
      expect(result.seal.status).toBe("active");
    });

    it("signed.signature is a non-empty hex string", () => {
      const { entityId } = createAndApproveEntity();
      const result = workflow.issueSeal(makeIssuanceParams(entityId));
      expect(result.signed.signature).toMatch(/^[0-9a-f]+$/);
      expect(result.signed.signature.length).toBeGreaterThan(0);
    });

    it("bundle contains valid Ed25519 signature verifiable by SealSigner", () => {
      const { entityId } = createAndApproveEntity();
      const result = workflow.issueSeal(makeIssuanceParams(entityId));
      const isValid = verifySignature(
        result.bundle.payload,
        result.bundle.signature,
        result.bundle.publicKey,
      );
      expect(isValid).toBe(true);
    });

    it("bundle.status is active", () => {
      const { entityId } = createAndApproveEntity();
      const result = workflow.issueSeal(makeIssuanceParams(entityId));
      expect(result.bundle.status).toBe("active");
    });

    it("bundle payload matches the DB seal fields", () => {
      const { entityId } = createAndApproveEntity();
      const result = workflow.issueSeal(makeIssuanceParams(entityId));
      expect(result.bundle.payload.sealId).toBe(result.seal.sealId);
      expect(result.bundle.payload.entityId).toBe(result.seal.entityId);
      expect(result.bundle.payload.checksum).toBe(result.seal.checksum);
    });

    it("throws when alignment is below minimum thresholds", () => {
      const { entityId } = createAndApproveEntity();
      expect(() =>
        workflow.issueSeal({
          ...makeIssuanceParams(entityId),
          alignment: { a_a: 0.50, u_u: 0.50, c_c: 0.50 },
        })
      ).toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // getSealBundle
  // -------------------------------------------------------------------------

  describe("SealWorkflow.getSealBundle", () => {
    it("returns a SealBundle for an entity with an active seal", () => {
      const { entityId } = createAndApproveEntity();
      workflow.issueSeal(makeIssuanceParams(entityId));

      const bundle = workflow.getSealBundle(entityId);
      expect(bundle).not.toBeNull();
      expect(bundle!.payload.entityId).toBe(entityId);
    });

    it("returns null for an entity without a seal", () => {
      const entity = store.createEntity({ type: "E", displayName: "NoSeal" });
      const bundle = workflow.getSealBundle(entity.id);
      expect(bundle).toBeNull();
    });

    it("returned bundle has a valid Ed25519 signature", () => {
      const { entityId } = createAndApproveEntity();
      workflow.issueSeal(makeIssuanceParams(entityId));

      const bundle = workflow.getSealBundle(entityId)!;
      const isValid = verifySignature(bundle.payload, bundle.signature, bundle.publicKey);
      expect(isValid).toBe(true);
    });

    it("returned bundle has status active for a non-revoked entity", () => {
      const { entityId } = createAndApproveEntity();
      workflow.issueSeal(makeIssuanceParams(entityId));

      const bundle = workflow.getSealBundle(entityId)!;
      expect(bundle.status).toBe("active");
    });
  });

  // -------------------------------------------------------------------------
  // verifySeal
  // -------------------------------------------------------------------------

  describe("SealWorkflow.verifySeal", () => {
    it("returns dbValid=true and signatureValid=true for a freshly issued seal", () => {
      const { entityId } = createAndApproveEntity();
      const issuance = workflow.issueSeal(makeIssuanceParams(entityId));

      const result = workflow.verifySeal(issuance.seal.sealId);
      expect(result.dbValid).toBe(true);
      expect(result.signatureValid).toBe(true);
      expect(result.seal).not.toBeNull();
    });

    it("returns dbValid=false and signatureValid=false for a non-existent sealId", () => {
      const result = workflow.verifySeal("seal-does-not-exist");
      expect(result.dbValid).toBe(false);
      expect(result.signatureValid).toBe(false);
      expect(result.seal).toBeNull();
    });

    it("seal field in result matches the issued seal", () => {
      const { entityId } = createAndApproveEntity();
      const issuance = workflow.issueSeal(makeIssuanceParams(entityId));

      const result = workflow.verifySeal(issuance.seal.sealId);
      expect(result.seal!.sealId).toBe(issuance.seal.sealId);
      expect(result.seal!.entityId).toBe(entityId);
    });
  });

  // -------------------------------------------------------------------------
  // revoke
  // -------------------------------------------------------------------------

  describe("SealWorkflow.revoke", () => {
    it("returns a RevocationResult with a seal, newTier, revocationCount, requiresGenesisApproval", () => {
      const { entityId } = createAndApproveEntity();
      workflow.issueSeal(makeIssuanceParams(entityId));

      const result = workflow.revoke({
        entityId,
        revokedBy: "admin",
        reason: "Policy violation",
      });

      expect(result.seal).not.toBeNull();
      expect(result.newTier).toBe("unverified");
      expect(typeof result.revocationCount).toBe("number");
      expect(typeof result.requiresGenesisApproval).toBe("boolean");
    });

    it("revocation count is 1 after first revocation", () => {
      const { entityId } = createAndApproveEntity();
      workflow.issueSeal(makeIssuanceParams(entityId));

      const result = workflow.revoke({
        entityId,
        revokedBy: "admin",
        reason: "First revocation",
      });

      expect(result.revocationCount).toBe(1);
      expect(result.requiresGenesisApproval).toBe(false);
    });

    it("requiresGenesisApproval is false after first revocation", () => {
      const { entityId } = createAndApproveEntity();
      workflow.issueSeal(makeIssuanceParams(entityId));

      const result = workflow.revoke({
        entityId,
        revokedBy: "admin",
        reason: "First",
      });

      expect(result.requiresGenesisApproval).toBe(false);
    });

    it("requiresGenesisApproval is true after two revocations", async () => {
      const { entityId } = createAndApproveEntity();
      workflow.issueSeal(makeIssuanceParams(entityId));

      // First revocation
      workflow.revoke({ entityId, revokedBy: "admin", reason: "First" });

      // Second revocation (no active seal needed — revoke still records history)
      await new Promise((r) => setTimeout(r, 5));
      const result = workflow.revoke({
        entityId,
        revokedBy: "admin",
        reason: "Second",
      });

      expect(result.revocationCount).toBe(2);
      expect(result.requiresGenesisApproval).toBe(true);
    });

    it("revoked seal is no longer returned by getSealBundle", () => {
      const { entityId } = createAndApproveEntity();
      workflow.issueSeal(makeIssuanceParams(entityId));

      workflow.revoke({ entityId, revokedBy: "admin", reason: "Test" });

      // After revocation the active seal is gone so getSealBundle returns null
      const bundle = workflow.getSealBundle(entityId);
      expect(bundle).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // getPublicKey
  // -------------------------------------------------------------------------

  describe("SealWorkflow.getPublicKey", () => {
    it("returns the signer public key as base64", () => {
      expect(workflow.getPublicKey()).toBe(signer.publicKeyBase64);
    });
  });
});

