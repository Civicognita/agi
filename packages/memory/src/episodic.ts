/**
 * Layer A + B memory schema (s112 t381) — schema-first slice.
 *
 * Per `_discovery/aion-blockchain-memory-draft-a.md`:
 *   Layer A — Working memory  (in-process; current task state)
 *   Layer B — Episodic memory (persisted with hash + confidence + provenance)
 *
 * This slice ships ONLY the type contracts + a canonical-hash helper +
 * a bridge to the AnchorRecord shape from `@agi/sdk` (Layer D, NoopAnchor
 * in v0.4.0 / live blockchain in v0.6.0). Storage migration (replacing
 * the flat `MemoryEntry` shape in agent-invoker.ts:540 with this richer
 * shape, plus the agi_data Postgres table updates) lands as a follow-up
 * slice under the same task — schema-first lets G4 (episode scoring)
 * + s117 (TrueCost integration) consume the type now without waiting on
 * the migration.
 *
 * Why a new file (not extending types.ts):
 *   - `MemoryEntry` is the legacy flat schema. Existing code consumes it
 *     directly. Mixing the new richer shape into the same file invites
 *     callers to grab the wrong type.
 *   - Episodic memory is conceptually distinct: every record carries a
 *     `coaFingerprint` tying it to the COA<>COI chain + a `primeAlignment`
 *     score (s112 G2 will populate this against PRIME). That's not what
 *     `MemoryEntry` captures.
 *   - Storage layer migration in slice 2 will eventually decide whether
 *     to merge the schemas or keep them separate. For now: separate.
 */

import { createHash } from "node:crypto";
import type { AnchorRecord } from "@agi/sdk";

/**
 * Layer A — Working memory. In-process state for the current task.
 * Lives on the AgentSession; not persisted between turns. The shape is
 * captured here so future code that hands working-memory snapshots
 * across module boundaries (e.g. for the prompt-inspector or for
 * Aion's "what am I doing right now" introspection) has a stable type
 * to consume.
 */
export interface WorkingMemory {
  /** What the agent is currently trying to accomplish. */
  currentGoals: string[];
  /** Documents / files the agent has loaded into context this turn. */
  activeDocuments: string[];
  /** The chain of operations the agent has executed in this turn so far. */
  operationChain: string[];
  /** Ad-hoc assumptions the agent is operating under. */
  temporaryAssumptions: string[];
  /** Snapshot timestamp — when this working-memory state was captured. */
  capturedAt: string;
}

/**
 * Layer B — Episodic memory record. One summarized event in the agent's
 * history. Every record carries the cryptographic + provenance metadata
 * needed for:
 *   - Deduplication (same event hashed identically → same record)
 *   - Anchor-able provenance (s113 / NoopAnchor → live BlockchainAnchor)
 *   - PRIME-alignment scoring (s112 G4 will populate `primeAlignment`)
 *   - COA<>COI traceability (every action → fingerprint → entity chain)
 *
 * The shape is per draft-a §"Layer B: Episodic memory" extended with
 * `primeAlignment` per the corrected ADF framing (memory feedback_adf_
 * is_full_framework_with_intelligence_protocols).
 */
export interface EpisodicRecord {
  /** Unique record id. ULID format recommended (caller responsibility). */
  id: string;
  /** ISO 8601 UTC timestamp of the event being summarized. */
  timestamp: string;
  /** The entity that produced or owns this episode. */
  actor: {
    entityId: string;
    coaAlias: string; // e.g. "#E0", "$A0"
  };
  /** Human-readable one-paragraph digest of the episode. */
  summary: string;
  /** Tags for categorical retrieval (e.g. ["preference", "tool-use"]). */
  tags: string[];
  /** Optional embedding vector for similarity retrieval. Populated by an
   *  embedder plugin in v0.6.0 (s116); v0.4.0 leaves null. */
  embedding?: number[];
  /** Confidence the scorer assigned to this episode's usefulness +
   *  alignment + correctness. 0..1 inclusive. Higher = better for
   *  candidate-dataset admission (s112 G5). */
  confidence: number;
  /** PRIME-alignment score (s112 G2 prime-alignment-scorer). 0..1.
   *  Optional in v0.4.0 because G2 is blocked on PRIME schema realignment;
   *  populated when G2 lands. */
  primeAlignment?: number;
  /** Pointers to the source material — chat session ids, doc paths, tool
   *  call ids, etc. — that this episode summarizes. */
  sourceLinks: string[];
  /** Canonical content hash for dedup + anchor reference. Produced by
   *  `canonicalEpisodicHash(record)` (sha256 of canonical JSON). */
  hash: string;
  /** Ties this record to the COA<>COI chain. Carries the same fingerprint
   *  the agent-invoker logs on the originating action. */
  coaFingerprint: string;
  /** Which model version produced the source content this episode digests. */
  modelVersion?: string;
}

/**
 * Compute the canonical hash for an episodic record. Deterministic — the
 * same logical event always hashes to the same value, regardless of map
 * insertion order or whitespace differences. Used for:
 *   - Dedup before persistence (don't store the same event twice)
 *   - The `record.hash` field (computed once, embedded in the record)
 *   - Anchor reference (NoopAnchor uses this hash as the anchor identity)
 *
 * Excludes the `hash` field itself + ephemeral fields (`embedding`,
 * `primeAlignment`, `confidence`) so re-scoring an existing episode
 * doesn't change its identity. The hash is over the *event*, not the
 * scorer's opinion of the event.
 */
export function canonicalEpisodicHash(
  record: Omit<EpisodicRecord, "hash" | "embedding" | "primeAlignment" | "confidence"> & {
    embedding?: number[];
    primeAlignment?: number;
    confidence?: number;
  },
): string {
  // Build canonical content with keys in alphabetical insertion order. Modern
  // JS engines preserve insertion order for string keys, so JSON.stringify
  // emits them in the order we wrote them. We DON'T use the (obj, replacer)
  // array form because that filter applies recursively — passing
  // ["actor", ...] would drop actor.entityId + actor.coaAlias from the
  // serialized output (silent bug: two different actors hashed identically
  // until s112 t381's test caught it).
  const canonical = {
    actor: {
      coaAlias: record.actor.coaAlias,
      entityId: record.actor.entityId,
    },
    coaFingerprint: record.coaFingerprint,
    id: record.id,
    modelVersion: record.modelVersion ?? null,
    sourceLinks: [...record.sourceLinks].sort(),
    summary: record.summary,
    tags: [...record.tags].sort(),
    timestamp: record.timestamp,
  };
  const json = JSON.stringify(canonical);
  return "sha256:" + createHash("sha256").update(json).digest("hex");
}

/**
 * Bridge an EpisodicRecord (Layer B) to an AnchorRecord (Layer D — the
 * shape NoopAnchor.anchor() consumes). Convenient when persisting an
 * episode that should also be hash-anchored for later verification.
 *
 * The AnchorRecord uses the EpisodicRecord's `hash` as the anchor identity
 * — meaning a verify(hash) lookup against the anchor returns metadata about
 * the episode without disclosing its content (the content lives in Layer B
 * persistent storage; only the hash + provenance is anchored).
 *
 * Per draft-a's "treat blockchain memory as verifiable memory infrastructure,
 * not primary runtime memory" — this bridge keeps the content out of the
 * anchor, only the hash + provenance.
 */
export function episodicToAnchor(record: EpisodicRecord): AnchorRecord {
  return {
    hash: record.hash,
    owner: record.actor.entityId,
    timestamp: record.timestamp,
    provenance: {
      source: "episodic-memory",
      modelVersion: record.modelVersion,
    },
    // confidence is the scorer's signal for episode quality; treated here as
    // the eval-score so the anchor record carries enough to gate downstream
    // training-dataset admission (G5 reward gate).
    evalScore: record.confidence,
  };
}
