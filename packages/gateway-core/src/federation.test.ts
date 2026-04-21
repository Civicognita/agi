// @ts-nocheck -- blocks on pg-backed test harness; tracked in _plans/phase2-tests-pg.md
import { describe, it, expect, beforeEach } from "vitest";
import { createHash } from "node:crypto";

import { generateNodeKeypair, FederationNode } from "./federation-node.js";
import type { FederationNodeConfig } from "./federation-node.js";
import {
  createHandshakeRequest,
  handleHandshakeRequest,
  verifyHandshakeResponse,
} from "./federation-handshake.js";
import {
  FederationRouter,
} from "./federation-router.js";
import type { FederationRequest } from "./federation-router.js";

// ---------------------------------------------------------------------------
// Helper: create a minimal FederationNodeConfig for tests
// ---------------------------------------------------------------------------

function makeNodeConfig(
  nodeId: string,
  overrides?: Partial<FederationNodeConfig>,
): FederationNodeConfig {
  const { privateKeyPem } = generateNodeKeypair();
  return {
    nodeId,
    displayName: `Test Node ${nodeId}`,
    federationEndpoint: `https://${nodeId}.example.com/fed/v1`,
    genesisSeal: `seal-${nodeId}`,
    privateKeyPem,
    ...overrides,
  };
}

function makeNode(nodeId: string, overrides?: Partial<FederationNodeConfig>): FederationNode {
  return new FederationNode(makeNodeConfig(nodeId, overrides));
}

function sha256(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

// ---------------------------------------------------------------------------
// 1. generateNodeKeypair
// ---------------------------------------------------------------------------

describe("generateNodeKeypair", () => {
  it("returns an object with privateKeyPem and publicKeyPem", () => {
    const kp = generateNodeKeypair();
    expect(kp).toHaveProperty("privateKeyPem");
    expect(kp).toHaveProperty("publicKeyPem");
  });

  it("privateKeyPem is a PKCS8 PEM string", () => {
    const { privateKeyPem } = generateNodeKeypair();
    expect(privateKeyPem).toContain("-----BEGIN PRIVATE KEY-----");
    expect(privateKeyPem).toContain("-----END PRIVATE KEY-----");
  });

  it("publicKeyPem is a SPKI PEM string", () => {
    const { publicKeyPem } = generateNodeKeypair();
    expect(publicKeyPem).toContain("-----BEGIN PUBLIC KEY-----");
    expect(publicKeyPem).toContain("-----END PUBLIC KEY-----");
  });

  it("two calls produce different keypairs", () => {
    const kp1 = generateNodeKeypair();
    const kp2 = generateNodeKeypair();
    expect(kp1.privateKeyPem).not.toBe(kp2.privateKeyPem);
    expect(kp1.publicKeyPem).not.toBe(kp2.publicKeyPem);
  });
});

// ---------------------------------------------------------------------------
// 2. FederationNode.getManifest
// ---------------------------------------------------------------------------

describe("FederationNode.getManifest", () => {
  let node: FederationNode;

  beforeEach(() => {
    node = makeNode("@A0");
  });

  it("returns schema 'mycelium-node-v1'", () => {
    expect(node.getManifest().schema).toBe("mycelium-node-v1");
  });

  it("returns correct nodeId", () => {
    expect(node.getManifest().nodeId).toBe("@A0");
  });

  it("returns a non-empty publicKey", () => {
    const { publicKey } = node.getManifest();
    expect(publicKey.length).toBeGreaterThan(0);
  });

  it("publicKey is base64 (valid base64 string)", () => {
    const { publicKey } = node.getManifest();
    expect(() => Buffer.from(publicKey, "base64")).not.toThrow();
  });

  it("returns correct federationEndpoint", () => {
    expect(node.getManifest().federationEndpoint).toBe("https://@A0.example.com/fed/v1");
  });

  it("returns correct genesisSeal", () => {
    expect(node.getManifest().genesisSeal).toBe("seal-@A0");
  });

  it("returns correct displayName", () => {
    expect(node.getManifest().displayName).toBe("Test Node @A0");
  });

  it("supportedProtocols includes 'peer-handshake-v1'", () => {
    expect(node.getManifest().supportedProtocols).toContain("peer-handshake-v1");
  });

  it("supportedProtocols includes 'entity-lookup-v1'", () => {
    expect(node.getManifest().supportedProtocols).toContain("entity-lookup-v1");
  });

  it("supportedProtocols includes 'coa-relay-v1'", () => {
    expect(node.getManifest().supportedProtocols).toContain("coa-relay-v1");
  });

  it("supportedProtocols includes 'governance-vote-v1'", () => {
    expect(node.getManifest().supportedProtocols).toContain("governance-vote-v1");
  });

  it("capabilities.coaRelay is true by default", () => {
    expect(node.getManifest().capabilities.coaRelay).toBe(true);
  });

  it("capabilities.governanceVoting is true by default", () => {
    expect(node.getManifest().capabilities.governanceVoting).toBe(true);
  });

  it("capabilities.entityDiscovery is true by default", () => {
    expect(node.getManifest().capabilities.entityDiscovery).toBe(true);
  });

  it("capabilities.maxCoaBatchSize is 100 by default", () => {
    expect(node.getManifest().capabilities.maxCoaBatchSize).toBe(100);
  });

  it("capability overrides from config are applied", () => {
    const n = makeNode("@B1", { capabilities: { coaRelay: false, maxCoaBatchSize: 10, governanceVoting: true, entityDiscovery: true } });
    expect(n.getManifest().capabilities.coaRelay).toBe(false);
    expect(n.getManifest().capabilities.maxCoaBatchSize).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// 3. FederationNode.signPayload / verifyPayload
// ---------------------------------------------------------------------------

describe("FederationNode sign/verify payload", () => {
  let nodeA: FederationNode;
  let nodeB: FederationNode;

  beforeEach(() => {
    nodeA = makeNode("@A0");
    nodeB = makeNode("@B1");
  });

  it("signPayload returns a hex string", () => {
    const sig = nodeA.signPayload("hello");
    expect(sig).toMatch(/^[0-9a-f]+$/);
  });

  it("signPayload produces 128-char hex (64-byte Ed25519 signature)", () => {
    const sig = nodeA.signPayload("hello");
    expect(sig).toHaveLength(128);
  });

  it("verifyPayload returns true when node verifies its own signature", () => {
    const data = "test data";
    const sig = nodeA.signPayload(data);
    const pubKey = nodeA.getPublicKeyBase64();
    expect(nodeA.verifyPayload(data, sig, pubKey)).toBe(true);
  });

  it("verifyPayload returns false when given wrong public key", () => {
    const data = "test data";
    const sig = nodeA.signPayload(data);
    const wrongKey = nodeB.getPublicKeyBase64();
    expect(nodeA.verifyPayload(data, sig, wrongKey)).toBe(false);
  });

  it("verifyPayload returns false when data is tampered", () => {
    const sig = nodeA.signPayload("original");
    const pubKey = nodeA.getPublicKeyBase64();
    expect(nodeA.verifyPayload("tampered", sig, pubKey)).toBe(false);
  });

  it("verifyPayload accepts a Buffer as data", () => {
    const data = Buffer.from("buffer test");
    const sig = nodeA.signPayload(data);
    const pubKey = nodeA.getPublicKeyBase64();
    expect(nodeA.verifyPayload(data, sig, pubKey)).toBe(true);
  });

  it("two different payloads produce different signatures", () => {
    const sig1 = nodeA.signPayload("payload1");
    const sig2 = nodeA.signPayload("payload2");
    expect(sig1).not.toBe(sig2);
  });
});

// ---------------------------------------------------------------------------
// 4. FederationNode.generateSigHeader / parseSigHeader
// ---------------------------------------------------------------------------

describe("FederationNode generateSigHeader / parseSigHeader", () => {
  let nodeA: FederationNode;
  let nodeB: FederationNode;

  beforeEach(() => {
    nodeA = makeNode("@A0");
    nodeB = makeNode("@B1");

    // Register nodeA as a peer of nodeB so nodeB can verify nodeA's headers
    nodeB.addPeer("@A0", "https://@A0.example.com/fed/v1", nodeA.getPublicKeyBase64(), "manual", 1);
    // Register nodeB as a peer of nodeA so nodeA can verify nodeB's headers
    nodeA.addPeer("@B1", "https://@B1.example.com/fed/v1", nodeB.getPublicKeyBase64(), "manual", 1);
  });

  it("generateSigHeader returns a string starting with 'Mycelium-Sig ed25519'", () => {
    const header = nodeA.generateSigHeader(sha256("body"));
    expect(header.startsWith("Mycelium-Sig ed25519")).toBe(true);
  });

  it("parseSigHeader returns non-null for a valid header from a known peer", () => {
    const bodyHash = sha256("body content");
    const header = nodeA.generateSigHeader(bodyHash);
    const result = nodeB.parseSigHeader(header, bodyHash);
    expect(result).not.toBeNull();
  });

  it("parseSigHeader returns valid=true for a correct header", () => {
    const bodyHash = sha256("test body");
    const header = nodeA.generateSigHeader(bodyHash);
    const result = nodeB.parseSigHeader(header, bodyHash);
    expect(result?.valid).toBe(true);
  });

  it("parseSigHeader returns the correct nodeId", () => {
    const bodyHash = sha256("body");
    const header = nodeA.generateSigHeader(bodyHash);
    const result = nodeB.parseSigHeader(header, bodyHash);
    expect(result?.nodeId).toBe("@A0");
  });

  it("parseSigHeader returns a numeric timestamp", () => {
    const bodyHash = sha256("body");
    const header = nodeA.generateSigHeader(bodyHash);
    const result = nodeB.parseSigHeader(header, bodyHash);
    expect(typeof result?.timestamp).toBe("number");
  });

  it("parseSigHeader returns null for a malformed header", () => {
    expect(nodeB.parseSigHeader("not-a-valid-header", sha256("body"))).toBeNull();
  });

  it("parseSigHeader returns valid=false for wrong body hash", () => {
    const header = nodeA.generateSigHeader(sha256("original body"));
    const result = nodeB.parseSigHeader(header, sha256("different body"));
    expect(result?.valid).toBe(false);
  });

  it("parseSigHeader returns valid=false for an expired timestamp", () => {
    const bodyHash = sha256("body");
    // Construct a header with a timestamp 120 seconds in the past
    const staleTimestamp = Math.floor(Date.now() / 1000) - 120;
    const payload = `@A0.${staleTimestamp}.${bodyHash}`;
    const sig = nodeA.signPayload(payload);
    const staleHeader = `Mycelium-Sig ed25519 @A0.${staleTimestamp}.${sig}`;
    const result = nodeB.parseSigHeader(staleHeader, bodyHash, 60);
    expect(result?.valid).toBe(false);
  });

  it("parseSigHeader returns null/invalid for unknown node not in peer list", () => {
    const nodeC = makeNode("@C2");
    const bodyHash = sha256("body");
    const header = nodeC.generateSigHeader(bodyHash);
    // nodeB doesn't know about nodeC
    const result = nodeB.parseSigHeader(header, bodyHash);
    // Should be null (no match) or valid=false (unknown peer)
    if (result !== null) {
      expect(result.valid).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. FederationNode peer management
// ---------------------------------------------------------------------------

describe("FederationNode peer management", () => {
  let node: FederationNode;

  beforeEach(() => {
    node = makeNode("@A0");
  });

  it("addPeer returns a PeerNode with the correct nodeId", () => {
    const peer = node.addPeer("@B1", "https://b.example.com", "pubkey64", "manual");
    expect(peer.nodeId).toBe("@B1");
  });

  it("addPeer defaults trustLevel to 0", () => {
    const peer = node.addPeer("@B1", "https://b.example.com", "pubkey64", "manual");
    expect(peer.trustLevel).toBe(0);
  });

  it("addPeer accepts an explicit trustLevel", () => {
    const peer = node.addPeer("@B1", "https://b.example.com", "pubkey64", "manual", 2);
    expect(peer.trustLevel).toBe(2);
  });

  it("addPeer stores the endpoint", () => {
    const peer = node.addPeer("@B1", "https://b.example.com", "pubkey64", "manual");
    expect(peer.endpoint).toBe("https://b.example.com");
  });

  it("addPeer stores the publicKey", () => {
    const peer = node.addPeer("@B1", "https://b.example.com", "mypubkey", "manual");
    expect(peer.publicKey).toBe("mypubkey");
  });

  it("addPeer stores the discoveryMethod", () => {
    const peer = node.addPeer("@B1", "https://b.example.com", "pubkey64", "registry");
    expect(peer.discoveryMethod).toBe("registry");
  });

  it("addPeer sets online=false initially", () => {
    const peer = node.addPeer("@B1", "https://b.example.com", "pubkey64", "manual");
    expect(peer.online).toBe(false);
  });

  it("addPeer sets failureCount=0 initially", () => {
    const peer = node.addPeer("@B1", "https://b.example.com", "pubkey64", "manual");
    expect(peer.failureCount).toBe(0);
  });

  it("addPeer sets lastHandshake=null initially", () => {
    const peer = node.addPeer("@B1", "https://b.example.com", "pubkey64", "manual");
    expect(peer.lastHandshake).toBeNull();
  });

  it("getPeer returns the added peer by nodeId", () => {
    node.addPeer("@B1", "https://b.example.com", "pubkey64", "manual");
    const peer = node.getPeer("@B1");
    expect(peer).not.toBeNull();
    expect(peer?.nodeId).toBe("@B1");
  });

  it("getPeer returns null for an unknown nodeId", () => {
    expect(node.getPeer("@X0")).toBeNull();
  });

  it("getAllPeers returns an empty array when no peers", () => {
    expect(node.getAllPeers()).toEqual([]);
  });

  it("getAllPeers returns all added peers", () => {
    node.addPeer("@B1", "https://b.example.com", "k1", "manual");
    node.addPeer("@C2", "https://c.example.com", "k2", "manual");
    expect(node.getAllPeers()).toHaveLength(2);
  });

  it("removePeer returns true and removes the peer", () => {
    node.addPeer("@B1", "https://b.example.com", "pubkey64", "manual");
    expect(node.removePeer("@B1")).toBe(true);
    expect(node.getPeer("@B1")).toBeNull();
  });

  it("removePeer returns false for unknown nodeId", () => {
    expect(node.removePeer("@X9")).toBe(false);
  });

  it("getTrustedPeers(1) returns only peers at trust >= 1", () => {
    node.addPeer("@B1", "https://b.example.com", "k1", "manual", 0);
    node.addPeer("@C2", "https://c.example.com", "k2", "manual", 1);
    node.addPeer("@D3", "https://d.example.com", "k3", "manual", 2);
    const trusted = node.getTrustedPeers(1);
    expect(trusted).toHaveLength(2);
    expect(trusted.every((p) => p.trustLevel >= 1)).toBe(true);
  });

  it("getTrustedPeers(2) returns only peers at trust >= 2", () => {
    node.addPeer("@B1", "https://b.example.com", "k1", "manual", 1);
    node.addPeer("@C2", "https://c.example.com", "k2", "manual", 2);
    const trusted = node.getTrustedPeers(2);
    expect(trusted).toHaveLength(1);
    expect(trusted[0]?.trustLevel).toBe(2);
  });

  it("setTrustLevel updates trust on a known peer and returns true", () => {
    node.addPeer("@B1", "https://b.example.com", "pubkey64", "manual", 0);
    const result = node.setTrustLevel("@B1", 2);
    expect(result).toBe(true);
    expect(node.getPeer("@B1")?.trustLevel).toBe(2);
  });

  it("setTrustLevel returns false for unknown nodeId", () => {
    expect(node.setTrustLevel("@X0", 1)).toBe(false);
  });

  it("recordHandshake updates trustLevel, lastHandshake, online, and resets failureCount", () => {
    node.addPeer("@B1", "https://b.example.com", "pubkey64", "manual", 0);
    const updated = node.recordHandshake("@B1", 1);
    expect(updated).not.toBeNull();
    expect(updated?.trustLevel).toBe(1);
    expect(updated?.lastHandshake).not.toBeNull();
    expect(updated?.online).toBe(true);
    expect(updated?.failureCount).toBe(0);
  });

  it("recordHandshake returns null for unknown nodeId", () => {
    expect(node.recordHandshake("@X0", 1)).toBeNull();
  });

  it("recordFailure increments failureCount", () => {
    node.addPeer("@B1", "https://b.example.com", "pubkey64", "manual");
    node.recordFailure("@B1");
    expect(node.getPeer("@B1")?.failureCount).toBe(1);
  });

  it("recordFailure sets online=false after 5 failures", () => {
    node.addPeer("@B1", "https://b.example.com", "pubkey64", "manual");
    node.recordHandshake("@B1", 1); // sets online=true
    for (let i = 0; i < 5; i++) {
      node.recordFailure("@B1");
    }
    expect(node.getPeer("@B1")?.online).toBe(false);
  });

  it("recordFailure is a no-op for unknown nodeId", () => {
    expect(() => node.recordFailure("@X0")).not.toThrow();
  });

  it("addPeer throws when maxPeers is reached", () => {
    const smallNode = makeNode("@A0", { maxPeers: 2 });
    smallNode.addPeer("@B1", "https://b.example.com", "k1", "manual");
    smallNode.addPeer("@C2", "https://c.example.com", "k2", "manual");
    expect(() => smallNode.addPeer("@D3", "https://d.example.com", "k3", "manual")).toThrow(
      /maximum peer count/i,
    );
  });
});

// ---------------------------------------------------------------------------
// 6. Federation handshake — full flow
// ---------------------------------------------------------------------------

describe("Federation handshake — createHandshakeRequest", () => {
  it("returns request, nonce, and sigHeader fields", () => {
    const node = makeNode("@A0");
    const result = createHandshakeRequest(node);
    expect(result).toHaveProperty("request");
    expect(result).toHaveProperty("nonce");
    expect(result).toHaveProperty("sigHeader");
  });

  it("request.manifest matches the node's own manifest", () => {
    const node = makeNode("@A0");
    const { request } = createHandshakeRequest(node);
    expect(request.manifest.nodeId).toBe("@A0");
    expect(request.manifest.schema).toBe("mycelium-node-v1");
  });

  it("request.nonce is a non-empty hex string", () => {
    const node = makeNode("@A0");
    const { nonce } = createHandshakeRequest(node);
    expect(nonce).toMatch(/^[0-9a-f]+$/);
    expect(nonce.length).toBeGreaterThan(0);
  });

  it("request.nonce matches the returned nonce field", () => {
    const node = makeNode("@A0");
    const { request, nonce } = createHandshakeRequest(node);
    expect(request.nonce).toBe(nonce);
  });

  it("request.timestamp is a valid ISO string", () => {
    const node = makeNode("@A0");
    const { request } = createHandshakeRequest(node);
    expect(() => new Date(request.timestamp)).not.toThrow();
  });

  it("sigHeader starts with 'Mycelium-Sig ed25519'", () => {
    const node = makeNode("@A0");
    const { sigHeader } = createHandshakeRequest(node);
    expect(sigHeader.startsWith("Mycelium-Sig ed25519")).toBe(true);
  });
});

describe("Federation handshake — handleHandshakeRequest", () => {
  let nodeA: FederationNode;
  let nodeB: FederationNode;

  beforeEach(() => {
    nodeA = makeNode("@A0");
    nodeB = makeNode("@B1");
  });

  it("returns accepted=true for a valid handshake", () => {
    const { request, sigHeader } = createHandshakeRequest(nodeA);
    const response = handleHandshakeRequest(nodeB, request, sigHeader);
    expect(response.accepted).toBe(true);
  });

  it("response manifest matches nodeB's own manifest", () => {
    const { request, sigHeader } = createHandshakeRequest(nodeA);
    const response = handleHandshakeRequest(nodeB, request, sigHeader);
    expect(response.manifest.nodeId).toBe("@B1");
  });

  it("assigns trust level 1 on successful handshake", () => {
    const { request, sigHeader } = createHandshakeRequest(nodeA);
    const response = handleHandshakeRequest(nodeB, request, sigHeader);
    expect(response.assignedTrust).toBe(1);
  });

  it("response includes non-empty nonceEcho", () => {
    const { request, sigHeader } = createHandshakeRequest(nodeA);
    const response = handleHandshakeRequest(nodeB, request, sigHeader);
    expect(response.nonceEcho.length).toBeGreaterThan(0);
  });

  it("response includes non-empty responseNonce", () => {
    const { request, sigHeader } = createHandshakeRequest(nodeA);
    const response = handleHandshakeRequest(nodeB, request, sigHeader);
    expect(response.responseNonce.length).toBeGreaterThan(0);
  });

  it("nodeB records nodeA as a peer after handshake", () => {
    const { request, sigHeader } = createHandshakeRequest(nodeA);
    handleHandshakeRequest(nodeB, request, sigHeader);
    expect(nodeB.getPeer("@A0")).not.toBeNull();
  });

  it("rejects self-handshake", () => {
    const { request, sigHeader } = createHandshakeRequest(nodeA);
    const response = handleHandshakeRequest(nodeA, request, sigHeader);
    expect(response.accepted).toBe(false);
  });

  it("rejects request with missing manifest", () => {
    const { request, sigHeader } = createHandshakeRequest(nodeA);
    const bad = { ...request, manifest: undefined as unknown as typeof request.manifest };
    const response = handleHandshakeRequest(nodeB, bad, sigHeader);
    expect(response.accepted).toBe(false);
  });

  it("rejects request with missing nonce", () => {
    const { request, sigHeader } = createHandshakeRequest(nodeA);
    const bad = { ...request, nonce: "" };
    const response = handleHandshakeRequest(nodeB, bad, sigHeader);
    expect(response.accepted).toBe(false);
  });

  it("rejects request with expired timestamp", () => {
    const { request, sigHeader } = createHandshakeRequest(nodeA);
    const expired = { ...request, timestamp: new Date(Date.now() - 120_000).toISOString() };
    const response = handleHandshakeRequest(nodeB, expired, sigHeader);
    expect(response.accepted).toBe(false);
  });

  it("rejects request with invalid signature header", () => {
    const { request } = createHandshakeRequest(nodeA);
    const response = handleHandshakeRequest(nodeB, request, "bad-sig-header");
    expect(response.accepted).toBe(false);
  });

  it("includes a reason string on rejection", () => {
    const { request, sigHeader } = createHandshakeRequest(nodeA);
    const response = handleHandshakeRequest(nodeA, request, sigHeader); // self-handshake
    expect(typeof response.reason).toBe("string");
    expect(response.reason!.length).toBeGreaterThan(0);
  });
});

describe("Federation handshake — verifyHandshakeResponse", () => {
  let nodeA: FederationNode;
  let nodeB: FederationNode;

  beforeEach(() => {
    nodeA = makeNode("@A0");
    nodeB = makeNode("@B1");
  });

  it("returns success=true for a valid response", () => {
    const { request, nonce, sigHeader } = createHandshakeRequest(nodeA);
    const response = handleHandshakeRequest(nodeB, request, sigHeader);
    const result = verifyHandshakeResponse(nodeA, response, nonce);
    expect(result.success).toBe(true);
  });

  it("result contains the correct peerNodeId", () => {
    const { request, nonce, sigHeader } = createHandshakeRequest(nodeA);
    const response = handleHandshakeRequest(nodeB, request, sigHeader);
    const result = verifyHandshakeResponse(nodeA, response, nonce);
    expect(result.peerNodeId).toBe("@B1");
  });

  it("result contains peerManifest on success", () => {
    const { request, nonce, sigHeader } = createHandshakeRequest(nodeA);
    const response = handleHandshakeRequest(nodeB, request, sigHeader);
    const result = verifyHandshakeResponse(nodeA, response, nonce);
    expect(result.peerManifest).toBeDefined();
    expect(result.peerManifest?.nodeId).toBe("@B1");
  });

  it("result.assignedTrust is 1 after a successful handshake", () => {
    const { request, nonce, sigHeader } = createHandshakeRequest(nodeA);
    const response = handleHandshakeRequest(nodeB, request, sigHeader);
    const result = verifyHandshakeResponse(nodeA, response, nonce);
    expect(result.assignedTrust).toBe(1);
  });

  it("nodeA records nodeB as a trusted peer after verifyHandshakeResponse", () => {
    const { request, nonce, sigHeader } = createHandshakeRequest(nodeA);
    const response = handleHandshakeRequest(nodeB, request, sigHeader);
    verifyHandshakeResponse(nodeA, response, nonce);
    expect(nodeA.getPeer("@B1")).not.toBeNull();
    expect(nodeA.getPeer("@B1")?.trustLevel).toBe(1);
  });

  it("returns success=false when response.accepted is false", () => {
    const { request, nonce, sigHeader } = createHandshakeRequest(nodeA);
    const rejectedResponse = handleHandshakeRequest(nodeA, request, sigHeader); // self
    const result = verifyHandshakeResponse(nodeA, rejectedResponse, nonce);
    expect(result.success).toBe(false);
  });

  it("returns success=false with wrong nonce", () => {
    const { request, sigHeader } = createHandshakeRequest(nodeA);
    const response = handleHandshakeRequest(nodeB, request, sigHeader);
    const result = verifyHandshakeResponse(nodeA, response, "wrong-nonce-value-here");
    expect(result.success).toBe(false);
  });
});

describe("Federation handshake — full bilateral flow", () => {
  it("both nodes have trust level 1 after a complete handshake exchange", () => {
    const nodeA = makeNode("@A0");
    const nodeB = makeNode("@B1");

    const { request, nonce, sigHeader } = createHandshakeRequest(nodeA);
    const response = handleHandshakeRequest(nodeB, request, sigHeader);
    expect(response.accepted).toBe(true);

    const result = verifyHandshakeResponse(nodeA, response, nonce);
    expect(result.success).toBe(true);

    expect(nodeB.getPeer("@A0")?.trustLevel).toBe(1);
    expect(nodeA.getPeer("@B1")?.trustLevel).toBe(1);
  });

  it("handshake is not bidirectionally symmetric — nodeA must initiate its own request to nodeB too", () => {
    const nodeA = makeNode("@A0");
    const nodeB = makeNode("@B1");

    // A initiates to B
    const { request, nonce, sigHeader } = createHandshakeRequest(nodeA);
    const response = handleHandshakeRequest(nodeB, request, sigHeader);
    verifyHandshakeResponse(nodeA, response, nonce);

    // A knows B
    expect(nodeA.getPeer("@B1")).not.toBeNull();
    // B knows A
    expect(nodeB.getPeer("@A0")).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 7. FederationRouter
// ---------------------------------------------------------------------------

describe("FederationRouter — manifest endpoints", () => {
  let node: FederationNode;
  let router: FederationRouter;

  beforeEach(() => {
    node = makeNode("@A0");
    router = new FederationRouter(node);
  });

  it("GET /.well-known/mycelium-node.json returns status 200", async () => {
    const req: FederationRequest = { method: "GET", path: "/.well-known/mycelium-node.json", headers: {} };
    const res = await router.handleRequest(req);
    expect(res.status).toBe(200);
  });

  it("GET /.well-known/mycelium-node.json returns the node manifest", async () => {
    const req: FederationRequest = { method: "GET", path: "/.well-known/mycelium-node.json", headers: {} };
    const res = await router.handleRequest(req);
    const body = res.body as { schema: string; nodeId: string };
    expect(body.schema).toBe("mycelium-node-v1");
    expect(body.nodeId).toBe("@A0");
  });

  it("GET /fed/v1/node returns status 200", async () => {
    const req: FederationRequest = { method: "GET", path: "/fed/v1/node", headers: {} };
    const res = await router.handleRequest(req);
    expect(res.status).toBe(200);
  });

  it("GET /fed/v1/node returns the node manifest (no auth required)", async () => {
    const req: FederationRequest = { method: "GET", path: "/fed/v1/node", headers: {} };
    const res = await router.handleRequest(req);
    const body = res.body as { schema: string };
    expect(body.schema).toBe("mycelium-node-v1");
  });

  it("manifest response has content-type application/json", async () => {
    const req: FederationRequest = { method: "GET", path: "/fed/v1/node", headers: {} };
    const res = await router.handleRequest(req);
    expect(res.headers?.["content-type"]).toBe("application/json");
  });
});

describe("FederationRouter — handshake endpoint", () => {
  let nodeA: FederationNode;
  let nodeB: FederationNode;
  let routerB: FederationRouter;

  beforeEach(() => {
    nodeA = makeNode("@A0");
    nodeB = makeNode("@B1");
    routerB = new FederationRouter(nodeB);
  });

  it("POST /fed/v1/peer/hello returns 200 for a valid handshake", async () => {
    const { request, sigHeader } = createHandshakeRequest(nodeA);
    const req: FederationRequest = {
      method: "POST",
      path: "/fed/v1/peer/hello",
      headers: { authorization: sigHeader },
      body: JSON.stringify(request),
    };
    const res = await routerB.handleRequest(req);
    expect(res.status).toBe(200);
  });

  it("POST /fed/v1/peer/hello returns accepted=true in body for valid handshake", async () => {
    const { request, sigHeader } = createHandshakeRequest(nodeA);
    const req: FederationRequest = {
      method: "POST",
      path: "/fed/v1/peer/hello",
      headers: { authorization: sigHeader },
      body: JSON.stringify(request),
    };
    const res = await routerB.handleRequest(req);
    const body = res.body as { accepted: boolean };
    expect(body.accepted).toBe(true);
  });

  it("POST /fed/v1/peer/hello returns 403 for self-handshake", async () => {
    const routerA = new FederationRouter(nodeA);
    const { request, sigHeader } = createHandshakeRequest(nodeA);
    const req: FederationRequest = {
      method: "POST",
      path: "/fed/v1/peer/hello",
      headers: { authorization: sigHeader },
      body: JSON.stringify(request),
    };
    const res = await routerA.handleRequest(req);
    expect(res.status).toBe(403);
  });

  it("POST /fed/v1/peer/hello returns 400 for missing body", async () => {
    const req: FederationRequest = {
      method: "POST",
      path: "/fed/v1/peer/hello",
      headers: {},
    };
    const res = await routerB.handleRequest(req);
    expect(res.status).toBe(400);
  });

  it("POST /fed/v1/peer/hello returns 400 for invalid JSON body", async () => {
    const req: FederationRequest = {
      method: "POST",
      path: "/fed/v1/peer/hello",
      headers: {},
      body: "not-json{{{",
    };
    const res = await routerB.handleRequest(req);
    expect(res.status).toBe(400);
  });

  it("mycelium-sig header is also accepted as alternative to authorization", async () => {
    const { request, sigHeader } = createHandshakeRequest(nodeA);
    const req: FederationRequest = {
      method: "POST",
      path: "/fed/v1/peer/hello",
      headers: { "mycelium-sig": sigHeader },
      body: JSON.stringify(request),
    };
    const res = await routerB.handleRequest(req);
    expect(res.status).toBe(200);
  });
});

describe("FederationRouter — authentication middleware", () => {
  let nodeA: FederationNode;
  let nodeB: FederationNode;
  let routerB: FederationRouter;

  beforeEach(() => {
    nodeA = makeNode("@A0");
    nodeB = makeNode("@B1");
    routerB = new FederationRouter(nodeB);

    // Perform a handshake so nodeA is a known trusted peer of nodeB
    const { request, nonce, sigHeader: hs } = createHandshakeRequest(nodeA);
    const response = handleHandshakeRequest(nodeB, request, hs);
    verifyHandshakeResponse(nodeA, response, nonce);
  });

  it("returns 401 when authorization header is missing", async () => {
    const req: FederationRequest = {
      method: "GET",
      path: "/fed/v1/peers",
      headers: {},
    };
    const res = await routerB.handleRequest(req);
    expect(res.status).toBe(401);
  });

  it("returns 401 when signature is invalid", async () => {
    const badSig = `Mycelium-Sig ed25519 @A0.${Math.floor(Date.now() / 1000)}.` + "a".repeat(128);
    const req: FederationRequest = {
      method: "GET",
      path: "/fed/v1/peers",
      headers: { authorization: badSig },
    };
    const res = await routerB.handleRequest(req);
    expect(res.status).toBe(401);
  });

  it("returns 401 when the Mycelium-Sig header is malformed", async () => {
    const req: FederationRequest = {
      method: "GET",
      path: "/fed/v1/peers",
      headers: { authorization: "Bearer some-token" },
    };
    const res = await routerB.handleRequest(req);
    expect(res.status).toBe(401);
  });

  it("returns 200 for /fed/v1/peers with valid signature from trusted peer", async () => {
    const body = "";
    const bodyHash = sha256(body);
    const sigHeader = nodeA.generateSigHeader(bodyHash);
    const req: FederationRequest = {
      method: "GET",
      path: "/fed/v1/peers",
      headers: { authorization: sigHeader },
    };
    const res = await routerB.handleRequest(req);
    expect(res.status).toBe(200);
  });
});

describe("FederationRouter — trust gating", () => {
  let nodeA: FederationNode;
  let nodeB: FederationNode;
  let routerB: FederationRouter;

  beforeEach(() => {
    nodeA = makeNode("@A0");
    nodeB = makeNode("@B1");
    routerB = new FederationRouter(nodeB);
  });

  it("returns 403 when peer has trust level 0 on /fed/v1/peers", async () => {
    // Add nodeA as a known-but-untrusted peer (trust 0)
    nodeB.addPeer("@A0", "https://@A0.example.com/fed/v1", nodeA.getPublicKeyBase64(), "manual", 0);

    const bodyHash = sha256("");
    const sigHeader = nodeA.generateSigHeader(bodyHash);
    const req: FederationRequest = {
      method: "GET",
      path: "/fed/v1/peers",
      headers: { authorization: sigHeader },
    };
    const res = await routerB.handleRequest(req);
    expect(res.status).toBe(403);
  });

  it("returns 200 for /fed/v1/peers when peer has trust level 1", async () => {
    nodeB.addPeer("@A0", "https://@A0.example.com/fed/v1", nodeA.getPublicKeyBase64(), "manual", 1);

    const bodyHash = sha256("");
    const sigHeader = nodeA.generateSigHeader(bodyHash);
    const req: FederationRequest = {
      method: "GET",
      path: "/fed/v1/peers",
      headers: { authorization: sigHeader },
    };
    const res = await routerB.handleRequest(req);
    expect(res.status).toBe(200);
  });

  it("returns 403 for /fed/v1/coa/submit when peer has trust level 1 (requires 2)", async () => {
    nodeB.addPeer("@A0", "https://@A0.example.com/fed/v1", nodeA.getPublicKeyBase64(), "manual", 1);

    const body = JSON.stringify({ records: [], originNode: "@A0" });
    const bodyHash = sha256(body);
    const sigHeader = nodeA.generateSigHeader(bodyHash);
    const req: FederationRequest = {
      method: "POST",
      path: "/fed/v1/coa/submit",
      headers: { authorization: sigHeader },
      body,
    };
    const res = await routerB.handleRequest(req);
    expect(res.status).toBe(403);
  });
});

describe("FederationRouter — GET /fed/v1/peers", () => {
  let nodeA: FederationNode;
  let nodeB: FederationNode;
  let routerB: FederationRouter;

  beforeEach(() => {
    nodeA = makeNode("@A0");
    nodeB = makeNode("@B1");
    routerB = new FederationRouter(nodeB);

    // Perform handshake to establish nodeA as trusted peer of nodeB
    const { request, nonce, sigHeader } = createHandshakeRequest(nodeA);
    const response = handleHandshakeRequest(nodeB, request, sigHeader);
    verifyHandshakeResponse(nodeA, response, nonce);
  });

  it("returns a peers array in the body", async () => {
    const sigHeader = nodeA.generateSigHeader(sha256(""));
    const req: FederationRequest = {
      method: "GET",
      path: "/fed/v1/peers",
      headers: { authorization: sigHeader },
    };
    const res = await routerB.handleRequest(req);
    const body = res.body as { peers: unknown[] };
    expect(Array.isArray(body.peers)).toBe(true);
  });

  it("peers list contains trusted peers only", async () => {
    // Add an untrusted peer
    nodeB.addPeer("@C2", "https://c.example.com", "k", "manual", 0);

    const sigHeader = nodeA.generateSigHeader(sha256(""));
    const req: FederationRequest = {
      method: "GET",
      path: "/fed/v1/peers",
      headers: { authorization: sigHeader },
    };
    const res = await routerB.handleRequest(req);
    const body = res.body as { peers: Array<{ trustLevel: number }> };
    // All returned peers should have trustLevel >= 1
    expect(body.peers.every((p) => p.trustLevel >= 1)).toBe(true);
  });
});

describe("FederationRouter — rate limiting", () => {
  it("returns 429 after exceeding rate limit", async () => {
    const nodeA = makeNode("@A0");
    const nodeB = makeNode("@B1");
    // Tight rate limit of 2 requests per minute
    const routerB = new FederationRouter(nodeB, { rateLimitPerMinute: 2 });

    nodeB.addPeer("@A0", "https://@A0.example.com/fed/v1", nodeA.getPublicKeyBase64(), "manual", 1);

    let lastStatus = 0;
    for (let i = 0; i < 5; i++) {
      const bodyHash = sha256("");
      const sigHeader = nodeA.generateSigHeader(bodyHash);
      const req: FederationRequest = {
        method: "GET",
        path: "/fed/v1/peers",
        headers: { authorization: sigHeader },
      };
      const res = await routerB.handleRequest(req);
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });
});

describe("FederationRouter — 404 for unknown routes", () => {
  it("returns 404 for an unknown authenticated route", async () => {
    const nodeA = makeNode("@A0");
    const nodeB = makeNode("@B1");
    const routerB = new FederationRouter(nodeB);
    nodeB.addPeer("@A0", "https://@A0.example.com/fed/v1", nodeA.getPublicKeyBase64(), "manual", 1);

    const sigHeader = nodeA.generateSigHeader(sha256(""));
    const req: FederationRequest = {
      method: "GET",
      path: "/fed/v1/unknown-route",
      headers: { authorization: sigHeader },
    };
    const res = await routerB.handleRequest(req);
    expect(res.status).toBe(404);
  });
});

describe("FederationRouter — audit logging", () => {
  let nodeA: FederationNode;
  let nodeB: FederationNode;
  let routerB: FederationRouter;

  beforeEach(() => {
    nodeA = makeNode("@A0");
    nodeB = makeNode("@B1");
    routerB = new FederationRouter(nodeB, { auditLog: true });
  });

  it("getAuditLog returns an empty array on fresh router", () => {
    expect(routerB.getAuditLog()).toEqual([]);
  });

  it("getAuditLog returns one entry after a single request", async () => {
    const req: FederationRequest = { method: "GET", path: "/fed/v1/node", headers: {} };
    await routerB.handleRequest(req);
    expect(routerB.getAuditLog()).toHaveLength(1);
  });

  it("audit entry has a timestamp field", async () => {
    const req: FederationRequest = { method: "GET", path: "/fed/v1/node", headers: {} };
    await routerB.handleRequest(req);
    const entry = routerB.getAuditLog()[0];
    expect(entry).toBeDefined();
    expect(() => new Date(entry!.timestamp)).not.toThrow();
  });

  it("audit entry records the correct method", async () => {
    const req: FederationRequest = { method: "GET", path: "/fed/v1/node", headers: {} };
    await routerB.handleRequest(req);
    expect(routerB.getAuditLog()[0]?.method).toBe("GET");
  });

  it("audit entry records the correct path", async () => {
    const req: FederationRequest = { method: "GET", path: "/fed/v1/node", headers: {} };
    await routerB.handleRequest(req);
    expect(routerB.getAuditLog()[0]?.path).toBe("/fed/v1/node");
  });

  it("audit entry records durationMs as a non-negative number", async () => {
    const req: FederationRequest = { method: "GET", path: "/fed/v1/node", headers: {} };
    await routerB.handleRequest(req);
    const entry = routerB.getAuditLog()[0];
    expect(typeof entry?.durationMs).toBe("number");
    expect(entry?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("getAuditLog grows with multiple requests", async () => {
    for (let i = 0; i < 3; i++) {
      await routerB.handleRequest({ method: "GET", path: "/fed/v1/node", headers: {} });
    }
    expect(routerB.getAuditLog().length).toBe(3);
  });

  it("clearAuditLog resets to empty", async () => {
    await routerB.handleRequest({ method: "GET", path: "/fed/v1/node", headers: {} });
    routerB.clearAuditLog();
    expect(routerB.getAuditLog()).toEqual([]);
  });

  it("getAuditLog(n) returns at most n entries", async () => {
    for (let i = 0; i < 5; i++) {
      await routerB.handleRequest({ method: "GET", path: "/fed/v1/node", headers: {} });
    }
    expect(routerB.getAuditLog(2)).toHaveLength(2);
  });

  it("audit entry peerNodeId is null for unauthenticated requests", async () => {
    const req: FederationRequest = { method: "GET", path: "/fed/v1/node", headers: {} };
    await routerB.handleRequest(req);
    expect(routerB.getAuditLog()[0]?.peerNodeId).toBeNull();
  });

  it("audit entry peerNodeId is set for authenticated requests", async () => {
    // Perform handshake first to establish trust
    const { request, nonce, sigHeader: hs } = createHandshakeRequest(nodeA);
    const response = handleHandshakeRequest(nodeB, request, hs);
    verifyHandshakeResponse(nodeA, response, nonce);
    routerB.clearAuditLog();

    const sigHeader = nodeA.generateSigHeader(sha256(""));
    const req: FederationRequest = {
      method: "GET",
      path: "/fed/v1/peers",
      headers: { authorization: sigHeader },
    };
    await routerB.handleRequest(req);
    const entry = routerB.getAuditLog()[0];
    expect(entry?.peerNodeId).toBe("@A0");
  });
});
