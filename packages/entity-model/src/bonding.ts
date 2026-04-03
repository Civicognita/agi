/**
 * Alignment Bonding — Task #212
 *
 * Two entities formally declare aligned agendas:
 * - Creates cross-agenda COA link
 * - 0BONUS increases for both when work intersects aligned goals
 * - Mutual and symmetric (both benefit equally)
 * - Revocable by either party
 * - Bond history tracked for audit
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** An alignment bond between two entities. */
export interface AlignmentBond {
  id: string;
  /** First entity in the bond. */
  entityAId: string;
  entityAGeid: string;
  /** Second entity in the bond. */
  entityBId: string;
  entityBGeid: string;
  /** Shared alignment description. */
  alignment: string;
  /** Domains where the alignment applies. */
  domains: string[];
  /** COA cross-link fingerprint for Entity A. */
  coaLinkA: string;
  /** COA cross-link fingerprint for Entity B. */
  coaLinkB: string;
  /** 0BONUS multiplier when work intersects aligned goals. */
  bonusMultiplier: number;
  /** Bond status. */
  status: BondStatus;
  /** ISO timestamp when bond was created. */
  createdAt: string;
  /** ISO timestamp when bond was activated (both parties confirmed). */
  activatedAt: string | null;
  /** ISO timestamp when bond was revoked. */
  revokedAt: string | null;
  /** Entity that revoked (if applicable). */
  revokedBy: string | null;
}

/** Bond lifecycle status. */
export type BondStatus = "proposed" | "active" | "revoked";

/** Parameters for proposing a bond. */
export interface ProposeBondParams {
  id: string;
  entityAId: string;
  entityAGeid: string;
  entityBId: string;
  entityBGeid: string;
  alignment: string;
  domains: string[];
  coaLinkA: string;
  coaLinkB: string;
}

/** Bond history entry for audit trail. */
export interface BondHistoryEntry {
  bondId: string;
  action: "proposed" | "activated" | "revoked";
  actorId: string;
  timestamp: string;
  reason?: string;
}

/** Default bonus multiplier for aligned work. */
export const ALIGNMENT_BONUS_MULTIPLIER = 0.10;

// ---------------------------------------------------------------------------
// Bonding Manager
// ---------------------------------------------------------------------------

/**
 * Manages alignment bonds between entities.
 */
export class BondingManager {
  private readonly bonds = new Map<string, AlignmentBond>();
  private readonly history: BondHistoryEntry[] = [];
  /** Index: entityId → Set of bond IDs. */
  private readonly entityBonds = new Map<string, Set<string>>();

  /**
   * Propose a new alignment bond.
   *
   * The bond starts as "proposed" and needs acceptance by entity B.
   */
  propose(params: ProposeBondParams): AlignmentBond {
    if (params.entityAId === params.entityBId) {
      throw new Error("Cannot bond with yourself");
    }

    // Check for existing active bond between these entities
    const existing = this.getActiveBond(params.entityAId, params.entityBId);
    if (existing) {
      throw new Error(`Active bond already exists between ${params.entityAId} and ${params.entityBId}`);
    }

    const bond: AlignmentBond = {
      id: params.id,
      entityAId: params.entityAId,
      entityAGeid: params.entityAGeid,
      entityBId: params.entityBId,
      entityBGeid: params.entityBGeid,
      alignment: params.alignment,
      domains: [...params.domains],
      coaLinkA: params.coaLinkA,
      coaLinkB: params.coaLinkB,
      bonusMultiplier: ALIGNMENT_BONUS_MULTIPLIER,
      status: "proposed",
      createdAt: new Date().toISOString(),
      activatedAt: null,
      revokedAt: null,
      revokedBy: null,
    };

    this.bonds.set(params.id, bond);
    this.indexBond(bond);
    this.recordHistory(bond.id, "proposed", params.entityAId);

    return bond;
  }

  /**
   * Accept a proposed bond (called by entity B).
   */
  accept(bondId: string, acceptorId: string): AlignmentBond {
    const bond = this.getOrThrow(bondId);

    if (bond.status !== "proposed") {
      throw new Error(`Cannot accept bond: status is "${bond.status}"`);
    }

    if (acceptorId !== bond.entityBId) {
      throw new Error("Only the proposed partner can accept a bond");
    }

    bond.status = "active";
    bond.activatedAt = new Date().toISOString();
    this.recordHistory(bondId, "activated", acceptorId);

    return bond;
  }

  /**
   * Revoke a bond (either party can revoke).
   */
  revoke(bondId: string, revokerId: string, reason?: string): AlignmentBond {
    const bond = this.getOrThrow(bondId);

    if (bond.status === "revoked") {
      throw new Error("Bond is already revoked");
    }

    if (revokerId !== bond.entityAId && revokerId !== bond.entityBId) {
      throw new Error("Only bond participants can revoke");
    }

    bond.status = "revoked";
    bond.revokedAt = new Date().toISOString();
    bond.revokedBy = revokerId;
    this.recordHistory(bondId, "revoked", revokerId, reason);

    return bond;
  }

  /**
   * Get all active bonds for an entity.
   */
  getEntityBonds(entityId: string, status?: BondStatus): AlignmentBond[] {
    const bondIds = this.entityBonds.get(entityId);
    if (!bondIds) return [];

    const bonds: AlignmentBond[] = [];
    for (const id of bondIds) {
      const bond = this.bonds.get(id);
      if (bond && (!status || bond.status === status)) {
        bonds.push(bond);
      }
    }
    return bonds;
  }

  /**
   * Get an active bond between two specific entities.
   */
  getActiveBond(entityAId: string, entityBId: string): AlignmentBond | null {
    const bondsA = this.entityBonds.get(entityAId);
    if (!bondsA) return null;

    for (const id of bondsA) {
      const bond = this.bonds.get(id);
      if (
        bond &&
        bond.status === "active" &&
        ((bond.entityAId === entityAId && bond.entityBId === entityBId) ||
         (bond.entityAId === entityBId && bond.entityBId === entityAId))
      ) {
        return bond;
      }
    }
    return null;
  }

  /**
   * Check if work in a domain qualifies for alignment bonus.
   */
  getAlignmentBonus(entityId: string, domain: string): number {
    const activeBonds = this.getEntityBonds(entityId, "active");
    let totalBonus = 0;

    for (const bond of activeBonds) {
      if (bond.domains.includes(domain)) {
        totalBonus += bond.bonusMultiplier;
      }
    }

    return totalBonus;
  }

  /** Get a single bond. */
  get(bondId: string): AlignmentBond | null {
    return this.bonds.get(bondId) ?? null;
  }

  /** Get bond history for audit. */
  getHistory(bondId?: string): BondHistoryEntry[] {
    if (bondId) {
      return this.history.filter(h => h.bondId === bondId);
    }
    return [...this.history];
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private getOrThrow(bondId: string): AlignmentBond {
    const bond = this.bonds.get(bondId);
    if (!bond) throw new Error(`Bond not found: ${bondId}`);
    return bond;
  }

  private indexBond(bond: AlignmentBond): void {
    for (const entityId of [bond.entityAId, bond.entityBId]) {
      if (!this.entityBonds.has(entityId)) {
        this.entityBonds.set(entityId, new Set());
      }
      this.entityBonds.get(entityId)!.add(bond.id);
    }
  }

  private recordHistory(bondId: string, action: BondHistoryEntry["action"], actorId: string, reason?: string): void {
    this.history.push({
      bondId,
      action,
      actorId,
      timestamp: new Date().toISOString(),
      reason,
    });
  }
}
