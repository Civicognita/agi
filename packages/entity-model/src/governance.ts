/**
 * Multi-Entity Governance — Tasks #172-174 (drizzle/Postgres rewrite)
 *
 * Manages organization (#O) and team (#T) entities with:
 *   - Membership management (invite, join, leave, remove)
 *   - Role hierarchy: owner > admin > member > observer
 *   - Impact pooling: org.$imp = SUM(member.$imp * impact_share) * org.0BONUS
 *   - Role-based access control (who can see what)
 */

import { and, eq, sql } from "drizzle-orm";
import { ulid } from "ulid";
import type { Db } from "@agi/db-schema/client";
import { memberships, entities, impactInteractions } from "@agi/db-schema";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MemberRole = "owner" | "admin" | "member" | "observer";
export type MembershipStatus = "pending" | "active" | "removed";

export interface Membership {
  id: string;
  orgId: string;
  memberId: string;
  role: MemberRole;
  status: MembershipStatus;
  impactShare: number;
  invitedBy: string;
  joinedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ImpactPoolEntry {
  memberId: string;
  memberName: string;
  role: MemberRole;
  totalImp: number;
  impactShare: number;
  contributedImp: number;
}

export interface OrgImpactSummary {
  orgId: string;
  orgName: string;
  memberCount: number;
  rawPoolImp: number;
  orgBonus: number;
  totalOrgImp: number;
  members: ImpactPoolEntry[];
}

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
  owner: { canInvite: true, canRemove: true, canChangeRoles: true, canViewMemberImp: true, canViewOrgCoa: true, canEditOrg: true },
  admin: { canInvite: true, canRemove: true, canChangeRoles: false, canViewMemberImp: true, canViewOrgCoa: true, canEditOrg: true },
  member: { canInvite: false, canRemove: false, canChangeRoles: false, canViewMemberImp: false, canViewOrgCoa: true, canEditOrg: false },
  observer: { canInvite: false, canRemove: false, canChangeRoles: false, canViewMemberImp: false, canViewOrgCoa: false, canEditOrg: false },
};

export function roleOutranks(a: MemberRole, b: MemberRole): boolean {
  return ROLE_RANK[a] > ROLE_RANK[b];
}

export function getRoleCapabilities(role: MemberRole): RoleCapabilities {
  return ROLE_CAPABILITIES[role];
}

// ---------------------------------------------------------------------------
// Row mapper
// ---------------------------------------------------------------------------

function rowToMembership(row: typeof memberships.$inferSelect): Membership {
  return {
    id: row.id,
    orgId: row.orgId,
    memberId: row.memberId,
    role: row.role as MemberRole,
    status: row.status as MembershipStatus,
    impactShare: row.impactShare / 10000, // stored as basis points (bps)
    invitedBy: row.invitedBy,
    joinedAt: row.joinedAt ? (row.joinedAt instanceof Date ? row.joinedAt.toISOString() : String(row.joinedAt)) : null,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
  };
}

// ---------------------------------------------------------------------------
// GovernanceManager
// ---------------------------------------------------------------------------

export class GovernanceManager {
  constructor(private readonly db: Db) {}

  async invite(
    orgId: string,
    memberId: string,
    invitedBy: string,
    role: MemberRole = "member",
    impactShare: number = 0.10,
  ): Promise<Membership> {
    const now = new Date();
    const id = ulid();

    const [existing] = await this.db
      .select()
      .from(memberships)
      .where(and(eq(memberships.orgId, orgId), eq(memberships.memberId, memberId)));

    if (existing && existing.status === "active") {
      throw new Error(`Entity ${memberId} is already an active member of ${orgId}`);
    }

    await this.db.insert(memberships).values({
      id,
      orgId,
      memberId,
      role,
      status: "pending",
      impactShare: Math.round(Math.max(0, Math.min(1, impactShare)) * 10000),
      invitedBy,
      joinedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    const [row] = await this.db.select().from(memberships).where(eq(memberships.id, id));
    return rowToMembership(row!);
  }

  async acceptInvite(membershipId: string): Promise<Membership> {
    const [row] = await this.db.select().from(memberships).where(eq(memberships.id, membershipId));
    if (!row) throw new Error(`Membership not found: ${membershipId}`);
    if (row.status !== "pending") throw new Error(`Cannot accept: status is "${row.status}"`);

    const now = new Date();
    await this.db.update(memberships)
      .set({ status: "active", joinedAt: now, updatedAt: now })
      .where(eq(memberships.id, membershipId));

    const [updated] = await this.db.select().from(memberships).where(eq(memberships.id, membershipId));
    return rowToMembership(updated!);
  }

  async removeMember(orgId: string, memberId: string): Promise<Membership | null> {
    const [row] = await this.db
      .select()
      .from(memberships)
      .where(and(eq(memberships.orgId, orgId), eq(memberships.memberId, memberId)));
    if (!row) return null;

    if (row.role === "owner") throw new Error("Cannot remove the owner. Transfer ownership first.");

    const now = new Date();
    await this.db.update(memberships)
      .set({ status: "removed", updatedAt: now })
      .where(eq(memberships.id, row.id));

    const [updated] = await this.db.select().from(memberships).where(eq(memberships.id, row.id));
    return rowToMembership(updated!);
  }

  async changeRole(membershipId: string, newRole: MemberRole): Promise<Membership> {
    const [row] = await this.db.select().from(memberships).where(eq(memberships.id, membershipId));
    if (!row) throw new Error(`Membership not found: ${membershipId}`);
    if (row.status !== "active") throw new Error(`Cannot change role: membership is "${row.status}"`);
    if (newRole === "owner") throw new Error("Use transferOwnership() to change owner");

    const now = new Date();
    await this.db.update(memberships)
      .set({ role: newRole, updatedAt: now })
      .where(eq(memberships.id, membershipId));

    const [updated] = await this.db.select().from(memberships).where(eq(memberships.id, membershipId));
    return rowToMembership(updated!);
  }

  async transferOwnership(orgId: string, newOwnerId: string): Promise<void> {
    const members = await this.getOrgMembers(orgId);
    const currentOwner = members.find((m) => m.role === "owner");
    if (!currentOwner) throw new Error(`No owner found for org ${orgId}`);

    const [newOwnerRow] = await this.db
      .select()
      .from(memberships)
      .where(and(eq(memberships.orgId, orgId), eq(memberships.memberId, newOwnerId)));
    if (!newOwnerRow || newOwnerRow.status !== "active") {
      throw new Error(`Entity ${newOwnerId} is not an active member of ${orgId}`);
    }

    const now = new Date();

    await this.db.update(memberships)
      .set({ role: "admin", updatedAt: now })
      .where(eq(memberships.id, currentOwner.id));

    await this.db.update(memberships)
      .set({ role: "owner", updatedAt: now })
      .where(eq(memberships.id, newOwnerRow.id));
  }

  async calculateOrgImpact(orgId: string, orgBonus: number = 0): Promise<OrgImpactSummary> {
    const members = await this.getOrgMembers(orgId);

    const [orgRow] = await this.db
      .select({ displayName: entities.displayName })
      .from(entities)
      .where(eq(entities.id, orgId));

    const entries: ImpactPoolEntry[] = await Promise.all(
      members.map(async (m) => {
        const [impRow] = await this.db
          .select({ totalImp: sql<number>`COALESCE(SUM(${impactInteractions.impScore}), 0)` })
          .from(impactInteractions)
          .where(eq(impactInteractions.entityId, m.memberId));

        const [memberRow] = await this.db
          .select({ displayName: entities.displayName })
          .from(entities)
          .where(eq(entities.id, m.memberId));

        const totalImp = impRow?.totalImp ?? 0;
        return {
          memberId: m.memberId,
          memberName: memberRow?.displayName ?? m.memberId,
          role: m.role,
          totalImp,
          impactShare: m.impactShare,
          contributedImp: totalImp * m.impactShare,
        };
      }),
    );

    const rawPoolImp = entries.reduce((sum, e) => sum + e.contributedImp, 0);
    const totalOrgImp = rawPoolImp * (1 + Math.min(orgBonus, 2.0));

    return {
      orgId,
      orgName: orgRow?.displayName ?? orgId,
      memberCount: members.length,
      rawPoolImp,
      orgBonus: Math.min(orgBonus, 2.0),
      totalOrgImp,
      members: entries,
    };
  }

  async getOrgMembers(orgId: string): Promise<Membership[]> {
    const rows = await this.db
      .select()
      .from(memberships)
      .where(and(eq(memberships.orgId, orgId), eq(memberships.status, "active")))
      .orderBy(memberships.role);
    return rows.map(rowToMembership);
  }

  async getMemberOrgs(memberId: string): Promise<Membership[]> {
    const rows = await this.db
      .select()
      .from(memberships)
      .where(and(eq(memberships.memberId, memberId), eq(memberships.status, "active")));
    return rows.map(rowToMembership);
  }

  async getMembership(orgId: string, memberId: string): Promise<Membership | null> {
    const [row] = await this.db
      .select()
      .from(memberships)
      .where(and(eq(memberships.orgId, orgId), eq(memberships.memberId, memberId)));
    return row ? rowToMembership(row) : null;
  }

  async getActiveCount(orgId: string): Promise<number> {
    const [row] = await this.db
      .select({ cnt: sql<number>`COUNT(*)` })
      .from(memberships)
      .where(and(eq(memberships.orgId, orgId), eq(memberships.status, "active")));
    return row?.cnt ?? 0;
  }

  async setImpactShare(membershipId: string, impactShare: number): Promise<Membership> {
    const [row] = await this.db.select().from(memberships).where(eq(memberships.id, membershipId));
    if (!row) throw new Error(`Membership not found: ${membershipId}`);

    const now = new Date();
    await this.db.update(memberships)
      .set({
        impactShare: Math.round(Math.max(0, Math.min(1, impactShare)) * 10000),
        updatedAt: now,
      })
      .where(eq(memberships.id, membershipId));

    const [updated] = await this.db.select().from(memberships).where(eq(memberships.id, membershipId));
    return rowToMembership(updated!);
  }
}
