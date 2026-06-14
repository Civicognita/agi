/**
 * Gate 2 — Reward / Evaluation (s112 t385, G5).
 *
 * Interface only in v0.4.0. The full reward gate runs the candidate adapter
 * against a held-out eval set + adversarial set + regression set + philosophy
 * consistency set + safety set and compares against the current adapter's score.
 *
 * In v0.4.0: always returns { pass: true, reason: "not_yet_wired" } so the
 * pipeline proceeds. The interface is locked so G6 adapters can assume it.
 *
 * To run manually: `pnpm eval:adapter <adapter-path>` (future tooling).
 */

import type { EpisodicRecord } from "../episodic.js";
import type { GateResult } from "./index.js";

export function gateReward(_record: EpisodicRecord): GateResult {
  // v0.4.0 stub — interface defined, not yet wired.
  // Wiring deferred to v0.5.0 once real LoRA adapters + eval harness exist.
  return { pass: true, reason: "not_yet_wired" };
}
