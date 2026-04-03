import type BetterSqlite3 from "better-sqlite3";
import { ulid } from "ulid";

import type { Database } from "./db.js";

// ---------------------------------------------------------------------------
// 0SCALE value mapping — VALUE[0BOOL] precision factors
// ---------------------------------------------------------------------------

/** Maps each 0BOOL label to its VALUE precision factor. */
export const BOOL_VALUES = {
  "0FALSE": -1.0,
  FALSE: -0.5,
  "0-": -0.25,
  NEUTRAL: 0,
  "0+": 0.25,
  TRUE: 0.5,
  "0TRUE": 1.0,
} as const;

/** A valid 0BOOL classification label. */
export type BoolLabel = keyof typeof BOOL_VALUES;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RecordImpactParams {
  entityId: string;
  coaFingerprint: string;
  channel?: string;
  workType?: string;
  /** Quantity of interactions — typically 1 per event. */
  quant: number;
  /** 0BOOL label used to derive VALUE in the $imp formula. */
  boolLabel: BoolLabel;
  /** 0BONUS additive modifier — defaults to 0. */
  bonus?: number;
  /** Origin node ID for federated impact interactions. */
  originNodeId?: string;
  /** Relay signature from the originating node. */
  relaySignature?: string;
}

export interface ImpactInteraction {
  id: string;
  entityId: string;
  coaFingerprint: string;
  channel: string | null;
  workType: string | null;
  quant: number;
  value0bool: number;
  bonus: number;
  impScore: number;
  createdAt: string;
  originNodeId: string | null;
  relaySignature: string | null;
}

// ---------------------------------------------------------------------------
// Named-parameter shapes for prepared statements
// ---------------------------------------------------------------------------

interface InsertInteractionParams {
  id: string;
  entity_id: string;
  coa_fingerprint: string;
  channel: string | null;
  work_type: string | null;
  quant: number;
  value_0bool: number;
  bonus: number;
  imp_score: number;
  created_at: string;
  origin_node_id: string | null;
  relay_signature: string | null;
}

interface EntityIdParam {
  entity_id: string;
}

interface BalanceSinceParams {
  entity_id: string;
  since: string;
}

interface PositiveBalanceSinceParams {
  entity_id: string;
  since: string;
}

interface HistoryParams {
  entity_id: string;
  limit: number;
  offset: number;
}

// ---------------------------------------------------------------------------
// Row type — snake_case as returned by better-sqlite3
// ---------------------------------------------------------------------------

interface ImpactInteractionRow {
  id: string;
  entity_id: string;
  coa_fingerprint: string;
  channel: string | null;
  work_type: string | null;
  quant: number;
  value_0bool: number;
  bonus: number;
  imp_score: number;
  created_at: string;
  origin_node_id: string | null;
  relay_signature: string | null;
}

// ---------------------------------------------------------------------------
// Row mapper
// ---------------------------------------------------------------------------

function rowToInteraction(row: ImpactInteractionRow): ImpactInteraction {
  return {
    id: row.id,
    entityId: row.entity_id,
    coaFingerprint: row.coa_fingerprint,
    channel: row.channel,
    workType: row.work_type,
    quant: row.quant,
    value0bool: row.value_0bool,
    bonus: row.bonus,
    impScore: row.imp_score,
    createdAt: row.created_at,
    originNodeId: row.origin_node_id,
    relaySignature: row.relay_signature,
  };
}

// ---------------------------------------------------------------------------
// ImpactRecorder
// ---------------------------------------------------------------------------

/**
 * Records and queries impact interactions using the 0SCALE formula:
 *
 * ```
 * $imp = QUANT × VALUE[0BOOL] × (1 + 0BONUS)
 * ```
 *
 * Interactions are forward-only — there are no UPDATE or DELETE methods.
 * Pass the `Database` handle returned by `createDatabase()`.
 *
 * @example
 * const db = createDatabase("/var/data/aionima.db");
 * const recorder = new ImpactRecorder(db);
 * const interaction = recorder.record({
 *   entityId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
 *   coaFingerprint: "$A0.#E0.@A0.C001",
 *   quant: 1,
 *   boolLabel: "TRUE",
 * });
 */
export class ImpactRecorder {
  private readonly stmtInsert: BetterSqlite3.Statement<[InsertInteractionParams]>;
  private readonly stmtGetHistory: BetterSqlite3.Statement<[HistoryParams], ImpactInteractionRow>;
  private readonly stmtGetBalance: BetterSqlite3.Statement<[EntityIdParam], { balance: number }>;
  private readonly stmtGetBalanceSince: BetterSqlite3.Statement<[BalanceSinceParams], { balance: number }>;
  private readonly stmtGetPositiveBalanceSince: BetterSqlite3.Statement<[PositiveBalanceSinceParams], { balance: number }>;
  private readonly stmtGetDistinctEventCount: BetterSqlite3.Statement<[EntityIdParam], { event_count: number }>;

  constructor(db: Database) {
    this.stmtInsert = db.prepare<[InsertInteractionParams]>(`
      INSERT INTO impact_interactions (
        id,
        entity_id,
        coa_fingerprint,
        channel,
        work_type,
        quant,
        value_0bool,
        bonus,
        imp_score,
        created_at,
        origin_node_id,
        relay_signature
      ) VALUES (
        @id,
        @entity_id,
        @coa_fingerprint,
        @channel,
        @work_type,
        @quant,
        @value_0bool,
        @bonus,
        @imp_score,
        @created_at,
        @origin_node_id,
        @relay_signature
      )
    `);

    this.stmtGetHistory = db.prepare<[HistoryParams], ImpactInteractionRow>(`
      SELECT
        id,
        entity_id,
        coa_fingerprint,
        channel,
        work_type,
        quant,
        value_0bool,
        bonus,
        imp_score,
        created_at,
        origin_node_id,
        relay_signature
      FROM impact_interactions
      WHERE entity_id = @entity_id
      ORDER BY created_at DESC
      LIMIT @limit OFFSET @offset
    `);

    this.stmtGetBalance = db.prepare<[EntityIdParam], { balance: number }>(`
      SELECT COALESCE(SUM(imp_score), 0) AS balance
      FROM impact_interactions
      WHERE entity_id = @entity_id
    `);

    this.stmtGetBalanceSince = db.prepare<[BalanceSinceParams], { balance: number }>(`
      SELECT COALESCE(SUM(imp_score), 0) AS balance
      FROM impact_interactions
      WHERE entity_id = @entity_id AND created_at >= @since
    `);

    this.stmtGetPositiveBalanceSince = db.prepare<[PositiveBalanceSinceParams], { balance: number }>(`
      SELECT COALESCE(SUM(imp_score), 0) AS balance
      FROM impact_interactions
      WHERE entity_id = @entity_id AND created_at >= @since AND imp_score > 0
    `);

    this.stmtGetDistinctEventCount = db.prepare<[EntityIdParam], { event_count: number }>(`
      SELECT COUNT(DISTINCT work_type) AS event_count
      FROM impact_interactions
      WHERE entity_id = @entity_id
    `);
  }

  // ---------------------------------------------------------------------------
  // Write operations
  // ---------------------------------------------------------------------------

  /**
   * Record an impact interaction and persist the calculated $imp score.
   *
   * The score is derived from the 0SCALE formula:
   * `$imp = quant × VALUE[boolLabel] × (1 + bonus)`
   *
   * @returns The newly created `ImpactInteraction` with the computed score.
   */
  record(params: RecordImpactParams): ImpactInteraction {
    const bonus = params.bonus ?? 0;
    const value0bool = BOOL_VALUES[params.boolLabel];
    const impScore = params.quant * value0bool * (1 + bonus);
    const id = ulid();
    const createdAt = new Date().toISOString();

    this.stmtInsert.run({
      id,
      entity_id: params.entityId,
      coa_fingerprint: params.coaFingerprint,
      channel: params.channel ?? null,
      work_type: params.workType ?? null,
      quant: params.quant,
      value_0bool: value0bool,
      bonus,
      imp_score: impScore,
      created_at: createdAt,
      origin_node_id: params.originNodeId ?? null,
      relay_signature: params.relaySignature ?? null,
    });

    return {
      id,
      entityId: params.entityId,
      coaFingerprint: params.coaFingerprint,
      channel: params.channel ?? null,
      workType: params.workType ?? null,
      quant: params.quant,
      value0bool,
      bonus,
      impScore,
      createdAt,
      originNodeId: params.originNodeId ?? null,
      relaySignature: params.relaySignature ?? null,
    };
  }

  // ---------------------------------------------------------------------------
  // Read operations
  // ---------------------------------------------------------------------------

  /**
   * Get the total $imp balance for an entity across all recorded interactions.
   * Returns 0 if the entity has no interactions.
   */
  getBalance(entityId: string): number {
    const row = this.stmtGetBalance.get({ entity_id: entityId });
    return row ? row.balance : 0;
  }

  /**
   * Get the total $imp balance for an entity since a given ISO-8601 timestamp.
   * Useful for tier calculations over a rolling time window.
   * Returns 0 if there are no interactions in the window.
   *
   * @param since - ISO-8601 datetime string (inclusive lower bound).
   */
  getBalanceSince(entityId: string, since: string): number {
    const row = this.stmtGetBalanceSince.get({ entity_id: entityId, since });
    return row ? row.balance : 0;
  }

  /**
   * Get the sum of POSITIVE $imp scores for an entity since a given timestamp.
   * Used for 0BONUS calculation (only positive scores contribute).
   * Returns 0 if there are no positive interactions in the window.
   *
   * @param since - ISO-8601 datetime string (inclusive lower bound).
   * @see docs/governance/impact-scoring-rules.md §6.2
   */
  getPositiveBalanceSince(entityId: string, since: string): number {
    const row = this.stmtGetPositiveBalanceSince.get({ entity_id: entityId, since });
    return row ? row.balance : 0;
  }

  /**
   * Count distinct work types recorded for an entity.
   * Used for impact tier threshold calculations.
   */
  getDistinctEventCount(entityId: string): number {
    const row = this.stmtGetDistinctEventCount.get({ entity_id: entityId });
    return row ? row.event_count : 0;
  }

  /**
   * Get the impact history for an entity, ordered by most recent first.
   * Defaults: limit 100, offset 0.
   */
  getHistory(
    entityId: string,
    opts?: { limit?: number; offset?: number },
  ): ImpactInteraction[] {
    const limit = opts?.limit ?? 100;
    const offset = opts?.offset ?? 0;
    const rows = this.stmtGetHistory.all({ entity_id: entityId, limit, offset });
    return rows.map(rowToInteraction);
  }
}
