/**
 * NoopAnchor — Layer D blockchain anchor stub for v0.4.0 (s112 t383).
 *
 * Implements the BlockchainAnchor interface from `@agi/sdk` without any
 * real chain calls. Records are persisted to `~/.agi/anchors/pending.jsonl`
 * with deterministic `noop:<sha256-of-record-json>` tx ids so callers can
 * use the returned `txHash` as a stable id.
 *
 * Why this exists in v0.4.0:
 *   - Layer D (per `_discovery/aion-blockchain-memory-draft-a.md`) is the
 *     verifiable-memory infrastructure. Storing hashes + provenance on a
 *     real chain (Ethereum / L2) ships in v0.6.0 via tynn s113.
 *   - But s112 callers (G1 EpisodicRecord, G4 episode scoring, G5 candidate
 *     dataset, future G6 adapter promotions) need to call `anchor()` from
 *     v0.4.0 onward. Without NoopAnchor those callers either (a) wouldn't
 *     adopt the interface and would need refactoring later, or (b) would
 *     ship dead `if (anchor)` branches.
 *   - NoopAnchor lets every consumer treat anchoring as a normal contract
 *     in v0.4.0. v0.6.0 swaps the implementation; no caller changes.
 *
 * The pending.jsonl file is gitignored under ~/.agi/. v0.6.0's first
 * concrete BlockchainAnchor implementation may optionally consume this
 * pending log to bulk-anchor pre-existing v0.4.0 records to chain.
 */

import { mkdirSync, appendFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import type { AnchorRecord, AnchorResult, BlockchainAnchor } from "@agi/sdk";

/** Default pending-anchor log path. Override with `new NoopAnchor({ logPath })`. */
const DEFAULT_LOG_PATH = join(homedir(), ".agi", "anchors", "pending.jsonl");

export interface NoopAnchorOptions {
  /** Override the pending-log path (mostly for tests). */
  logPath?: string;
}

/** Deterministic tx-hash for a NoopAnchor record. Lets callers de-dupe + ref
 *  the same record without storing the full canonical body. The "noop:" prefix
 *  marks these so the future live anchor can distinguish real-chain tx hashes
 *  from synthetic ones during the v0.6.0 migration. */
function noopTxHash(record: AnchorRecord): string {
  // Canonical JSON: stable key order so the same record always hashes the same.
  const canonical = JSON.stringify(record, Object.keys(record).sort());
  const digest = createHash("sha256").update(canonical).digest("hex");
  return `noop:${digest.slice(0, 24)}`;
}

export class NoopAnchor implements BlockchainAnchor {
  private readonly logPath: string;

  constructor(opts: NoopAnchorOptions = {}) {
    this.logPath = opts.logPath ?? DEFAULT_LOG_PATH;
    // Ensure the parent directory exists. Defer file creation to first write
    // so empty installs don't litter the FS.
    mkdirSync(dirname(this.logPath), { recursive: true });
  }

  async anchor(record: AnchorRecord): Promise<AnchorResult> {
    const txHash = noopTxHash(record);
    const line = JSON.stringify({ txHash, record }) + "\n";
    appendFileSync(this.logPath, line, { encoding: "utf-8" });
    return { txHash };
  }

  async verify(hash: string): Promise<{ exists: boolean; record?: AnchorRecord }> {
    if (!existsSync(this.logPath)) return { exists: false };
    const content = readFileSync(this.logPath, "utf-8");
    for (const line of content.split("\n")) {
      if (line.length === 0) continue;
      try {
        const entry = JSON.parse(line) as { txHash: string; record: AnchorRecord };
        if (entry.record.hash === hash) return { exists: true, record: entry.record };
      } catch {
        // Skip malformed lines; the live anchor never writes them, but jsonl
        // can in principle have a partial last line if a process was killed
        // mid-write. Defensive parse + continue.
      }
    }
    return { exists: false };
  }

  async listByOwner(owner: string, limit = 100): Promise<AnchorRecord[]> {
    if (!existsSync(this.logPath)) return [];
    const content = readFileSync(this.logPath, "utf-8");
    const out: AnchorRecord[] = [];
    for (const line of content.split("\n")) {
      if (line.length === 0) continue;
      try {
        const entry = JSON.parse(line) as { txHash: string; record: AnchorRecord };
        if (entry.record.owner === owner) out.push(entry.record);
      } catch {
        // See verify() — defensive.
      }
    }
    // Newest-first per the interface contract.
    out.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    return out.slice(0, limit);
  }
}
