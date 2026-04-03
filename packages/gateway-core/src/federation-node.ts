/**
 * Federation Node Manifest & Discovery — Task #195
 *
 * Serves the mycelium-node-v1 manifest at /.well-known/mycelium-node.json.
 * Manages peer discovery via manual config, registry lookup, and
 * transitive peer-of-peer (depth limited to 2 hops).
 *
 * @see federation-types.ts for all type definitions
 */

import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
  randomBytes,
  type KeyObject,
} from "node:crypto";

import type {
  NodeManifest,
  PeerNode,
  DiscoveryMethod,
  TrustLevel,
  NodeCapabilities,
  FederationProtocol,
} from "./federation-types.js";
import type { FederationPeerStore } from "./federation-peer-store.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FederationNodeConfig {
  /** Node ID in @N format. */
  nodeId: string;
  /** Human-readable node name. */
  displayName: string;
  /** Base URL for this node's federation endpoint. */
  federationEndpoint: string;
  /** GENESIS seal fingerprint. */
  genesisSeal: string;
  /** Ed25519 private key PEM for signing. */
  privateKeyPem: string;
  /** Node capabilities. */
  capabilities?: Partial<NodeCapabilities>;
  /** Maximum peer-of-peer discovery depth. */
  maxDiscoveryDepth?: number;
  /** Maximum number of known peers. */
  maxPeers?: number;
  /** Optional SQLite-backed peer store (replaces in-memory Map). */
  peerStore?: FederationPeerStore;
}

// ---------------------------------------------------------------------------
// Default capabilities
// ---------------------------------------------------------------------------

const DEFAULT_CAPABILITIES: NodeCapabilities = {
  coaRelay: true,
  governanceVoting: true,
  entityDiscovery: true,
  maxCoaBatchSize: 100,
};

const DEFAULT_PROTOCOLS: FederationProtocol[] = [
  "peer-handshake-v1",
  "entity-lookup-v1",
  "coa-relay-v1",
  "governance-vote-v1",
];

// ---------------------------------------------------------------------------
// Federation Node
// ---------------------------------------------------------------------------

/**
 * Manages this node's federation identity and peer relationships.
 *
 * Responsibilities:
 * - Generate and serve the node manifest
 * - Track known peers with trust levels
 * - Discover new peers via configured methods
 * - Generate and verify Mycelium-Sig headers
 */
export class FederationNode {
  private readonly config: FederationNodeConfig;
  private readonly privateKey: KeyObject;
  private readonly publicKey: KeyObject;
  private readonly publicKeyBase64: string;
  private readonly peers = new Map<string, PeerNode>();
  private readonly maxDiscoveryDepth: number;
  private readonly maxPeers: number;
  private readonly peerStore: FederationPeerStore | null;

  constructor(config: FederationNodeConfig) {
    this.config = config;
    this.maxDiscoveryDepth = config.maxDiscoveryDepth ?? 2;
    this.maxPeers = config.maxPeers ?? 100;
    this.peerStore = config.peerStore ?? null;

    this.privateKey = createPrivateKey(config.privateKeyPem);
    this.publicKey = createPublicKey(this.privateKey);

    const spkiDer = this.publicKey.export({ type: "spki", format: "der" }) as Buffer;
    this.publicKeyBase64 = spkiDer.toString("base64");
  }

  // -------------------------------------------------------------------------
  // Manifest
  // -------------------------------------------------------------------------

  /**
   * Generate the node manifest for /.well-known/mycelium-node.json
   */
  getManifest(): NodeManifest {
    return {
      schema: "mycelium-node-v1",
      nodeId: this.config.nodeId,
      publicKey: this.publicKeyBase64,
      federationEndpoint: this.config.federationEndpoint,
      genesisSeal: this.config.genesisSeal,
      supportedProtocols: [...DEFAULT_PROTOCOLS],
      displayName: this.config.displayName,
      capabilities: { ...DEFAULT_CAPABILITIES, ...this.config.capabilities },
    };
  }

  /**
   * Get this node's ID.
   */
  getNodeId(): string {
    return this.config.nodeId;
  }

  /**
   * Get this node's public key as base64-encoded SPKI DER.
   */
  getPublicKeyBase64(): string {
    return this.publicKeyBase64;
  }

  // -------------------------------------------------------------------------
  // Signing / Verification
  // -------------------------------------------------------------------------

  /**
   * Sign a payload with this node's private key.
   * @returns Hex-encoded Ed25519 signature.
   */
  signPayload(data: string | Buffer): string {
    const buf = typeof data === "string" ? Buffer.from(data) : data;
    return sign(null, buf, this.privateKey).toString("hex");
  }

  /**
   * Verify a signature against a public key.
   */
  verifyPayload(data: string | Buffer, signatureHex: string, publicKeyBase64: string): boolean {
    const buf = typeof data === "string" ? Buffer.from(data) : data;
    const spkiDer = Buffer.from(publicKeyBase64, "base64");
    const pubKey = createPublicKey({ key: spkiDer, format: "der", type: "spki" });
    const sig = Buffer.from(signatureHex, "hex");
    return verify(null, buf, pubKey, sig);
  }

  /**
   * Generate a Mycelium-Sig authorization header value.
   *
   * Format: Mycelium-Sig ed25519 <node_id>.<timestamp_unix>.<signature_hex>
   * The signature covers: <node_id>.<timestamp_unix>.<request_body_hash>
   */
  generateSigHeader(bodyHash: string): string {
    const timestamp = Math.floor(Date.now() / 1000);
    const payload = `${this.config.nodeId}.${timestamp}.${bodyHash}`;
    const signature = this.signPayload(payload);
    return `Mycelium-Sig ed25519 ${this.config.nodeId}.${timestamp}.${signature}`;
  }

  /**
   * Parse and verify a Mycelium-Sig header.
   * @returns Parsed signature data or null if invalid.
   */
  parseSigHeader(
    header: string,
    bodyHash: string,
    maxAgeSeconds = 60,
  ): { nodeId: string; timestamp: number; valid: boolean } | null {
    const match = header.match(/^Mycelium-Sig ed25519 ([^.]+)\.(\d+)\.([a-f0-9]+)$/);
    if (!match) return null;

    const [, nodeId, timestampStr, signatureHex] = match;
    if (!nodeId || !timestampStr || !signatureHex) return null;

    const timestamp = parseInt(timestampStr, 10);
    const now = Math.floor(Date.now() / 1000);

    // Replay window check
    if (Math.abs(now - timestamp) > maxAgeSeconds) {
      return { nodeId, timestamp, valid: false };
    }

    // Look up peer's public key
    const peer = this.peers.get(nodeId);
    if (!peer) return { nodeId, timestamp, valid: false };

    const payload = `${nodeId}.${timestamp}.${bodyHash}`;
    const valid = this.verifyPayload(payload, signatureHex, peer.publicKey);

    return { nodeId, timestamp, valid };
  }

  /**
   * Generate a random nonce for handshakes.
   */
  generateNonce(): string {
    return randomBytes(32).toString("hex");
  }

  // -------------------------------------------------------------------------
  // Peer management
  // -------------------------------------------------------------------------

  /**
   * Add a peer node (from manual config or discovery).
   */
  addPeer(
    nodeId: string,
    endpoint: string,
    publicKey: string,
    method: DiscoveryMethod,
    trustLevel: TrustLevel = 0,
  ): PeerNode {
    if (this.peerStore) {
      return this.peerStore.addPeer(nodeId, endpoint, publicKey, method, trustLevel);
    }

    if (this.peers.size >= this.maxPeers) {
      throw new Error(`Maximum peer count reached: ${this.maxPeers}`);
    }

    const peer: PeerNode = {
      nodeId,
      endpoint,
      publicKey,
      trustLevel,
      discoveryMethod: method,
      lastSeen: new Date().toISOString(),
      lastHandshake: null,
      failureCount: 0,
      online: false,
    };

    this.peers.set(nodeId, peer);
    return peer;
  }

  /**
   * Update a peer after a successful handshake.
   */
  recordHandshake(nodeId: string, assignedTrust: TrustLevel): PeerNode | null {
    if (this.peerStore) {
      return this.peerStore.recordHandshake(nodeId, assignedTrust);
    }

    const peer = this.peers.get(nodeId);
    if (!peer) return null;

    peer.trustLevel = assignedTrust;
    peer.lastHandshake = new Date().toISOString();
    peer.lastSeen = new Date().toISOString();
    peer.online = true;
    peer.failureCount = 0;

    return peer;
  }

  /**
   * Record a communication failure with a peer.
   */
  recordFailure(nodeId: string): void {
    if (this.peerStore) {
      return this.peerStore.recordFailure(nodeId);
    }

    const peer = this.peers.get(nodeId);
    if (!peer) return;

    peer.failureCount++;
    if (peer.failureCount >= 5) {
      peer.online = false;
    }
  }

  /**
   * Get a specific peer.
   */
  getPeer(nodeId: string): PeerNode | null {
    if (this.peerStore) {
      return this.peerStore.getPeer(nodeId);
    }
    return this.peers.get(nodeId) ?? null;
  }

  /**
   * Get all known peers.
   */
  getAllPeers(): PeerNode[] {
    if (this.peerStore) {
      return this.peerStore.getAllPeers();
    }
    return [...this.peers.values()];
  }

  /**
   * Get peers at or above a given trust level.
   */
  getTrustedPeers(minTrust: TrustLevel): PeerNode[] {
    if (this.peerStore) {
      return this.peerStore.getTrustedPeers(minTrust);
    }
    return [...this.peers.values()].filter(p => p.trustLevel >= minTrust);
  }

  /**
   * Remove a peer.
   */
  removePeer(nodeId: string): boolean {
    if (this.peerStore) {
      return this.peerStore.removePeer(nodeId);
    }
    return this.peers.delete(nodeId);
  }

  /**
   * Update a peer's trust level.
   */
  setTrustLevel(nodeId: string, level: TrustLevel): boolean {
    if (this.peerStore) {
      return this.peerStore.setTrustLevel(nodeId, level);
    }
    const peer = this.peers.get(nodeId);
    if (!peer) return false;
    peer.trustLevel = level;
    return true;
  }

  /**
   * Get the max discovery depth for peer-of-peer discovery.
   */
  getMaxDiscoveryDepth(): number {
    return this.maxDiscoveryDepth;
  }

  // -------------------------------------------------------------------------
  // HIVE-ID Integration
  // -------------------------------------------------------------------------

  /**
   * Register this node's GEID and public key with HIVE-ID.
   * Called on boot when federation is enabled. Non-fatal on failure.
   *
   * @param hiveUrl - Base URL of the HIVE-ID service (e.g. "https://id.aionima.ai")
   */
  async registerWithHive(hiveUrl: string): Promise<boolean> {
    try {
      // Register GEID
      const geidRes = await fetch(`${hiveUrl}/hive/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          geid: this.config.nodeId,
          publicKey: this.publicKeyBase64,
          homeNodeUrl: this.config.federationEndpoint,
          displayName: this.config.displayName,
          entityType: "node",
        }),
      });

      if (!geidRes.ok) return false;

      // Register node
      const nodeRes = await fetch(`${hiveUrl}/hive/register/node`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nodeId: this.config.nodeId,
          url: this.config.federationEndpoint,
          publicKey: this.publicKeyBase64,
          displayName: this.config.displayName,
          capabilities: {
            ...DEFAULT_CAPABILITIES,
            ...this.config.capabilities,
          },
        }),
      });

      return nodeRes.ok;
    } catch {
      return false;
    }
  }

  /**
   * Verify a plugin seal against HIVE-ID.
   *
   * @param hiveUrl - Base URL of the HIVE-ID service
   * @param sealId - The seal ID to verify
   * @param expectedHash - The expected manifest hash
   */
  async verifyPluginSeal(
    hiveUrl: string,
    sealId: string,
    expectedHash: string,
  ): Promise<{ valid: boolean; seal?: { pluginId: string; version: string; signedBy: string } }> {
    try {
      const res = await fetch(`${hiveUrl}/hive/seals/verify/${sealId}`);
      if (!res.ok) return { valid: false };

      const seal = (await res.json()) as {
        sealId: string;
        pluginId: string;
        version: string;
        manifestHash: string;
        signedBy: string;
      };

      return {
        valid: seal.manifestHash === expectedHash,
        seal: {
          pluginId: seal.pluginId,
          version: seal.version,
          signedBy: seal.signedBy,
        },
      };
    } catch {
      return { valid: false };
    }
  }
}

// ---------------------------------------------------------------------------
// Key generation helper
// ---------------------------------------------------------------------------

/**
 * Generate a new Ed25519 keypair for a federation node.
 */
export function generateNodeKeypair(): { privateKeyPem: string; publicKeyPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }) as string,
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }) as string,
  };
}
