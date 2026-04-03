/**
 * Governance Constitution — Task #208
 *
 * Defines the ratifiable governance constitution as a typed data structure.
 * Once ratified, the constitution is immutable — amendments require
 * a Type 2 governance proposal.
 *
 * Contents:
 * - Tier thresholds and voting rules
 * - Quorum requirements per proposal type
 * - Civicognita sunset milestones
 * - Amendment procedures
 */

import type { TierThresholds } from "./tier-engine.js";
import type { ApprovalRequirements, ProposalType } from "./proposals.js";

// ---------------------------------------------------------------------------
// Constitution types
// ---------------------------------------------------------------------------

/** The governance constitution document. */
export interface Constitution {
  /** Schema version for future migration. */
  schema: "constitution-v1";
  /** ISO timestamp when ratified. */
  ratifiedAt: string | null;
  /** Hash of the constitution content for integrity verification. */
  contentHash: string | null;
  /** Signatories who ratified (entity GEIDs). */
  ratifiedBy: string[];

  /** Tier definitions and thresholds. */
  tiers: ConstitutionTierSection;
  /** Proposal types and approval requirements. */
  proposals: ConstitutionProposalSection;
  /** Voting rules and caps. */
  voting: ConstitutionVotingSection;
  /** Civicognita sunset provisions. */
  sunset: ConstitutionSunsetSection;
  /** Amendment procedures. */
  amendments: ConstitutionAmendmentSection;
}

/** Tier definition section. */
export interface ConstitutionTierSection {
  thresholds: TierThresholds;
  definitions: Array<{
    tier: number;
    name: string;
    description: string;
    rights: string[];
  }>;
}

/** Proposal section. */
export interface ConstitutionProposalSection {
  types: Record<ProposalType, {
    name: string;
    description: string;
    requirements: ApprovalRequirements;
    authorMinTier: number;
  }>;
}

/** Voting rules section. */
export interface ConstitutionVotingSection {
  /** Maximum fraction of effective votes from Stewards (Tier 3). */
  stewardCapFraction: number;
  /** Tier weights for weighted voting. */
  tierWeights: Record<number, number>;
  /** Anchor cooling veto window for Type 1 proposals (days). */
  anchorVetoWindowDays: number;
}

/** Sunset provisions for Civicognita. */
export interface ConstitutionSunsetSection {
  /** Milestone 1: veto converts to single Anchor vote. */
  milestone1: {
    tier2PlusRequired: number;
    nodesRequired: number;
    effect: string;
  };
  /** Milestone 2: Civicognita exits Anchor. */
  milestone2: {
    tier2PlusRequired: number;
    nodesRequired: number;
    effect: string;
  };
}

/** Amendment procedures. */
export interface ConstitutionAmendmentSection {
  /** Proposal type required for amendments. */
  requiredProposalType: ProposalType;
  /** Whether amendments are irrevocable once enacted. */
  irrevocable: boolean;
  /** Cooling period before amendment takes effect (days). */
  coolingPeriodDays: number;
}

// ---------------------------------------------------------------------------
// Default constitution
// ---------------------------------------------------------------------------

/**
 * The genesis constitution — initial governance rules.
 *
 * This serves as the template for ratification. Once ratified,
 * modifications require a Type 2 governance proposal.
 */
export const GENESIS_CONSTITUTION: Constitution = {
  schema: "constitution-v1",
  ratifiedAt: null,
  contentHash: null,
  ratifiedBy: [],

  tiers: {
    thresholds: {
      tier1MinImp: 10,
      tier1RecencyDays: 90,
      tier2MinImp: 100,
      tier2MinEvents: 5,
      tier3MinImp: 1000,
      tier3MinStandingDays: 180,
    },
    definitions: [
      {
        tier: 0,
        name: "Observer",
        description: "Account exists. Can view public data.",
        rights: ["view_public_data", "submit_feedback"],
      },
      {
        tier: 1,
        name: "Participant",
        description: ">10 verified $imp in 90 days. Active contributor.",
        rights: ["vote_community", "create_community_proposals", "view_coa_chain"],
      },
      {
        tier: 2,
        name: "Contributor",
        description: ">100 total $imp + 5 distinct events. Established contributor.",
        rights: ["vote_all", "create_protocol_proposals", "view_impact_details", "co_verify"],
      },
      {
        tier: 3,
        name: "Steward",
        description: ">1000 $imp + 180 days standing. Trusted guardian.",
        rights: ["vote_all_weighted", "create_governance_proposals", "anchor_veto", "view_full_audit"],
      },
    ],
  },

  proposals: {
    types: {
      1: {
        name: "Protocol Change",
        description: "Changes to the Impactivism protocol itself.",
        requirements: {
          stewardApproval: 2 / 3,
          contributorApproval: 1 / 2,
          quorum: 0.50,
          quorumIsFraction: true,
          votingWindowHours: 168,
        },
        authorMinTier: 2,
      },
      2: {
        name: "Governance Rule Change",
        description: "Amendments to governance rules, tier thresholds, or this constitution.",
        requirements: {
          stewardApproval: 3 / 4,
          contributorApproval: 2 / 3,
          quorum: 0.60,
          quorumIsFraction: true,
          votingWindowHours: 336,
        },
        authorMinTier: 3,
      },
      3: {
        name: "Community",
        description: "Community-level decisions, feature requests, and non-binding resolutions.",
        requirements: {
          stewardApproval: 0,
          contributorApproval: 0,
          quorum: 25,
          quorumIsFraction: false,
          votingWindowHours: 168,
        },
        authorMinTier: 1,
      },
      4: {
        name: "Emergency",
        description: "Emergency protocol actions requiring rapid Anchor consensus.",
        requirements: {
          stewardApproval: 0,
          contributorApproval: 0,
          quorum: 4,
          quorumIsFraction: false,
          votingWindowHours: 24,
        },
        authorMinTier: 3,
      },
    },
  },

  voting: {
    stewardCapFraction: 0.20,
    tierWeights: { 0: 0, 1: 1, 2: 3, 3: 5 },
    anchorVetoWindowDays: 30,
  },

  sunset: {
    milestone1: {
      tier2PlusRequired: 500,
      nodesRequired: 5,
      effect: "Civicognita founding veto converts to a single Anchor vote",
    },
    milestone2: {
      tier2PlusRequired: 2000,
      nodesRequired: 10,
      effect: "Civicognita exits Anchor status entirely",
    },
  },

  amendments: {
    requiredProposalType: 2,
    irrevocable: true,
    coolingPeriodDays: 30,
  },
};

/**
 * Validate that a constitution document has all required fields.
 */
export function validateConstitution(doc: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!doc || typeof doc !== "object") {
    return { valid: false, errors: ["Constitution must be an object"] };
  }

  const c = doc as Record<string, unknown>;

  if (c["schema"] !== "constitution-v1") {
    errors.push('schema must be "constitution-v1"');
  }

  if (!c["tiers"] || typeof c["tiers"] !== "object") {
    errors.push("Missing tiers section");
  }

  if (!c["proposals"] || typeof c["proposals"] !== "object") {
    errors.push("Missing proposals section");
  }

  if (!c["voting"] || typeof c["voting"] !== "object") {
    errors.push("Missing voting section");
  }

  if (!c["sunset"] || typeof c["sunset"] !== "object") {
    errors.push("Missing sunset section");
  }

  if (!c["amendments"] || typeof c["amendments"] !== "object") {
    errors.push("Missing amendments section");
  }

  return { valid: errors.length === 0, errors };
}
