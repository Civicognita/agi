/**
 * Layer D — Blockchain anchor interface (s112 t383, scaffolding for v0.6.0).
 *
 * Per `_discovery/aion-blockchain-memory-draft-a.md`'s 4-layer memory model:
 *   A — Working memory  (in-process)
 *   B — Episodic memory (~/.agi/memory + agi_data Postgres)
 *   C — PRIME doctrine  (aionima-prime + frozen gold-evals)
 *   D — Blockchain anchor — **THIS LAYER**
 *
 * Layer D's job: store hashes + provenance + governance signals on a public
 * verifiable ledger so memory artifacts + adapter promotions + dataset
 * snapshots can be verified across time and across machines. Per draft-a,
 * "treat blockchain memory as verifiable memory infrastructure, not primary
 * runtime memory."
 *
 * **v0.4.0 ships only this interface + a NoopAnchor implementation that
 * writes records to ~/.agi/anchors/pending.jsonl.** No real chain calls.
 * v0.6.0 swaps the implementation for a live Ethereum/L2 anchor through
 * the same interface (per tynn s113). Callers that adopt the interface
 * now don't change when v0.6.0 lands — that's the whole point.
 *
 * Stays out of scope per draft-a:
 *   - Storing raw memory content on-chain (use IPFS/Filecoin via CID; anchor
 *     the CID hash only).
 *   - Synchronous on-chain writes per agent action (would burn gas + add
 *     latency to every turn). Anchoring batches in v0.6.0.
 */

/** A record anchored to the ledger. Carries hash + minimal provenance. */
export interface AnchorRecord {
  /** Hash of the artifact being anchored (sha256 of the canonical content
   *  the caller cares about — episodic record, dataset, adapter, etc.). */
  hash: string;
  /** Owner entity that produced/owns the artifact (e.g. "#E0", "$A0"). */
  owner: string;
  /** ISO 8601 UTC timestamp at which the anchor was created. */
  timestamp: string;
  /** Where the artifact came from + which model produced it (when applicable). */
  provenance: {
    source: string;
    modelVersion?: string;
  };
  /** Optional eval score snapshot — used for adapter promotion anchors. 0..1. */
  evalScore?: number;
  /** Optional governance approval — used when an adapter promotion required
   *  human/DAO approval before adoption. */
  governanceApproval?: {
    approver: string;
    signedAt: string;
  };
}

/**
 * Result of an `anchor()` call. The `txHash` field is meaningful for live
 * implementations (the on-chain transaction hash) but is a deterministic
 * sentinel for NoopAnchor (`noop:<sha256-of-record-json>`). Callers can use
 * `txHash` as a stable id for the anchored record without caring whether
 * the underlying anchor is real or noop.
 */
export interface AnchorResult {
  txHash: string;
  /** Set when the anchor implementation also persisted the artifact to
   *  decentralized storage (IPFS/Filecoin). Live impl returns the CID;
   *  noop omits. */
  cid?: string;
}

/**
 * The interface every anchor implementation conforms to. Callers depend
 * on this, not on the concrete impl. v0.4.0 ships NoopAnchor; v0.6.0
 * adds the live Ethereum/L2 anchor (s113) — same shape, no caller change.
 */
export interface BlockchainAnchor {
  /**
   * Persist an anchor record. Returns synchronously when the record is
   * accepted (NoopAnchor: written to local jsonl; live impl: tx submitted
   * to mempool, hash returned). Live impls may have async confirmation
   * semantics layered on top — the returned `txHash` is the handle for
   * tracking confirmation.
   */
  anchor(record: AnchorRecord): Promise<AnchorResult>;

  /**
   * Look up a record by its content hash. Returns the original record when
   * the hash exists in this anchor's ledger; returns `{exists: false}`
   * otherwise. Used by audit verifiers + cross-instance trust checks.
   */
  verify(hash: string): Promise<{ exists: boolean; record?: AnchorRecord }>;

  /**
   * List all records anchored by a given owner. Bounded by `limit` (default
   * 100). Sorted newest-first. Used by dashboards + the per-entity ledger
   * surface (s117 7B).
   */
  listByOwner(owner: string, limit?: number): Promise<AnchorRecord[]>;
}
