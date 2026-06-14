/**
 * Gate 4 — Rollback (s112 t385, G5).
 *
 * Fully wired in v0.4.0. Every episode admitted to the candidate dataset
 * must be rollback-safe: it must have a valid hash and a COA fingerprint
 * linking it to the chain-of-accountability. These two fields are the
 * minimum metadata an adapter promotion record needs to identify the
 * training inputs that produced it.
 *
 * When G6 (LoRA pipeline) begins producing real adapters, each promotion
 * records: {version_id, parent_version, training_data_snapshot_hash,
 * reproducible_config, promoted_at}. Rollback is a file-system swap back
 * to the parent version — `agi adapter rollback <version_id>`.
 *
 * Gate 4's job here is to ensure the episode has the metadata a rollback
 * record would need to be meaningful. Episodes missing hash or
 * coaFingerprint are rejected from the candidate dataset because a
 * rollback to a model trained on unattributable data would be opaque.
 */

import type { EpisodicRecord } from "../episodic.js";
import type { GateResult } from "./index.js";

export function gateRollback(record: EpisodicRecord): GateResult {
  if (!record.hash || !record.hash.startsWith("sha256:")) {
    return { pass: false, reason: "rollback: missing or malformed hash (must be sha256:<hex>)" };
  }
  if (!record.coaFingerprint) {
    return { pass: false, reason: "rollback: coaFingerprint is empty — episode is unattributable" };
  }
  return { pass: true };
}
