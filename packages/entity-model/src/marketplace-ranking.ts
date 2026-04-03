/**
 * Marketplace Ranking Algorithm — Task #214
 *
 * 5-factor score:
 * - domain_match_weight (0.30) — how well skill matches query domain
 * - recognition_weight (0.25) — endorsements and recognitions
 * - usage_quality (0.20) — install retention vs quick-remove
 * - coa_contribution (0.15) — correlation with $imp generation
 * - recency (0.10) — maintenance activity
 */

import type { SkillListing } from "./marketplace.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Ranking weights (must sum to 1.0). */
export interface RankingWeights {
  domainMatch: number;
  recognition: number;
  usageQuality: number;
  coaContribution: number;
  recency: number;
}

/** Default ranking weights per spec. */
export const DEFAULT_RANKING_WEIGHTS: RankingWeights = {
  domainMatch: 0.30,
  recognition: 0.25,
  usageQuality: 0.20,
  coaContribution: 0.15,
  recency: 0.10,
};

/** Per-skill ranking score breakdown. */
export interface RankingScore {
  skillId: string;
  /** Final composite score (0.0 - 1.0). */
  totalScore: number;
  /** Individual factor scores (0.0 - 1.0). */
  factors: {
    domainMatch: number;
    recognition: number;
    usageQuality: number;
    coaContribution: number;
    recency: number;
  };
}

/** Context for ranking computation. */
export interface RankingContext {
  /** The domain being searched (for domain match scoring). */
  queryDomain?: string;
  /** Maximum endorsement count among all skills (for normalization). */
  maxEndorsements: number;
  /** Maximum installs among all skills (for normalization). */
  maxInstalls: number;
  /** Maximum $imp correlation among all skills (for normalization). */
  maxImpCorrelation: number;
  /** Current time for recency calculation. */
  now: Date;
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

/**
 * Compute ranking scores for a set of skills.
 *
 * @param skills - Skills to rank
 * @param context - Normalization context
 * @param weights - Custom weights (optional, defaults to spec weights)
 * @returns Skills sorted by descending score
 */
export function rankSkills(
  skills: SkillListing[],
  context: RankingContext,
  weights?: Partial<RankingWeights>,
): RankingScore[] {
  const w = { ...DEFAULT_RANKING_WEIGHTS, ...weights };

  const scores = skills.map(skill => computeScore(skill, context, w));

  // Sort descending by total score
  scores.sort((a, b) => b.totalScore - a.totalScore);

  return scores;
}

/**
 * Compute ranking score for a single skill.
 */
export function computeScore(
  skill: SkillListing,
  context: RankingContext,
  weights: RankingWeights = DEFAULT_RANKING_WEIGHTS,
): RankingScore {
  const factors = {
    domainMatch: computeDomainMatch(skill, context.queryDomain),
    recognition: computeRecognition(skill, context.maxEndorsements),
    usageQuality: computeUsageQuality(skill),
    coaContribution: computeCoaContribution(skill, context.maxImpCorrelation),
    recency: computeRecency(skill, context.now),
  };

  const totalScore =
    factors.domainMatch * weights.domainMatch +
    factors.recognition * weights.recognition +
    factors.usageQuality * weights.usageQuality +
    factors.coaContribution * weights.coaContribution +
    factors.recency * weights.recency;

  return {
    skillId: skill.id,
    totalScore,
    factors,
  };
}

// ---------------------------------------------------------------------------
// Factor computations (each returns 0.0 - 1.0)
// ---------------------------------------------------------------------------

/** Domain match: 1.0 if skill matches query domain, 0.5 if no domain query. */
function computeDomainMatch(skill: SkillListing, queryDomain?: string): number {
  if (!queryDomain) return 0.5; // Neutral when no domain filter
  return skill.domains.includes(queryDomain as typeof skill.domains[number]) ? 1.0 : 0.0;
}

/** Recognition: endorsement count normalized against max. */
function computeRecognition(skill: SkillListing, maxEndorsements: number): number {
  if (maxEndorsements === 0) return 0;
  return Math.min(skill.endorsementCount / maxEndorsements, 1.0);
}

/** Usage quality: retention rate (1 - quickRemoveRate). */
function computeUsageQuality(skill: SkillListing): number {
  if (skill.stats.installs === 0) return 0.5; // Neutral for new skills
  return skill.stats.retentionRate;
}

/** COA contribution: $imp correlation normalized against max. */
function computeCoaContribution(skill: SkillListing, maxImpCorrelation: number): number {
  if (maxImpCorrelation === 0) return 0;
  return Math.min(skill.stats.avgImpCorrelation / maxImpCorrelation, 1.0);
}

/** Recency: exponential decay based on time since last update. */
function computeRecency(skill: SkillListing, now: Date): number {
  const updatedAt = new Date(skill.updatedAt);
  const daysSinceUpdate = (now.getTime() - updatedAt.getTime()) / (24 * 60 * 60 * 1000);

  // Half-life of 90 days — skills updated recently score higher
  const halfLife = 90;
  return Math.pow(0.5, daysSinceUpdate / halfLife);
}
