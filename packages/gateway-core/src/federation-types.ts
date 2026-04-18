/**
 * Federation Protocol Types — Task #197
 *
 * Type definitions for the Mycelium Federation Protocol.
 * All /fed/v1/* endpoints share these types.
 *
 * Protocol: HTTP/2-based node-to-node communication
 * Auth: Mycelium-Sig header (Ed25519 signatures with replay protection)
 * Trust: Progressive (0=unknown, 1=handshake, 2=verified, 3=trusted)
 */

import type { GEID } from "@agi/entity-model";

// ---------------------------------------------------------------------------
// Node identity
// ---------------------------------------------------------------------------

/** Trust level between federation nodes. */
export type TrustLevel = 0 | 1 | 2 | 3;

/** Node manifest served at /.well-known/mycelium-node.json */
export interface NodeManifest {
  /** Schema version. */
  schema: "mycelium-node-v1";
  /** Node ID in @N format (e.g., @A0). */
  nodeId: string;
  /** Ed25519 public key, base64-encoded SPKI DER. */
  publicKey: string;
  /** Base URL for federation endpoints (e.g., https://node.example.com/fed/v1). */
  federationEndpoint: string;
  /** GENESIS seal fingerprint for this node. */
  genesisSeal: string;
  /** Protocols supported by this node. */
  supportedProtocols: FederationProtocol[];
  /** Human-readable node name. */
  displayName: string;
  /** Node operator contact (optional). */
  contact?: string;
  /** Node capabilities. */
  capabilities: NodeCapabilities;
}

export type FederationProtocol =
  | "peer-handshake-v1"
  | "entity-lookup-v1"
  | "coa-relay-v1"
  | "governance-vote-v1";

export interface NodeCapabilities {
  /** Whether this node accepts cross-node COA submissions. */
  coaRelay: boolean;
  /** Whether this node participates in governance votes. */
  governanceVoting: boolean;
  /** Whether this node shares entity discovery information. */
  entityDiscovery: boolean;
  /** Maximum COA records per relay batch. */
  maxCoaBatchSize: number;
}

// ---------------------------------------------------------------------------
// Peer management
// ---------------------------------------------------------------------------

/** Known peer node record. */
export interface PeerNode {
  /** Node ID. */
  nodeId: string;
  /** Federation endpoint URL. */
  endpoint: string;
  /** Node's public key (base64 SPKI DER). */
  publicKey: string;
  /** Current trust level. */
  trustLevel: TrustLevel;
  /** How this peer was discovered. */
  discoveryMethod: DiscoveryMethod;
  /** Last successful communication. */
  lastSeen: string;
  /** Last handshake timestamp. */
  lastHandshake: string | null;
  /** Number of failed connection attempts. */
  failureCount: number;
  /** Whether this peer is currently reachable. */
  online: boolean;
}

export type DiscoveryMethod = "manual" | "registry" | "peer-of-peer";

// ---------------------------------------------------------------------------
// Handshake protocol (POST /fed/v1/peer/hello)
// ---------------------------------------------------------------------------

/** Handshake request body. */
export interface HandshakeRequest {
  /** Requesting node's manifest. */
  manifest: NodeManifest;
  /** Nonce for this handshake (hex, 32 bytes). */
  nonce: string;
  /** ISO timestamp. */
  timestamp: string;
}

/** Handshake response body. */
export interface HandshakeResponse {
  /** Whether the handshake was accepted. */
  accepted: boolean;
  /** Responding node's manifest. */
  manifest: NodeManifest;
  /** Echo of request nonce + response nonce, signed. */
  nonceEcho: string;
  /** Response nonce (hex, 32 bytes). */
  responseNonce: string;
  /** Trust level assigned to the requesting node. */
  assignedTrust: TrustLevel;
  /** Reason for rejection (if not accepted). */
  reason?: string;
}

// ---------------------------------------------------------------------------
// Mycelium-Sig authorization header
// ---------------------------------------------------------------------------

/**
 * Mycelium-Sig header format:
 * Mycelium-Sig ed25519 <node_id>.<timestamp_unix>.<signature_hex>
 *
 * Replay window: 60 seconds
 */
export interface MyceliumSig {
  algorithm: "ed25519";
  nodeId: string;
  timestamp: number;
  signature: string;
}

// ---------------------------------------------------------------------------
// Federation API endpoints
// ---------------------------------------------------------------------------

/** Entity lookup request (GET /fed/v1/entities/:geid) */
export interface EntityLookupResponse {
  found: boolean;
  geid: GEID;
  /** Verification tier on the remote node. */
  verificationTier?: string;
  /** Display name (only if entity has opted into discovery). */
  displayName?: string;
  /** Node that owns this entity. */
  homeNode: string;
}

/** COA relay submission (POST /fed/v1/coa/submit) */
export interface COARelayRequest {
  /** COA records to relay. */
  records: COARelayRecord[];
  /** Originating node ID. */
  originNode: string;
}

export interface COARelayRecord {
  fingerprint: string;
  entityGeid: GEID;
  workType: string;
  impScore: number;
  createdAt: string;
  /** Signature over the COA record by the originating node. */
  originSignature: string;
}

export interface COARelayResponse {
  accepted: number;
  rejected: number;
  errors: Array<{ fingerprint: string; reason: string }>;
}

/** Governance vote relay (POST /fed/v1/governance/vote) */
export interface GovernanceVoteRequest {
  proposalId: string;
  voterGeid: GEID;
  vote: "approve" | "reject" | "abstain";
  weight: number;
  signature: string;
}

export interface GovernanceVoteResponse {
  recorded: boolean;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Ring protocol (node discovery)
// ---------------------------------------------------------------------------

/** Ring announce request (POST /fed/v1/ring/announce). */
export interface RingAnnounceRequest {
  /** Announcing node's manifest. */
  manifest: NodeManifest;
  /** Known peers to share (trust >= 1). */
  knownPeers: Array<{ nodeId: string; endpoint: string; trustLevel: TrustLevel }>;
}

export interface RingAnnounceResponse {
  /** Whether the announcement was accepted. */
  accepted: boolean;
  /** Peers the responder knows about (for mutual discovery). */
  knownPeers: Array<{ nodeId: string; endpoint: string; trustLevel: TrustLevel }>;
}

// ---------------------------------------------------------------------------
// Visitor authentication
// ---------------------------------------------------------------------------

/** Visitor authentication challenge (POST /fed/v1/identity/challenge). */
export interface VisitorChallengeRequest {
  /** Visitor's GEID. */
  geid: GEID;
  /** Visitor's home node ID. */
  homeNodeId: string;
}

export interface VisitorChallengeResponse {
  /** Challenge nonce (hex, 32 bytes). */
  challenge: string;
  /** Challenge expiry (ISO timestamp). */
  expiresAt: string;
}

/** Visitor authentication response (POST /fed/v1/identity/verify). */
export interface VisitorVerifyRequest {
  /** Visitor's GEID. */
  geid: GEID;
  /** The challenge nonce that was issued. */
  challenge: string;
  /** Ed25519 signature over the challenge by the visitor's private key. */
  signature: string;
}

export interface VisitorVerifyResponse {
  /** Whether authentication succeeded. */
  authenticated: boolean;
  /** Session token (if authenticated). */
  sessionToken?: string;
  /** Reason for rejection. */
  reason?: string;
}

// ---------------------------------------------------------------------------
// Federation errors
// ---------------------------------------------------------------------------

export interface FederationError {
  code: FederationErrorCode;
  message: string;
  nodeId?: string;
}

export type FederationErrorCode =
  | "UNTRUSTED_NODE"
  | "INVALID_SIGNATURE"
  | "REPLAY_DETECTED"
  | "RATE_LIMITED"
  | "UNKNOWN_ENTITY"
  | "PROTOCOL_MISMATCH"
  | "HANDSHAKE_FAILED"
  | "NODE_OFFLINE"
  | "INTERNAL_ERROR";
