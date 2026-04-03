/**
 * Multi-Entity Governance — Tasks #172-174
 *
 * Manages organization (#O) and team (#T) entities with:
 *   - Membership management (invite, join, leave, remove)
 *   - Role hierarchy: owner > admin > member > observer
 *   - Impact pooling: org.$imp = SUM(member.$imp * impact_share) * org.0BONUS
 *   - Role-based access control (who can see what)
 *
 * @see core/ENTITY.md for entity classification
 */

import { ulid } from "ulid";
import type { Database } from "./db.js";
import type BetterSqlite3 from "better-sqlite3";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Role hierarchy for org/team members. */
export type MemberRole = "owner" | "admin" | "member" | "observer";

/** Membership status. */
export type MembershipStatus = "pending" | "active" | "removed";

/** Organization/team membership record. */
export interface Membership {
  id: string;
  orgId: string;
  memberId: string;
  role: MemberRole;
  status: MembershipStatus;
  /** Share of member's $imp that flows to org pool (0.0 - 1.0). */
  impactShare: number;
  invitedBy: string;
  joinedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Impact pool entry for aggregation. */
export interface ImpactPoolEntry {
  memberId: string;
  memberName: string;
  role: MemberRole;
  totalImp: number;
  impactShare: number;
  contributedImp: number;
}

/** Org-level impact summary. */
export interface OrgImpactSummary {
  orgId: string;
  orgName: string;
  memberCount: number;
  rawPoolImp: number;
  orgBonus: number;
  totalOrgImp: number;
  members: ImpactPoolEntry[];
}

/** Role capabilities for access control. */
export interface RoleCapabilities {
  canInvite: boolean;
  canRemove: boolean;
  canChangeRoles: boolean;
  canViewMemberImp: boolean;
  canViewOrgCoa: boolean;
  canEditOrg: boolean;
}

// ---------------------------------------------------------------------------
// Role hierarchy
// ---------------------------------------------------------------------------

const ROLE_RANK: Record<MemberRole, number> = {
  owner: 4,
  admin: 3,
  member: 2,
  observer: 1,
};

const ROLE_CAPABILITIES: Record<MemberRole, RoleCapabilities> = {
  owner: {
    canInvite: true,
    canRemove: true,
    canChangeRoles: true,
    canViewMemberImp: true,
    canViewOrgCoa: true,
    canEditOrg: true,
  },
  admin: {
    canInvite: true,
    canRemove: true,
    canChangeRoles: false,
    canViewMemberImp: true,
    canViewOrgCoa: true,
    canEditOrg: true,
  },
  member: {
    canInvite: false,
    canRemove: false,
    canChangeRoles: false,
    canViewMemberImp: false,
    canViewOrgCoa: true,
    canEditOrg: false,
  },
  observer: {
    canInvite: false,
    canRemove: false,
    canChangeRoles: false,
    canViewMemberImp: false,
    canViewOrgCoa: false,
    canEditOrg: false,
  },
};

/** Check if a role outranks another. */
export function roleOutranks(a: MemberRole, b: MemberRole): boolean {
  return ROLE_RANK[a] > ROLE_RANK[b];
}

/** Get capabilities for a role. */
export function getRoleCapabilities(role: MemberRole): RoleCapabilities {
  return ROLE_CAPABILITIES[role];
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface MembershipRow {
  id: string;
  org_id: string;
  member_id: string;
  role: string;
  status: string;
  impact_share: number;
  invited_by: string;
  joined_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToMembership(row: MembershipRow): Membership {
  return {
    id: row.id,
    orgId: row.org_id,
    memberId: row.member_id,
    role: row.role as MemberRole,
    status: row.status as MembershipStatus,
    impactShare: row.impact_share,
    invitedBy: row.invited_by,
    joinedAt: row.joined_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Statement parameter shapes
// ---------------------------------------------------------------------------

interface InsertMembershipParams {
  id: string;
  org_id: string;
  member_id: string;
  role: string;
  status: string;
  impact_share: number;
  invited_by: string;
  joined_at: string | null;
  created_at: string;
  updated_at: string;
}

interface UpdateMembershipParams {
  id: string;
  role: string;
  status: string;
  impact_share: number;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// GovernanceManager
// ---------------------------------------------------------------------------

export class GovernanceManager {
  private readonly stmtInsert: BetterSqlite3.Statement<[InsertMembershipParams]>;
  private readonly stmtUpdate: BetterSqlite3.Statement<[UpdateMembershipParams]>;
  private readonly stmtGetById: BetterSqlite3.Statement<[string], MembershipRow>;
  private readonly stmtGetByOrgMember: BetterSqlite3.Statement<[string, string], MembershipRow>;
  private readonly stmtGetOrgMembers: BetterSqlite3.Statement<[string], MembershipRow>;
  private readonly stmtGetMemberOrgs: BetterSqlite3.Statement<[string], MembershipRow>;
  private readonly stmtCountActiveMembers: BetterSqlite3.Statement<[string], { count: number }>;

  constructor(private readonly db: Database) {
    this.stmtInsert = db.prepare<[InsertMembershipParams]>(`
      INSERT INTO memberships (
        id, org_id, member_id, role, status, impact_share,
        invited_by, joined_at, created_at, updated_at
      ) VALUES (
        @id, @org_id, @member_id, @role, @status, @impact_share,
        @invited_by, @joined_at, @created_at, @updated_at
      )
    `);

    this.stmtUpdate = db.prepare<[UpdateMembershipParams]>(`
      UPDATE memberships
      SET role = @role, status = @status, impact_share = @impact_share, updated_at = @updated_at
      WHERE id = @id
    `);

    this.stmtGetById = db.prepare<[string], MembershipRow>(`
      SELECT * FROM memberships WHERE id = ?
    `);

    this.stmtGetByOrgMember = db.prepare<[string, string], MembershipRow>(`
      SELECT * FROM memberships WHERE org_id = ? AND member_id = ?
    `);

    this.stmtGetOrgMembers = db.prepare<[string], MembershipRow>(`
      SELECT * FROM memberships WHERE org_id = ? AND status = 'active'
      ORDER BY role ASC
    `);

    this.stmtGetMemberOrgs = db.prepare<[string], MembershipRow>(`
      SELECT * FROM memberships WHERE member_id = ? AND status = 'active'
    `);

    this.stmtCountActiveMembers = db.prepare<[string], { count: number }>(`
      SELECT COUNT(*) as count FROM memberships WHERE org_id = ? AND status = 'active'
    `);
  }

  // ---------------------------------------------------------------------------
  // Invite & join
  // ---------------------------------------------------------------------------

  /**
   * Invite a member to an organization.
   * Creates a "pending" membership that must be accepted.
   */
  invite(
    orgId: string,
    memberId: string,
    invitedBy: string,
    role: MemberRole = "member",
    impactShare: number = 0.10,
  ): Membership {
    const now = new Date().toISOString();
    const id = ulid();

    // Check if membership already exists
    const existing = this.stmtGetByOrgMember.get(orgId, memberId);
    if (existing && existing.status === "active") {
      throw new Error(`Entity ${memberId} is already an active member of ${orgId}`);
    }

    this.stmtInsert.run({
      id,
      org_id: orgId,
      member_id: memberId,
      role,
      status: "pending",
      impact_share: Math.max(0, Math.min(1, impactShare)),
      invited_by: invitedBy,
      joined_at: null,
      created_at: now,
      updated_at: now,
    });

    return rowToMembership(this.stmtGetById.get(id)!);
  }

  /**
   * Accept an invitation — transitions pending → active.
   */
  acceptInvite(membershipId: string): Membership {
    const row = this.stmtGetById.get(membershipId);
    if (!row) throw new Error(`Membership not found: ${membershipId}`);
    if (row.status !== "pending") throw new Error(`Cannot accept: status is "${row.status}"`);

    const now = new Date().toISOString();
    this.db.prepare(`UPDATE memberships SET status = 'active', joined_at = ?, updated_at = ? WHERE id = ?`)
      .run(now, now, membershipId);

    return rowToMembership(this.stmtGetById.get(membershipId)!);
  }

  /**
   * Remove a member from an organization.
   */
  removeMember(orgId: string, memberId: string): Membership | null {
    const row = this.stmtGetByOrgMember.get(orgId, memberId);
    if (!row) return null;

    if (row.role === "owner") {
      throw new Error("Cannot remove the owner. Transfer ownership first.");
    }

    const now = new Date().toISOString();
    this.stmtUpdate.run({
      id: row.id,
      role: row.role,
      status: "removed",
      impact_share: row.impact_share,
      updated_at: now,
    });

    return rowToMembership(this.stmtGetById.get(row.id)!);
  }

  // ---------------------------------------------------------------------------
  // Role management
  // ---------------------------------------------------------------------------

  /** Change a member's role. Cannot promote above admin (owner transfer is separate). */
  changeRole(membershipId: string, newRole: MemberRole): Membership {
    const row = this.stmtGetById.get(membershipId);
    if (!row) throw new Error(`Membership not found: ${membershipId}`);
    if (row.status !== "active") throw new Error(`Cannot change role: membership is "${row.status}"`);
    if (newRole === "owner") throw new Error("Use transferOwnership() to change owner");

    const now = new Date().toISOString();
    this.stmtUpdate.run({
      id: row.id,
      role: newRole,
      status: row.status,
      impact_share: row.impact_share,
      updated_at: now,
    });

    return rowToMembership(this.stmtGetById.get(membershipId)!);
  }

  /** Transfer ownership to another active member. Demotes current owner to admin. */
  transferOwnership(orgId: string, newOwnerId: string): void {
    const currentOwner = this.getOrgMembers(orgId).find((m) => m.role === "owner");
    if (!currentOwner) throw new Error(`No owner found for org ${orgId}`);

    const newOwner = this.stmtGetByOrgMember.get(orgId, newOwnerId);
    if (!newOwner || newOwner.status !== "active") {
      throw new Error(`Entity ${newOwnerId} is not an active member of ${orgId}`);
    }

    const now = new Date().toISOString();

    // Demote current owner to admin
    this.stmtUpdate.run({
      id: currentOwner.id,
      role: "admin",
      status: "active",
      impact_share: currentOwner.impactShare,
      updated_at: now,
    });

    // Promote new owner
    this.stmtUpdate.run({
      id: newOwner.id,
      role: "owner",
      status: newOwner.status,
      impact_share: newOwner.impact_share,
      updated_at: now,
    });
  }

  // ---------------------------------------------------------------------------
  // Impact pooling
  // ---------------------------------------------------------------------------

  /**
   * Calculate the org-level impact summary.
   * org.$imp = SUM(member.$imp * impact_share) * (1 + org.0BONUS)
   */
  calculateOrgImpact(orgId: string, orgBonus: number = 0): OrgImpactSummary {
    const members = this.getOrgMembers(orgId);

    // Get org display name
    const orgRow = this.db.prepare<[string], { display_name: string }>(
      `SELECT display_name FROM entities WHERE id = ?`,
    ).get(orgId);

    const entries: ImpactPoolEntry[] = members.map((m) => {
      const impRow = this.db.prepare<[string], { total_imp: number }>(
        `SELECT COALESCE(SUM(imp_score), 0) as total_imp FROM impact_interactions WHERE entity_id = ?`,
      ).get(m.memberId);

      const totalImp = impRow?.total_imp ?? 0;
      const contributedImp = totalImp * m.impactShare;

      // Get member name
      const memberRow = this.db.prepare<[string], { display_name: string }>(
        `SELECT display_name FROM entities WHERE id = ?`,
      ).get(m.memberId);

      return {
        memberId: m.memberId,
        memberName: memberRow?.display_name ?? m.memberId,
        role: m.role,
        totalImp,
        impactShare: m.impactShare,
        contributedImp,
      };
    });

    const rawPoolImp = entries.reduce((sum, e) => sum + e.contributedImp, 0);
    const totalOrgImp = rawPoolImp * (1 + Math.min(orgBonus, 2.0));

    return {
      orgId,
      orgName: orgRow?.display_name ?? orgId,
      memberCount: members.length,
      rawPoolImp,
      orgBonus: Math.min(orgBonus, 2.0),
      totalOrgImp,
      members: entries,
    };
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  /** Get all active members of an organization. */
  getOrgMembers(orgId: string): Membership[] {
    return this.stmtGetOrgMembers.all(orgId).map(rowToMembership);
  }

  /** Get all organizations a member belongs to. */
  getMemberOrgs(memberId: string): Membership[] {
    return this.stmtGetMemberOrgs.all(memberId).map(rowToMembership);
  }

  /** Get a specific membership. */
  getMembership(orgId: string, memberId: string): Membership | null {
    const row = this.stmtGetByOrgMember.get(orgId, memberId);
    return row ? rowToMembership(row) : null;
  }

  /** Count active members in an org. */
  getActiveCount(orgId: string): number {
    return this.stmtCountActiveMembers.get(orgId)?.count ?? 0;
  }

  /** Update a member's impact share (0.0 - 1.0). */
  setImpactShare(membershipId: string, impactShare: number): Membership {
    const row = this.stmtGetById.get(membershipId);
    if (!row) throw new Error(`Membership not found: ${membershipId}`);

    const now = new Date().toISOString();
    this.stmtUpdate.run({
      id: row.id,
      role: row.role,
      status: row.status,
      impact_share: Math.max(0, Math.min(1, impactShare)),
      updated_at: now,
    });

    return rowToMembership(this.stmtGetById.get(membershipId)!);
  }
}
