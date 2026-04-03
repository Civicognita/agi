/**
 * Trust Level Engine — Task #221
 *
 * Trust level 3 (Established): 90 days operational + 5 co-verifications
 *   from Established nodes + no disputed claims in good standing.
 *
 * Trust level 4 (Anchor): granted by governance vote only.
 *   Anchor quorum for emergency protocol changes (4-of-5 within 24h).
 *   Anchor node appointment ceremony in governance system.
 */

import type { TrustLevel, PeerNode } from "./federation-types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Trust level definitions (extended from federation-types). */
export type ExtendedTrustLevel = TrustLevel | 4;

/** Trust level names. */
export const TRUST_LEVEL_NAMES: Record<ExtendedTrustLevel, string> = {
  0: "Unknown",
  1: "Handshake",
  2: "Verified",
  3: "Established",
  4: "Anchor",
};

/** Requirements for trust level 3 (Established). */
export interface EstablishedRequirements {
  /** Minimum operational days (from first successful handshake). */
  minOperationalDays: number;
  /** Minimum co-verifications from Established (L3+) nodes. */
  minEstablishedCoVerifications: number;
  /** Maximum disputed claims allowed (0 = none tolerated). */
  maxDisputedClaims: number;
}

/** Default requirements for trust level 3. */
export const DEFAULT_ESTABLISHED_REQUIREMENTS: EstablishedRequirements = {
  minOperationalDays: 90,
  minEstablishedCoVerifications: 5,
  maxDisputedClaims: 0,
};

/** Input data for trust level 3 evaluation. */
export interface TrustEvaluationInput {
  /** Node being evaluated. */
  nodeId: string;
  /** Date of first successful handshake. */
  firstHandshakeDate: Date;
  /** Number of co-verifications from Established (L3+) nodes. */
  establishedCoVerifications: number;
  /** Number of disputed claims against this node. */
  disputedClaims: number;
  /** Whether the node is currently in good standing. */
  inGoodStanding: boolean;
}

/** Result of trust level evaluation. */
export interface TrustEvaluationResult {
  /** Whether the node qualifies for the target trust level. */
  qualifies: boolean;
  /** Current trust level. */
  currentLevel: ExtendedTrustLevel;
  /** Target trust level being evaluated. */
  targetLevel: ExtendedTrustLevel;
  /** Missing requirements (empty if qualifies). */
  gaps: TrustGap[];
}

export interface TrustGap {
  requirement: string;
  current: number | boolean;
  needed: number | boolean;
}

/** Anchor appointment request via governance vote. */
export interface AnchorAppointment {
  /** Node being appointed as Anchor. */
  nodeId: string;
  /** Governance proposal ID that authorized the appointment. */
  proposalId: string;
  /** Vote tally. */
  votesFor: number;
  votesAgainst: number;
  /** Appointment timestamp. */
  appointedAt: string;
  /** Appointing ceremony witness nodes. */
  witnesses: string[];
}

/** Emergency protocol change request (Anchor quorum). */
export interface EmergencyProtocolChange {
  /** Unique change request ID. */
  changeId: string;
  /** Description of the emergency change. */
  description: string;
  /** Change type. */
  changeType: "protocol_patch" | "node_quarantine" | "emergency_freeze";
  /** Anchor nodes that have approved. */
  approvals: AnchorApproval[];
  /** Deadline for quorum (24 hours from creation). */
  deadline: string;
  /** Status. */
  status: "pending" | "approved" | "rejected" | "expired";
  /** Created timestamp. */
  createdAt: string;
}

export interface AnchorApproval {
  nodeId: string;
  signature: string;
  timestamp: string;
}

/** Anchor quorum configuration. */
export interface AnchorQuorumConfig {
  /** Minimum anchors required for emergency changes. */
  minAnchors: number;
  /** Maximum total anchors (denominator for quorum). */
  totalAnchors: number;
  /** Time limit for gathering quorum (hours). */
  deadlineHours: number;
}

export const DEFAULT_ANCHOR_QUORUM: AnchorQuorumConfig = {
  minAnchors: 4,
  totalAnchors: 5,
  deadlineHours: 24,
};

// ---------------------------------------------------------------------------
// Trust Engine
// ---------------------------------------------------------------------------

export class TrustEngine {
  private readonly requirements: EstablishedRequirements;
  private readonly quorumConfig: AnchorQuorumConfig;
  private readonly anchors = new Map<string, AnchorAppointment>();
  private readonly emergencyChanges = new Map<string, EmergencyProtocolChange>();

  constructor(
    requirements?: Partial<EstablishedRequirements>,
    quorumConfig?: Partial<AnchorQuorumConfig>,
  ) {
    this.requirements = { ...DEFAULT_ESTABLISHED_REQUIREMENTS, ...requirements };
    this.quorumConfig = { ...DEFAULT_ANCHOR_QUORUM, ...quorumConfig };
  }

  // -------------------------------------------------------------------------
  // Trust Level 3 (Established)
  // -------------------------------------------------------------------------

  /**
   * Evaluate whether a node qualifies for trust level 3 (Established).
   */
  evaluateEstablished(
    input: TrustEvaluationInput,
    now = new Date(),
  ): TrustEvaluationResult {
    const gaps: TrustGap[] = [];

    // Check operational days
    const operationalDays = Math.floor(
      (now.getTime() - input.firstHandshakeDate.getTime()) / (24 * 60 * 60 * 1000),
    );
    if (operationalDays < this.requirements.minOperationalDays) {
      gaps.push({
        requirement: "Operational days",
        current: operationalDays,
        needed: this.requirements.minOperationalDays,
      });
    }

    // Check co-verifications from Established nodes
    if (input.establishedCoVerifications < this.requirements.minEstablishedCoVerifications) {
      gaps.push({
        requirement: "Established co-verifications",
        current: input.establishedCoVerifications,
        needed: this.requirements.minEstablishedCoVerifications,
      });
    }

    // Check disputed claims
    if (input.disputedClaims > this.requirements.maxDisputedClaims) {
      gaps.push({
        requirement: "No disputed claims",
        current: input.disputedClaims,
        needed: this.requirements.maxDisputedClaims,
      });
    }

    // Check good standing
    if (!input.inGoodStanding) {
      gaps.push({
        requirement: "Good standing",
        current: false,
        needed: true,
      });
    }

    return {
      qualifies: gaps.length === 0,
      currentLevel: 2,
      targetLevel: 3,
      gaps,
    };
  }

  // -------------------------------------------------------------------------
  // Trust Level 4 (Anchor) — Governance-Only
  // -------------------------------------------------------------------------

  /**
   * Record an Anchor node appointment from a governance vote.
   * Only governance can grant trust level 4.
   */
  appointAnchor(appointment: AnchorAppointment): void {
    this.anchors.set(appointment.nodeId, appointment);
  }

  /**
   * Revoke an Anchor node's trust level 4 (governance vote required).
   */
  revokeAnchor(nodeId: string): boolean {
    return this.anchors.delete(nodeId);
  }

  /**
   * Check whether a node is an Anchor.
   */
  isAnchor(nodeId: string): boolean {
    return this.anchors.has(nodeId);
  }

  /**
   * Get all Anchor nodes.
   */
  getAnchors(): AnchorAppointment[] {
    return [...this.anchors.values()];
  }

  /**
   * Get the effective trust level for a node (including Anchor status).
   */
  getEffectiveTrustLevel(peer: PeerNode): ExtendedTrustLevel {
    if (this.isAnchor(peer.nodeId)) return 4;
    return peer.trustLevel as ExtendedTrustLevel;
  }

  // -------------------------------------------------------------------------
  // Emergency Protocol Changes (Anchor Quorum)
  // -------------------------------------------------------------------------

  /**
   * Create an emergency protocol change request.
   * Requires an Anchor node to initiate.
   */
  createEmergencyChange(
    changeId: string,
    description: string,
    changeType: EmergencyProtocolChange["changeType"],
    initiatorNodeId: string,
    initiatorSignature: string,
    now = new Date(),
  ): EmergencyProtocolChange | null {
    if (!this.isAnchor(initiatorNodeId)) return null;

    const deadline = new Date(
      now.getTime() + this.quorumConfig.deadlineHours * 60 * 60 * 1000,
    );

    const change: EmergencyProtocolChange = {
      changeId,
      description,
      changeType,
      approvals: [
        {
          nodeId: initiatorNodeId,
          signature: initiatorSignature,
          timestamp: now.toISOString(),
        },
      ],
      deadline: deadline.toISOString(),
      status: "pending",
      createdAt: now.toISOString(),
    };

    this.emergencyChanges.set(changeId, change);
    return change;
  }

  /**
   * Add an Anchor approval to an emergency change.
   * Returns updated status.
   */
  approveEmergencyChange(
    changeId: string,
    nodeId: string,
    signature: string,
    now = new Date(),
  ): EmergencyProtocolChange | null {
    const change = this.emergencyChanges.get(changeId);
    if (!change || change.status !== "pending") return null;
    if (!this.isAnchor(nodeId)) return null;

    // Check deadline
    if (now > new Date(change.deadline)) {
      change.status = "expired";
      return change;
    }

    // Prevent duplicate approval
    if (change.approvals.some(a => a.nodeId === nodeId)) return change;

    change.approvals.push({
      nodeId,
      signature,
      timestamp: now.toISOString(),
    });

    // Check quorum
    if (change.approvals.length >= this.quorumConfig.minAnchors) {
      change.status = "approved";
    }

    return change;
  }

  /**
   * Reject an emergency change (any Anchor can reject).
   */
  rejectEmergencyChange(changeId: string, nodeId: string): boolean {
    const change = this.emergencyChanges.get(changeId);
    if (!change || change.status !== "pending") return false;
    if (!this.isAnchor(nodeId)) return false;

    change.status = "rejected";
    return true;
  }

  /**
   * Expire overdue emergency changes.
   */
  expireOverdueChanges(now = new Date()): number {
    let expired = 0;
    for (const change of this.emergencyChanges.values()) {
      if (change.status === "pending" && now > new Date(change.deadline)) {
        change.status = "expired";
        expired++;
      }
    }
    return expired;
  }

  /**
   * Get an emergency change by ID.
   */
  getEmergencyChange(changeId: string): EmergencyProtocolChange | null {
    return this.emergencyChanges.get(changeId) ?? null;
  }

  /**
   * Get all pending emergency changes.
   */
  getPendingChanges(): EmergencyProtocolChange[] {
    return [...this.emergencyChanges.values()].filter(c => c.status === "pending");
  }
}
