/**
 * Gate 3 — Governance (s112 t385, G5).
 *
 * Interface only in v0.4.0. The full governance gate requires:
 *   - Threshold improvement delta over current adapter
 *   - No critical regressions on safety/alignment evals
 *   - Optional human review (dashboard prompt)
 *   - Optional on-chain approval (Impactium DAO, v0.6.0+)
 *
 * In v0.4.0: always returns { pass: true, reason: "not_yet_wired" }.
 * Owner confirmation via the dashboard is the only governance gate in prod.
 * Automated governance (DAO, improvement-delta threshold) deferred to v0.5.0+.
 */

import type { EpisodicRecord } from "../episodic.js";
import type { GateResult } from "./index.js";

export function gateGovernance(_record: EpisodicRecord): GateResult {
  // v0.4.0 stub — interface defined, owner-approval-only in production.
  return { pass: true, reason: "not_yet_wired" };
}
