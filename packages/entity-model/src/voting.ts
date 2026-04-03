/**
 * Voting Mechanism with Tier Caps — Task #207
 *
 * Vote casting with tier validation:
 * - 20% Steward cap enforcement
 * - Quorum tracking per proposal type
 * - Anchor node 30-day cooling veto for Type 1
 * - Civicognita founding veto for Type 2 (with sunset milestones)
 * - Public auditable vote records
 */

import type { GovernanceTier } from "./tier-engine.js";
import { tierVotingWeight } from "./tier-engine.js";
import type { VoteTally } from "./proposals.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single vote record. */
export interface Vote {
  id: string;
  proposalId: string;
  voterId: string;
  voterTier: GovernanceTier;
  /** The node this vote was cast from. */
  sourceNode: string;
  vote: "approve" | "reject" | "abstain";
  /** Weighted vote value based on tier. */
  weight: number;
  /** Ed25519 signature over vote content (for auditability). */
  signature: string | null;
  /** ISO timestamp. */
  castAt: string;
}

/** Parameters for casting a vote. */
export interface CastVoteParams {
  id: string;
  proposalId: string;
  voterId: string;
  voterTier: GovernanceTier;
  sourceNode: string;
  vote: "approve" | "reject" | "abstain";
  signature?: string;
}

/** Sunset milestone status. */
export interface SunsetMilestone {
  /** Milestone 1: 500 Tier 2+ across 5 nodes → veto converts to single Anchor vote. */
  milestone1Met: boolean;
  /** Milestone 2: 2000 across 10 nodes → Civicognita exits Anchor. */
  milestone2Met: boolean;
  /** Current Tier 2+ count. */
  tier2PlusCount: number;
  /** Current node count. */
  nodeCount: number;
}

/** Sunset milestone thresholds. */
export const SUNSET_MILESTONES = {
  milestone1: { tier2Plus: 500, nodes: 5 },
  milestone2: { tier2Plus: 2000, nodes: 10 },
} as const;

// ---------------------------------------------------------------------------
// Vote Manager
// ---------------------------------------------------------------------------

/**
 * Manages vote casting, validation, and tally computation.
 */
export class VoteManager {
  private readonly votes = new Map<string, Vote>();
  /** Index: proposalId → Set of voterIds (prevents double-voting). */
  private readonly proposalVoters = new Map<string, Set<string>>();

  /**
   * Cast a vote on a proposal.
   *
   * Validates:
   * - Voter has not already voted on this proposal
   * - Voter's tier qualifies them to vote (Tier 0 cannot vote)
   * - Vote weight is computed from tier
   */
  castVote(params: CastVoteParams): Vote {
    // Tier 0 cannot vote
    if (params.voterTier === 0) {
      throw new Error("Tier 0 (Observer) entities cannot vote");
    }

    // Check for double-voting
    const voters = this.proposalVoters.get(params.proposalId);
    if (voters?.has(params.voterId)) {
      throw new Error(`Entity ${params.voterId} has already voted on proposal ${params.proposalId}`);
    }

    const weight = tierVotingWeight(params.voterTier);

    const vote: Vote = {
      id: params.id,
      proposalId: params.proposalId,
      voterId: params.voterId,
      voterTier: params.voterTier,
      sourceNode: params.sourceNode,
      vote: params.vote,
      weight,
      signature: params.signature ?? null,
      castAt: new Date().toISOString(),
    };

    this.votes.set(params.id, vote);

    // Track voter
    if (!this.proposalVoters.has(params.proposalId)) {
      this.proposalVoters.set(params.proposalId, new Set());
    }
    this.proposalVoters.get(params.proposalId)!.add(params.voterId);

    return vote;
  }

  /**
   * Compute the vote tally for a proposal.
   */
  computeTally(proposalId: string): VoteTally {
    const tally: VoteTally = {
      stewardFor: 0,
      stewardAgainst: 0,
      stewardTotal: 0,
      contributorFor: 0,
      contributorAgainst: 0,
      contributorTotal: 0,
      participantFor: 0,
      participantAgainst: 0,
      observerFor: 0,
      observerAgainst: 0,
      totalVotes: 0,
    };

    for (const vote of this.votes.values()) {
      if (vote.proposalId !== proposalId) continue;
      if (vote.vote === "abstain") {
        tally.totalVotes++;
        continue;
      }

      const isFor = vote.vote === "approve";

      switch (vote.voterTier) {
        case 3:
          tally.stewardTotal++;
          if (isFor) tally.stewardFor++;
          else tally.stewardAgainst++;
          break;
        case 2:
          tally.contributorTotal++;
          if (isFor) tally.contributorFor++;
          else tally.contributorAgainst++;
          break;
        case 1:
          if (isFor) tally.participantFor++;
          else tally.participantAgainst++;
          break;
        case 0:
          if (isFor) tally.observerFor++;
          else tally.observerAgainst++;
          break;
      }

      tally.totalVotes++;
    }

    return tally;
  }

  /**
   * Get all votes for a proposal (for public audit).
   */
  getProposalVotes(proposalId: string): Vote[] {
    const result: Vote[] = [];
    for (const vote of this.votes.values()) {
      if (vote.proposalId === proposalId) {
        result.push(vote);
      }
    }
    return result;
  }

  /**
   * Get a specific vote.
   */
  getVote(voteId: string): Vote | null {
    return this.votes.get(voteId) ?? null;
  }

  /**
   * Check whether an entity has voted on a proposal.
   */
  hasVoted(proposalId: string, voterId: string): boolean {
    return this.proposalVoters.get(proposalId)?.has(voterId) ?? false;
  }

  /**
   * Apply 20% Steward cap to a tally.
   *
   * Returns the effective vote counts with steward influence capped.
   */
  applyStewardCap(tally: VoteTally): VoteTally {
    if (tally.totalVotes === 0) return tally;

    const maxStewardVotes = Math.ceil(tally.totalVotes * 0.20);
    const actualSteward = tally.stewardFor + tally.stewardAgainst;

    if (actualSteward <= maxStewardVotes) return tally;

    // Scale down steward votes proportionally
    const scale = maxStewardVotes / actualSteward;
    return {
      ...tally,
      stewardFor: Math.round(tally.stewardFor * scale),
      stewardAgainst: Math.round(tally.stewardAgainst * scale),
      stewardTotal: maxStewardVotes,
    };
  }
}

// ---------------------------------------------------------------------------
// Sunset milestone evaluation
// ---------------------------------------------------------------------------

/**
 * Check sunset milestone status.
 *
 * Milestone 1: 500 Tier 2+ entities across 5 nodes
 *   → Civicognita founding veto converts to a single Anchor vote
 *
 * Milestone 2: 2000 Tier 2+ entities across 10 nodes
 *   → Civicognita exits Anchor status entirely
 */
export function checkSunsetMilestones(
  tier2PlusCount: number,
  nodeCount: number,
): SunsetMilestone {
  return {
    milestone1Met:
      tier2PlusCount >= SUNSET_MILESTONES.milestone1.tier2Plus &&
      nodeCount >= SUNSET_MILESTONES.milestone1.nodes,
    milestone2Met:
      tier2PlusCount >= SUNSET_MILESTONES.milestone2.tier2Plus &&
      nodeCount >= SUNSET_MILESTONES.milestone2.nodes,
    tier2PlusCount,
    nodeCount,
  };
}
