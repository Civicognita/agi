/**
 * CostLedgerWriter — fire-and-forget per-turn cost recording (s111 t422).
 *
 * Owns a single drizzle insert into `cost_records` per agent-router invoke.
 * Critical performance constraint: MUST NOT slow down chat turns. The writer
 * is fire-and-forget — record() returns immediately, the actual insert
 * happens in a microtask. Errors are logged via the structured logger but
 * never bubble back to the caller. A failed write loses one row's audit
 * trail; never breaks the user's chat experience.
 *
 * The writer pairs with cost-pricing.ts (computeDollarCost) — caller passes
 * the dollar cost in (or null for unknown), so this class doesn't need
 * pricing config. Same pattern for power: caller samples cpuWatts/gpuWatts
 * before calling record(), so the writer is purely a persistence layer.
 *
 * AgentRouter wiring (where invoke() calls record() at turn end) ships in
 * a separate cycle — this class is the persistence layer, the wiring
 * decides what to record and when.
 */

import { randomUUID } from "node:crypto";
import type { Db } from "@agi/db-schema/client";
import { costRecords } from "@agi/db-schema";
import type { ComponentLogger } from "./logger.js";

/** Caller-supplied fields for one turn. Matches the cost_records schema
 *  minus auto-generated id + ts; both are stamped at write time. */
export interface CostLedgerEntry {
  /** Owner-side entity that initiated the turn. May be null when no
   *  identity is attached (system jobs, internal turns). */
  entityId: string | null;
  provider: string;
  model: string;
  costMode: string;
  complexity: string;
  inputTokens: number;
  outputTokens: number;
  /** RAPL CPU watts at turn end (s111 t377). Null on hosts without RAPL. */
  cpuWattsObserved: number | null;
  /** NVIDIA GPU watts at turn end (s111 t417). Null on non-NVIDIA hosts. */
  gpuWattsObserved: number | null;
  /** Caller computes via cost-pricing.computeDollarCost. Null when the
   *  Provider/model isn't priced (unknown cost — better than $0 fabrication). */
  dollarCost: number | null;
  escalated: boolean;
  turnDurationMs: number;
  routingReason: string;
}

export class CostLedgerWriter {
  constructor(
    private readonly db: Db,
    private readonly log: ComponentLogger,
  ) {}

  /**
   * Record one turn. Returns immediately; the insert runs in a microtask
   * so the caller (AgentRouter.invoke) doesn't pay DB-write latency on
   * the user's chat turn. Inserts the entry with a fresh UUID + current
   * timestamp; downstream aggregation queries filter by ts.
   *
   * On insert failure, logs at warn level — never throws. A missing row
   * is a small audit-trail loss, not a user-facing failure. The writer
   * does NOT retry: ledger continuity matters less than chat reliability,
   * and a backed-up DB shouldn't compound failure into user-visible delay.
   */
  record(entry: CostLedgerEntry): void {
    void this.insertAsync(entry);
  }

  private async insertAsync(entry: CostLedgerEntry): Promise<void> {
    try {
      await this.db.insert(costRecords).values({
        id: randomUUID(),
        // ts column has defaultNow() so omitting it stamps server-side.
        entityId: entry.entityId,
        provider: entry.provider,
        model: entry.model,
        costMode: entry.costMode,
        complexity: entry.complexity,
        inputTokens: entry.inputTokens,
        outputTokens: entry.outputTokens,
        cpuWattsObserved: entry.cpuWattsObserved,
        gpuWattsObserved: entry.gpuWattsObserved,
        dollarCost: entry.dollarCost,
        escalated: entry.escalated,
        turnDurationMs: entry.turnDurationMs,
        routingReason: entry.routingReason,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.warn(`cost-ledger insert failed (provider=${entry.provider}, model=${entry.model}): ${msg}`);
    }
  }
}
