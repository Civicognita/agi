/**
 * Governance System Tests — Tier Engine, Proposals, Voting, Constitution
 *
 * Tests for: tier-engine.ts, proposals.ts, voting.ts, constitution.ts
 */

import { describe, it, expect, beforeEach } from "vitest";

// Tier Engine
import {
  classifyTier,
  classifyTiers,
  tierVotingWeight,
  TIER_NAMES,
  DEFAULT_THRESHOLDS,
  type TierInput,
} from "./tier-engine.js";

// Proposals
import {
  ProposalManager,
  evaluateVotes,
  APPROVAL_REQUIREMENTS,
  type VoteTally,
  type CreateProposalParams,
} from "./proposals.js";

// Voting
import {
  VoteManager,
  checkSunsetMilestones,
  SUNSET_MILESTONES,
} from "./voting.js";

// Constitution
import {
  GENESIS_CONSTITUTION,
  validateConstitution,
} from "./constitution.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTierInput(overrides: Partial<TierInput> = {}): TierInput {
  return {
    totalImp: 0,
    recentImp: 0,
    distinctEvents: 0,
    standingDays: 0,
    ...overrides,
  };
}

function makeTally(overrides: Partial<VoteTally> = {}): VoteTally {
  return {
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
    ...overrides,
  };
}

function makeProposalParams(overrides: Partial<CreateProposalParams> = {}): CreateProposalParams {
  return {
    id: "proposal-1",
    type: 3,
    title: "Test Proposal",
    description: "A test proposal",
    authorId: "entity-1",
    authorTier: 1,
    originNode: "node-1",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// TIER ENGINE — TIER_NAMES and DEFAULT_THRESHOLDS
// ---------------------------------------------------------------------------

describe("TIER_NAMES", () => {
  it("Tier 0 is Observer", () => {
    expect(TIER_NAMES[0]).toBe("Observer");
  });

  it("Tier 1 is Participant", () => {
    expect(TIER_NAMES[1]).toBe("Participant");
  });

  it("Tier 2 is Contributor", () => {
    expect(TIER_NAMES[2]).toBe("Contributor");
  });

  it("Tier 3 is Steward", () => {
    expect(TIER_NAMES[3]).toBe("Steward");
  });
});

describe("DEFAULT_THRESHOLDS", () => {
  it("tier1MinImp is 10", () => {
    expect(DEFAULT_THRESHOLDS.tier1MinImp).toBe(10);
  });

  it("tier1RecencyDays is 90", () => {
    expect(DEFAULT_THRESHOLDS.tier1RecencyDays).toBe(90);
  });

  it("tier2MinImp is 100", () => {
    expect(DEFAULT_THRESHOLDS.tier2MinImp).toBe(100);
  });

  it("tier2MinEvents is 5", () => {
    expect(DEFAULT_THRESHOLDS.tier2MinEvents).toBe(5);
  });

  it("tier3MinImp is 1000", () => {
    expect(DEFAULT_THRESHOLDS.tier3MinImp).toBe(1000);
  });

  it("tier3MinStandingDays is 180", () => {
    expect(DEFAULT_THRESHOLDS.tier3MinStandingDays).toBe(180);
  });
});

// ---------------------------------------------------------------------------
// TIER ENGINE — classifyTier
// ---------------------------------------------------------------------------

describe("classifyTier — Tier 0 (no activity)", () => {
  it("returns Tier 0 for entity with no activity", () => {
    const result = classifyTier("entity-1", makeTierInput());
    expect(result.tier).toBe(0);
  });

  it("tierName is Observer for Tier 0", () => {
    const result = classifyTier("entity-1", makeTierInput());
    expect(result.tierName).toBe("Observer");
  });

  it("entityId is preserved in result", () => {
    const result = classifyTier("entity-1", makeTierInput());
    expect(result.entityId).toBe("entity-1");
  });

  it("all qualifications are false for inactive entity", () => {
    const result = classifyTier("entity-1", makeTierInput());
    expect(result.qualifications.tier1).toBe(false);
    expect(result.qualifications.tier2).toBe(false);
    expect(result.qualifications.tier3).toBe(false);
  });

  it("calculatedAt is a valid ISO timestamp", () => {
    const result = classifyTier("entity-1", makeTierInput());
    expect(new Date(result.calculatedAt).toISOString()).toBe(result.calculatedAt);
  });
});

describe("classifyTier — Tier 1 (Participant)", () => {
  it("returns Tier 1 when recentImp >= 10 in 90 days", () => {
    const result = classifyTier("entity-1", makeTierInput({ recentImp: 10 }));
    expect(result.tier).toBe(1);
  });

  it("returns Tier 1 for exactly 10 recentImp", () => {
    const result = classifyTier("entity-1", makeTierInput({ recentImp: 10 }));
    expect(result.qualifications.tier1).toBe(true);
  });

  it("does NOT return Tier 1 for 9 recentImp", () => {
    const result = classifyTier("entity-1", makeTierInput({ recentImp: 9 }));
    expect(result.tier).toBe(0);
    expect(result.qualifications.tier1).toBe(false);
  });

  it("tierName is Participant for Tier 1", () => {
    const result = classifyTier("entity-1", makeTierInput({ recentImp: 15 }));
    expect(result.tierName).toBe("Participant");
  });
});

describe("classifyTier — Tier 2 (Contributor)", () => {
  it("returns Tier 2 when totalImp >= 100 and distinctEvents >= 5", () => {
    const result = classifyTier("entity-1", makeTierInput({
      totalImp: 100,
      recentImp: 10,
      distinctEvents: 5,
    }));
    expect(result.tier).toBe(2);
  });

  it("does NOT return Tier 2 if totalImp met but distinctEvents < 5", () => {
    const result = classifyTier("entity-1", makeTierInput({
      totalImp: 100,
      recentImp: 10,
      distinctEvents: 4,
    }));
    expect(result.qualifications.tier2).toBe(false);
  });

  it("does NOT return Tier 2 if distinctEvents met but totalImp < 100", () => {
    const result = classifyTier("entity-1", makeTierInput({
      totalImp: 99,
      recentImp: 10,
      distinctEvents: 5,
    }));
    expect(result.qualifications.tier2).toBe(false);
  });

  it("tierName is Contributor for Tier 2", () => {
    const result = classifyTier("entity-1", makeTierInput({
      totalImp: 200,
      recentImp: 20,
      distinctEvents: 10,
    }));
    expect(result.tierName).toBe("Contributor");
  });
});

describe("classifyTier — Tier 3 (Steward)", () => {
  it("returns Tier 3 when totalImp >= 1000 and standingDays >= 180", () => {
    const result = classifyTier("entity-1", makeTierInput({
      totalImp: 1000,
      recentImp: 50,
      distinctEvents: 20,
      standingDays: 180,
    }));
    expect(result.tier).toBe(3);
  });

  it("does NOT return Tier 3 if totalImp met but standingDays < 180", () => {
    const result = classifyTier("entity-1", makeTierInput({
      totalImp: 1000,
      recentImp: 50,
      distinctEvents: 20,
      standingDays: 179,
    }));
    expect(result.qualifications.tier3).toBe(false);
  });

  it("does NOT return Tier 3 if standingDays met but totalImp < 1000", () => {
    const result = classifyTier("entity-1", makeTierInput({
      totalImp: 999,
      recentImp: 50,
      distinctEvents: 20,
      standingDays: 200,
    }));
    expect(result.qualifications.tier3).toBe(false);
  });

  it("tierName is Steward for Tier 3", () => {
    const result = classifyTier("entity-1", makeTierInput({
      totalImp: 2000,
      recentImp: 100,
      distinctEvents: 30,
      standingDays: 365,
    }));
    expect(result.tierName).toBe("Steward");
  });
});

describe("classifyTier — highest qualifying tier wins", () => {
  it("Tier 3 entity also qualifies for Tier 1 and 2", () => {
    const result = classifyTier("entity-1", makeTierInput({
      totalImp: 1000,
      recentImp: 50,
      distinctEvents: 20,
      standingDays: 180,
    }));
    expect(result.tier).toBe(3);
    expect(result.qualifications.tier1).toBe(true);
    expect(result.qualifications.tier2).toBe(true);
    expect(result.qualifications.tier3).toBe(true);
  });

  it("Tier 2 entity also qualifies for Tier 1", () => {
    const result = classifyTier("entity-1", makeTierInput({
      totalImp: 100,
      recentImp: 15,
      distinctEvents: 5,
      standingDays: 30,
    }));
    expect(result.tier).toBe(2);
    expect(result.qualifications.tier1).toBe(true);
    expect(result.qualifications.tier2).toBe(true);
    expect(result.qualifications.tier3).toBe(false);
  });
});

describe("classifyTier — nextTierGap", () => {
  it("returns null nextTierGap for Tier 3 entity", () => {
    const result = classifyTier("entity-1", makeTierInput({
      totalImp: 2000,
      recentImp: 100,
      distinctEvents: 30,
      standingDays: 365,
    }));
    expect(result.nextTierGap).toBeNull();
  });

  it("nextTierGap targets Tier 1 for Tier 0 entity", () => {
    const result = classifyTier("entity-1", makeTierInput({ recentImp: 5 }));
    expect(result.nextTierGap).not.toBeNull();
    expect(result.nextTierGap!.targetTier).toBe(1);
  });

  it("nextTierGap includes imp requirement for Tier 0 → Tier 1", () => {
    const result = classifyTier("entity-1", makeTierInput({ recentImp: 5 }));
    const req = result.nextTierGap!.requirements;
    expect(req.length).toBeGreaterThan(0);
    expect(req[0]).toMatch(/5\.0 more verified/);
  });

  it("nextTierGap targets Tier 2 for Tier 1 entity", () => {
    const result = classifyTier("entity-1", makeTierInput({
      recentImp: 15,
      totalImp: 50,
      distinctEvents: 2,
    }));
    expect(result.nextTierGap!.targetTier).toBe(2);
  });

  it("nextTierGap includes both imp and events for Tier 1 → Tier 2", () => {
    const result = classifyTier("entity-1", makeTierInput({
      recentImp: 15,
      totalImp: 50,
      distinctEvents: 2,
    }));
    const req = result.nextTierGap!.requirements;
    expect(req.some((r) => r.includes("total $imp"))).toBe(true);
    expect(req.some((r) => r.includes("impact events"))).toBe(true);
  });
});

describe("classifyTier — custom thresholds", () => {
  it("uses custom tier1MinImp when provided", () => {
    // With custom threshold of 5, recentImp=5 should qualify for Tier 1
    const result = classifyTier("entity-1", makeTierInput({ recentImp: 5 }), {
      tier1MinImp: 5,
    });
    expect(result.qualifications.tier1).toBe(true);
    expect(result.tier).toBe(1);
  });

  it("uses custom tier2MinImp and tier2MinEvents", () => {
    const result = classifyTier("entity-1", makeTierInput({
      totalImp: 50,
      recentImp: 5,
      distinctEvents: 3,
    }), {
      tier1MinImp: 5,
      tier2MinImp: 50,
      tier2MinEvents: 3,
    });
    expect(result.qualifications.tier2).toBe(true);
    expect(result.tier).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// TIER ENGINE — classifyTiers (batch)
// ---------------------------------------------------------------------------

describe("classifyTiers — batch classification", () => {
  it("returns one result per entity", () => {
    const entities = [
      { entityId: "entity-1", input: makeTierInput() },
      { entityId: "entity-2", input: makeTierInput({ recentImp: 15 }) },
      { entityId: "entity-3", input: makeTierInput({ totalImp: 1000, recentImp: 50, distinctEvents: 10, standingDays: 200 }) },
    ];
    const results = classifyTiers(entities);
    expect(results.length).toBe(3);
  });

  it("correctly classifies each entity in batch", () => {
    const entities = [
      { entityId: "entity-1", input: makeTierInput() },
      { entityId: "entity-2", input: makeTierInput({ recentImp: 15 }) },
    ];
    const results = classifyTiers(entities);
    expect(results[0]!.tier).toBe(0);
    expect(results[1]!.tier).toBe(1);
  });

  it("preserves entity IDs in batch results", () => {
    const entities = [
      { entityId: "entity-alpha", input: makeTierInput() },
      { entityId: "entity-beta", input: makeTierInput({ recentImp: 15 }) },
    ];
    const results = classifyTiers(entities);
    expect(results[0]!.entityId).toBe("entity-alpha");
    expect(results[1]!.entityId).toBe("entity-beta");
  });

  it("returns empty array for empty input", () => {
    expect(classifyTiers([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// TIER ENGINE — tierVotingWeight
// ---------------------------------------------------------------------------

describe("tierVotingWeight", () => {
  it("Tier 0 has weight 0", () => {
    expect(tierVotingWeight(0)).toBe(0);
  });

  it("Tier 1 has weight 1", () => {
    expect(tierVotingWeight(1)).toBe(1);
  });

  it("Tier 2 has weight 3", () => {
    expect(tierVotingWeight(2)).toBe(3);
  });

  it("Tier 3 has weight 5", () => {
    expect(tierVotingWeight(3)).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// PROPOSALS — ProposalManager lifecycle
// ---------------------------------------------------------------------------

describe("ProposalManager.create", () => {
  let manager: ProposalManager;

  beforeEach(() => {
    manager = new ProposalManager();
  });

  it("creates a draft proposal", () => {
    const proposal = manager.create(makeProposalParams());
    expect(proposal.status).toBe("draft");
  });

  it("stores the proposal ID correctly", () => {
    const proposal = manager.create(makeProposalParams({ id: "proposal-42" }));
    expect(proposal.id).toBe("proposal-42");
  });

  it("stores authorId and authorTier correctly", () => {
    const proposal = manager.create(makeProposalParams({
      authorId: "entity-7",
      authorTier: 2,
    }));
    expect(proposal.authorId).toBe("entity-7");
    expect(proposal.authorTier).toBe(2);
  });

  it("initializes timestamps and nullable fields", () => {
    const proposal = manager.create(makeProposalParams());
    expect(proposal.openedAt).toBeNull();
    expect(proposal.closesAt).toBeNull();
    expect(proposal.decidedAt).toBeNull();
    expect(proposal.enactedAt).toBeNull();
    expect(proposal.approved).toBeNull();
    expect(proposal.anchorVetoed).toBe(false);
    expect(proposal.foundingVetoed).toBe(false);
  });

  it("rejects Type 1 proposal from Tier 1 author", () => {
    expect(() =>
      manager.create(makeProposalParams({ type: 1, authorTier: 1 }))
    ).toThrow(/Tier 2\+/i);
  });

  it("rejects Type 1 proposal from Tier 0 author", () => {
    expect(() =>
      manager.create(makeProposalParams({ type: 1, authorTier: 0 }))
    ).toThrow(/Tier 2\+/i);
  });

  it("accepts Type 1 proposal from Tier 2 author", () => {
    const proposal = manager.create(makeProposalParams({ type: 1, authorTier: 2 }));
    expect(proposal.type).toBe(1);
  });

  it("accepts Type 1 proposal from Tier 3 author", () => {
    const proposal = manager.create(makeProposalParams({ type: 1, authorTier: 3 }));
    expect(proposal.type).toBe(1);
  });

  it("rejects Type 2 proposal from Tier 2 author", () => {
    expect(() =>
      manager.create(makeProposalParams({ type: 2, authorTier: 2 }))
    ).toThrow(/Tier 3/i);
  });

  it("accepts Type 2 proposal from Tier 3 author", () => {
    const proposal = manager.create(makeProposalParams({ type: 2, authorTier: 3 }));
    expect(proposal.type).toBe(2);
  });

  it("rejects Type 3 proposal from Tier 0 author", () => {
    expect(() =>
      manager.create(makeProposalParams({ type: 3, authorTier: 0 }))
    ).toThrow(/Tier 1\+/i);
  });

  it("accepts Type 3 proposal from Tier 1 author", () => {
    const proposal = manager.create(makeProposalParams({ type: 3, authorTier: 1 }));
    expect(proposal.type).toBe(3);
  });

  it("accepts Type 4 proposal from any tier (emergency)", () => {
    const proposal = manager.create(makeProposalParams({ type: 4, authorTier: 1 }));
    expect(proposal.type).toBe(4);
  });
});

describe("ProposalManager.openForVoting", () => {
  let manager: ProposalManager;

  beforeEach(() => {
    manager = new ProposalManager();
  });

  it("transitions draft to voting", () => {
    manager.create(makeProposalParams());
    const proposal = manager.openForVoting("proposal-1");
    expect(proposal.status).toBe("voting");
  });

  it("sets openedAt to ISO timestamp", () => {
    const before = new Date().toISOString();
    manager.create(makeProposalParams());
    const proposal = manager.openForVoting("proposal-1");
    const after = new Date().toISOString();
    expect(proposal.openedAt).not.toBeNull();
    expect(proposal.openedAt! >= before).toBe(true);
    expect(proposal.openedAt! <= after).toBe(true);
  });

  it("sets closesAt based on votingWindowHours", () => {
    manager.create(makeProposalParams({ type: 3 }));
    const proposal = manager.openForVoting("proposal-1");
    expect(proposal.closesAt).not.toBeNull();
    // Type 3: 168 hours window
    const expectedMs = 168 * 60 * 60 * 1000;
    const diff = new Date(proposal.closesAt!).getTime() - new Date(proposal.openedAt!).getTime();
    expect(diff).toBeCloseTo(expectedMs, -2);
  });

  it("rejects non-draft proposals", () => {
    manager.create(makeProposalParams());
    manager.openForVoting("proposal-1");
    // already voting
    expect(() => manager.openForVoting("proposal-1")).toThrow(/Cannot open proposal/i);
  });

  it("throws for unknown proposal ID", () => {
    expect(() => manager.openForVoting("nonexistent")).toThrow(/not found/i);
  });
});

describe("ProposalManager.decide", () => {
  let manager: ProposalManager;

  beforeEach(() => {
    manager = new ProposalManager();
    manager.create(makeProposalParams({ type: 3, authorTier: 1 }));
    manager.openForVoting("proposal-1");
  });

  it("sets status to decided after decide()", () => {
    const tally = makeTally({
      participantFor: 15,
      participantAgainst: 5,
      totalVotes: 30,
    });
    const proposal = manager.decide("proposal-1", tally, 30);
    expect(proposal.status).toBe("decided");
  });

  it("sets decidedAt to ISO timestamp", () => {
    const tally = makeTally({ participantFor: 20, totalVotes: 30 });
    const before = new Date().toISOString();
    const proposal = manager.decide("proposal-1", tally, 30);
    const after = new Date().toISOString();
    expect(proposal.decidedAt).not.toBeNull();
    expect(proposal.decidedAt! >= before).toBe(true);
    expect(proposal.decidedAt! <= after).toBe(true);
  });

  it("sets approved to true when vote passes", () => {
    // Type 3: simple majority + 25 votes
    const tally = makeTally({
      participantFor: 20,
      participantAgainst: 5,
      totalVotes: 30,
    });
    const proposal = manager.decide("proposal-1", tally, 100);
    expect(proposal.approved).toBe(true);
  });

  it("sets approved to false when vote fails", () => {
    // Type 3: less than 25 votes minimum
    const tally = makeTally({
      participantFor: 10,
      participantAgainst: 5,
      totalVotes: 15,
    });
    const proposal = manager.decide("proposal-1", tally, 100);
    expect(proposal.approved).toBe(false);
  });

  it("throws if proposal is not in voting status", () => {
    // Create a fresh draft proposal that hasn't been opened
    manager.create(makeProposalParams({ id: "proposal-2", type: 3, authorTier: 1 }));
    expect(() =>
      manager.decide("proposal-2", makeTally(), 100)
    ).toThrow(/Cannot decide proposal/i);
  });
});

describe("ProposalManager.anchorVeto", () => {
  let manager: ProposalManager;

  beforeEach(() => {
    manager = new ProposalManager();
    // Create and approve a Type 1 proposal
    manager.create(makeProposalParams({
      id: "proposal-1",
      type: 1,
      authorTier: 2,
    }));
    manager.openForVoting("proposal-1");
    // Enough steward + contributor votes for Type 1
    const tally = makeTally({
      stewardFor: 4,
      stewardAgainst: 0,
      stewardTotal: 4,
      contributorFor: 3,
      contributorAgainst: 0,
      contributorTotal: 3,
      totalVotes: 10,
    });
    manager.decide("proposal-1", tally, 10);
  });

  it("vetoes an approved Type 1 proposal", () => {
    const proposal = manager.anchorVeto("proposal-1");
    expect(proposal.anchorVetoed).toBe(true);
    expect(proposal.approved).toBe(false);
    expect(proposal.status).toBe("rejected");
  });

  it("rejects veto on non-Type-1 proposal", () => {
    manager.create(makeProposalParams({
      id: "proposal-2",
      type: 2,
      authorTier: 3,
    }));
    manager.openForVoting("proposal-2");
    const t2tally = makeTally({
      stewardFor: 4,
      stewardAgainst: 0,
      stewardTotal: 4,
      contributorFor: 3,
      contributorAgainst: 0,
      contributorTotal: 3,
      totalVotes: 10,
    });
    manager.decide("proposal-2", t2tally, 10);
    expect(() => manager.anchorVeto("proposal-2")).toThrow(/Type 1/i);
  });
});

describe("ProposalManager.foundingVeto", () => {
  let manager: ProposalManager;

  beforeEach(() => {
    manager = new ProposalManager();
    // Create and approve a Type 2 proposal
    manager.create(makeProposalParams({
      id: "proposal-1",
      type: 2,
      authorTier: 3,
    }));
    manager.openForVoting("proposal-1");
    const tally = makeTally({
      stewardFor: 4,
      stewardAgainst: 0,
      stewardTotal: 4,
      contributorFor: 3,
      contributorAgainst: 0,
      contributorTotal: 3,
      totalVotes: 10,
    });
    manager.decide("proposal-1", tally, 10);
  });

  it("vetoes an approved Type 2 proposal", () => {
    const proposal = manager.foundingVeto("proposal-1");
    expect(proposal.foundingVetoed).toBe(true);
    expect(proposal.approved).toBe(false);
    expect(proposal.status).toBe("rejected");
  });

  it("rejects founding veto on Type 1 proposal", () => {
    manager.create(makeProposalParams({
      id: "proposal-2",
      type: 1,
      authorTier: 2,
    }));
    manager.openForVoting("proposal-2");
    const t1tally = makeTally({
      stewardFor: 4,
      stewardAgainst: 0,
      stewardTotal: 4,
      contributorFor: 3,
      contributorAgainst: 0,
      contributorTotal: 3,
      totalVotes: 10,
    });
    manager.decide("proposal-2", t1tally, 10);
    expect(() => manager.foundingVeto("proposal-2")).toThrow(/Type 2/i);
  });
});

describe("ProposalManager.enact", () => {
  let manager: ProposalManager;

  function createAndApproveType3(proposalId: string): void {
    manager.create(makeProposalParams({ id: proposalId, type: 3, authorTier: 1 }));
    manager.openForVoting(proposalId);
    const tally = makeTally({
      participantFor: 20,
      participantAgainst: 5,
      totalVotes: 30,
    });
    manager.decide(proposalId, tally, 100);
  }

  beforeEach(() => {
    manager = new ProposalManager();
  });

  it("transitions decided+approved to enacted", () => {
    createAndApproveType3("proposal-1");
    const proposal = manager.enact("proposal-1");
    expect(proposal.status).toBe("enacted");
  });

  it("sets enactedAt to ISO timestamp", () => {
    createAndApproveType3("proposal-1");
    const before = new Date().toISOString();
    const proposal = manager.enact("proposal-1");
    const after = new Date().toISOString();
    expect(proposal.enactedAt).not.toBeNull();
    expect(proposal.enactedAt! >= before).toBe(true);
    expect(proposal.enactedAt! <= after).toBe(true);
  });

  it("rejects enacting a failed proposal", () => {
    manager.create(makeProposalParams({ type: 3, authorTier: 1 }));
    manager.openForVoting("proposal-1");
    // Not enough votes
    const tally = makeTally({ participantFor: 5, participantAgainst: 10, totalVotes: 15 });
    manager.decide("proposal-1", tally, 100);
    expect(() => manager.enact("proposal-1")).toThrow(/approved/i);
  });

  it("rejects enacting a vetoed proposal", () => {
    // Create and approve a Type 1 proposal, then veto it
    manager.create(makeProposalParams({ id: "proposal-1", type: 1, authorTier: 2 }));
    manager.openForVoting("proposal-1");
    const tally = makeTally({
      stewardFor: 4, stewardAgainst: 0, stewardTotal: 4,
      contributorFor: 3, contributorAgainst: 0, contributorTotal: 3,
      totalVotes: 10,
    });
    manager.decide("proposal-1", tally, 10);
    manager.anchorVeto("proposal-1");
    expect(() => manager.enact("proposal-1")).toThrow(/(vetoed|approved)/i);
  });
});

describe("ProposalManager.expireVoting", () => {
  let manager: ProposalManager;

  beforeEach(() => {
    manager = new ProposalManager();
  });

  it("expires proposals past their deadline", () => {
    manager.create(makeProposalParams({ type: 3, authorTier: 1 }));
    manager.openForVoting("proposal-1");

    // Force closesAt to the past
    const proposal = manager.get("proposal-1")!;
    proposal.closesAt = new Date(Date.now() - 1000).toISOString();

    const count = manager.expireVoting(new Date());
    expect(count).toBe(1);
    expect(manager.get("proposal-1")!.status).toBe("expired");
  });

  it("does not expire proposals with future deadline", () => {
    manager.create(makeProposalParams({ type: 3, authorTier: 1 }));
    manager.openForVoting("proposal-1");

    const count = manager.expireVoting(new Date());
    expect(count).toBe(0);
    expect(manager.get("proposal-1")!.status).toBe("voting");
  });

  it("returns 0 when no voting proposals exist", () => {
    expect(manager.expireVoting()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// PROPOSALS — evaluateVotes
// ---------------------------------------------------------------------------

describe("evaluateVotes — Type 1 (Protocol Change)", () => {
  it("approves when 2/3 Steward + 1/2 Contributor and 50% quorum met", () => {
    const tally = makeTally({
      stewardFor: 4,
      stewardAgainst: 1,
      stewardTotal: 5,
      contributorFor: 3,
      contributorAgainst: 2,
      contributorTotal: 5,
      totalVotes: 10,
    });
    const result = evaluateVotes(1, tally, 10);
    expect(result.quorumMet).toBe(true);
    // 4/5 = 80% steward approval >= 2/3 (~66.7%)
    expect(result.stewardApprovalMet).toBe(true);
    // 3/5 = 60% contributor approval >= 1/2 (50%)
    expect(result.contributorApprovalMet).toBe(true);
    expect(result.approved).toBe(true);
  });

  it("rejects when steward approval below 2/3", () => {
    const tally = makeTally({
      stewardFor: 1,
      stewardAgainst: 2,
      stewardTotal: 3,
      contributorFor: 3,
      contributorAgainst: 2,
      contributorTotal: 5,
      totalVotes: 10,
    });
    const result = evaluateVotes(1, tally, 10);
    expect(result.stewardApprovalMet).toBe(false);
    expect(result.approved).toBe(false);
  });

  it("rejects when quorum not met for Type 1", () => {
    const tally = makeTally({
      stewardFor: 4,
      stewardAgainst: 0,
      stewardTotal: 4,
      contributorFor: 3,
      contributorAgainst: 0,
      contributorTotal: 3,
      totalVotes: 4,
    });
    // 4 votes out of 100 eligible = 4% < 50% quorum
    const result = evaluateVotes(1, tally, 100);
    expect(result.quorumMet).toBe(false);
    expect(result.approved).toBe(false);
  });
});

describe("evaluateVotes — Type 3 (Community)", () => {
  it("approves with simple majority and 25+ votes", () => {
    const tally = makeTally({
      participantFor: 20,
      participantAgainst: 5,
      totalVotes: 30,
    });
    const result = evaluateVotes(3, tally, 200);
    expect(result.quorumMet).toBe(true);
    expect(result.approved).toBe(true);
  });

  it("rejects when fewer than 25 votes", () => {
    const tally = makeTally({
      participantFor: 13,
      participantAgainst: 5,
      totalVotes: 18,
    });
    const result = evaluateVotes(3, tally, 200);
    expect(result.quorumMet).toBe(false);
    expect(result.approved).toBe(false);
  });

  it("rejects when simple majority not met", () => {
    const tally = makeTally({
      participantFor: 10,
      participantAgainst: 20,
      totalVotes: 30,
    });
    const result = evaluateVotes(3, tally, 200);
    expect(result.approved).toBe(false);
    expect(result.reasons.some((r) => r.includes("majority"))).toBe(true);
  });
});

describe("evaluateVotes — Type 4 (Emergency)", () => {
  it("approves when 4 or more anchor votes", () => {
    const tally = makeTally({
      stewardFor: 4,
      stewardAgainst: 0,
      stewardTotal: 4,
      totalVotes: 4,
    });
    const result = evaluateVotes(4, tally, 5);
    expect(result.approved).toBe(true);
  });

  it("approves with exactly 4 anchor votes out of 5", () => {
    const tally = makeTally({
      stewardFor: 4,
      stewardAgainst: 1,
      stewardTotal: 5,
      totalVotes: 5,
    });
    const result = evaluateVotes(4, tally, 5);
    expect(result.approved).toBe(true);
  });

  it("rejects when fewer than 4 anchor votes", () => {
    const tally = makeTally({
      stewardFor: 3,
      stewardAgainst: 1,
      stewardTotal: 4,
      totalVotes: 4,
    });
    const result = evaluateVotes(4, tally, 5);
    expect(result.approved).toBe(false);
    expect(result.reasons.some((r) => r.includes("Emergency"))).toBe(true);
  });
});

describe("evaluateVotes — quorum not met", () => {
  it("includes quorum failure reason in reasons array", () => {
    const tally = makeTally({ participantFor: 5, totalVotes: 5 });
    const result = evaluateVotes(1, tally, 100);
    expect(result.quorumMet).toBe(false);
    expect(result.reasons.some((r) => r.includes("Quorum"))).toBe(true);
  });
});

describe("evaluateVotes — 20% steward cap", () => {
  it("applies 20% steward cap for Type 1", () => {
    // 10 total votes, max steward = ceil(10 * 0.20) = 2
    const tally = makeTally({
      stewardFor: 8,
      stewardAgainst: 2,
      stewardTotal: 10,
      totalVotes: 10,
    });
    const result = evaluateVotes(1, tally, 10);
    expect(result.effectiveStewardVotes).toBeLessThanOrEqual(2);
  });

  it("applies 20% steward cap for Type 2", () => {
    const tally = makeTally({
      stewardFor: 8,
      stewardAgainst: 2,
      stewardTotal: 10,
      totalVotes: 10,
    });
    const result = evaluateVotes(2, tally, 10);
    expect(result.effectiveStewardVotes).toBeLessThanOrEqual(2);
  });

  it("does not apply steward cap for Type 3", () => {
    const tally = makeTally({
      stewardFor: 5,
      stewardAgainst: 0,
      stewardTotal: 5,
      participantFor: 15,
      totalVotes: 25,
    });
    const result = evaluateVotes(3, tally, 200);
    // All 5 steward votes counted
    expect(result.effectiveStewardVotes).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// VOTING — VoteManager
// ---------------------------------------------------------------------------

describe("VoteManager.castVote", () => {
  let vm: VoteManager;

  beforeEach(() => {
    vm = new VoteManager();
  });

  it("records a vote with correct weight for Tier 1", () => {
    const vote = vm.castVote({
      id: "vote-1",
      proposalId: "proposal-1",
      voterId: "entity-1",
      voterTier: 1,
      sourceNode: "node-1",
      vote: "approve",
    });
    expect(vote.weight).toBe(1);
  });

  it("records a vote with correct weight for Tier 2", () => {
    const vote = vm.castVote({
      id: "vote-1",
      proposalId: "proposal-1",
      voterId: "entity-1",
      voterTier: 2,
      sourceNode: "node-1",
      vote: "approve",
    });
    expect(vote.weight).toBe(3);
  });

  it("records a vote with correct weight for Tier 3", () => {
    const vote = vm.castVote({
      id: "vote-1",
      proposalId: "proposal-1",
      voterId: "entity-1",
      voterTier: 3,
      sourceNode: "node-1",
      vote: "approve",
    });
    expect(vote.weight).toBe(5);
  });

  it("rejects Tier 0 voters", () => {
    expect(() =>
      vm.castVote({
        id: "vote-1",
        proposalId: "proposal-1",
        voterId: "entity-1",
        voterTier: 0,
        sourceNode: "node-1",
        vote: "approve",
      })
    ).toThrow(/Tier 0/i);
  });

  it("prevents double-voting on same proposal", () => {
    vm.castVote({
      id: "vote-1",
      proposalId: "proposal-1",
      voterId: "entity-1",
      voterTier: 1,
      sourceNode: "node-1",
      vote: "approve",
    });
    expect(() =>
      vm.castVote({
        id: "vote-2",
        proposalId: "proposal-1",
        voterId: "entity-1",
        voterTier: 1,
        sourceNode: "node-1",
        vote: "reject",
      })
    ).toThrow(/already voted/i);
  });

  it("allows same voter to vote on different proposals", () => {
    vm.castVote({
      id: "vote-1",
      proposalId: "proposal-1",
      voterId: "entity-1",
      voterTier: 1,
      sourceNode: "node-1",
      vote: "approve",
    });
    expect(() =>
      vm.castVote({
        id: "vote-2",
        proposalId: "proposal-2",
        voterId: "entity-1",
        voterTier: 1,
        sourceNode: "node-1",
        vote: "approve",
      })
    ).not.toThrow();
  });

  it("stores vote metadata correctly", () => {
    const vote = vm.castVote({
      id: "vote-1",
      proposalId: "proposal-1",
      voterId: "entity-1",
      voterTier: 2,
      sourceNode: "node-1",
      vote: "reject",
      signature: "sig-abc",
    });
    expect(vote.proposalId).toBe("proposal-1");
    expect(vote.voterId).toBe("entity-1");
    expect(vote.voterTier).toBe(2);
    expect(vote.vote).toBe("reject");
    expect(vote.signature).toBe("sig-abc");
  });

  it("castAt is a valid ISO timestamp", () => {
    const vote = vm.castVote({
      id: "vote-1",
      proposalId: "proposal-1",
      voterId: "entity-1",
      voterTier: 1,
      sourceNode: "node-1",
      vote: "approve",
    });
    expect(new Date(vote.castAt).toISOString()).toBe(vote.castAt);
  });
});

describe("VoteManager.computeTally", () => {
  let vm: VoteManager;

  beforeEach(() => {
    vm = new VoteManager();
  });

  it("correctly tallies votes by tier", () => {
    vm.castVote({ id: "v1", proposalId: "p1", voterId: "e1", voterTier: 3, sourceNode: "n1", vote: "approve" });
    vm.castVote({ id: "v2", proposalId: "p1", voterId: "e2", voterTier: 3, sourceNode: "n1", vote: "reject" });
    vm.castVote({ id: "v3", proposalId: "p1", voterId: "e3", voterTier: 2, sourceNode: "n1", vote: "approve" });
    vm.castVote({ id: "v4", proposalId: "p1", voterId: "e4", voterTier: 1, sourceNode: "n1", vote: "approve" });

    const tally = vm.computeTally("p1");
    expect(tally.stewardFor).toBe(1);
    expect(tally.stewardAgainst).toBe(1);
    expect(tally.stewardTotal).toBe(2);
    expect(tally.contributorFor).toBe(1);
    expect(tally.contributorTotal).toBe(1);
    expect(tally.participantFor).toBe(1);
    expect(tally.totalVotes).toBe(4);
  });

  it("counts abstain votes in totalVotes but not in for/against", () => {
    vm.castVote({ id: "v1", proposalId: "p1", voterId: "e1", voterTier: 1, sourceNode: "n1", vote: "abstain" });
    vm.castVote({ id: "v2", proposalId: "p1", voterId: "e2", voterTier: 1, sourceNode: "n1", vote: "approve" });

    const tally = vm.computeTally("p1");
    expect(tally.totalVotes).toBe(2);
    expect(tally.participantFor).toBe(1);
    expect(tally.participantAgainst).toBe(0);
  });

  it("returns empty tally for proposal with no votes", () => {
    const tally = vm.computeTally("nonexistent-proposal");
    expect(tally.totalVotes).toBe(0);
    expect(tally.stewardFor).toBe(0);
    expect(tally.contributorFor).toBe(0);
    expect(tally.participantFor).toBe(0);
  });

  it("only tallies votes for the specified proposal", () => {
    vm.castVote({ id: "v1", proposalId: "p1", voterId: "e1", voterTier: 2, sourceNode: "n1", vote: "approve" });
    vm.castVote({ id: "v2", proposalId: "p2", voterId: "e2", voterTier: 2, sourceNode: "n1", vote: "approve" });

    const tally1 = vm.computeTally("p1");
    expect(tally1.totalVotes).toBe(1);

    const tally2 = vm.computeTally("p2");
    expect(tally2.totalVotes).toBe(1);
  });
});

describe("VoteManager.hasVoted", () => {
  let vm: VoteManager;

  beforeEach(() => {
    vm = new VoteManager();
  });

  it("returns false before voting", () => {
    expect(vm.hasVoted("proposal-1", "entity-1")).toBe(false);
  });

  it("returns true after voting", () => {
    vm.castVote({
      id: "vote-1",
      proposalId: "proposal-1",
      voterId: "entity-1",
      voterTier: 1,
      sourceNode: "node-1",
      vote: "approve",
    });
    expect(vm.hasVoted("proposal-1", "entity-1")).toBe(true);
  });

  it("returns false for different proposal", () => {
    vm.castVote({
      id: "vote-1",
      proposalId: "proposal-1",
      voterId: "entity-1",
      voterTier: 1,
      sourceNode: "node-1",
      vote: "approve",
    });
    expect(vm.hasVoted("proposal-2", "entity-1")).toBe(false);
  });
});

describe("VoteManager.applyStewardCap", () => {
  let vm: VoteManager;

  beforeEach(() => {
    vm = new VoteManager();
  });

  it("caps steward votes at 20% of total", () => {
    const tally = makeTally({
      stewardFor: 8,
      stewardAgainst: 2,
      stewardTotal: 10,
      participantFor: 40,
      totalVotes: 50,
    });
    const capped = vm.applyStewardCap(tally);
    // max = ceil(50 * 0.20) = 10, actual = 10, so no change? No: 10 total steward out of 50 total = 20%, at cap.
    // actual stewardFor + stewardAgainst = 10, maxStewardVotes = ceil(50 * 0.20) = 10
    // 10 <= 10 → no cap applied
    expect(capped.stewardTotal).toBe(10);
  });

  it("scales down steward votes when over 20%", () => {
    const tally = makeTally({
      stewardFor: 10,
      stewardAgainst: 0,
      stewardTotal: 10,
      participantFor: 10,
      totalVotes: 20,
    });
    const capped = vm.applyStewardCap(tally);
    // max = ceil(20 * 0.20) = 4, actual steward = 10 > 4
    expect(capped.stewardTotal).toBe(4);
    // stewardFor scaled: round(10 * (4/10)) = 4
    expect(capped.stewardFor).toBe(4);
  });

  it("returns original tally unchanged when totalVotes is 0", () => {
    const tally = makeTally();
    const result = vm.applyStewardCap(tally);
    expect(result).toEqual(tally);
  });

  it("returns original tally when steward votes are within cap", () => {
    const tally = makeTally({
      stewardFor: 1,
      stewardAgainst: 0,
      stewardTotal: 1,
      participantFor: 20,
      totalVotes: 25,
    });
    // max = ceil(25 * 0.20) = 5, actual = 1 <= 5 → unchanged
    const capped = vm.applyStewardCap(tally);
    expect(capped.stewardFor).toBe(1);
    expect(capped.stewardTotal).toBe(1);
  });
});

describe("VoteManager.getProposalVotes", () => {
  let vm: VoteManager;

  beforeEach(() => {
    vm = new VoteManager();
  });

  it("returns all votes for a proposal", () => {
    vm.castVote({ id: "v1", proposalId: "p1", voterId: "e1", voterTier: 1, sourceNode: "n1", vote: "approve" });
    vm.castVote({ id: "v2", proposalId: "p1", voterId: "e2", voterTier: 2, sourceNode: "n1", vote: "reject" });
    vm.castVote({ id: "v3", proposalId: "p2", voterId: "e3", voterTier: 1, sourceNode: "n1", vote: "approve" });

    const votes = vm.getProposalVotes("p1");
    expect(votes.length).toBe(2);
    expect(votes.every((v) => v.proposalId === "p1")).toBe(true);
  });

  it("returns empty array when no votes exist for proposal", () => {
    expect(vm.getProposalVotes("nonexistent")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// VOTING — Sunset Milestones
// ---------------------------------------------------------------------------

describe("checkSunsetMilestones", () => {
  it("returns both false when below all thresholds", () => {
    const result = checkSunsetMilestones(100, 2);
    expect(result.milestone1Met).toBe(false);
    expect(result.milestone2Met).toBe(false);
  });

  it("returns milestone1Met when 500 T2+ across 5 nodes", () => {
    const result = checkSunsetMilestones(500, 5);
    expect(result.milestone1Met).toBe(true);
    expect(result.milestone2Met).toBe(false);
  });

  it("returns milestone1Met false when T2+ count met but node count insufficient", () => {
    const result = checkSunsetMilestones(500, 4);
    expect(result.milestone1Met).toBe(false);
  });

  it("returns milestone1Met false when node count met but T2+ insufficient", () => {
    const result = checkSunsetMilestones(499, 5);
    expect(result.milestone1Met).toBe(false);
  });

  it("returns both met when 2000 T2+ across 10 nodes", () => {
    const result = checkSunsetMilestones(2000, 10);
    expect(result.milestone1Met).toBe(true);
    expect(result.milestone2Met).toBe(true);
  });

  it("returns milestone2Met false when T2+ count met but node count insufficient", () => {
    const result = checkSunsetMilestones(2000, 9);
    expect(result.milestone2Met).toBe(false);
  });

  it("returns milestone2Met false when node count met but T2+ insufficient", () => {
    const result = checkSunsetMilestones(1999, 10);
    expect(result.milestone2Met).toBe(false);
  });

  it("preserves tier2PlusCount and nodeCount in result", () => {
    const result = checkSunsetMilestones(750, 7);
    expect(result.tier2PlusCount).toBe(750);
    expect(result.nodeCount).toBe(7);
  });

  it("SUNSET_MILESTONES constants are correct", () => {
    expect(SUNSET_MILESTONES.milestone1.tier2Plus).toBe(500);
    expect(SUNSET_MILESTONES.milestone1.nodes).toBe(5);
    expect(SUNSET_MILESTONES.milestone2.tier2Plus).toBe(2000);
    expect(SUNSET_MILESTONES.milestone2.nodes).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// CONSTITUTION — GENESIS_CONSTITUTION
// ---------------------------------------------------------------------------

describe("GENESIS_CONSTITUTION", () => {
  it("has correct schema version", () => {
    expect(GENESIS_CONSTITUTION.schema).toBe("constitution-v1");
  });

  it("has 4 tier definitions", () => {
    expect(GENESIS_CONSTITUTION.tiers.definitions.length).toBe(4);
  });

  it("tier definitions cover tiers 0 through 3", () => {
    const tiers = GENESIS_CONSTITUTION.tiers.definitions.map((d) => d.tier);
    expect(tiers).toContain(0);
    expect(tiers).toContain(1);
    expect(tiers).toContain(2);
    expect(tiers).toContain(3);
  });

  it("has 4 proposal types", () => {
    const typeKeys = Object.keys(GENESIS_CONSTITUTION.proposals.types);
    expect(typeKeys.length).toBe(4);
  });

  it("proposal types include 1, 2, 3, and 4", () => {
    const types = GENESIS_CONSTITUTION.proposals.types;
    expect(types[1]).toBeDefined();
    expect(types[2]).toBeDefined();
    expect(types[3]).toBeDefined();
    expect(types[4]).toBeDefined();
  });

  it("ratifiedAt is null initially", () => {
    expect(GENESIS_CONSTITUTION.ratifiedAt).toBeNull();
  });

  it("contentHash is null initially", () => {
    expect(GENESIS_CONSTITUTION.contentHash).toBeNull();
  });

  it("ratifiedBy is empty array initially", () => {
    expect(GENESIS_CONSTITUTION.ratifiedBy).toEqual([]);
  });

  it("stewardCapFraction is 0.20", () => {
    expect(GENESIS_CONSTITUTION.voting.stewardCapFraction).toBe(0.20);
  });

  it("tierWeights match tier engine weights", () => {
    const w = GENESIS_CONSTITUTION.voting.tierWeights;
    expect(w[0]).toBe(0);
    expect(w[1]).toBe(1);
    expect(w[2]).toBe(3);
    expect(w[3]).toBe(5);
  });

  it("thresholds match DEFAULT_THRESHOLDS", () => {
    const t = GENESIS_CONSTITUTION.tiers.thresholds;
    expect(t.tier1MinImp).toBe(DEFAULT_THRESHOLDS.tier1MinImp);
    expect(t.tier1RecencyDays).toBe(DEFAULT_THRESHOLDS.tier1RecencyDays);
    expect(t.tier2MinImp).toBe(DEFAULT_THRESHOLDS.tier2MinImp);
    expect(t.tier2MinEvents).toBe(DEFAULT_THRESHOLDS.tier2MinEvents);
    expect(t.tier3MinImp).toBe(DEFAULT_THRESHOLDS.tier3MinImp);
    expect(t.tier3MinStandingDays).toBe(DEFAULT_THRESHOLDS.tier3MinStandingDays);
  });

  it("amendment requires Type 2 proposal", () => {
    expect(GENESIS_CONSTITUTION.amendments.requiredProposalType).toBe(2);
  });

  it("amendments are irrevocable", () => {
    expect(GENESIS_CONSTITUTION.amendments.irrevocable).toBe(true);
  });

  it("sunset milestone 1 requires 500 T2+ across 5 nodes", () => {
    expect(GENESIS_CONSTITUTION.sunset.milestone1.tier2PlusRequired).toBe(500);
    expect(GENESIS_CONSTITUTION.sunset.milestone1.nodesRequired).toBe(5);
  });

  it("sunset milestone 2 requires 2000 T2+ across 10 nodes", () => {
    expect(GENESIS_CONSTITUTION.sunset.milestone2.tier2PlusRequired).toBe(2000);
    expect(GENESIS_CONSTITUTION.sunset.milestone2.nodesRequired).toBe(10);
  });
});

describe("validateConstitution", () => {
  it("returns valid for GENESIS_CONSTITUTION", () => {
    const result = validateConstitution(GENESIS_CONSTITUTION);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("returns errors for null input", () => {
    const result = validateConstitution(null);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("returns errors for non-object input", () => {
    const result = validateConstitution("not-an-object");
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("returns errors for wrong schema version", () => {
    const result = validateConstitution({ ...GENESIS_CONSTITUTION, schema: "wrong-version" });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("schema"))).toBe(true);
  });

  it("returns errors when tiers section is missing", () => {
    const { tiers: _tiers, ...rest } = GENESIS_CONSTITUTION;
    const result = validateConstitution(rest);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("tiers"))).toBe(true);
  });

  it("returns errors when proposals section is missing", () => {
    const { proposals: _proposals, ...rest } = GENESIS_CONSTITUTION;
    const result = validateConstitution(rest);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("proposals"))).toBe(true);
  });

  it("returns errors when voting section is missing", () => {
    const { voting: _voting, ...rest } = GENESIS_CONSTITUTION;
    const result = validateConstitution(rest);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("voting"))).toBe(true);
  });

  it("returns errors when sunset section is missing", () => {
    const { sunset: _sunset, ...rest } = GENESIS_CONSTITUTION;
    const result = validateConstitution(rest);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("sunset"))).toBe(true);
  });

  it("returns errors when amendments section is missing", () => {
    const { amendments: _amendments, ...rest } = GENESIS_CONSTITUTION;
    const result = validateConstitution(rest);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("amendments"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GAME THEORY SCENARIOS
// ---------------------------------------------------------------------------

describe("Game Theory: Steward minority cannot dominate vote (20% cap)", () => {
  it("10 stewards cannot control outcome against 40 Tier 1 participants", () => {
    // Scenario: 10 stewards all vote FOR, 40 Tier 1 participants all vote AGAINST
    // With 20% cap, steward votes are capped so participants' majority wins
    const vm = new VoteManager();

    // Cast 10 steward votes (Tier 3)
    for (let i = 0; i < 10; i++) {
      vm.castVote({
        id: `steward-vote-${i}`,
        proposalId: "proposal-1",
        voterId: `steward-${i}`,
        voterTier: 3,
        sourceNode: "node-1",
        vote: "approve",
      });
    }
    // Cast 40 participant votes (Tier 1)
    for (let i = 0; i < 40; i++) {
      vm.castVote({
        id: `participant-vote-${i}`,
        proposalId: "proposal-1",
        voterId: `participant-${i}`,
        voterTier: 1,
        sourceNode: "node-1",
        vote: "reject",
      });
    }

    const tally = vm.computeTally("proposal-1");
    const cappedTally = vm.applyStewardCap(tally);

    // With 50 total votes, max steward = ceil(50 * 0.20) = 10
    // actual steward = 10, so exactly at cap — no overshoot
    // But even with full steward weight, participant "reject" should prevail
    // stewardFor=10, participantAgainst=40 → against wins
    // evaluateVotes for Type 3 checks simple majority
    const result = evaluateVotes(3, cappedTally, 200);
    // 40 against > 10 for → majority is AGAINST → not approved
    expect(result.approved).toBe(false);
  });

  it("steward cap is enforced when steward votes exceed 20% of total", () => {
    const tally = makeTally({
      stewardFor: 20,
      stewardAgainst: 0,
      stewardTotal: 20,
      participantFor: 5,
      participantAgainst: 5,
      totalVotes: 30,
    });
    // max steward = ceil(30 * 0.20) = 6
    const result = evaluateVotes(1, tally, 30);
    expect(result.effectiveStewardVotes).toBeLessThanOrEqual(6);
  });
});

describe("Game Theory: Type 2 governance change requires supermajority", () => {
  it("rejects Type 2 proposal with simple majority but below 3/4 steward threshold", () => {
    // 3 out of 5 stewards = 60%, below 75% required
    const tally = makeTally({
      stewardFor: 3,
      stewardAgainst: 2,
      stewardTotal: 5,
      contributorFor: 4,
      contributorAgainst: 2,
      contributorTotal: 6,
      totalVotes: 12,
    });
    const result = evaluateVotes(2, tally, 12);
    expect(result.stewardApprovalMet).toBe(false);
    expect(result.approved).toBe(false);
  });

  it("approves Type 2 with 3/4 steward and 2/3 contributor and 60% quorum", () => {
    const tally = makeTally({
      stewardFor: 6,
      stewardAgainst: 1,
      stewardTotal: 7,
      contributorFor: 8,
      contributorAgainst: 4,
      contributorTotal: 12,
      totalVotes: 20,
    });
    // quorum: 20/20 = 100% >= 60%
    // steward: 6/7 ≈ 85.7% >= 75%
    // contributor: 8/12 ≈ 66.7% >= 66.7%
    const result = evaluateVotes(2, tally, 20);
    expect(result.quorumMet).toBe(true);
    expect(result.stewardApprovalMet).toBe(true);
    expect(result.contributorApprovalMet).toBe(true);
    expect(result.approved).toBe(true);
  });
});

describe("Game Theory: Emergency 4-of-5 anchor vote", () => {
  it("succeeds with 4 anchor approvals", () => {
    const tally = makeTally({
      stewardFor: 4,
      stewardAgainst: 1,
      stewardTotal: 5,
      totalVotes: 5,
    });
    const result = evaluateVotes(4, tally, 5);
    expect(result.approved).toBe(true);
  });

  it("fails with only 3 anchor approvals", () => {
    const tally = makeTally({
      stewardFor: 3,
      stewardAgainst: 2,
      stewardTotal: 5,
      totalVotes: 5,
    });
    const result = evaluateVotes(4, tally, 5);
    expect(result.approved).toBe(false);
  });

  it("fails with 0 anchor approvals", () => {
    const tally = makeTally({
      stewardFor: 0,
      stewardAgainst: 5,
      stewardTotal: 5,
      totalVotes: 5,
    });
    const result = evaluateVotes(4, tally, 5);
    expect(result.approved).toBe(false);
  });
});

describe("Game Theory: Tier 1 participants can pass community proposals without steward consent", () => {
  it("community proposal passes with only Tier 1 votes and no stewards", () => {
    const vm = new VoteManager();
    // 30 Tier 1 participants vote, majority approve
    for (let i = 0; i < 20; i++) {
      vm.castVote({
        id: `v-for-${i}`,
        proposalId: "proposal-1",
        voterId: `participant-for-${i}`,
        voterTier: 1,
        sourceNode: "node-1",
        vote: "approve",
      });
    }
    for (let i = 0; i < 10; i++) {
      vm.castVote({
        id: `v-against-${i}`,
        proposalId: "proposal-1",
        voterId: `participant-against-${i}`,
        voterTier: 1,
        sourceNode: "node-1",
        vote: "reject",
      });
    }

    const tally = vm.computeTally("proposal-1");
    expect(tally.totalVotes).toBe(30);
    expect(tally.stewardFor).toBe(0);
    expect(tally.stewardTotal).toBe(0);

    const result = evaluateVotes(3, tally, 200);
    // 30 >= 25 (quorum) AND 20 for > 10 against (simple majority)
    expect(result.approved).toBe(true);
  });

  it("community proposal requires 25 minimum votes even with majority", () => {
    // Only 15 Tier 1 participants vote — below minimum
    const tally = makeTally({
      participantFor: 10,
      participantAgainst: 5,
      totalVotes: 15,
    });
    const result = evaluateVotes(3, tally, 200);
    expect(result.quorumMet).toBe(false);
    expect(result.approved).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// APPROVAL_REQUIREMENTS constant
// ---------------------------------------------------------------------------

describe("APPROVAL_REQUIREMENTS", () => {
  it("Type 1 stewardApproval is 2/3", () => {
    expect(APPROVAL_REQUIREMENTS[1]!.stewardApproval).toBeCloseTo(2 / 3);
  });

  it("Type 1 contributorApproval is 1/2", () => {
    expect(APPROVAL_REQUIREMENTS[1]!.contributorApproval).toBeCloseTo(0.5);
  });

  it("Type 1 quorum is 50%", () => {
    expect(APPROVAL_REQUIREMENTS[1]!.quorum).toBe(0.50);
  });

  it("Type 2 stewardApproval is 3/4", () => {
    expect(APPROVAL_REQUIREMENTS[2]!.stewardApproval).toBeCloseTo(3 / 4);
  });

  it("Type 2 contributorApproval is 2/3", () => {
    expect(APPROVAL_REQUIREMENTS[2]!.contributorApproval).toBeCloseTo(2 / 3);
  });

  it("Type 2 quorum is 60%", () => {
    expect(APPROVAL_REQUIREMENTS[2]!.quorum).toBe(0.60);
  });

  it("Type 3 quorum is 25 (absolute count)", () => {
    expect(APPROVAL_REQUIREMENTS[3]!.quorum).toBe(25);
    expect(APPROVAL_REQUIREMENTS[3]!.quorumIsFraction).toBe(false);
  });

  it("Type 4 quorum is 4 (absolute count)", () => {
    expect(APPROVAL_REQUIREMENTS[4]!.quorum).toBe(4);
    expect(APPROVAL_REQUIREMENTS[4]!.quorumIsFraction).toBe(false);
  });

  it("Type 4 votingWindowHours is 24", () => {
    expect(APPROVAL_REQUIREMENTS[4]!.votingWindowHours).toBe(24);
  });
});
