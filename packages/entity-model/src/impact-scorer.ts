/**
 * Impact Scorer — Tasks #126-#130
 *
 * Orchestrates the full $imp scoring pipeline:
 *   1. QUANT lookup (from work_type)
 *   2. 0BOOL classification (Tier 1 rules → Tier 2 LLM → Tier 3 default)
 *   3. 0BONUS calculation (90-day rolling window)
 *   4. Formula: $imp = QUANT × VALUE[0BOOL] × (1 + 0BONUS)
 *   5. Record to forward-only ledger
 *
 * @see docs/governance/impact-scoring-rules.md
 */

import type { BoolLabel, ImpactInteraction, ImpactRecorder } from "./impact.js";
import { BOOL_VALUES } from "./impact.js";
import type { VerificationTier } from "./types.js";

import { lookupQuant, UNCLASSIFIED_CHANNEL } from "./quant-table.js";
import {
  classify,
  classifyTier1,
  type ClassificationContext,
  type ClassificationResult,
  type LLMClassifier,
} from "./bool-classifier.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Parameters for scoring an interaction. */
export interface ScoreInteractionParams {
  /** Entity ULID. */
  entityId: string;
  /** COA fingerprint for audit linkage. */
  coaFingerprint: string;
  /** Channel the interaction arrived on (e.g. "telegram", "discord"). */
  channel?: string;
  /** COAWorkType token (e.g. "message_in", "tool_use"). */
  workType: string | null;
  /** Entity verification tier at time of interaction. */
  verificationTier: VerificationTier;
  /** Classification context for Tier 1 rules (optional overrides). */
  classificationCtx?: Partial<ClassificationContext>;
}

/** Full scoring result including intermediate values. */
export interface ScoringResult {
  /** The persisted impact interaction record. */
  interaction: ImpactInteraction;
  /** QUANT value used. */
  quant: number;
  /** Whether the work_type was unknown (§4.3 rules applied). */
  quantUnknown: boolean;
  /** 0BOOL classification result. */
  classification: ClassificationResult;
  /** 0BONUS value at time of scoring. */
  bonus: number;
  /** Final computed $imp score. */
  impScore: number;
}

/** Configuration for the 0BONUS calculation. */
export interface BonusConfig {
  /** Rolling window in days (default: 90). */
  windowDays: number;
  /** Normalizing divisor (default: 100). */
  divisor: number;
  /** Maximum 0BONUS cap (default: 2.0). */
  cap: number;
}

// ---------------------------------------------------------------------------
// Constants (GOV-ISR-001 §6)
// ---------------------------------------------------------------------------

const DEFAULT_BONUS_CONFIG: BonusConfig = {
  windowDays: 90,
  divisor: 100,
  cap: 2.0,
};

/** Minimum interactions before scoring unverified entities (§2). */
const UNVERIFIED_SCORING_THRESHOLD = 3;

// ---------------------------------------------------------------------------
// ImpactScorer
// ---------------------------------------------------------------------------

export class ImpactScorer {
  private readonly recorder: ImpactRecorder;
  private readonly bonusConfig: BonusConfig;
  private llmClassifier: LLMClassifier | null = null;

  /**
   * Track deferred interactions for unverified entities that haven't
   * reached the scoring threshold yet (§2 — fewer than 3 interactions).
   */
  private readonly deferredCounts = new Map<string, number>();

  constructor(
    recorder: ImpactRecorder,
    bonusConfig?: Partial<BonusConfig>,
  ) {
    this.recorder = recorder;
    this.bonusConfig = { ...DEFAULT_BONUS_CONFIG, ...bonusConfig };
  }

  /** Set the LLM classifier for Tier 2 assessment. */
  setLLMClassifier(classifier: LLMClassifier): void {
    this.llmClassifier = classifier;
  }

  // ---------------------------------------------------------------------------
  // 0BONUS calculation (§6)
  // ---------------------------------------------------------------------------

  /**
   * Calculate the current 0BONUS for an entity.
   *
   * Formula: 0BONUS = SUM(positive $imp in window) / divisor, capped.
   *
   * @see docs/governance/impact-scoring-rules.md §6.1
   */
  async calculateBonus(entityId: string): Promise<number> {
    const windowMs = this.bonusConfig.windowDays * 24 * 60 * 60 * 1000;
    const since = new Date(Date.now() - windowMs).toISOString();

    const positiveSum = await this.recorder.getPositiveBalanceSince(entityId, since);
    const rawBonus = positiveSum / this.bonusConfig.divisor;

    return Math.min(rawBonus, this.bonusConfig.cap);
  }

  // ---------------------------------------------------------------------------
  // Score an interaction
  // ---------------------------------------------------------------------------

  /**
   * Score a single interaction through the full pipeline.
   *
   * Steps:
   * 1. Check unverified deferral (§2)
   * 2. Look up QUANT (§4)
   * 3. Classify 0BOOL (§5)
   * 4. Calculate 0BONUS (§6)
   * 5. Apply formula: $imp = QUANT × VALUE[0BOOL] × (1 + 0BONUS)
   * 6. Record to ledger
   */
  async score(params: ScoreInteractionParams): Promise<ScoringResult | null> {
    // Step 1: Unverified deferral check (§2)
    if (params.verificationTier === "unverified") {
      const count = (this.deferredCounts.get(params.entityId) ?? 0) + 1;
      this.deferredCounts.set(params.entityId, count);

      if (count < UNVERIFIED_SCORING_THRESHOLD) {
        // Deferred — not scored yet
        return null;
      }

      // Reached threshold — score this one (retroactive scoring of previous
      // interactions is handled by scoreRetroactive())
      if (count === UNVERIFIED_SCORING_THRESHOLD) {
        this.deferredCounts.delete(params.entityId);
      }
    }

    return this.scoreImmediate(params);
  }

  /**
   * Score an interaction immediately (no deferral check).
   * Used internally and for retroactive scoring.
   */
  async scoreImmediate(params: ScoreInteractionParams): Promise<ScoringResult> {
    // Step 2: QUANT lookup
    const { quant, isUnknown: quantUnknown } = lookupQuant(params.workType);

    // Step 3: 0BOOL classification
    const classCtx: ClassificationContext = {
      workType: params.workType,
      verificationTier: params.verificationTier,
      ...params.classificationCtx,
    };

    let classification: ClassificationResult;

    if (quantUnknown) {
      // §4.3: Unknown work_type → force NEUTRAL
      classification = {
        label: "NEUTRAL",
        tier: 3,
        confidence: 0,
        reason: "Unknown work_type; forced NEUTRAL per §4.3",
      };
    } else {
      classification = await classify(classCtx, this.llmClassifier);
    }

    // Step 4: Calculate 0BONUS
    const bonus = await this.calculateBonus(params.entityId);

    // Step 5: Compute $imp
    const value0bool = BOOL_VALUES[classification.label];
    const impScore = quant * value0bool * (1 + bonus);

    // Build work_type suffix for Tier 2 LLM classifications (§5.2)
    let recordWorkType = params.workType ?? undefined;
    if (classification.tier === 2 && params.workType != null) {
      recordWorkType = `${params.workType}:llm:${classification.label}:${classification.confidence.toFixed(1)}`;
    }

    // Step 6: Record to ledger
    const channel = quantUnknown
      ? UNCLASSIFIED_CHANNEL
      : (params.channel ?? undefined);

    const interaction = await this.recorder.record({
      entityId: params.entityId,
      coaFingerprint: params.coaFingerprint,
      channel,
      workType: recordWorkType,
      quant,
      boolLabel: classification.label,
      bonus,
    });

    return {
      interaction,
      quant,
      quantUnknown,
      classification,
      bonus,
      impScore,
    };
  }

  /**
   * Score an interaction using only Tier 1 rules (synchronous).
   *
   * This is the fast path for gateway hot paths where async LLM
   * assessment is not acceptable. Falls through to NEUTRAL if
   * no Tier 1 rule matches.
   */
  async scoreSync(params: ScoreInteractionParams): Promise<ScoringResult> {
    const { quant, isUnknown: quantUnknown } = lookupQuant(params.workType);

    const classCtx: ClassificationContext = {
      workType: params.workType,
      verificationTier: params.verificationTier,
      ...params.classificationCtx,
    };

    let classification: ClassificationResult;

    if (quantUnknown) {
      classification = {
        label: "NEUTRAL",
        tier: 3,
        confidence: 0,
        reason: "Unknown work_type; forced NEUTRAL per §4.3",
      };
    } else {
      const tier1 = classifyTier1(classCtx);
      classification = tier1 ?? {
        label: "NEUTRAL",
        tier: 3,
        confidence: 0,
        reason: "No Tier 1 rule matched; defaulting to NEUTRAL",
      };
    }

    const bonus = await this.calculateBonus(params.entityId);
    const value0bool = BOOL_VALUES[classification.label];
    const impScore = quant * value0bool * (1 + bonus);

    const channel = quantUnknown
      ? UNCLASSIFIED_CHANNEL
      : (params.channel ?? undefined);

    const interaction = await this.recorder.record({
      entityId: params.entityId,
      coaFingerprint: params.coaFingerprint,
      channel,
      workType: params.workType ?? undefined,
      quant,
      boolLabel: classification.label,
      bonus,
    });

    return {
      interaction,
      quant,
      quantUnknown,
      classification,
      bonus,
      impScore,
    };
  }

  // ---------------------------------------------------------------------------
  // Calibration / diagnostics
  // ---------------------------------------------------------------------------

  /**
   * Dry-run the scoring pipeline without persisting.
   * Returns what the score WOULD be for given parameters.
   */
  async dryRun(params: {
    workType: string | null;
    verificationTier: VerificationTier;
    entityId: string;
    classificationCtx?: Partial<ClassificationContext>;
  }): Promise<{
    quant: number;
    quantUnknown: boolean;
    boolLabel: BoolLabel;
    value0bool: number;
    bonus: number;
    projectedImpScore: number;
  }> {
    const { quant, isUnknown: quantUnknown } = lookupQuant(params.workType);

    const classCtx: ClassificationContext = {
      workType: params.workType,
      verificationTier: params.verificationTier,
      ...params.classificationCtx,
    };

    let boolLabel: BoolLabel;
    if (quantUnknown) {
      boolLabel = "NEUTRAL";
    } else {
      const tier1 = classifyTier1(classCtx);
      boolLabel = tier1?.label ?? "NEUTRAL";
    }

    const bonus = await this.calculateBonus(params.entityId);
    const value0bool = BOOL_VALUES[boolLabel];
    const projectedImpScore = quant * value0bool * (1 + bonus);

    return {
      quant,
      quantUnknown,
      boolLabel,
      value0bool,
      bonus,
      projectedImpScore,
    };
  }

  /**
   * Get a complete entity impact profile for dashboarding.
   */
  async getEntityProfile(entityId: string): Promise<{
    lifetimeBalance: number;
    windowBalance: number;
    currentBonus: number;
    distinctEventTypes: number;
    recentHistory: ImpactInteraction[];
  }> {
    const windowMs = this.bonusConfig.windowDays * 24 * 60 * 60 * 1000;
    const since = new Date(Date.now() - windowMs).toISOString();

    const [lifetimeBalance, windowBalance, currentBonus, distinctEventTypes, recentHistory] = await Promise.all([
      this.recorder.getBalance(entityId),
      this.recorder.getBalanceSince(entityId, since),
      this.calculateBonus(entityId),
      this.recorder.getDistinctEventCount(entityId),
      this.recorder.getHistory(entityId, { limit: 20 }),
    ]);

    return {
      lifetimeBalance,
      windowBalance,
      currentBonus,
      distinctEventTypes,
      recentHistory,
    };
  }
}
