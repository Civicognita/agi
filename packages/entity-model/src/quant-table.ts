/**
 * QUANT Lookup Table — Task #126
 *
 * Maps COAWorkType tokens to their governance-locked QUANT values.
 * These values are fixed per docs/governance/impact-scoring-rules.md §4.1.
 *
 * Changes to this table are a governance event requiring #E0 sign-off.
 */

// ---------------------------------------------------------------------------
// Locked QUANT values (GOV-ISR-001 §4.1)
// ---------------------------------------------------------------------------

/**
 * Governance-locked QUANT value mapping.
 *
 * | Interaction Type             | work_type Token   | QUANT |
 * |------------------------------|-------------------|-------|
 * | Conversation — inbound       | message_in        | 1     |
 * | Conversation — outbound      | message_out       | 1     |
 * | Task dispatch                | task_dispatch      | 3     |
 * | Verification request         | verification       | 5     |
 * | Seal issuance                | seal_issuance      | 10    |
 * | Skill invocation             | tool_use           | 2     |
 * | Artifact (tool_use tier)     | artifact           | 2     |
 * | Commit (tool_use tier)       | commit             | 2     |
 * | Action (tool_use tier)       | action             | 2     |
 */
const QUANT_TABLE: Record<string, number> = {
  message_in: 1,
  message_out: 1,
  tool_use: 2,
  task_dispatch: 3,
  verification: 5,
  seal_issuance: 10,
  artifact: 2,
  commit: 2,
  action: 2,
};

// ---------------------------------------------------------------------------
// Lookup API
// ---------------------------------------------------------------------------

/** Default QUANT for unknown interaction types (GOV-ISR-001 §4.3). */
const DEFAULT_QUANT = 1;

/** Sentinel channel value for unclassified interaction types. */
export const UNCLASSIFIED_CHANNEL = "__UNCLASSIFIED__";

/**
 * Look up the QUANT value for a given work_type.
 *
 * If the work_type is unknown, returns the conservative default (1)
 * and sets `isUnknown = true` so the caller can apply §4.3 rules
 * (log warning, force neutral 0BOOL, flag channel).
 */
export function lookupQuant(workType: string | null | undefined): {
  quant: number;
  isUnknown: boolean;
} {
  if (workType == null) {
    return { quant: DEFAULT_QUANT, isUnknown: true };
  }

  // Strip any suffix (e.g. "message_in:llm:0+:0.8" → "message_in")
  const baseType = workType.split(":")[0]!;
  const quant = QUANT_TABLE[baseType];

  if (quant !== undefined) {
    return { quant, isUnknown: false };
  }

  return { quant: DEFAULT_QUANT, isUnknown: true };
}

/**
 * Get the raw QUANT table for inspection/calibration tooling.
 * Returns a frozen copy.
 */
export function getQuantTable(): Readonly<Record<string, number>> {
  return Object.freeze({ ...QUANT_TABLE });
}

/**
 * Check if a work_type token has a defined QUANT entry.
 */
export function isKnownWorkType(workType: string): boolean {
  const baseType = workType.split(":")[0]!;
  return baseType in QUANT_TABLE;
}
