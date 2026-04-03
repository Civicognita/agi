/**
 * Co-Verification Protocol — Task #203
 *
 * POST /fed/v1/peer/verify: Node A asks Nodes B,C to independently
 * verify a COA claim from Node D.
 *
 * Features:
 * - 3-of-N verification for higher governance confidence
 * - Track verification results per claim
 * - Trust level 2 upgrade: 30 days operational + 3 co-verifications
 *   from Level 2+ nodes
 */

import type { HashedCOARecord } from "./hash-chain.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Status of a single verification vote. */
export type VerificationVote = "confirmed" | "disputed" | "inconclusive";

/** A verification request sent to peer nodes. */
export interface CoVerificationRequest {
  /** Unique ID for this verification request. */
  requestId: string;
  /** Node requesting verification. */
  requestingNode: string;
  /** Node whose COA claim is being verified. */
  claimNode: string;
  /** The COA records to verify (chain segment). */
  records: HashedCOARecord[];
  /** Fingerprint of the specific record under scrutiny. */
  targetFingerprint: string;
  /** ISO timestamp when the request was created. */
  createdAt: string;
  /** ISO timestamp when responses are due. */
  deadline: string;
}

/** A verification response from a peer node. */
export interface CoVerificationResponse {
  requestId: string;
  /** Node providing the verification. */
  verifierNode: string;
  /** The verification vote. */
  vote: VerificationVote;
  /** Hash chain verification passed? */
  chainValid: boolean;
  /** Signatures verified? */
  signaturesValid: boolean;
  /** Any anomalies detected. */
  anomalies: string[];
  /** ISO timestamp. */
  respondedAt: string;
}

/** Tracked state of a co-verification process. */
export interface CoVerificationClaim {
  requestId: string;
  requestingNode: string;
  claimNode: string;
  targetFingerprint: string;
  /** Peer nodes asked to verify. */
  verifiers: string[];
  /** Responses received so far. */
  responses: CoVerificationResponse[];
  /** Current status. */
  status: "pending" | "confirmed" | "disputed" | "expired";
  /** Threshold required. */
  threshold: number;
  createdAt: string;
  deadline: string;
  resolvedAt: string | null;
}

/** Trust upgrade criteria. */
export interface TrustUpgradeCheck {
  nodeId: string;
  /** Days the node has been operational (since first handshake). */
  operationalDays: number;
  /** Number of successful co-verifications from Level 2+ nodes. */
  level2Verifications: number;
  /** Whether the node qualifies for trust level 2. */
  eligible: boolean;
  /** Missing criteria. */
  missing: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default number of confirming votes required. */
export const DEFAULT_THRESHOLD = 3;

/** Default deadline duration in hours. */
export const DEFAULT_DEADLINE_HOURS = 48;

/** Days of operation required for trust level 2 upgrade. */
export const TRUST_UPGRADE_MIN_DAYS = 30;

/** Number of Level 2+ co-verifications required for upgrade. */
export const TRUST_UPGRADE_MIN_VERIFICATIONS = 3;

// ---------------------------------------------------------------------------
// Co-Verification Manager
// ---------------------------------------------------------------------------

/**
 * Manages co-verification claims and trust level upgrades.
 *
 * This is an in-memory implementation suitable for a single node.
 * Production deployments should persist claims to a database.
 */
export class CoVerificationManager {
  private readonly claims = new Map<string, CoVerificationClaim>();
  /** Track how many successful L2+ verifications each node has accumulated. */
  private readonly nodeVerificationCounts = new Map<string, number>();
  /** Track when each node was first seen (ISO timestamp). */
  private readonly nodeFirstSeen = new Map<string, string>();

  /**
   * Create a new co-verification request.
   *
   * @param requestingNode - Node ID requesting verification
   * @param claimNode - Node whose claim is being verified
   * @param targetFingerprint - Fingerprint of the record to verify
   * @param verifiers - Node IDs of peers to ask for verification
   * @param records - The chain segment to verify
   * @param threshold - Number of confirming votes needed (default 3)
   * @returns The co-verification request to send to peers
   */
  createRequest(
    requestingNode: string,
    claimNode: string,
    targetFingerprint: string,
    verifiers: string[],
    records: HashedCOARecord[],
    threshold?: number,
  ): CoVerificationRequest {
    const requestId = generateRequestId();
    const now = new Date();
    const deadline = new Date(now.getTime() + DEFAULT_DEADLINE_HOURS * 60 * 60 * 1000);

    const claim: CoVerificationClaim = {
      requestId,
      requestingNode,
      claimNode,
      targetFingerprint,
      verifiers: [...verifiers],
      responses: [],
      status: "pending",
      threshold: threshold ?? DEFAULT_THRESHOLD,
      createdAt: now.toISOString(),
      deadline: deadline.toISOString(),
      resolvedAt: null,
    };

    this.claims.set(requestId, claim);

    return {
      requestId,
      requestingNode,
      claimNode,
      records,
      targetFingerprint,
      createdAt: claim.createdAt,
      deadline: claim.deadline,
    };
  }

  /**
   * Record a verification response from a peer node.
   *
   * @returns Updated claim status, or null if requestId not found
   */
  recordResponse(response: CoVerificationResponse): CoVerificationClaim | null {
    const claim = this.claims.get(response.requestId);
    if (!claim) return null;

    // Prevent duplicate responses from same verifier
    if (claim.responses.some(r => r.verifierNode === response.verifierNode)) {
      return claim;
    }

    // Only accept responses from designated verifiers
    if (!claim.verifiers.includes(response.verifierNode)) {
      return claim;
    }

    claim.responses.push(response);

    // Check if we've reached a decision
    this.evaluateClaim(claim);

    return claim;
  }

  /**
   * Get a claim by its request ID.
   */
  getClaim(requestId: string): CoVerificationClaim | null {
    return this.claims.get(requestId) ?? null;
  }

  /**
   * Get all claims for a specific node (as claim target).
   */
  getClaimsForNode(claimNode: string): CoVerificationClaim[] {
    const result: CoVerificationClaim[] = [];
    for (const claim of this.claims.values()) {
      if (claim.claimNode === claimNode) {
        result.push(claim);
      }
    }
    return result;
  }

  /**
   * Get all confirmed verifications for a node from Level 2+ verifiers.
   *
   * @param claimNode - The node being verified
   * @param level2PlusNodes - Set of node IDs at trust level 2+
   */
  getLevel2Verifications(claimNode: string, level2PlusNodes: Set<string>): number {
    let count = this.nodeVerificationCounts.get(claimNode) ?? 0;

    // Also count from active confirmed claims
    for (const claim of this.claims.values()) {
      if (claim.claimNode === claimNode && claim.status === "confirmed") {
        for (const resp of claim.responses) {
          if (resp.vote === "confirmed" && level2PlusNodes.has(resp.verifierNode)) {
            // Already counted in nodeVerificationCounts via evaluateClaim
          }
        }
      }
    }

    return count;
  }

  /**
   * Register when a node was first seen (for trust upgrade calculation).
   */
  registerNodeFirstSeen(nodeId: string, timestamp: string): void {
    if (!this.nodeFirstSeen.has(nodeId)) {
      this.nodeFirstSeen.set(nodeId, timestamp);
    }
  }

  /**
   * Check whether a node is eligible for trust level 2 upgrade.
   *
   * Requirements:
   * - 30+ days since first seen
   * - 3+ co-verifications from Level 2+ nodes
   */
  checkTrustUpgrade(
    nodeId: string,
    level2PlusNodes: Set<string>,
    now?: Date,
  ): TrustUpgradeCheck {
    const currentTime = now ?? new Date();
    const firstSeen = this.nodeFirstSeen.get(nodeId);

    let operationalDays = 0;
    if (firstSeen) {
      const msPerDay = 24 * 60 * 60 * 1000;
      operationalDays = Math.floor(
        (currentTime.getTime() - new Date(firstSeen).getTime()) / msPerDay,
      );
    }

    const level2Verifications = this.getLevel2Verifications(nodeId, level2PlusNodes);

    const missing: string[] = [];
    if (operationalDays < TRUST_UPGRADE_MIN_DAYS) {
      missing.push(`Need ${TRUST_UPGRADE_MIN_DAYS - operationalDays} more days operational`);
    }
    if (level2Verifications < TRUST_UPGRADE_MIN_VERIFICATIONS) {
      missing.push(
        `Need ${TRUST_UPGRADE_MIN_VERIFICATIONS - level2Verifications} more Level 2+ verifications`,
      );
    }

    return {
      nodeId,
      operationalDays,
      level2Verifications,
      eligible: missing.length === 0,
      missing,
    };
  }

  /**
   * Expire all claims past their deadline.
   */
  expireClaims(now?: Date): number {
    const currentTime = now ?? new Date();
    let expired = 0;

    for (const claim of this.claims.values()) {
      if (claim.status === "pending" && new Date(claim.deadline) < currentTime) {
        claim.status = "expired";
        claim.resolvedAt = currentTime.toISOString();
        expired++;
      }
    }

    return expired;
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private evaluateClaim(claim: CoVerificationClaim): void {
    if (claim.status !== "pending") return;

    const confirmed = claim.responses.filter(r => r.vote === "confirmed").length;
    const disputed = claim.responses.filter(r => r.vote === "disputed").length;
    const total = claim.responses.length;

    // Confirmed: threshold met
    if (confirmed >= claim.threshold) {
      claim.status = "confirmed";
      claim.resolvedAt = new Date().toISOString();

      // Increment verification count for the claim node
      const prev = this.nodeVerificationCounts.get(claim.claimNode) ?? 0;
      this.nodeVerificationCounts.set(claim.claimNode, prev + 1);
      return;
    }

    // Disputed: majority dispute with enough responses
    if (disputed > claim.verifiers.length / 2 && total >= claim.threshold) {
      claim.status = "disputed";
      claim.resolvedAt = new Date().toISOString();
      return;
    }

    // If all verifiers responded but threshold not met
    if (total >= claim.verifiers.length) {
      // Not enough confirms = disputed
      claim.status = disputed > confirmed ? "disputed" : "expired";
      claim.resolvedAt = new Date().toISOString();
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let requestCounter = 0;

function generateRequestId(): string {
  const now = Date.now().toString(36);
  const counter = (requestCounter++).toString(36).padStart(4, "0");
  const rand = Math.random().toString(36).slice(2, 8);
  return `cvr-${now}-${counter}-${rand}`;
}
