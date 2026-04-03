/**
 * 0BOOL Classifier — Task #127
 *
 * Two-tier classification system per GOV-ISR-001 §5.2:
 *   Tier 1: Automated deterministic rules (no LLM)
 *   Tier 2: LLM assessment (when no Tier 1 rule matches)
 *   Tier 3: Default to NEUTRAL (fail-safe)
 *
 * This module implements Tier 1 rules and provides interfaces for
 * Tier 2 integration. The gateway wires up the actual LLM call.
 */

import type { BoolLabel } from "./impact.js";
import type { VerificationTier } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Context provided to the classifier for each interaction. */
export interface ClassificationContext {
  /** COAWorkType token (e.g. "message_in", "seal_issuance"). */
  workType: string | null;
  /** Entity verification tier at time of interaction. */
  verificationTier: VerificationTier;
  /** Whether the operation completed successfully. */
  outcomeSuccess?: boolean;
  /** Whether the entity is on the blocklist. */
  isBlocklisted?: boolean;
  /** Whether the entity responded within 24h (for message_out). */
  entityRespondedWithin24h?: boolean;
  /** Whether the message content matches abuse patterns. */
  matchesAbusePattern?: boolean;
  /** Raw message content for Tier 2 LLM assessment (sanitized). */
  messageContent?: string;
}

/** Result of 0BOOL classification. */
export interface ClassificationResult {
  /** The assigned 0BOOL label. */
  label: BoolLabel;
  /** Which tier produced this classification. */
  tier: 1 | 2 | 3;
  /** Confidence score |+value| — only meaningful for Tier 2. */
  confidence: number;
  /** Human-readable reason for the classification. */
  reason: string;
}

/**
 * Interface for Tier 2 LLM classification.
 * Implemented by the gateway's agent bridge.
 */
export interface LLMClassifier {
  /**
   * Request LLM assessment of an interaction's 0BOOL direction.
   *
   * @param ctx - Classification context (sanitized message, history summary)
   * @returns Label + confidence, or null if assessment unavailable
   */
  assess(ctx: ClassificationContext): Promise<{
    label: BoolLabel;
    confidence: number;
  } | null>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum confidence threshold for Tier 2 LLM classifications (MAGIC threshold). */
const LLM_CONFIDENCE_THRESHOLD = 0.6;

// ---------------------------------------------------------------------------
// Tier 1 — Automated Rules (GOV-ISR-001 §5.2)
// ---------------------------------------------------------------------------

/**
 * Apply Tier 1 deterministic classification rules.
 *
 * Returns a ClassificationResult if a rule matches, or null if
 * no Tier 1 rule applies (caller should try Tier 2).
 */
export function classifyTier1(
  ctx: ClassificationContext,
): ClassificationResult | null {
  // Rule: Entity on blocklist → 0FALSE
  if (ctx.isBlocklisted === true) {
    return {
      label: "0FALSE",
      tier: 1,
      confidence: 1.0,
      reason: "Entity is on blocklist",
    };
  }

  // Rule: Abuse pattern match → 0FALSE
  if (ctx.matchesAbusePattern === true) {
    return {
      label: "0FALSE",
      tier: 1,
      confidence: 1.0,
      reason: "Message matches abuse pattern rules",
    };
  }

  const baseType = ctx.workType?.split(":")[0] ?? null;

  // Rule: seal_issuance + sealed tier → 0TRUE
  if (baseType === "seal_issuance" && ctx.verificationTier === "sealed") {
    return {
      label: "0TRUE",
      tier: 1,
      confidence: 1.0,
      reason: "Seal issuance by sealed entity",
    };
  }

  // Rule: verification with outcome
  if (baseType === "verification") {
    if (ctx.outcomeSuccess === true) {
      return {
        label: "TRUE",
        tier: 1,
        confidence: 1.0,
        reason: "Successful verification",
      };
    }
    if (ctx.outcomeSuccess === false) {
      return {
        label: "FALSE",
        tier: 1,
        confidence: 1.0,
        reason: "Failed verification",
      };
    }
  }

  // Rule: task_dispatch with outcome
  if (baseType === "task_dispatch") {
    if (ctx.outcomeSuccess === true) {
      return {
        label: "TRUE",
        tier: 1,
        confidence: 1.0,
        reason: "Task dispatch completed successfully",
      };
    }
    if (ctx.outcomeSuccess === false) {
      return {
        label: "0-",
        tier: 1,
        confidence: 1.0,
        reason: "Task dispatch failed or timed out",
      };
    }
  }

  // Rule: message_out where entity did not respond within 24h → 0-
  if (baseType === "message_out" && ctx.entityRespondedWithin24h === false) {
    return {
      label: "0-",
      tier: 1,
      confidence: 1.0,
      reason: "Entity did not respond within 24 hours",
    };
  }

  // No Tier 1 rule matched
  return null;
}

// ---------------------------------------------------------------------------
// Full classification pipeline
// ---------------------------------------------------------------------------

/**
 * Classify an interaction through the full Tier 1 → Tier 2 → Tier 3 pipeline.
 *
 * @param ctx - Interaction context
 * @param llm - Optional LLM classifier for Tier 2 (if null, skips to Tier 3)
 */
export async function classify(
  ctx: ClassificationContext,
  llm?: LLMClassifier | null,
): Promise<ClassificationResult> {
  // Tier 1: Automated rules
  const tier1 = classifyTier1(ctx);
  if (tier1 !== null) {
    return tier1;
  }

  // Tier 2: LLM assessment (if available)
  if (llm != null) {
    try {
      const assessment = await llm.assess(ctx);
      if (assessment !== null) {
        if (assessment.confidence >= LLM_CONFIDENCE_THRESHOLD) {
          return {
            label: assessment.label,
            tier: 2,
            confidence: assessment.confidence,
            reason: `LLM assessment (confidence: ${assessment.confidence.toFixed(2)})`,
          };
        }
        // Below threshold → fall through to Tier 3
      }
    } catch {
      // LLM failure is non-fatal → fall through to Tier 3
    }
  }

  // Tier 3: Default to NEUTRAL (fail-safe)
  return {
    label: "NEUTRAL",
    tier: 3,
    confidence: 0,
    reason: "No classification rule matched; defaulting to NEUTRAL",
  };
}
