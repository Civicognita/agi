/**
 * 4-gate evaluation pipeline (s112 t385, G5).
 *
 * Gates 1 + 4 are fully wired in v0.4.0.
 * Gates 2 + 3 are interface stubs (return pass: true, reason: "not_yet_wired").
 */

export interface GateResult {
  pass: boolean;
  /** Human-readable reason on failure (or "not_yet_wired" for stub gates). */
  reason?: string;
}

export { gateDataQuality } from "./gate-data-quality.js";
export { gateReward } from "./gate-reward.js";
export { gateGovernance } from "./gate-governance.js";
export { gateRollback } from "./gate-rollback.js";
