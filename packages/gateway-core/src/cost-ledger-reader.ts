/**
 * CostLedgerReader — aggregation queries for the Providers UX cost ticker
 * + Mission Control hero narrative enrichment (s111 t423).
 *
 * Three query surfaces:
 *   - today(): rollups since 00:00 local — drives the Today tile
 *   - week(): rollups for the trailing 7 days — drives the This week tile
 *   - recent(limit): newest-last array of cost records — drives the Mission
 *     Control hero narrative ("consumed X.XW for Y.Ys ($Z.ZZ via Anthropic)")
 *
 * Energy is computed inline from watts × turn duration:
 *   Wh = (cpuWattsObserved + gpuWattsObserved) * turnDurationMs / 3_600_000
 * Null watt readings are skipped — the schema's NULL semantics propagate
 * through SUM() correctly (Postgres SUM ignores nulls). On hosts where
 * the samplers always return null, the energy total stays 0 honestly.
 *
 * The reader is read-only; the WriterClass (cost-ledger-writer.ts) owns
 * inserts. Tests mock AnyDb to assert query shapes without a live DB.
 */

import { and, desc, gte, sql } from "drizzle-orm";
import type { AnyDb } from "@agi/db-schema/client";
import { costRecords } from "@agi/db-schema";

/** Per-Provider breakdown returned alongside aggregate rollups. */
export interface ProviderRollup {
  provider: string;
  turns: number;
  dollarCost: number;
  inputTokens: number;
  outputTokens: number;
}

/** Aggregate rollup over a time window. */
export interface CostRollup {
  /** Total turns in the window. */
  turns: number;
  /** Total USD spent (cloud Providers; locals contribute 0). */
  dollarCost: number;
  /** Total input + output tokens. */
  totalTokens: number;
  /** Estimated energy used (Wh) — computed from sampled watts × duration.
   *  Returns 0 when no turns reported watts (non-Linux host without RAPL,
   *  non-NVIDIA without nvidia-smi). */
  watts: number;
  /** Per-Provider breakdown — the ticker uses this for "98% local · 2% cloud"
   *  and similar share computations. */
  byProvider: ProviderRollup[];
}

/** Single record returned by recent() — wire-shape mirror of cost_records. */
export interface CostLedgerEntryRecord {
  id: string;
  ts: string;
  entityId: string | null;
  provider: string;
  model: string;
  costMode: string;
  complexity: string;
  inputTokens: number;
  outputTokens: number;
  cpuWattsObserved: number | null;
  gpuWattsObserved: number | null;
  dollarCost: number | null;
  escalated: boolean;
  turnDurationMs: number;
  routingReason: string;
}

export class CostLedgerReader {
  constructor(private readonly db: AnyDb) {}

  /** Rollups since 00:00 of the local day. */
  async today(): Promise<CostRollup> {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return this.rollupSince(start);
  }

  /** Rollups for the trailing 7 days (168 hours back from now). */
  async week(): Promise<CostRollup> {
    const start = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    return this.rollupSince(start);
  }

  /** Newest-last array of recent records, capped at `limit` (default 20). */
  async recent(limit = 20): Promise<CostLedgerEntryRecord[]> {
    const rows = await this.db
      .select()
      .from(costRecords)
      .orderBy(desc(costRecords.ts))
      .limit(Math.max(1, Math.min(200, limit)));
    return rows.map(rowToWireShape).reverse();
  }

  private async rollupSince(start: Date): Promise<CostRollup> {
    // Aggregate query: COUNT(*), SUM(dollar_cost), SUM(tokens), SUM(Wh).
    // The Wh expression skips null watt rows automatically because Postgres
    // ignores NULL in arithmetic (NULL + n = NULL → not summed).
    const aggregate = await this.db
      .select({
        turns: sql<number>`count(*)::int`,
        dollarCost: sql<number>`coalesce(sum(${costRecords.dollarCost}), 0)::float`,
        totalTokens: sql<number>`coalesce(sum(${costRecords.inputTokens} + ${costRecords.outputTokens}), 0)::int`,
        watts: sql<number>`coalesce(sum(
          (coalesce(${costRecords.cpuWattsObserved}, 0) + coalesce(${costRecords.gpuWattsObserved}, 0))
          * ${costRecords.turnDurationMs} / 3600000.0
        ), 0)::float`,
      })
      .from(costRecords)
      .where(gte(costRecords.ts, start));

    const byProviderRows = await this.db
      .select({
        provider: costRecords.provider,
        turns: sql<number>`count(*)::int`,
        dollarCost: sql<number>`coalesce(sum(${costRecords.dollarCost}), 0)::float`,
        inputTokens: sql<number>`coalesce(sum(${costRecords.inputTokens}), 0)::int`,
        outputTokens: sql<number>`coalesce(sum(${costRecords.outputTokens}), 0)::int`,
      })
      .from(costRecords)
      .where(gte(costRecords.ts, start))
      .groupBy(costRecords.provider);

    const agg = aggregate[0] ?? { turns: 0, dollarCost: 0, totalTokens: 0, watts: 0 };
    return {
      turns: agg.turns,
      dollarCost: agg.dollarCost,
      totalTokens: agg.totalTokens,
      watts: Math.round(agg.watts * 1000) / 1000,
      byProvider: byProviderRows.map((r) => ({
        provider: r.provider,
        turns: r.turns,
        dollarCost: r.dollarCost,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
      })),
    };
  }
}

/** Convert a drizzle select row to the wire shape (Date → ISO string). */
function rowToWireShape(row: typeof costRecords.$inferSelect): CostLedgerEntryRecord {
  return {
    id: row.id,
    ts: (row.ts instanceof Date ? row.ts : new Date(row.ts)).toISOString(),
    entityId: row.entityId,
    provider: row.provider,
    model: row.model,
    costMode: row.costMode,
    complexity: row.complexity,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cpuWattsObserved: row.cpuWattsObserved,
    gpuWattsObserved: row.gpuWattsObserved,
    dollarCost: row.dollarCost,
    escalated: row.escalated,
    turnDurationMs: row.turnDurationMs,
    routingReason: row.routingReason,
  };
}

// Suppress unused import — `and` is reserved for future per-Provider filtering
// (e.g. today-by-Provider when the UX needs deeper drill-down). Kept to
// signal intent and avoid an import-shuffle when the next slice adds it.
void and;
