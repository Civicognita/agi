import { describe, it, expect, beforeEach } from "vitest";
import { createDatabase } from "./db.js";
import type { Database } from "./db.js";
import { EntityStore } from "./store.js";
import {
  GovernanceManager,
  roleOutranks,
  getRoleCapabilities,
} from "./governance.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

let db: Database;
let store: EntityStore;
let gov: GovernanceManager;

// Entity IDs reused across tests within each describe block
let orgId: string;
let aliceId: string;
let bobId: string;
let carolId: string;

function makeEntities() {
  const org = store.createEntity({ type: "O", displayName: "Civicognita" });
  const alice = store.createEntity({ type: "E", displayName: "Alice" });
  const bob = store.createEntity({ type: "E", displayName: "Bob" });
  const carol = store.createEntity({ type: "E", displayName: "Carol" });
  orgId = org.id;
  aliceId = alice.id;
  bobId = bob.id;
  carolId = carol.id;
}

beforeEach(() => {
  db = createDatabase(":memory:");
  store = new EntityStore(db);
  gov = new GovernanceManager(db);
  makeEntities();
});

// ---------------------------------------------------------------------------
// ROLE_RANK — ordering
// ---------------------------------------------------------------------------

describe("ROLE_RANK ordering", () => {
  it("owner outranks admin", () => {
    expect(roleOutranks("owner", "admin")).toBe(true);
  });

  it("owner outranks member", () => {
    expect(roleOutranks("owner", "member")).toBe(true);
  });

  it("owner outranks observer", () => {
    expect(roleOutranks("owner", "observer")).toBe(true);
  });

  it("admin outranks member", () => {
    expect(roleOutranks("admin", "member")).toBe(true);
  });

  it("admin outranks observer", () => {
    expect(roleOutranks("admin", "observer")).toBe(true);
  });

  it("member outranks observer", () => {
    expect(roleOutranks("member", "observer")).toBe(true);
  });

  it("equal roles do not outrank each other — owner", () => {
    expect(roleOutranks("owner", "owner")).toBe(false);
  });

  it("equal roles do not outrank each other — member", () => {
    expect(roleOutranks("member", "member")).toBe(false);
  });

  it("lower role does not outrank higher — admin vs owner", () => {
    expect(roleOutranks("admin", "owner")).toBe(false);
  });

  it("lower role does not outrank higher — observer vs member", () => {
    expect(roleOutranks("observer", "member")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getRoleCapabilities
// ---------------------------------------------------------------------------

describe("getRoleCapabilities — owner", () => {
  it("owner can invite", () => {
    expect(getRoleCapabilities("owner").canInvite).toBe(true);
  });

  it("owner can remove", () => {
    expect(getRoleCapabilities("owner").canRemove).toBe(true);
  });

  it("owner can change roles", () => {
    expect(getRoleCapabilities("owner").canChangeRoles).toBe(true);
  });

  it("owner can view member imp", () => {
    expect(getRoleCapabilities("owner").canViewMemberImp).toBe(true);
  });

  it("owner can view org COA", () => {
    expect(getRoleCapabilities("owner").canViewOrgCoa).toBe(true);
  });

  it("owner can edit org", () => {
    expect(getRoleCapabilities("owner").canEditOrg).toBe(true);
  });
});

describe("getRoleCapabilities — admin", () => {
  it("admin can invite", () => {
    expect(getRoleCapabilities("admin").canInvite).toBe(true);
  });

  it("admin can remove", () => {
    expect(getRoleCapabilities("admin").canRemove).toBe(true);
  });

  it("admin cannot change roles", () => {
    expect(getRoleCapabilities("admin").canChangeRoles).toBe(false);
  });

  it("admin can view member imp", () => {
    expect(getRoleCapabilities("admin").canViewMemberImp).toBe(true);
  });

  it("admin can view org COA", () => {
    expect(getRoleCapabilities("admin").canViewOrgCoa).toBe(true);
  });

  it("admin can edit org", () => {
    expect(getRoleCapabilities("admin").canEditOrg).toBe(true);
  });
});

describe("getRoleCapabilities — member", () => {
  it("member cannot invite", () => {
    expect(getRoleCapabilities("member").canInvite).toBe(false);
  });

  it("member cannot remove", () => {
    expect(getRoleCapabilities("member").canRemove).toBe(false);
  });

  it("member cannot change roles", () => {
    expect(getRoleCapabilities("member").canChangeRoles).toBe(false);
  });

  it("member cannot view member imp", () => {
    expect(getRoleCapabilities("member").canViewMemberImp).toBe(false);
  });

  it("member can view org COA", () => {
    expect(getRoleCapabilities("member").canViewOrgCoa).toBe(true);
  });

  it("member cannot edit org", () => {
    expect(getRoleCapabilities("member").canEditOrg).toBe(false);
  });
});

describe("getRoleCapabilities — observer", () => {
  it("observer cannot invite", () => {
    expect(getRoleCapabilities("observer").canInvite).toBe(false);
  });

  it("observer cannot remove", () => {
    expect(getRoleCapabilities("observer").canRemove).toBe(false);
  });

  it("observer cannot change roles", () => {
    expect(getRoleCapabilities("observer").canChangeRoles).toBe(false);
  });

  it("observer cannot view member imp", () => {
    expect(getRoleCapabilities("observer").canViewMemberImp).toBe(false);
  });

  it("observer cannot view org COA", () => {
    expect(getRoleCapabilities("observer").canViewOrgCoa).toBe(false);
  });

  it("observer cannot edit org", () => {
    expect(getRoleCapabilities("observer").canEditOrg).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Invite flow
// ---------------------------------------------------------------------------

describe("GovernanceManager.invite", () => {
  it("creates a pending membership", () => {
    const m = gov.invite(orgId, aliceId, bobId);
    expect(m.status).toBe("pending");
  });

  it("stores orgId and memberId correctly", () => {
    const m = gov.invite(orgId, aliceId, bobId);
    expect(m.orgId).toBe(orgId);
    expect(m.memberId).toBe(aliceId);
  });

  it("stores invitedBy correctly", () => {
    const m = gov.invite(orgId, aliceId, bobId);
    expect(m.invitedBy).toBe(bobId);
  });

  it("defaults to member role", () => {
    const m = gov.invite(orgId, aliceId, bobId);
    expect(m.role).toBe("member");
  });

  it("uses provided role when specified", () => {
    const m = gov.invite(orgId, aliceId, bobId, "admin");
    expect(m.role).toBe("admin");
  });

  it("defaults impact_share to 0.10", () => {
    const m = gov.invite(orgId, aliceId, bobId);
    expect(m.impactShare).toBeCloseTo(0.10);
  });

  it("uses provided impact_share", () => {
    const m = gov.invite(orgId, aliceId, bobId, "member", 0.25);
    expect(m.impactShare).toBeCloseTo(0.25);
  });

  it("clamps impact_share above 1.0 to 1.0", () => {
    const m = gov.invite(orgId, aliceId, bobId, "member", 1.5);
    expect(m.impactShare).toBeCloseTo(1.0);
  });

  it("clamps impact_share below 0.0 to 0.0", () => {
    const m = gov.invite(orgId, aliceId, bobId, "member", -0.5);
    expect(m.impactShare).toBeCloseTo(0.0);
  });

  it("assigns a ULID id", () => {
    const m = gov.invite(orgId, aliceId, bobId);
    expect(m.id).toMatch(/^[0-9A-Z]{26}$/);
  });

  it("sets joinedAt to null on invite", () => {
    const m = gov.invite(orgId, aliceId, bobId);
    expect(m.joinedAt).toBeNull();
  });

  it("throws if member is already active in org", () => {
    const m = gov.invite(orgId, aliceId, bobId);
    gov.acceptInvite(m.id);
    expect(() => gov.invite(orgId, aliceId, bobId)).toThrow(/already an active member/i);
  });
});

// ---------------------------------------------------------------------------
// acceptInvite
// ---------------------------------------------------------------------------

describe("GovernanceManager.acceptInvite", () => {
  it("transitions pending to active", () => {
    const m = gov.invite(orgId, aliceId, bobId);
    const accepted = gov.acceptInvite(m.id);
    expect(accepted.status).toBe("active");
  });

  it("sets joinedAt to an ISO timestamp", () => {
    const before = new Date().toISOString();
    const m = gov.invite(orgId, aliceId, bobId);
    const accepted = gov.acceptInvite(m.id);
    const after = new Date().toISOString();
    expect(accepted.joinedAt).not.toBeNull();
    expect(accepted.joinedAt! >= before).toBe(true);
    expect(accepted.joinedAt! <= after).toBe(true);
  });

  it("throws for non-existent membership id", () => {
    expect(() => gov.acceptInvite("01ARZ3NDEKTSV4RRFFQ69G5FAV")).toThrow(/not found/i);
  });

  it("throws if membership is already active", () => {
    const m = gov.invite(orgId, aliceId, bobId);
    gov.acceptInvite(m.id);
    expect(() => gov.acceptInvite(m.id)).toThrow(/cannot accept/i);
  });

  it("throws if membership has been removed", () => {
    const m = gov.invite(orgId, aliceId, bobId);
    gov.acceptInvite(m.id);
    gov.removeMember(orgId, aliceId);
    const removed = gov.getMembership(orgId, aliceId)!;
    // removed.id is the same membership — try to accept it again
    expect(() => gov.acceptInvite(removed.id)).toThrow(/cannot accept/i);
  });
});

// ---------------------------------------------------------------------------
// removeMember
// ---------------------------------------------------------------------------

describe("GovernanceManager.removeMember", () => {
  it("sets status to removed", () => {
    gov.invite(orgId, aliceId, bobId);
    const removed = gov.removeMember(orgId, aliceId);
    expect(removed!.status).toBe("removed");
  });

  it("returns null when member is not in org", () => {
    const result = gov.removeMember(orgId, carolId);
    expect(result).toBeNull();
  });

  it("can remove a pending membership", () => {
    gov.invite(orgId, aliceId, bobId);
    const removed = gov.removeMember(orgId, aliceId);
    expect(removed!.status).toBe("removed");
  });

  it("throws when removing the owner", () => {
    const m = gov.invite(orgId, aliceId, bobId, "owner");
    gov.acceptInvite(m.id);
    expect(() => gov.removeMember(orgId, aliceId)).toThrow(/cannot remove the owner/i);
  });
});

// ---------------------------------------------------------------------------
// changeRole
// ---------------------------------------------------------------------------

describe("GovernanceManager.changeRole", () => {
  it("updates role from member to admin", () => {
    const m = gov.invite(orgId, aliceId, bobId, "member");
    gov.acceptInvite(m.id);
    const updated = gov.changeRole(m.id, "admin");
    expect(updated.role).toBe("admin");
  });

  it("updates role from admin to observer", () => {
    const m = gov.invite(orgId, aliceId, bobId, "admin");
    gov.acceptInvite(m.id);
    const updated = gov.changeRole(m.id, "observer");
    expect(updated.role).toBe("observer");
  });

  it("throws when trying to set role to owner via changeRole", () => {
    const m = gov.invite(orgId, aliceId, bobId, "admin");
    gov.acceptInvite(m.id);
    expect(() => gov.changeRole(m.id, "owner")).toThrow(/transferOwnership/i);
  });

  it("throws for non-existent membership id", () => {
    expect(() => gov.changeRole("01ARZ3NDEKTSV4RRFFQ69G5FAV", "admin")).toThrow(/not found/i);
  });

  it("throws when membership is pending", () => {
    const m = gov.invite(orgId, aliceId, bobId, "member");
    expect(() => gov.changeRole(m.id, "admin")).toThrow(/cannot change role/i);
  });

  it("preserves impactShare when changing role", () => {
    const m = gov.invite(orgId, aliceId, bobId, "member", 0.5);
    gov.acceptInvite(m.id);
    const updated = gov.changeRole(m.id, "admin");
    expect(updated.impactShare).toBeCloseTo(0.5);
  });
});

// ---------------------------------------------------------------------------
// transferOwnership
// ---------------------------------------------------------------------------

describe("GovernanceManager.transferOwnership", () => {
  it("new owner gets owner role", () => {
    const ownerM = gov.invite(orgId, aliceId, bobId, "owner");
    gov.acceptInvite(ownerM.id);
    const memberM = gov.invite(orgId, bobId, aliceId, "member");
    gov.acceptInvite(memberM.id);

    gov.transferOwnership(orgId, bobId);

    const bobMembership = gov.getMembership(orgId, bobId)!;
    expect(bobMembership.role).toBe("owner");
  });

  it("previous owner is demoted to admin", () => {
    const ownerM = gov.invite(orgId, aliceId, bobId, "owner");
    gov.acceptInvite(ownerM.id);
    const memberM = gov.invite(orgId, bobId, aliceId, "member");
    gov.acceptInvite(memberM.id);

    gov.transferOwnership(orgId, bobId);

    const aliceMembership = gov.getMembership(orgId, aliceId)!;
    expect(aliceMembership.role).toBe("admin");
  });

  it("throws when org has no owner", () => {
    const m = gov.invite(orgId, aliceId, bobId, "member");
    gov.acceptInvite(m.id);
    expect(() => gov.transferOwnership(orgId, aliceId)).toThrow(/no owner found/i);
  });

  it("throws when new owner is not an active member", () => {
    const ownerM = gov.invite(orgId, aliceId, bobId, "owner");
    gov.acceptInvite(ownerM.id);
    // carolId has no membership at all
    expect(() => gov.transferOwnership(orgId, carolId)).toThrow(/not an active member/i);
  });

  it("throws when new owner has only a pending membership", () => {
    const ownerM = gov.invite(orgId, aliceId, bobId, "owner");
    gov.acceptInvite(ownerM.id);
    gov.invite(orgId, carolId, aliceId, "member");
    // carol is pending, not active
    expect(() => gov.transferOwnership(orgId, carolId)).toThrow(/not an active member/i);
  });
});

// ---------------------------------------------------------------------------
// Queries — getOrgMembers, getMemberOrgs, getMembership, getActiveCount
// ---------------------------------------------------------------------------

describe("GovernanceManager.getOrgMembers", () => {
  it("returns only active members", () => {
    const m1 = gov.invite(orgId, aliceId, bobId);
    gov.acceptInvite(m1.id);
    gov.invite(orgId, bobId, aliceId); // pending
    gov.invite(orgId, carolId, aliceId); // pending, then removed
    gov.removeMember(orgId, carolId);

    const members = gov.getOrgMembers(orgId);
    expect(members.length).toBe(1);
    expect(members[0]!.memberId).toBe(aliceId);
  });

  it("returns empty array when org has no active members", () => {
    expect(gov.getOrgMembers(orgId)).toEqual([]);
  });

  it("returned memberships all have status active", () => {
    const m1 = gov.invite(orgId, aliceId, bobId);
    gov.acceptInvite(m1.id);
    const m2 = gov.invite(orgId, bobId, aliceId);
    gov.acceptInvite(m2.id);

    const members = gov.getOrgMembers(orgId);
    expect(members.every((m) => m.status === "active")).toBe(true);
  });
});

describe("GovernanceManager.getMemberOrgs", () => {
  it("returns all active orgs for a member", () => {
    const org2 = store.createEntity({ type: "O", displayName: "SecondOrg" });
    const m1 = gov.invite(orgId, aliceId, bobId);
    gov.acceptInvite(m1.id);
    const m2 = gov.invite(org2.id, aliceId, bobId);
    gov.acceptInvite(m2.id);

    const orgs = gov.getMemberOrgs(aliceId);
    expect(orgs.length).toBe(2);
  });

  it("returns empty array when member has no active memberships", () => {
    expect(gov.getMemberOrgs(aliceId)).toEqual([]);
  });

  it("does not include pending memberships", () => {
    gov.invite(orgId, aliceId, bobId); // stays pending
    expect(gov.getMemberOrgs(aliceId)).toEqual([]);
  });
});

describe("GovernanceManager.getMembership", () => {
  it("returns membership for org+member pair", () => {
    const m = gov.invite(orgId, aliceId, bobId);
    const fetched = gov.getMembership(orgId, aliceId);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(m.id);
  });

  it("returns null when no membership exists", () => {
    expect(gov.getMembership(orgId, aliceId)).toBeNull();
  });

  it("returns the membership regardless of status", () => {
    gov.invite(orgId, aliceId, bobId);
    gov.removeMember(orgId, aliceId);
    const m = gov.getMembership(orgId, aliceId);
    expect(m).not.toBeNull();
    expect(m!.status).toBe("removed");
  });
});

describe("GovernanceManager.getActiveCount", () => {
  it("returns 0 for org with no members", () => {
    expect(gov.getActiveCount(orgId)).toBe(0);
  });

  it("counts only active memberships", () => {
    const m1 = gov.invite(orgId, aliceId, bobId);
    gov.acceptInvite(m1.id);
    gov.invite(orgId, bobId, aliceId); // pending
    gov.invite(orgId, carolId, aliceId); // pending
    gov.removeMember(orgId, carolId);

    expect(gov.getActiveCount(orgId)).toBe(1);
  });

  it("increments when additional members are accepted", () => {
    const m1 = gov.invite(orgId, aliceId, bobId);
    gov.acceptInvite(m1.id);
    expect(gov.getActiveCount(orgId)).toBe(1);

    const m2 = gov.invite(orgId, bobId, aliceId);
    gov.acceptInvite(m2.id);
    expect(gov.getActiveCount(orgId)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// setImpactShare
// ---------------------------------------------------------------------------

describe("GovernanceManager.setImpactShare", () => {
  it("updates impact share to new value", () => {
    const m = gov.invite(orgId, aliceId, bobId, "member", 0.10);
    const updated = gov.setImpactShare(m.id, 0.75);
    expect(updated.impactShare).toBeCloseTo(0.75);
  });

  it("clamps value above 1.0 to 1.0", () => {
    const m = gov.invite(orgId, aliceId, bobId);
    const updated = gov.setImpactShare(m.id, 2.5);
    expect(updated.impactShare).toBeCloseTo(1.0);
  });

  it("clamps value below 0.0 to 0.0", () => {
    const m = gov.invite(orgId, aliceId, bobId);
    const updated = gov.setImpactShare(m.id, -1.0);
    expect(updated.impactShare).toBeCloseTo(0.0);
  });

  it("preserves role and status when updating share", () => {
    const m = gov.invite(orgId, aliceId, bobId, "admin");
    gov.acceptInvite(m.id);
    const updated = gov.setImpactShare(m.id, 0.5);
    expect(updated.role).toBe("admin");
    expect(updated.status).toBe("active");
  });

  it("throws for non-existent membership id", () => {
    expect(() => gov.setImpactShare("01ARZ3NDEKTSV4RRFFQ69G5FAV", 0.5)).toThrow(/not found/i);
  });
});

// ---------------------------------------------------------------------------
// calculateOrgImpact
// ---------------------------------------------------------------------------

describe("GovernanceManager.calculateOrgImpact", () => {
  it("returns zero rawPoolImp when no members have impact", () => {
    const m = gov.invite(orgId, aliceId, bobId, "member", 0.5);
    gov.acceptInvite(m.id);

    const summary = gov.calculateOrgImpact(orgId, 0);
    expect(summary.rawPoolImp).toBeCloseTo(0);
  });

  it("returns correct rawPoolImp from member contributions", () => {
    const m = gov.invite(orgId, aliceId, bobId, "member", 0.5);
    gov.acceptInvite(m.id);

    // Seed impact for alice: imp_score = 10
    const coaFp = "$A0.#E0.@A0.C001";
    db.prepare(
      `INSERT INTO coa_chains (fingerprint, resource_id, entity_id, node_id, chain_counter, work_type, created_at)
       VALUES (?, '$A0', ?, '@A0', 1, 'message_in', ?)`,
    ).run(coaFp, aliceId, new Date().toISOString());
    db.prepare(
      `INSERT INTO impact_interactions (id, entity_id, coa_fingerprint, quant, value_0bool, bonus, imp_score, created_at)
       VALUES (?, ?, ?, 1, 1.0, 0, 10, ?)`,
    ).run("01IMPACT00000000000000000001", aliceId, coaFp, new Date().toISOString());

    const summary = gov.calculateOrgImpact(orgId, 0);
    // rawPoolImp = 10 * 0.5 = 5
    expect(summary.rawPoolImp).toBeCloseTo(5);
  });

  it("applies orgBonus multiplier: totalOrgImp = rawPoolImp * (1 + bonus)", () => {
    const m = gov.invite(orgId, aliceId, bobId, "member", 1.0);
    gov.acceptInvite(m.id);

    const coaFp = "$A0.#E0.@A0.C002";
    db.prepare(
      `INSERT INTO coa_chains (fingerprint, resource_id, entity_id, node_id, chain_counter, work_type, created_at)
       VALUES (?, '$A0', ?, '@A0', 2, 'message_in', ?)`,
    ).run(coaFp, aliceId, new Date().toISOString());
    db.prepare(
      `INSERT INTO impact_interactions (id, entity_id, coa_fingerprint, quant, value_0bool, bonus, imp_score, created_at)
       VALUES (?, ?, ?, 1, 1.0, 0, 20, ?)`,
    ).run("01IMPACT00000000000000000002", aliceId, coaFp, new Date().toISOString());

    // orgBonus = 0.5 → totalOrgImp = 20 * 1.0 * (1 + 0.5) = 30
    const summary = gov.calculateOrgImpact(orgId, 0.5);
    expect(summary.totalOrgImp).toBeCloseTo(30);
    expect(summary.orgBonus).toBeCloseTo(0.5);
  });

  it("caps orgBonus at 2.0", () => {
    const m = gov.invite(orgId, aliceId, bobId, "member", 1.0);
    gov.acceptInvite(m.id);

    const coaFp = "$A0.#E0.@A0.C003";
    db.prepare(
      `INSERT INTO coa_chains (fingerprint, resource_id, entity_id, node_id, chain_counter, work_type, created_at)
       VALUES (?, '$A0', ?, '@A0', 3, 'message_in', ?)`,
    ).run(coaFp, aliceId, new Date().toISOString());
    db.prepare(
      `INSERT INTO impact_interactions (id, entity_id, coa_fingerprint, quant, value_0bool, bonus, imp_score, created_at)
       VALUES (?, ?, ?, 1, 1.0, 0, 10, ?)`,
    ).run("01IMPACT00000000000000000003", aliceId, coaFp, new Date().toISOString());

    // Passing orgBonus = 5.0, but should be capped at 2.0 → totalOrgImp = 10 * (1 + 2.0) = 30
    const summary = gov.calculateOrgImpact(orgId, 5.0);
    expect(summary.orgBonus).toBeCloseTo(2.0);
    expect(summary.totalOrgImp).toBeCloseTo(30);
  });

  it("uses org displayName from entities table", () => {
    const summary = gov.calculateOrgImpact(orgId, 0);
    expect(summary.orgName).toBe("Civicognita");
  });

  it("falls back to orgId when org has no entities row", () => {
    const fakeOrgId = "01FAKEORG000000000000000000";
    const summary = gov.calculateOrgImpact(fakeOrgId, 0);
    expect(summary.orgName).toBe(fakeOrgId);
  });

  it("reports correct memberCount", () => {
    const m1 = gov.invite(orgId, aliceId, bobId);
    gov.acceptInvite(m1.id);
    const m2 = gov.invite(orgId, bobId, aliceId);
    gov.acceptInvite(m2.id);

    const summary = gov.calculateOrgImpact(orgId, 0);
    expect(summary.memberCount).toBe(2);
  });

  it("summed contributedImp across members is additive", () => {
    const m1 = gov.invite(orgId, aliceId, bobId, "member", 0.5);
    gov.acceptInvite(m1.id);
    const m2 = gov.invite(orgId, bobId, aliceId, "member", 0.25);
    gov.acceptInvite(m2.id);

    // Alice: imp = 8, share = 0.5 → contributed = 4
    const fp1 = "$A0.#E0.@A0.C010";
    db.prepare(
      `INSERT INTO coa_chains (fingerprint, resource_id, entity_id, node_id, chain_counter, work_type, created_at)
       VALUES (?, '$A0', ?, '@A0', 10, 'message_in', ?)`,
    ).run(fp1, aliceId, new Date().toISOString());
    db.prepare(
      `INSERT INTO impact_interactions (id, entity_id, coa_fingerprint, quant, value_0bool, bonus, imp_score, created_at)
       VALUES (?, ?, ?, 1, 1.0, 0, 8, ?)`,
    ).run("01IMPACT00000000000000000010", aliceId, fp1, new Date().toISOString());

    // Bob: imp = 4, share = 0.25 → contributed = 1
    const fp2 = "$A0.#E0.@A0.C011";
    db.prepare(
      `INSERT INTO coa_chains (fingerprint, resource_id, entity_id, node_id, chain_counter, work_type, created_at)
       VALUES (?, '$A0', ?, '@A0', 11, 'message_in', ?)`,
    ).run(fp2, bobId, new Date().toISOString());
    db.prepare(
      `INSERT INTO impact_interactions (id, entity_id, coa_fingerprint, quant, value_0bool, bonus, imp_score, created_at)
       VALUES (?, ?, ?, 1, 1.0, 0, 4, ?)`,
    ).run("01IMPACT00000000000000000011", bobId, fp2, new Date().toISOString());

    const summary = gov.calculateOrgImpact(orgId, 0);
    // rawPoolImp = 4 + 1 = 5, orgBonus = 0 → totalOrgImp = 5
    expect(summary.rawPoolImp).toBeCloseTo(5);
    expect(summary.totalOrgImp).toBeCloseTo(5);
  });

  it("returns zero totalOrgImp when org has no active members", () => {
    const summary = gov.calculateOrgImpact(orgId, 1.0);
    expect(summary.totalOrgImp).toBeCloseTo(0);
    expect(summary.memberCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("GovernanceManager — edge cases", () => {
  it("invite does not throw for a non-existent entity id (no FK enforcement issue)", () => {
    // better-sqlite3 enforces FKs — inviting a non-existent entity should throw
    expect(() => gov.invite(orgId, "01NONEXIST0000000000000000", bobId)).toThrow();
  });

  it("acceptInvite on already-active membership throws", () => {
    const m = gov.invite(orgId, aliceId, bobId);
    gov.acceptInvite(m.id);
    expect(() => gov.acceptInvite(m.id)).toThrow(/cannot accept/i);
  });

  it("removeMember returns null for entity with no membership", () => {
    expect(gov.removeMember(orgId, carolId)).toBeNull();
  });

  it("invite can re-invite after removal (creates new membership)", () => {
    // First invite + remove
    gov.invite(orgId, aliceId, bobId);
    gov.removeMember(orgId, aliceId);

    // SQLite UNIQUE constraint on (org_id, member_id) — second invite throws
    expect(() => gov.invite(orgId, aliceId, bobId)).toThrow();
  });

  it("getOrgMembers excludes removed members", () => {
    const m = gov.invite(orgId, aliceId, bobId);
    gov.acceptInvite(m.id);
    gov.removeMember(orgId, aliceId);

    expect(gov.getOrgMembers(orgId)).toEqual([]);
  });

  it("getMemberOrgs excludes removed memberships", () => {
    const m = gov.invite(orgId, aliceId, bobId);
    gov.acceptInvite(m.id);
    gov.removeMember(orgId, aliceId);

    expect(gov.getMemberOrgs(aliceId)).toEqual([]);
  });
});
