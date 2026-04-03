/**
 * Federation Handshake Protocol — Task #196
 *
 * Implements the node-to-node handshake via POST /fed/v1/peer/hello.
 * Exchanges public keys, verifies node identity via Ed25519 signatures.
 *
 * Handshake flow:
 * 1. Initiator sends its manifest + nonce
 * 2. Responder verifies signature, returns its manifest + nonce echo
 * 3. Initiator verifies response nonce echo
 * 4. Both nodes record trust level 1
 *
 * @see federation-types.ts for HandshakeRequest/Response types
 */

import { createHash } from "node:crypto";

import type {
  HandshakeRequest,
  HandshakeResponse,
  NodeManifest,
  TrustLevel,
} from "./federation-types.js";
import type { FederationNode } from "./federation-node.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HandshakeResult {
  success: boolean;
  peerNodeId: string;
  peerManifest?: NodeManifest;
  assignedTrust: TrustLevel;
  error?: string;
}

export interface HandshakeValidation {
  valid: boolean;
  error?: string;
  request?: HandshakeRequest;
}

// ---------------------------------------------------------------------------
// Handshake Handler (Responder side)
// ---------------------------------------------------------------------------

/**
 * Handle an incoming handshake request.
 *
 * Called when POST /fed/v1/peer/hello is received.
 * Validates the request, registers the peer, and returns a response.
 */
export function handleHandshakeRequest(
  node: FederationNode,
  request: HandshakeRequest,
  sigHeader: string,
): HandshakeResponse {
  const myManifest = node.getManifest();

  // 1. Validate request structure
  if (!request.manifest || !request.nonce || !request.timestamp) {
    return rejectHandshake(myManifest, "Missing required fields");
  }

  // 2. Validate manifest schema
  if (request.manifest.schema !== "mycelium-node-v1") {
    return rejectHandshake(myManifest, "Unsupported manifest schema");
  }

  // 3. Reject self-handshake
  if (request.manifest.nodeId === node.getNodeId()) {
    return rejectHandshake(myManifest, "Cannot handshake with self");
  }

  // 4. Verify timestamp freshness (60 second window)
  const requestTime = new Date(request.timestamp).getTime();
  const now = Date.now();
  if (Math.abs(now - requestTime) > 60_000) {
    return rejectHandshake(myManifest, "Handshake timestamp expired");
  }

  // 5. Verify signature from Mycelium-Sig header
  const bodyHash = hashBody(JSON.stringify(request));

  // We need to add the peer first to verify their signature
  // (parseSigHeader looks up the peer's public key)
  const existingPeer = node.getPeer(request.manifest.nodeId);
  if (!existingPeer) {
    node.addPeer(
      request.manifest.nodeId,
      request.manifest.federationEndpoint,
      request.manifest.publicKey,
      "manual",
      0,
    );
  }

  const sigResult = node.parseSigHeader(sigHeader, bodyHash);
  if (!sigResult || !sigResult.valid) {
    // Remove the peer we just added if signature is invalid
    if (!existingPeer) {
      node.removePeer(request.manifest.nodeId);
    }
    return rejectHandshake(myManifest, "Invalid signature");
  }

  // 6. Generate response nonce
  const responseNonce = node.generateNonce();

  // 7. Sign the nonce echo (request nonce + response nonce)
  const noncePayload = `${request.nonce}.${responseNonce}`;
  const nonceEcho = node.signPayload(noncePayload);

  // 8. Assign trust level 1 (handshake complete)
  const assignedTrust: TrustLevel = 1;
  node.recordHandshake(request.manifest.nodeId, assignedTrust);

  return {
    accepted: true,
    manifest: myManifest,
    nonceEcho,
    responseNonce,
    assignedTrust,
  };
}

/**
 * Verify a handshake response (Initiator side).
 *
 * Called after receiving a response to our handshake request.
 */
export function verifyHandshakeResponse(
  node: FederationNode,
  response: HandshakeResponse,
  originalNonce: string,
): HandshakeResult {
  if (!response.accepted) {
    return {
      success: false,
      peerNodeId: response.manifest.nodeId,
      assignedTrust: 0,
      error: response.reason ?? "Handshake rejected",
    };
  }

  // Verify nonce echo signature
  const noncePayload = `${originalNonce}.${response.responseNonce}`;
  const valid = node.verifyPayload(
    noncePayload,
    response.nonceEcho,
    response.manifest.publicKey,
  );

  if (!valid) {
    return {
      success: false,
      peerNodeId: response.manifest.nodeId,
      assignedTrust: 0,
      error: "Invalid nonce echo signature",
    };
  }

  // Register or update peer
  const existingPeer = node.getPeer(response.manifest.nodeId);
  if (!existingPeer) {
    node.addPeer(
      response.manifest.nodeId,
      response.manifest.federationEndpoint,
      response.manifest.publicKey,
      "manual",
      response.assignedTrust,
    );
  }
  node.recordHandshake(response.manifest.nodeId, response.assignedTrust);

  return {
    success: true,
    peerNodeId: response.manifest.nodeId,
    peerManifest: response.manifest,
    assignedTrust: response.assignedTrust,
  };
}

/**
 * Create a handshake request to send to a peer.
 */
export function createHandshakeRequest(
  node: FederationNode,
): { request: HandshakeRequest; nonce: string; sigHeader: string } {
  const nonce = node.generateNonce();
  const timestamp = new Date().toISOString();

  const request: HandshakeRequest = {
    manifest: node.getManifest(),
    nonce,
    timestamp,
  };

  const bodyHash = hashBody(JSON.stringify(request));
  const sigHeader = node.generateSigHeader(bodyHash);

  return { request, nonce, sigHeader };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rejectHandshake(manifest: NodeManifest, reason: string): HandshakeResponse {
  return {
    accepted: false,
    manifest,
    nonceEcho: "",
    responseNonce: "",
    assignedTrust: 0,
    reason,
  };
}

function hashBody(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}
