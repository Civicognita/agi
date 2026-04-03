import { describe, it, expect, beforeEach } from "vitest";
import {
  RecognitionManager,
  RECOGNITION_BONUS,
} from "./recognition.js";
import type { RecognitionDomain } from "./recognition.js";
import {
  BondingManager,
  ALIGNMENT_BONUS_MULTIPLIER,
} from "./bonding.js";
import { MarketplaceManager } from "./marketplace.js";
import {
  rankSkills,
  computeScore,
  DEFAULT_RANKING_WEIGHTS,
} from "./marketplace-ranking.js";
import type { RankingContext } from "./marketplace-ranking.js";
import type { SkillListing } from "./marketplace.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRecognitionParams(overrides: Partial<Parameters<RecognitionManager["create"]>[0]> = {}) {
  return {
    id: "rec-1",
    recognizerId: "entity-1",
    recognizerGeid: "geid:test1",
    recipientId: "entity-2",
    recipientGeid: "geid:test2",
    contribution: "Helped the community with important work",
    domain: "community" as RecognitionDomain,
    boolLabel: "TRUE",
    recognizerCoa: "$A0.#E0.@A0.C001",
    recipientCoa: "$A0.#E0.@A0.C002",
    sourceNode: "node-1",
    ...overrides,
  };
}

function makeBondParams(overrides: Partial<Parameters<BondingManager["propose"]>[0]> = {}) {
  return {
    id: "bond-1",
    entityAId: "entity-1",
    entityAGeid: "geid:test1",
    entityBId: "entity-2",
    entityBGeid: "geid:test2",
    alignment: "Shared commitment to community development",
    domains: ["community", "governance"],
    coaLinkA: "$A0.#E0.@A0.C001",
    coaLinkB: "$A0.#E0.@A0.C002",
    ...overrides,
  };
}

function makeSkillParams(overrides: Partial<Parameters<MarketplaceManager["submit"]>[0]> = {}) {
  return {
    id: "skill-1",
    name: "Community Connector",
    description: "Helps entities connect with their community",
    authorId: "entity-1",
    authorGeid: "geid:test1",
    authorCoa: "$A0.#E0.@A0.C001",
    domains: ["community"] as RecognitionDomain[],
    version: "1.0.0",
    tags: ["community", "networking"],
    sourceNode: "node-1",
    ...overrides,
  };
}

/** Build a minimal SkillListing for ranking tests without going through the manager. */
function makeSkillListing(overrides: Partial<SkillListing> = {}): SkillListing {
  const now = new Date().toISOString();
  return {
    id: "skill-1",
    name: "Test Skill",
    description: "A test skill",
    authorId: "entity-1",
    authorGeid: "geid:test1",
    authorCoa: "$A0.#E0.@A0.C001",
    domains: ["community"],
    version: "1.0.0",
    verificationStatus: "unreviewed",
    tags: [],
    stats: {
      installs: 0,
      activeInstalls: 0,
      uninstalls: 0,
      retentionRate: 1.0,
      avgImpCorrelation: 0,
    },
    endorsementCount: 0,
    sourceNode: "node-1",
    createdAt: now,
    updatedAt: now,
    published: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// RecognitionManager
// ---------------------------------------------------------------------------

describe("RecognitionManager.create", () => {
  let mgr: RecognitionManager;

  beforeEach(() => {
    mgr = new RecognitionManager();
  });

  it("creates a pending recognition event", () => {
    const event = mgr.create(makeRecognitionParams());
    expect(event.status).toBe("pending");
  });

  it("rejects self-recognition", () => {
    expect(() =>
      mgr.create(makeRecognitionParams({ recognizerId: "entity-1", recipientId: "entity-1" }))
    ).toThrow(/cannot recognize yourself/i);
  });

  it("assigns recipientBase bonus from RECOGNITION_BONUS", () => {
    const event = mgr.create(makeRecognitionParams());
    expect(event.recipientBonus).toBe(RECOGNITION_BONUS.recipientBase);
  });

  it("assigns recognizerIncentive bonus from RECOGNITION_BONUS", () => {
    const event = mgr.create(makeRecognitionParams());
    expect(event.recognizerBonus).toBe(RECOGNITION_BONUS.recognizerIncentive);
  });

  it("stores all required fields", () => {
    const params = makeRecognitionParams();
    const event = mgr.create(params);
    expect(event.id).toBe("rec-1");
    expect(event.recognizerId).toBe("entity-1");
    expect(event.recipientId).toBe("entity-2");
    expect(event.contribution).toBe(params.contribution);
    expect(event.domain).toBe("community");
    expect(event.publicConsent).toBe(false);
  });
});

describe("RecognitionManager.validate", () => {
  let mgr: RecognitionManager;

  beforeEach(() => {
    mgr = new RecognitionManager();
  });

  it("transitions pending to validated", () => {
    mgr.create(makeRecognitionParams());
    const event = mgr.validate("rec-1");
    expect(event.status).toBe("validated");
  });

  it("with custom bonus respects maxBonus cap", () => {
    mgr.create(makeRecognitionParams());
    // Pass a bonus well above the cap
    const event = mgr.validate("rec-1", RECOGNITION_BONUS.maxBonus + 1.0);
    expect(event.recipientBonus).toBe(RECOGNITION_BONUS.maxBonus);
  });

  it("with custom bonus below cap uses provided value", () => {
    mgr.create(makeRecognitionParams());
    const event = mgr.validate("rec-1", 0.20);
    expect(event.recipientBonus).toBeCloseTo(0.20);
  });

  it("throws when validating a non-pending event", () => {
    mgr.create(makeRecognitionParams());
    mgr.validate("rec-1");
    expect(() => mgr.validate("rec-1")).toThrow(/cannot validate/i);
  });
});

describe("RecognitionManager.reject", () => {
  let mgr: RecognitionManager;

  beforeEach(() => {
    mgr = new RecognitionManager();
  });

  it("transitions pending to rejected", () => {
    mgr.create(makeRecognitionParams());
    const event = mgr.reject("rec-1");
    expect(event.status).toBe("rejected");
  });

  it("zeroes recipientBonus on rejection", () => {
    mgr.create(makeRecognitionParams());
    const event = mgr.reject("rec-1");
    expect(event.recipientBonus).toBe(0);
  });

  it("zeroes recognizerBonus on rejection", () => {
    mgr.create(makeRecognitionParams());
    const event = mgr.reject("rec-1");
    expect(event.recognizerBonus).toBe(0);
  });

  it("throws when rejecting a non-pending event", () => {
    mgr.create(makeRecognitionParams());
    mgr.reject("rec-1");
    expect(() => mgr.reject("rec-1")).toThrow(/cannot reject/i);
  });
});

describe("RecognitionManager.getReceivedRecognitions", () => {
  let mgr: RecognitionManager;

  beforeEach(() => {
    mgr = new RecognitionManager();
  });

  it("returns recognitions for a recipient", () => {
    mgr.create(makeRecognitionParams({ id: "rec-1", recipientId: "entity-2" }));
    mgr.create(makeRecognitionParams({ id: "rec-2", recognizerId: "entity-3", recipientId: "entity-2" }));
    const received = mgr.getReceivedRecognitions("entity-2");
    expect(received.length).toBe(2);
  });

  it("returns empty array for entity with no received recognitions", () => {
    expect(mgr.getReceivedRecognitions("entity-99")).toEqual([]);
  });

  it("filters by status when provided", () => {
    mgr.create(makeRecognitionParams({ id: "rec-1" }));
    mgr.create(makeRecognitionParams({ id: "rec-2", recognizerId: "entity-3", recipientId: "entity-2" }));
    mgr.validate("rec-1");
    const validated = mgr.getReceivedRecognitions("entity-2", "validated");
    expect(validated.length).toBe(1);
    expect(validated[0]!.id).toBe("rec-1");
  });
});

describe("RecognitionManager.getGivenRecognitions", () => {
  let mgr: RecognitionManager;

  beforeEach(() => {
    mgr = new RecognitionManager();
  });

  it("returns recognitions given by an entity", () => {
    mgr.create(makeRecognitionParams({ id: "rec-1", recognizerId: "entity-1", recipientId: "entity-2" }));
    mgr.create(makeRecognitionParams({ id: "rec-2", recognizerId: "entity-1", recipientId: "entity-3" }));
    const given = mgr.getGivenRecognitions("entity-1");
    expect(given.length).toBe(2);
  });

  it("returns empty array for entity that has given no recognitions", () => {
    expect(mgr.getGivenRecognitions("entity-99")).toEqual([]);
  });
});

describe("RecognitionManager.getPublicProfile", () => {
  let mgr: RecognitionManager;

  beforeEach(() => {
    mgr = new RecognitionManager();
  });

  it("only returns validated + public-consent events", () => {
    // validated + public
    mgr.create(makeRecognitionParams({ id: "rec-1", publicConsent: true }));
    mgr.validate("rec-1");

    // validated but not public
    mgr.create(makeRecognitionParams({ id: "rec-2", recognizerId: "entity-3", publicConsent: false }));
    mgr.validate("rec-2");

    // pending + public
    mgr.create(makeRecognitionParams({ id: "rec-3", recognizerId: "entity-4", publicConsent: true }));

    const profile = mgr.getPublicProfile("entity-2");
    expect(profile.length).toBe(1);
    expect(profile[0]!.id).toBe("rec-1");
  });

  it("returns empty array when no public validated recognitions exist", () => {
    mgr.create(makeRecognitionParams({ publicConsent: false }));
    mgr.validate("rec-1");
    expect(mgr.getPublicProfile("entity-2")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// BondingManager
// ---------------------------------------------------------------------------

describe("BondingManager.propose", () => {
  let mgr: BondingManager;

  beforeEach(() => {
    mgr = new BondingManager();
  });

  it("creates a proposed bond", () => {
    const bond = mgr.propose(makeBondParams());
    expect(bond.status).toBe("proposed");
  });

  it("rejects self-bonding", () => {
    expect(() =>
      mgr.propose(makeBondParams({ entityAId: "entity-1", entityBId: "entity-1" }))
    ).toThrow(/cannot bond with yourself/i);
  });

  it("rejects duplicate active bonds", () => {
    mgr.propose(makeBondParams({ id: "bond-1" }));
    mgr.accept("bond-1", "entity-2");
    expect(() =>
      mgr.propose(makeBondParams({ id: "bond-2" }))
    ).toThrow(/active bond already exists/i);
  });

  it("stores all required fields", () => {
    const params = makeBondParams();
    const bond = mgr.propose(params);
    expect(bond.id).toBe("bond-1");
    expect(bond.entityAId).toBe("entity-1");
    expect(bond.entityBId).toBe("entity-2");
    expect(bond.alignment).toBe(params.alignment);
    expect(bond.domains).toEqual(["community", "governance"]);
    expect(bond.bonusMultiplier).toBe(ALIGNMENT_BONUS_MULTIPLIER);
    expect(bond.activatedAt).toBeNull();
    expect(bond.revokedAt).toBeNull();
  });
});

describe("BondingManager.accept", () => {
  let mgr: BondingManager;

  beforeEach(() => {
    mgr = new BondingManager();
    mgr.propose(makeBondParams());
  });

  it("activates a proposed bond when called by entity B", () => {
    const bond = mgr.accept("bond-1", "entity-2");
    expect(bond.status).toBe("active");
  });

  it("sets activatedAt timestamp on accept", () => {
    const before = new Date().toISOString();
    const bond = mgr.accept("bond-1", "entity-2");
    const after = new Date().toISOString();
    expect(bond.activatedAt).not.toBeNull();
    expect(bond.activatedAt! >= before).toBe(true);
    expect(bond.activatedAt! <= after).toBe(true);
  });

  it("rejects acceptance from non-partner entity", () => {
    expect(() => mgr.accept("bond-1", "entity-1")).toThrow(/only the proposed partner/i);
  });

  it("throws when accepting a non-proposed bond", () => {
    mgr.accept("bond-1", "entity-2");
    expect(() => mgr.accept("bond-1", "entity-2")).toThrow(/cannot accept/i);
  });
});

describe("BondingManager.revoke", () => {
  let mgr: BondingManager;

  beforeEach(() => {
    mgr = new BondingManager();
    mgr.propose(makeBondParams());
    mgr.accept("bond-1", "entity-2");
  });

  it("can be revoked by entity A", () => {
    const bond = mgr.revoke("bond-1", "entity-1");
    expect(bond.status).toBe("revoked");
    expect(bond.revokedBy).toBe("entity-1");
  });

  it("can be revoked by entity B", () => {
    const bond = mgr.revoke("bond-1", "entity-2");
    expect(bond.status).toBe("revoked");
    expect(bond.revokedBy).toBe("entity-2");
  });

  it("rejects revocation from non-participants", () => {
    expect(() => mgr.revoke("bond-1", "entity-99")).toThrow(/only bond participants/i);
  });

  it("throws when revoking an already-revoked bond", () => {
    mgr.revoke("bond-1", "entity-1");
    expect(() => mgr.revoke("bond-1", "entity-1")).toThrow(/already revoked/i);
  });
});

describe("BondingManager.getEntityBonds", () => {
  let mgr: BondingManager;

  beforeEach(() => {
    mgr = new BondingManager();
  });

  it("returns bonds for an entity", () => {
    mgr.propose(makeBondParams({ id: "bond-1" }));
    const bonds = mgr.getEntityBonds("entity-1");
    expect(bonds.length).toBe(1);
  });

  it("returns bonds for either entity in the pair", () => {
    mgr.propose(makeBondParams({ id: "bond-1" }));
    expect(mgr.getEntityBonds("entity-1").length).toBe(1);
    expect(mgr.getEntityBonds("entity-2").length).toBe(1);
  });

  it("returns empty array for entity with no bonds", () => {
    expect(mgr.getEntityBonds("entity-99")).toEqual([]);
  });

  it("filters by status when provided", () => {
    mgr.propose(makeBondParams({ id: "bond-1" }));
    mgr.accept("bond-1", "entity-2");
    const active = mgr.getEntityBonds("entity-1", "active");
    const proposed = mgr.getEntityBonds("entity-1", "proposed");
    expect(active.length).toBe(1);
    expect(proposed.length).toBe(0);
  });
});

describe("BondingManager.getActiveBond", () => {
  let mgr: BondingManager;

  beforeEach(() => {
    mgr = new BondingManager();
  });

  it("finds active bond between two entities", () => {
    mgr.propose(makeBondParams());
    mgr.accept("bond-1", "entity-2");
    const bond = mgr.getActiveBond("entity-1", "entity-2");
    expect(bond).not.toBeNull();
    expect(bond!.id).toBe("bond-1");
  });

  it("returns null for proposed bond (not yet active)", () => {
    mgr.propose(makeBondParams());
    expect(mgr.getActiveBond("entity-1", "entity-2")).toBeNull();
  });

  it("returns null when no bond exists", () => {
    expect(mgr.getActiveBond("entity-1", "entity-2")).toBeNull();
  });
});

describe("BondingManager.getAlignmentBonus", () => {
  let mgr: BondingManager;

  beforeEach(() => {
    mgr = new BondingManager();
  });

  it("returns 0 when entity has no active bonds", () => {
    expect(mgr.getAlignmentBonus("entity-1", "community")).toBe(0);
  });

  it("sums multipliers for matching domains across active bonds", () => {
    // Bond 1: entity-1 + entity-2, domains: community, governance
    mgr.propose(makeBondParams({ id: "bond-1", entityBId: "entity-2" }));
    mgr.accept("bond-1", "entity-2");

    // Bond 2: entity-1 + entity-3, domains: community
    mgr.propose(
      makeBondParams({ id: "bond-2", entityAId: "entity-1", entityBId: "entity-3", domains: ["community"] })
    );
    mgr.accept("bond-2", "entity-3");

    // community appears in both bonds → 2 * ALIGNMENT_BONUS_MULTIPLIER
    const bonus = mgr.getAlignmentBonus("entity-1", "community");
    expect(bonus).toBeCloseTo(2 * ALIGNMENT_BONUS_MULTIPLIER);
  });

  it("returns 0 for a domain not covered by any bond", () => {
    mgr.propose(makeBondParams({ id: "bond-1", domains: ["governance"] }));
    mgr.accept("bond-1", "entity-2");
    expect(mgr.getAlignmentBonus("entity-1", "innovation")).toBe(0);
  });
});

describe("BondingManager.getHistory", () => {
  let mgr: BondingManager;

  beforeEach(() => {
    mgr = new BondingManager();
  });

  it("returns full audit trail for a bond", () => {
    mgr.propose(makeBondParams());
    mgr.accept("bond-1", "entity-2");
    mgr.revoke("bond-1", "entity-1");

    const history = mgr.getHistory("bond-1");
    expect(history.length).toBe(3);
    expect(history[0]!.action).toBe("proposed");
    expect(history[1]!.action).toBe("activated");
    expect(history[2]!.action).toBe("revoked");
  });

  it("returns all history when no bondId filter given", () => {
    mgr.propose(makeBondParams({ id: "bond-1" }));
    mgr.propose(makeBondParams({ id: "bond-2", entityAId: "entity-1", entityBId: "entity-3" }));

    const history = mgr.getHistory();
    expect(history.length).toBe(2);
  });

  it("returns empty array for bond with no history", () => {
    expect(mgr.getHistory("bond-nonexistent")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// MarketplaceManager
// ---------------------------------------------------------------------------

describe("MarketplaceManager.submit", () => {
  let mgr: MarketplaceManager;

  beforeEach(() => {
    mgr = new MarketplaceManager();
  });

  it("creates an unreviewed skill", () => {
    const skill = mgr.submit(makeSkillParams());
    expect(skill.verificationStatus).toBe("unreviewed");
  });

  it("creates an unpublished skill", () => {
    const skill = mgr.submit(makeSkillParams());
    expect(skill.published).toBe(false);
  });

  it("initializes stats to zero", () => {
    const skill = mgr.submit(makeSkillParams());
    expect(skill.stats.installs).toBe(0);
    expect(skill.stats.activeInstalls).toBe(0);
    expect(skill.stats.uninstalls).toBe(0);
    expect(skill.endorsementCount).toBe(0);
  });

  it("initializes retentionRate to 1.0", () => {
    const skill = mgr.submit(makeSkillParams());
    expect(skill.stats.retentionRate).toBe(1.0);
  });
});

describe("MarketplaceManager.publish", () => {
  let mgr: MarketplaceManager;

  beforeEach(() => {
    mgr = new MarketplaceManager();
    mgr.submit(makeSkillParams());
  });

  it("makes a skill visible (published = true)", () => {
    const skill = mgr.publish("skill-1");
    expect(skill.published).toBe(true);
  });

  it("throws for non-existent skill", () => {
    expect(() => mgr.publish("skill-nonexistent")).toThrow(/skill not found/i);
  });
});

describe("MarketplaceManager.setVerificationStatus", () => {
  let mgr: MarketplaceManager;

  beforeEach(() => {
    mgr = new MarketplaceManager();
    mgr.submit(makeSkillParams());
  });

  it("updates status to reviewed", () => {
    const skill = mgr.setVerificationStatus("skill-1", "reviewed");
    expect(skill.verificationStatus).toBe("reviewed");
  });

  it("updates status to flagged", () => {
    const skill = mgr.setVerificationStatus("skill-1", "flagged");
    expect(skill.verificationStatus).toBe("flagged");
  });
});

describe("MarketplaceManager.install", () => {
  let mgr: MarketplaceManager;

  beforeEach(() => {
    mgr = new MarketplaceManager();
    mgr.submit(makeSkillParams());
  });

  it("increments installs and activeInstalls correctly", () => {
    mgr.install("skill-1", "entity-1");
    const skill = mgr.get("skill-1")!;
    expect(skill.stats.installs).toBe(1);
    expect(skill.stats.activeInstalls).toBe(1);
  });

  it("double install is idempotent", () => {
    mgr.install("skill-1", "entity-1");
    mgr.install("skill-1", "entity-1");
    const skill = mgr.get("skill-1")!;
    expect(skill.stats.installs).toBe(1);
    expect(skill.stats.activeInstalls).toBe(1);
  });

  it("multiple users each increment installs independently", () => {
    mgr.install("skill-1", "entity-1");
    mgr.install("skill-1", "entity-2");
    const skill = mgr.get("skill-1")!;
    expect(skill.stats.installs).toBe(2);
    expect(skill.stats.activeInstalls).toBe(2);
  });
});

describe("MarketplaceManager.uninstall", () => {
  let mgr: MarketplaceManager;

  beforeEach(() => {
    mgr = new MarketplaceManager();
    mgr.submit(makeSkillParams());
  });

  it("decrements activeInstalls and increments uninstalls", () => {
    mgr.install("skill-1", "entity-1");
    mgr.uninstall("skill-1", "entity-1");
    const skill = mgr.get("skill-1")!;
    expect(skill.stats.activeInstalls).toBe(0);
    expect(skill.stats.uninstalls).toBe(1);
    // installs count does not go back down
    expect(skill.stats.installs).toBe(1);
  });

  it("uninstalling something not installed is a no-op", () => {
    mgr.uninstall("skill-1", "entity-99");
    const skill = mgr.get("skill-1")!;
    expect(skill.stats.uninstalls).toBe(0);
  });

  it("retentionRate is recalculated after uninstall", () => {
    mgr.install("skill-1", "entity-1");
    mgr.install("skill-1", "entity-2");
    mgr.uninstall("skill-1", "entity-1");
    const skill = mgr.get("skill-1")!;
    // 1 active out of 2 installs = 0.5
    expect(skill.stats.retentionRate).toBeCloseTo(0.5);
  });
});

describe("MarketplaceManager.endorse", () => {
  let mgr: MarketplaceManager;

  beforeEach(() => {
    mgr = new MarketplaceManager();
    mgr.submit(makeSkillParams());
  });

  it("adds endorsement and increments endorsementCount", () => {
    mgr.endorse({
      id: "end-1",
      skillId: "skill-1",
      endorserId: "entity-2",
      endorserGeid: "geid:test2",
      comment: "Excellent skill",
    });
    const skill = mgr.get("skill-1")!;
    expect(skill.endorsementCount).toBe(1);
    expect(mgr.getEndorsements("skill-1").length).toBe(1);
  });

  it("endorsement stores all fields correctly", () => {
    const endorsement = mgr.endorse({
      id: "end-1",
      skillId: "skill-1",
      endorserId: "entity-2",
      endorserGeid: "geid:test2",
      comment: "Excellent skill",
    });
    expect(endorsement.id).toBe("end-1");
    expect(endorsement.endorserId).toBe("entity-2");
    expect(endorsement.comment).toBe("Excellent skill");
  });
});

describe("MarketplaceManager.search", () => {
  let mgr: MarketplaceManager;

  beforeEach(() => {
    mgr = new MarketplaceManager();

    mgr.submit(makeSkillParams({ id: "skill-1", name: "Community Tool", description: "For community work", domains: ["community"] }));
    mgr.submit(makeSkillParams({ id: "skill-2", name: "Tech Wizard", description: "For technology tasks", domains: ["technology"] }));
    mgr.submit(makeSkillParams({ id: "skill-3", name: "Hidden Skill", description: "Not published", domains: ["governance"] }));

    mgr.publish("skill-1");
    mgr.publish("skill-2");
    // skill-3 stays unpublished
  });

  it("filters by domain", () => {
    const results = mgr.search({ domain: "community" });
    expect(results.length).toBe(1);
    expect(results[0]!.id).toBe("skill-1");
  });

  it("filters by text in name", () => {
    const results = mgr.search({ text: "wizard" });
    expect(results.length).toBe(1);
    expect(results[0]!.id).toBe("skill-2");
  });

  it("filters by text in description", () => {
    const results = mgr.search({ text: "technology tasks" });
    expect(results.length).toBe(1);
    expect(results[0]!.id).toBe("skill-2");
  });

  it("text search is case-insensitive", () => {
    const results = mgr.search({ text: "COMMUNITY" });
    expect(results.length).toBe(1);
    expect(results[0]!.id).toBe("skill-1");
  });

  it("only returns published skills", () => {
    const all = mgr.search({});
    const ids = all.map(s => s.id);
    expect(ids).not.toContain("skill-3");
    expect(all.length).toBe(2);
  });

  it("empty query returns all published skills", () => {
    const results = mgr.search({});
    expect(results.length).toBe(2);
  });
});

describe("MarketplaceManager.isInstalled", () => {
  let mgr: MarketplaceManager;

  beforeEach(() => {
    mgr = new MarketplaceManager();
    mgr.submit(makeSkillParams());
  });

  it("tracks user installs — returns true after install", () => {
    mgr.install("skill-1", "entity-1");
    expect(mgr.isInstalled("skill-1", "entity-1")).toBe(true);
  });

  it("returns false for user who has not installed", () => {
    expect(mgr.isInstalled("skill-1", "entity-99")).toBe(false);
  });

  it("returns false after uninstall", () => {
    mgr.install("skill-1", "entity-1");
    mgr.uninstall("skill-1", "entity-1");
    expect(mgr.isInstalled("skill-1", "entity-1")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Marketplace Ranking
// ---------------------------------------------------------------------------

describe("rankSkills", () => {
  it("sorts by descending score", () => {
    const now = new Date();
    const recent = now.toISOString();
    const old = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString();

    const skills: SkillListing[] = [
      makeSkillListing({ id: "skill-1", endorsementCount: 0, updatedAt: old }),
      makeSkillListing({ id: "skill-2", endorsementCount: 10, updatedAt: recent }),
    ];

    const context: RankingContext = {
      maxEndorsements: 10,
      maxInstalls: 0,
      maxImpCorrelation: 0,
      now,
    };

    const ranked = rankSkills(skills, context);
    expect(ranked[0]!.skillId).toBe("skill-2");
    expect(ranked[1]!.skillId).toBe("skill-1");
    expect(ranked[0]!.totalScore).toBeGreaterThanOrEqual(ranked[1]!.totalScore);
  });

  it("returns one score per skill", () => {
    const skills = [
      makeSkillListing({ id: "skill-1" }),
      makeSkillListing({ id: "skill-2" }),
    ];
    const context: RankingContext = {
      maxEndorsements: 1,
      maxInstalls: 1,
      maxImpCorrelation: 1,
      now: new Date(),
    };
    const ranked = rankSkills(skills, context);
    expect(ranked.length).toBe(2);
  });
});

describe("computeScore", () => {
  it("produces correct factor breakdown structure", () => {
    const skill = makeSkillListing({ id: "skill-1" });
    const context: RankingContext = {
      maxEndorsements: 10,
      maxInstalls: 10,
      maxImpCorrelation: 1,
      now: new Date(),
    };
    const score = computeScore(skill, context);
    expect(score).toHaveProperty("skillId", "skill-1");
    expect(score).toHaveProperty("totalScore");
    expect(score.factors).toHaveProperty("domainMatch");
    expect(score.factors).toHaveProperty("recognition");
    expect(score.factors).toHaveProperty("usageQuality");
    expect(score.factors).toHaveProperty("coaContribution");
    expect(score.factors).toHaveProperty("recency");
  });

  it("totalScore equals weighted sum of factors", () => {
    const skill = makeSkillListing({
      id: "skill-1",
      endorsementCount: 5,
      stats: {
        installs: 10,
        activeInstalls: 8,
        uninstalls: 2,
        retentionRate: 0.8,
        avgImpCorrelation: 0.5,
      },
    });
    const context: RankingContext = {
      queryDomain: "community",
      maxEndorsements: 10,
      maxInstalls: 10,
      maxImpCorrelation: 1.0,
      now: new Date(),
    };
    const score = computeScore(skill, context);
    const w = DEFAULT_RANKING_WEIGHTS;
    const expected =
      score.factors.domainMatch * w.domainMatch +
      score.factors.recognition * w.recognition +
      score.factors.usageQuality * w.usageQuality +
      score.factors.coaContribution * w.coaContribution +
      score.factors.recency * w.recency;
    expect(score.totalScore).toBeCloseTo(expected);
  });
});

describe("Domain match factor", () => {
  const context: RankingContext = {
    maxEndorsements: 0,
    maxInstalls: 0,
    maxImpCorrelation: 0,
    now: new Date(),
  };

  it("returns 1.0 for matching domain", () => {
    const skill = makeSkillListing({ domains: ["community"] });
    const score = computeScore(skill, { ...context, queryDomain: "community" });
    expect(score.factors.domainMatch).toBe(1.0);
  });

  it("returns 0.0 for non-matching domain", () => {
    const skill = makeSkillListing({ domains: ["community"] });
    const score = computeScore(skill, { ...context, queryDomain: "technology" });
    expect(score.factors.domainMatch).toBe(0.0);
  });

  it("returns 0.5 when no domain query provided", () => {
    const skill = makeSkillListing({ domains: ["community"] });
    const score = computeScore(skill, { ...context, queryDomain: undefined });
    expect(score.factors.domainMatch).toBe(0.5);
  });
});

describe("Recognition factor", () => {
  it("normalizes against maxEndorsements", () => {
    const skill = makeSkillListing({ endorsementCount: 5 });
    const context: RankingContext = {
      maxEndorsements: 10,
      maxInstalls: 0,
      maxImpCorrelation: 0,
      now: new Date(),
    };
    const score = computeScore(skill, context);
    expect(score.factors.recognition).toBeCloseTo(0.5);
  });

  it("returns 0 when maxEndorsements is 0", () => {
    const skill = makeSkillListing({ endorsementCount: 0 });
    const context: RankingContext = {
      maxEndorsements: 0,
      maxInstalls: 0,
      maxImpCorrelation: 0,
      now: new Date(),
    };
    const score = computeScore(skill, context);
    expect(score.factors.recognition).toBe(0);
  });

  it("caps at 1.0 when endorsements exceed maxEndorsements", () => {
    const skill = makeSkillListing({ endorsementCount: 20 });
    const context: RankingContext = {
      maxEndorsements: 10,
      maxInstalls: 0,
      maxImpCorrelation: 0,
      now: new Date(),
    };
    const score = computeScore(skill, context);
    expect(score.factors.recognition).toBe(1.0);
  });
});

describe("Usage quality factor", () => {
  it("uses retention rate directly", () => {
    const skill = makeSkillListing({
      stats: {
        installs: 10,
        activeInstalls: 7,
        uninstalls: 3,
        retentionRate: 0.7,
        avgImpCorrelation: 0,
      },
    });
    const context: RankingContext = {
      maxEndorsements: 0,
      maxInstalls: 0,
      maxImpCorrelation: 0,
      now: new Date(),
    };
    const score = computeScore(skill, context);
    expect(score.factors.usageQuality).toBeCloseTo(0.7);
  });

  it("returns 0.5 for new skills with no installs", () => {
    const skill = makeSkillListing({
      stats: {
        installs: 0,
        activeInstalls: 0,
        uninstalls: 0,
        retentionRate: 1.0,
        avgImpCorrelation: 0,
      },
    });
    const context: RankingContext = {
      maxEndorsements: 0,
      maxInstalls: 0,
      maxImpCorrelation: 0,
      now: new Date(),
    };
    const score = computeScore(skill, context);
    expect(score.factors.usageQuality).toBe(0.5);
  });
});

describe("Recency factor", () => {
  it("decays over time (90-day half-life)", () => {
    const now = new Date();
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    const skillFresh = makeSkillListing({ updatedAt: now.toISOString() });
    const skillOld = makeSkillListing({ updatedAt: ninetyDaysAgo.toISOString() });

    const context: RankingContext = {
      maxEndorsements: 0,
      maxInstalls: 0,
      maxImpCorrelation: 0,
      now,
    };

    const scoreFresh = computeScore(skillFresh, context);
    const scoreOld = computeScore(skillOld, context);

    // Fresh skill should score higher on recency
    expect(scoreFresh.factors.recency).toBeGreaterThan(scoreOld.factors.recency);
    // At exactly 90 days, score should be ~0.5 (half-life)
    expect(scoreOld.factors.recency).toBeCloseTo(0.5, 2);
  });

  it("returns ~1.0 for a just-updated skill", () => {
    const now = new Date();
    const skill = makeSkillListing({ updatedAt: now.toISOString() });
    const context: RankingContext = {
      maxEndorsements: 0,
      maxInstalls: 0,
      maxImpCorrelation: 0,
      now,
    };
    const score = computeScore(skill, context);
    expect(score.factors.recency).toBeCloseTo(1.0, 2);
  });
});

describe("Custom weights", () => {
  it("custom weights change scoring", () => {
    const now = new Date();
    const skills = [
      makeSkillListing({
        id: "skill-1",
        endorsementCount: 0,
        domains: ["technology"],
      }),
      makeSkillListing({
        id: "skill-2",
        endorsementCount: 10,
        domains: ["community"],
      }),
    ];

    const context: RankingContext = {
      queryDomain: "technology",
      maxEndorsements: 10,
      maxInstalls: 0,
      maxImpCorrelation: 0,
      now,
    };

    // Default weights — domain match at 0.30 should favour skill-1
    const defaultRanked = rankSkills(skills, context);

    // Override: heavily weight recognition (0.90) and zero domain match
    const customRanked = rankSkills(skills, context, {
      domainMatch: 0.0,
      recognition: 0.90,
      usageQuality: 0.05,
      coaContribution: 0.025,
      recency: 0.025,
    });

    // With custom weights, skill-2 should rank first due to high recognition
    expect(customRanked[0]!.skillId).toBe("skill-2");
    // The two rankings must differ
    expect(defaultRanked[0]!.skillId).not.toBe(customRanked[0]!.skillId);
  });
});

describe("DEFAULT_RANKING_WEIGHTS", () => {
  it("weights sum to 1.0", () => {
    const w = DEFAULT_RANKING_WEIGHTS;
    const sum = w.domainMatch + w.recognition + w.usageQuality + w.coaContribution + w.recency;
    expect(sum).toBeCloseTo(1.0);
  });

  it("has correct individual values", () => {
    expect(DEFAULT_RANKING_WEIGHTS.domainMatch).toBe(0.30);
    expect(DEFAULT_RANKING_WEIGHTS.recognition).toBe(0.25);
    expect(DEFAULT_RANKING_WEIGHTS.usageQuality).toBe(0.20);
    expect(DEFAULT_RANKING_WEIGHTS.coaContribution).toBe(0.15);
    expect(DEFAULT_RANKING_WEIGHTS.recency).toBe(0.10);
  });
});
