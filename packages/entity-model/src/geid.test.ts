import { describe, it, expect } from "vitest";
import {
  generateEntityKeypair,
  deriveGEID,
  isValidGEID,
  extractPublicKeyBase58,
  signIdentityStatement,
  verifyIdentityStatement,
  publicKeyFromGEID,
  GEID_PREFIX,
} from "./geid.js";
import type { GEID } from "./geid.js";

// ---------------------------------------------------------------------------
// GEID_PREFIX constant
// ---------------------------------------------------------------------------

describe("GEID_PREFIX", () => {
  it("is the string 'geid:'", () => {
    expect(GEID_PREFIX).toBe("geid:");
  });

  it("has length 5", () => {
    expect(GEID_PREFIX.length).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// generateEntityKeypair
// ---------------------------------------------------------------------------

describe("generateEntityKeypair — structure", () => {
  it("returns an object with all four required fields", () => {
    const kp = generateEntityKeypair();
    expect(kp).toHaveProperty("privateKeyPem");
    expect(kp).toHaveProperty("publicKeyPem");
    expect(kp).toHaveProperty("geid");
    expect(kp).toHaveProperty("publicKeyBase58");
  });

  it("privateKeyPem is a PEM-encoded PKCS8 private key", () => {
    const { privateKeyPem } = generateEntityKeypair();
    expect(privateKeyPem).toContain("-----BEGIN PRIVATE KEY-----");
    expect(privateKeyPem).toContain("-----END PRIVATE KEY-----");
  });

  it("publicKeyPem is a PEM-encoded SPKI public key", () => {
    const { publicKeyPem } = generateEntityKeypair();
    expect(publicKeyPem).toContain("-----BEGIN PUBLIC KEY-----");
    expect(publicKeyPem).toContain("-----END PUBLIC KEY-----");
  });

  it("geid starts with 'geid:'", () => {
    const { geid } = generateEntityKeypair();
    expect(geid.startsWith("geid:")).toBe(true);
  });

  it("geid has a non-empty base58 part after the prefix", () => {
    const { geid } = generateEntityKeypair();
    const base58Part = geid.slice(GEID_PREFIX.length);
    expect(base58Part.length).toBeGreaterThan(0);
  });

  it("publicKeyBase58 matches the base58 portion of the geid", () => {
    const { geid, publicKeyBase58 } = generateEntityKeypair();
    const base58Part = geid.slice(GEID_PREFIX.length);
    expect(base58Part).toBe(publicKeyBase58);
  });

  it("publicKeyBase58 contains only valid base58 characters", () => {
    const { publicKeyBase58 } = generateEntityKeypair();
    const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    for (const char of publicKeyBase58) {
      expect(BASE58_ALPHABET).toContain(char);
    }
  });
});

describe("generateEntityKeypair — uniqueness", () => {
  it("two calls produce different privateKeyPem values", () => {
    const kp1 = generateEntityKeypair();
    const kp2 = generateEntityKeypair();
    expect(kp1.privateKeyPem).not.toBe(kp2.privateKeyPem);
  });

  it("two calls produce different publicKeyPem values", () => {
    const kp1 = generateEntityKeypair();
    const kp2 = generateEntityKeypair();
    expect(kp1.publicKeyPem).not.toBe(kp2.publicKeyPem);
  });

  it("two calls produce different GEIDs", () => {
    const kp1 = generateEntityKeypair();
    const kp2 = generateEntityKeypair();
    expect(kp1.geid).not.toBe(kp2.geid);
  });

  it("two calls produce different publicKeyBase58 values", () => {
    const kp1 = generateEntityKeypair();
    const kp2 = generateEntityKeypair();
    expect(kp1.publicKeyBase58).not.toBe(kp2.publicKeyBase58);
  });
});

// ---------------------------------------------------------------------------
// deriveGEID
// ---------------------------------------------------------------------------

describe("deriveGEID", () => {
  it("returns the same GEID as generateEntityKeypair for the same key", () => {
    const { publicKeyPem, geid } = generateEntityKeypair();
    const derived = deriveGEID(publicKeyPem);
    expect(derived).toBe(geid);
  });

  it("is deterministic — same public key always produces same GEID", () => {
    const { publicKeyPem } = generateEntityKeypair();
    const d1 = deriveGEID(publicKeyPem);
    const d2 = deriveGEID(publicKeyPem);
    expect(d1).toBe(d2);
  });

  it("different public keys produce different GEIDs", () => {
    const kp1 = generateEntityKeypair();
    const kp2 = generateEntityKeypair();
    expect(deriveGEID(kp1.publicKeyPem)).not.toBe(deriveGEID(kp2.publicKeyPem));
  });

  it("returned GEID starts with 'geid:'", () => {
    const { publicKeyPem } = generateEntityKeypair();
    expect(deriveGEID(publicKeyPem).startsWith("geid:")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isValidGEID
// ---------------------------------------------------------------------------

describe("isValidGEID — valid cases", () => {
  it("returns true for a freshly generated GEID", () => {
    const { geid } = generateEntityKeypair();
    expect(isValidGEID(geid)).toBe(true);
  });

  it("returns true for a GEID derived from a public key", () => {
    const { publicKeyPem } = generateEntityKeypair();
    const geid = deriveGEID(publicKeyPem);
    expect(isValidGEID(geid)).toBe(true);
  });

  it("accepts a manually constructed GEID with a 30-char base58 suffix", () => {
    const validBase58 = "123456789ABCDEFGHJKLMNPQRSTUVWx"; // 31 valid chars
    const geid = `geid:${validBase58}`;
    expect(isValidGEID(geid)).toBe(true);
  });
});

describe("isValidGEID — invalid cases", () => {
  it("returns false for an empty string", () => {
    expect(isValidGEID("")).toBe(false);
  });

  it("returns false when prefix is missing", () => {
    const { publicKeyBase58 } = generateEntityKeypair();
    expect(isValidGEID(publicKeyBase58)).toBe(false);
  });

  it("returns false when prefix is wrong ('uuid:' instead of 'geid:')", () => {
    const { publicKeyBase58 } = generateEntityKeypair();
    expect(isValidGEID(`uuid:${publicKeyBase58}`)).toBe(false);
  });

  it("returns false when prefix is 'GEID:' (wrong case)", () => {
    const { publicKeyBase58 } = generateEntityKeypair();
    expect(isValidGEID(`GEID:${publicKeyBase58}`)).toBe(false);
  });

  it("returns false when base58 part is too short (less than 20 chars)", () => {
    expect(isValidGEID("geid:short")).toBe(false);
  });

  it("returns false when base58 part is empty (just the prefix)", () => {
    expect(isValidGEID("geid:")).toBe(false);
  });

  it("returns false when base58 part contains '0' (not in base58 alphabet)", () => {
    const base = "123456789ABCDEFGHJKLMNPQRSTUVWx";
    expect(isValidGEID(`geid:${base}0invalid`)).toBe(false);
  });

  it("returns false when base58 part contains 'O' (not in base58 alphabet)", () => {
    const base = "123456789ABCDEFGHJKLMNPQRSTUVWx";
    expect(isValidGEID(`geid:${base}O`)).toBe(false);
  });

  it("returns false when base58 part contains 'I' (not in base58 alphabet)", () => {
    const base = "123456789ABCDEFGHJKLMNPQRSTUVWx";
    expect(isValidGEID(`geid:${base}I`)).toBe(false);
  });

  it("returns false when base58 part contains 'l' (lowercase L, not in alphabet)", () => {
    const base = "123456789ABCDEFGHJKLMNPQRSTUVWx";
    expect(isValidGEID(`geid:${base}l`)).toBe(false);
  });

  it("returns false when base58 part is too long (over 50 chars)", () => {
    // 51 valid base58 characters — one beyond the maximum of 50
    const tooLong = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrs";
    expect(isValidGEID(`geid:${tooLong}`)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// extractPublicKeyBase58
// ---------------------------------------------------------------------------

describe("extractPublicKeyBase58", () => {
  it("extracts the base58 part after 'geid:'", () => {
    const { geid, publicKeyBase58 } = generateEntityKeypair();
    expect(extractPublicKeyBase58(geid)).toBe(publicKeyBase58);
  });

  it("returned value does not start with 'geid:'", () => {
    const { geid } = generateEntityKeypair();
    const extracted = extractPublicKeyBase58(geid);
    expect(extracted.startsWith("geid:")).toBe(false);
  });

  it("is the inverse of prefixing with GEID_PREFIX", () => {
    const { geid } = generateEntityKeypair();
    const extracted = extractPublicKeyBase58(geid);
    expect(`${GEID_PREFIX}${extracted}`).toBe(geid);
  });

  it("two different keypairs produce two different extracted values", () => {
    const kp1 = generateEntityKeypair();
    const kp2 = generateEntityKeypair();
    expect(extractPublicKeyBase58(kp1.geid)).not.toBe(extractPublicKeyBase58(kp2.geid));
  });
});

// ---------------------------------------------------------------------------
// signIdentityStatement
// ---------------------------------------------------------------------------

describe("signIdentityStatement — structure", () => {
  it("returns an object with all required fields", () => {
    const { privateKeyPem, geid } = generateEntityKeypair();
    const stmt = signIdentityStatement(privateKeyPem, geid, "entity-001", "@A0");
    expect(stmt).toHaveProperty("geid");
    expect(stmt).toHaveProperty("localEntityId");
    expect(stmt).toHaveProperty("nodeId");
    expect(stmt).toHaveProperty("timestamp");
    expect(stmt).toHaveProperty("signature");
  });

  it("stores the provided geid on the statement", () => {
    const { privateKeyPem, geid } = generateEntityKeypair();
    const stmt = signIdentityStatement(privateKeyPem, geid, "entity-001", "@A0");
    expect(stmt.geid).toBe(geid);
  });

  it("stores the provided localEntityId on the statement", () => {
    const { privateKeyPem, geid } = generateEntityKeypair();
    const stmt = signIdentityStatement(privateKeyPem, geid, "entity-xyz", "@A0");
    expect(stmt.localEntityId).toBe("entity-xyz");
  });

  it("stores the provided nodeId on the statement", () => {
    const { privateKeyPem, geid } = generateEntityKeypair();
    const stmt = signIdentityStatement(privateKeyPem, geid, "entity-001", "@B1");
    expect(stmt.nodeId).toBe("@B1");
  });

  it("timestamp is a valid ISO string", () => {
    const { privateKeyPem, geid } = generateEntityKeypair();
    const stmt = signIdentityStatement(privateKeyPem, geid, "entity-001", "@A0");
    expect(() => new Date(stmt.timestamp)).not.toThrow();
    expect(new Date(stmt.timestamp).toISOString()).toBe(stmt.timestamp);
  });

  it("signature is a non-empty hex string", () => {
    const { privateKeyPem, geid } = generateEntityKeypair();
    const stmt = signIdentityStatement(privateKeyPem, geid, "entity-001", "@A0");
    expect(stmt.signature).toMatch(/^[0-9a-f]+$/);
    expect(stmt.signature.length).toBeGreaterThan(0);
  });

  it("signature is 128 hex chars (64 bytes = Ed25519 signature length)", () => {
    const { privateKeyPem, geid } = generateEntityKeypair();
    const stmt = signIdentityStatement(privateKeyPem, geid, "entity-001", "@A0");
    expect(stmt.signature).toHaveLength(128);
  });
});

// ---------------------------------------------------------------------------
// verifyIdentityStatement
// ---------------------------------------------------------------------------

describe("verifyIdentityStatement — valid", () => {
  it("returns true for a freshly signed statement with the matching public key", () => {
    const { privateKeyPem, publicKeyPem, geid } = generateEntityKeypair();
    const stmt = signIdentityStatement(privateKeyPem, geid, "entity-001", "@A0");
    expect(verifyIdentityStatement(stmt, publicKeyPem)).toBe(true);
  });

  it("verifies across two independent calls (re-verification)", () => {
    const { privateKeyPem, publicKeyPem, geid } = generateEntityKeypair();
    const stmt = signIdentityStatement(privateKeyPem, geid, "entity-re", "@A0");
    expect(verifyIdentityStatement(stmt, publicKeyPem)).toBe(true);
    expect(verifyIdentityStatement(stmt, publicKeyPem)).toBe(true);
  });
});

describe("verifyIdentityStatement — invalid", () => {
  it("returns false when the wrong public key is used", () => {
    const kp1 = generateEntityKeypair();
    const kp2 = generateEntityKeypair();
    const stmt = signIdentityStatement(kp1.privateKeyPem, kp1.geid, "entity-001", "@A0");
    expect(verifyIdentityStatement(stmt, kp2.publicKeyPem)).toBe(false);
  });

  it("returns false when geid is tampered on the statement", () => {
    const { privateKeyPem, publicKeyPem, geid } = generateEntityKeypair();
    const stmt = signIdentityStatement(privateKeyPem, geid, "entity-001", "@A0");
    const { geid: otherGeid } = generateEntityKeypair();
    const tampered = { ...stmt, geid: otherGeid };
    expect(verifyIdentityStatement(tampered, publicKeyPem)).toBe(false);
  });

  it("returns false when localEntityId is tampered", () => {
    const { privateKeyPem, publicKeyPem, geid } = generateEntityKeypair();
    const stmt = signIdentityStatement(privateKeyPem, geid, "entity-001", "@A0");
    const tampered = { ...stmt, localEntityId: "entity-TAMPERED" };
    expect(verifyIdentityStatement(tampered, publicKeyPem)).toBe(false);
  });

  it("returns false when nodeId is tampered", () => {
    const { privateKeyPem, publicKeyPem, geid } = generateEntityKeypair();
    const stmt = signIdentityStatement(privateKeyPem, geid, "entity-001", "@A0");
    const tampered = { ...stmt, nodeId: "@TAMPERED" };
    expect(verifyIdentityStatement(tampered, publicKeyPem)).toBe(false);
  });

  it("returns false when timestamp is tampered", () => {
    const { privateKeyPem, publicKeyPem, geid } = generateEntityKeypair();
    const stmt = signIdentityStatement(privateKeyPem, geid, "entity-001", "@A0");
    const tampered = { ...stmt, timestamp: new Date(0).toISOString() };
    expect(verifyIdentityStatement(tampered, publicKeyPem)).toBe(false);
  });

  it("returns false when the signature hex is zeroed out", () => {
    const { privateKeyPem, publicKeyPem, geid } = generateEntityKeypair();
    const stmt = signIdentityStatement(privateKeyPem, geid, "entity-001", "@A0");
    const tampered = { ...stmt, signature: "0".repeat(128) };
    expect(verifyIdentityStatement(tampered, publicKeyPem)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// publicKeyFromGEID
// ---------------------------------------------------------------------------

describe("publicKeyFromGEID", () => {
  it("returns a KeyObject without throwing", () => {
    const { geid } = generateEntityKeypair();
    expect(() => publicKeyFromGEID(geid)).not.toThrow();
  });

  it("reconstructed key can verify signatures made with the original private key", async () => {
    const { privateKeyPem, geid } = generateEntityKeypair();
    const reconstructed = publicKeyFromGEID(geid);

    const message = Buffer.from("test payload for GEID reconstruction");
    const { createPrivateKey, sign: nodeSig, verify: nodeVerify } = await import("node:crypto");
    const privKey = createPrivateKey(privateKeyPem);
    const sig = nodeSig(null, message, privKey);

    expect(nodeVerify(null, message, reconstructed, sig)).toBe(true);
  });

  it("reconstructed key rejects signatures from a different keypair", async () => {
    const kp1 = generateEntityKeypair();
    const kp2 = generateEntityKeypair();

    const { createPrivateKey, sign: nodeSig, verify: nodeVerify } = await import("node:crypto");
    const privKey1 = createPrivateKey(kp1.privateKeyPem);
    const message = Buffer.from("cross-key check");
    const sig = nodeSig(null, message, privKey1);

    const reconstructedFromKp2 = publicKeyFromGEID(kp2.geid);
    expect(nodeVerify(null, message, reconstructedFromKp2, sig)).toBe(false);
  });

  it("reconstructed public key verifies identity statements made with the keypair", async () => {
    const { privateKeyPem, publicKeyPem, geid } = generateEntityKeypair();
    const stmt = signIdentityStatement(privateKeyPem, geid, "entity-recon", "@A0");

    // Verify via normal path first
    expect(verifyIdentityStatement(stmt, publicKeyPem)).toBe(true);

    // Now derive a PEM from the GEID's reconstructed key and verify again
    const reconstructed = publicKeyFromGEID(geid);
    const reconPem = reconstructed.export({ type: "spki", format: "pem" }) as string;
    expect(verifyIdentityStatement(stmt, reconPem)).toBe(true);
  });

  it("two GEIDs from different keypairs produce different reconstructed keys", () => {
    const kp1 = generateEntityKeypair();
    const kp2 = generateEntityKeypair();
    const k1 = publicKeyFromGEID(kp1.geid);
    const k2 = publicKeyFromGEID(kp2.geid);
    const pem1 = k1.export({ type: "spki", format: "pem" }) as string;
    const pem2 = k2.export({ type: "spki", format: "pem" }) as string;
    expect(pem1).not.toBe(pem2);
  });
});

// ---------------------------------------------------------------------------
// Round-trip integration
// ---------------------------------------------------------------------------

describe("GEID round-trip: generate → sign → verify", () => {
  it("full round-trip passes for a freshly generated keypair", () => {
    const { privateKeyPem, publicKeyPem, geid } = generateEntityKeypair();
    const stmt = signIdentityStatement(privateKeyPem, geid, "roundtrip-entity", "@C2");
    expect(verifyIdentityStatement(stmt, publicKeyPem)).toBe(true);
  });

  it("deriveGEID then sign then verify succeeds", () => {
    const { privateKeyPem, publicKeyPem } = generateEntityKeypair();
    const geid = deriveGEID(publicKeyPem);
    const stmt = signIdentityStatement(privateKeyPem, geid, "derive-entity", "@A0");
    expect(verifyIdentityStatement(stmt, publicKeyPem)).toBe(true);
  });

  it("isValidGEID passes for a GEID produced by deriveGEID", () => {
    const { publicKeyPem } = generateEntityKeypair();
    const geid = deriveGEID(publicKeyPem);
    expect(isValidGEID(geid)).toBe(true);
  });

  it("extractPublicKeyBase58 → prefixed → isValidGEID round-trip", () => {
    const { geid } = generateEntityKeypair();
    const base58 = extractPublicKeyBase58(geid);
    const rebuilt = `${GEID_PREFIX}${base58}` as GEID;
    expect(isValidGEID(rebuilt)).toBe(true);
    expect(rebuilt).toBe(geid);
  });
});
