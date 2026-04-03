/**
 * Proposal Creation and Lifecycle System — Task #206
 *
 * Proposal types:
 *   Type 1 (Protocol Change): 2/3 Steward + 1/2 Contributor, 50% quorum
 *   Type 2 (Governance Rule): 3/4 Steward + 2/3 Contributor, 60% quorum
 *   Type 3 (Community): Simple majority, 25 votes minimum
 *   Type 4 (Emergency): 4-of-5 Anchors, 24h window
 *
 * Lifecycle: draft → open → voting → decided → enacted
 */

import type { GovernanceTier } from "./tier-engine.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Proposal types per governance spec. */
export type ProposalType = 1 | 2 | 3 | 4;

/** Proposal lifecycle status. */
export type ProposalStatus = "draft" | "open" | "voting" | "decided" | "enacted" | "rejected" | "expired";

/** Proposal type names. */
export const PROPOSAL_TYPE_NAMES: Record<ProposalType, string> = {
  1: "Protocol Change",
  2: "Governance Rule Change",
  3: "Community",
  4: "Emergency",
};

/** Approval requirements per proposal type. */
export interface ApprovalRequirements {
  /** Required Steward (Tier 3) approval fraction. */
  stewardApproval: number;
  /** Required Contributor (Tier 2) approval fraction. */
  contributorApproval: number;
  /** Quorum: fraction of eligible voters or minimum vote count. */
  quorum: number;
  /** Whether quorum is a fraction (true) or absolute count (false). */
  quorumIsFraction: boolean;
  /** Voting window duration in hours. */
  votingWindowHours: number;
}

/** Default approval requirements per proposal type. */
export const APPROVAL_REQUIREMENTS: Record<ProposalType, ApprovalRequirements> = {
  1: {
    stewardApproval: 2 / 3,
    contributorApproval: 1 / 2,
    quorum: 0.50,
    quorumIsFraction: true,
    votingWindowHours: 168, // 7 days
  },
  2: {
    stewardApproval: 3 / 4,
    contributorApproval: 2 / 3,
    quorum: 0.60,
    quorumIsFraction: true,
    votingWindowHours: 336, // 14 days
  },
  3: {
    stewardApproval: 0,
    contributorApproval: 0,
    quorum: 25,
    quorumIsFraction: false,
    votingWindowHours: 168, // 7 days
  },
  4: {
    stewardApproval: 0,
    contributorApproval: 0,
    quorum: 4, // 4-of-5 Anchors
    quorumIsFraction: false,
    votingWindowHours: 24, // 24h window
  },
};

/** A governance proposal. */
export interface Proposal {
  id: string;
  type: ProposalType;
  title: string;
  description: string;
  /** Entity who created the proposal. */
  authorId: string;
  /** Author's governance tier at creation time. */
  authorTier: GovernanceTier;
  status: ProposalStatus;
  /** Node that originated the proposal. */
  originNode: string;
  /** ISO timestamp when proposal was created. */
  createdAt: string;
  /** ISO timestamp when voting opened. */
  openedAt: string | null;
  /** ISO timestamp when voting closes. */
  closesAt: string | null;
  /** ISO timestamp when proposal was decided. */
  decidedAt: string | null;
  /** ISO timestamp when proposal was enacted. */
  enactedAt: string | null;
  /** Whether the proposal was approved. */
  approved: boolean | null;
  /** Anchor cooling veto (Type 1 only). */
  anchorVetoed: boolean;
  /** Civicognita founding veto (Type 2 only). */
  foundingVetoed: boolean;
}

/** Parameters to create a proposal. */
export interface CreateProposalParams {
  id: string;
  type: ProposalType;
  title: string;
  description: string;
  authorId: string;
  authorTier: GovernanceTier;
  originNode: string;
}

// ---------------------------------------------------------------------------
// Proposal Manager
// ---------------------------------------------------------------------------

/**
 * Manages proposal lifecycle.
 *
 * In-memory implementation suitable for single-node operation.
 */
export class ProposalManager {
  private readonly proposals = new Map<string, Proposal>();

  /**
   * Create a new proposal in draft status.
   *
   * Tier requirements:
   * - Type 1 (Protocol): Tier 2+ required
   * - Type 2 (Governance): Tier 3 required
   * - Type 3 (Community): Tier 1+ required
   * - Type 4 (Emergency): Anchor nodes only (checked externally)
   */
  create(params: CreateProposalParams): Proposal {
    // Validate author tier
    this.validateAuthorTier(params.type, params.authorTier);

    const proposal: Proposal = {
      id: params.id,
      type: params.type,
      title: params.title,
      description: params.description,
      authorId: params.authorId,
      authorTier: params.authorTier,
      status: "draft",
      originNode: params.originNode,
      createdAt: new Date().toISOString(),
      openedAt: null,
      closesAt: null,
      decidedAt: null,
      enactedAt: null,
      approved: null,
      anchorVetoed: false,
      foundingVetoed: false,
    };

    this.proposals.set(params.id, proposal);
    return proposal;
  }

  /**
   * Open a draft proposal for voting.
   *
   * Transitions: draft → open → voting (combined in one step for simplicity).
   */
  openForVoting(proposalId: string): Proposal {
    const proposal = this.getOrThrow(proposalId);
    if (proposal.status !== "draft") {
      throw new Error(`Cannot open proposal: status is "${proposal.status}"`);
    }

    const now = new Date();
    const requirements = APPROVAL_REQUIREMENTS[proposal.type];
    const closesAt = new Date(now.getTime() + requirements.votingWindowHours * 60 * 60 * 1000);

    proposal.status = "voting";
    proposal.openedAt = now.toISOString();
    proposal.closesAt = closesAt.toISOString();

    return proposal;
  }

  /**
   * Decide a proposal based on vote tallies.
   *
   * @param proposalId - Proposal to decide
   * @param tally - Vote counts by tier
   * @param totalEligible - Total eligible voters (for quorum calculation)
   * @returns Updated proposal
   */
  decide(
    proposalId: string,
    tally: VoteTally,
    totalEligible: number,
  ): Proposal {
    const proposal = this.getOrThrow(proposalId);
    if (proposal.status !== "voting") {
      throw new Error(`Cannot decide proposal: status is "${proposal.status}"`);
    }

    const requirements = APPROVAL_REQUIREMENTS[proposal.type];
    const decision = evaluateVotes(proposal.type, tally, totalEligible, requirements);

    proposal.status = "decided";
    proposal.decidedAt = new Date().toISOString();
    proposal.approved = decision.approved;

    return proposal;
  }

  /**
   * Apply an anchor cooling veto (Type 1 only, 30-day window).
   */
  anchorVeto(proposalId: string): Proposal {
    const proposal = this.getOrThrow(proposalId);
    if (proposal.type !== 1) {
      throw new Error("Anchor veto only applies to Type 1 proposals");
    }
    if (proposal.status !== "decided" || !proposal.approved) {
      throw new Error("Can only veto approved, decided proposals");
    }

    proposal.anchorVetoed = true;
    proposal.approved = false;
    proposal.status = "rejected";

    return proposal;
  }

  /**
   * Apply Civicognita founding veto (Type 2 only).
   */
  foundingVeto(proposalId: string): Proposal {
    const proposal = this.getOrThrow(proposalId);
    if (proposal.type !== 2) {
      throw new Error("Founding veto only applies to Type 2 proposals");
    }
    if (proposal.status !== "decided" || !proposal.approved) {
      throw new Error("Can only veto approved, decided proposals");
    }

    proposal.foundingVetoed = true;
    proposal.approved = false;
    proposal.status = "rejected";

    return proposal;
  }

  /**
   * Enact an approved proposal.
   */
  enact(proposalId: string): Proposal {
    const proposal = this.getOrThrow(proposalId);
    if (proposal.status !== "decided" || !proposal.approved) {
      throw new Error("Can only enact approved proposals");
    }
    if (proposal.anchorVetoed || proposal.foundingVetoed) {
      throw new Error("Cannot enact vetoed proposals");
    }

    proposal.status = "enacted";
    proposal.enactedAt = new Date().toISOString();

    return proposal;
  }

  /**
   * Expire proposals past their voting window.
   */
  expireVoting(now?: Date): number {
    const currentTime = now ?? new Date();
    let expired = 0;

    for (const proposal of this.proposals.values()) {
      if (
        proposal.status === "voting" &&
        proposal.closesAt &&
        new Date(proposal.closesAt) < currentTime
      ) {
        proposal.status = "expired";
        expired++;
      }
    }

    return expired;
  }

  /** Get a proposal by ID. */
  get(proposalId: string): Proposal | null {
    return this.proposals.get(proposalId) ?? null;
  }

  /** Get all proposals, optionally filtered by status. */
  list(status?: ProposalStatus): Proposal[] {
    const result: Proposal[] = [];
    for (const proposal of this.proposals.values()) {
      if (!status || proposal.status === status) {
        result.push(proposal);
      }
    }
    return result;
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private getOrThrow(proposalId: string): Proposal {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) throw new Error(`Proposal not found: ${proposalId}`);
    return proposal;
  }

  private validateAuthorTier(type: ProposalType, tier: GovernanceTier): void {
    switch (type) {
      case 1:
        if (tier < 2) throw new Error("Type 1 proposals require Tier 2+");
        break;
      case 2:
        if (tier < 3) throw new Error("Type 2 proposals require Tier 3");
        break;
      case 3:
        if (tier < 1) throw new Error("Type 3 proposals require Tier 1+");
        break;
      case 4:
        // Emergency proposals — anchor check is external
        break;
    }
  }
}

// ---------------------------------------------------------------------------
// Vote evaluation
// ---------------------------------------------------------------------------

/** Vote tally organized by tier. */
export interface VoteTally {
  /** Votes from Tier 3 (Steward) entities. */
  stewardFor: number;
  stewardAgainst: number;
  stewardTotal: number;
  /** Votes from Tier 2 (Contributor) entities. */
  contributorFor: number;
  contributorAgainst: number;
  contributorTotal: number;
  /** Votes from Tier 1 (Participant) entities. */
  participantFor: number;
  participantAgainst: number;
  /** Votes from Tier 0 (Observer) — no voting weight. */
  observerFor: number;
  observerAgainst: number;
  /** Total votes cast. */
  totalVotes: number;
}

/** Vote evaluation result. */
export interface VoteDecision {
  approved: boolean;
  quorumMet: boolean;
  stewardApprovalMet: boolean;
  contributorApprovalMet: boolean;
  /** Effective vote counts after 20% steward cap. */
  effectiveStewardVotes: number;
  reasons: string[];
}

/**
 * Evaluate votes against approval requirements.
 *
 * Applies the 20% Steward cap: max 20% of effective votes
 * can come from Tier 3 entities.
 */
export function evaluateVotes(
  proposalType: ProposalType,
  tally: VoteTally,
  totalEligible: number,
  requirements?: ApprovalRequirements,
): VoteDecision {
  const req = requirements ?? APPROVAL_REQUIREMENTS[proposalType];
  const reasons: string[] = [];

  // 1. Check quorum
  let quorumMet: boolean;
  if (req.quorumIsFraction) {
    quorumMet = totalEligible > 0 && (tally.totalVotes / totalEligible) >= req.quorum;
    if (!quorumMet) {
      reasons.push(
        `Quorum not met: ${tally.totalVotes}/${totalEligible} (${(req.quorum * 100).toFixed(0)}% required)`,
      );
    }
  } else {
    quorumMet = tally.totalVotes >= req.quorum;
    if (!quorumMet) {
      reasons.push(`Minimum votes not met: ${tally.totalVotes}/${req.quorum}`);
    }
  }

  // 2. Apply 20% Steward cap (Type 1 and 2 only)
  let effectiveStewardVotes = tally.stewardFor + tally.stewardAgainst;
  if ((proposalType === 1 || proposalType === 2) && tally.totalVotes > 0) {
    const maxStewardVotes = Math.ceil(tally.totalVotes * 0.20);
    effectiveStewardVotes = Math.min(effectiveStewardVotes, maxStewardVotes);
  }

  // 3. Check tier-specific approval
  let stewardApprovalMet = true;
  let contributorApprovalMet = true;

  if (req.stewardApproval > 0 && tally.stewardTotal > 0) {
    const stewardApprovalRate = tally.stewardFor / tally.stewardTotal;
    stewardApprovalMet = stewardApprovalRate >= req.stewardApproval;
    if (!stewardApprovalMet) {
      reasons.push(
        `Steward approval not met: ${(stewardApprovalRate * 100).toFixed(1)}% (${(req.stewardApproval * 100).toFixed(0)}% required)`,
      );
    }
  }

  if (req.contributorApproval > 0 && tally.contributorTotal > 0) {
    const contributorApprovalRate = tally.contributorFor / tally.contributorTotal;
    contributorApprovalMet = contributorApprovalRate >= req.contributorApproval;
    if (!contributorApprovalMet) {
      reasons.push(
        `Contributor approval not met: ${(contributorApprovalRate * 100).toFixed(1)}% (${(req.contributorApproval * 100).toFixed(0)}% required)`,
      );
    }
  }

  // 4. For Community proposals (Type 3): simple majority
  let majorityMet = true;
  if (proposalType === 3) {
    const totalFor = tally.stewardFor + tally.contributorFor + tally.participantFor;
    const totalAgainst = tally.stewardAgainst + tally.contributorAgainst + tally.participantAgainst;
    majorityMet = totalFor > totalAgainst;
    if (!majorityMet) {
      reasons.push(`Simple majority not met: ${totalFor} for vs ${totalAgainst} against`);
    }
  }

  // 5. For Emergency proposals (Type 4): 4-of-5 Anchors
  // Anchors map to steward votes in this context
  let emergencyMet = true;
  if (proposalType === 4) {
    emergencyMet = tally.stewardFor >= 4;
    if (!emergencyMet) {
      reasons.push(`Emergency approval not met: ${tally.stewardFor}/4 Anchor approvals`);
    }
  }

  const approved =
    quorumMet &&
    stewardApprovalMet &&
    contributorApprovalMet &&
    majorityMet &&
    emergencyMet;

  return {
    approved,
    quorumMet,
    stewardApprovalMet,
    contributorApprovalMet,
    effectiveStewardVotes,
    reasons,
  };
}
