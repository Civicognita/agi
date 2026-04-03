/**
 * Tier Classification Engine — Task #205
 *
 * Calculates governance tiers from impact data:
 *   Tier 0 (Observer): Account exists
 *   Tier 1 (Participant): >10 verified $imp in 90 days
 *   Tier 2 (Contributor): >100 total $imp + 5 distinct impact events
 *   Tier 3 (Steward): >1000 total $imp + 180 days standing
 *
 * Real-time recalculation on demand.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Governance tier levels. */
export type GovernanceTier = 0 | 1 | 2 | 3;

/** Tier names for display. */
export const TIER_NAMES: Record<GovernanceTier, string> = {
  0: "Observer",
  1: "Participant",
  2: "Contributor",
  3: "Steward",
};

/** Thresholds for tier qualification. */
export interface TierThresholds {
  /** Tier 1: minimum verified $imp in the recency window. */
  tier1MinImp: number;
  /** Tier 1: recency window in days. */
  tier1RecencyDays: number;
  /** Tier 2: minimum total $imp. */
  tier2MinImp: number;
  /** Tier 2: minimum distinct impact events. */
  tier2MinEvents: number;
  /** Tier 3: minimum total $imp. */
  tier3MinImp: number;
  /** Tier 3: minimum standing duration in days. */
  tier3MinStandingDays: number;
}

/** Default thresholds per the governance spec. */
export const DEFAULT_THRESHOLDS: TierThresholds = {
  tier1MinImp: 10,
  tier1RecencyDays: 90,
  tier2MinImp: 100,
  tier2MinEvents: 5,
  tier3MinImp: 1000,
  tier3MinStandingDays: 180,
};

/** Input data needed for tier calculation. */
export interface TierInput {
  /** Entity's total verified $imp (all time). */
  totalImp: number;
  /** Entity's verified $imp within the recency window. */
  recentImp: number;
  /** Number of distinct impact events. */
  distinctEvents: number;
  /** Entity's account age in days. */
  standingDays: number;
}

/** Result of tier classification. */
export interface TierClassification {
  entityId: string;
  tier: GovernanceTier;
  tierName: string;
  /** Whether the entity meets criteria for each tier. */
  qualifications: {
    tier1: boolean;
    tier2: boolean;
    tier3: boolean;
  };
  /** Distance to next tier (what's needed). */
  nextTierGap: NextTierGap | null;
  /** When the tier was calculated. */
  calculatedAt: string;
}

/** What's needed to reach the next tier. */
export interface NextTierGap {
  targetTier: GovernanceTier;
  requirements: string[];
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * Classify an entity's governance tier based on impact data.
 *
 * Tiers are evaluated from highest to lowest — the entity gets
 * the highest tier they qualify for.
 */
export function classifyTier(
  entityId: string,
  input: TierInput,
  thresholds?: Partial<TierThresholds>,
): TierClassification {
  const t = { ...DEFAULT_THRESHOLDS, ...thresholds };

  const tier1 = input.recentImp >= t.tier1MinImp;
  const tier2 = input.totalImp >= t.tier2MinImp && input.distinctEvents >= t.tier2MinEvents;
  const tier3 = input.totalImp >= t.tier3MinImp && input.standingDays >= t.tier3MinStandingDays;

  let tier: GovernanceTier = 0;
  if (tier3) tier = 3;
  else if (tier2) tier = 2;
  else if (tier1) tier = 1;

  const nextTierGap = computeNextTierGap(tier, input, t);

  return {
    entityId,
    tier,
    tierName: TIER_NAMES[tier],
    qualifications: { tier1, tier2, tier3 },
    nextTierGap,
    calculatedAt: new Date().toISOString(),
  };
}

function computeNextTierGap(
  currentTier: GovernanceTier,
  input: TierInput,
  t: TierThresholds,
): NextTierGap | null {
  if (currentTier >= 3) return null;

  const targetTier = (currentTier + 1) as GovernanceTier;
  const requirements: string[] = [];

  switch (targetTier) {
    case 1: {
      const impNeeded = t.tier1MinImp - input.recentImp;
      if (impNeeded > 0) {
        requirements.push(`Need ${impNeeded.toFixed(1)} more verified $imp in ${t.tier1RecencyDays} days`);
      }
      break;
    }
    case 2: {
      const impNeeded = t.tier2MinImp - input.totalImp;
      if (impNeeded > 0) {
        requirements.push(`Need ${impNeeded.toFixed(1)} more total $imp`);
      }
      const eventsNeeded = t.tier2MinEvents - input.distinctEvents;
      if (eventsNeeded > 0) {
        requirements.push(`Need ${eventsNeeded} more distinct impact events`);
      }
      break;
    }
    case 3: {
      const impNeeded = t.tier3MinImp - input.totalImp;
      if (impNeeded > 0) {
        requirements.push(`Need ${impNeeded.toFixed(1)} more total $imp`);
      }
      const daysNeeded = t.tier3MinStandingDays - input.standingDays;
      if (daysNeeded > 0) {
        requirements.push(`Need ${daysNeeded} more days of standing`);
      }
      break;
    }
  }

  return { targetTier, requirements };
}

// ---------------------------------------------------------------------------
// Batch classification
// ---------------------------------------------------------------------------

/** Classify multiple entities at once. */
export function classifyTiers(
  entities: Array<{ entityId: string; input: TierInput }>,
  thresholds?: Partial<TierThresholds>,
): TierClassification[] {
  return entities.map(({ entityId, input }) => classifyTier(entityId, input, thresholds));
}

/** Get a tier's voting weight. Higher tiers have more weight. */
export function tierVotingWeight(tier: GovernanceTier): number {
  switch (tier) {
    case 0: return 0;
    case 1: return 1;
    case 2: return 3;
    case 3: return 5;
  }
}
