/**
 * ImpactRecorder — records and queries impact interactions (drizzle/Postgres).
 *
 * Records quantified impact contributions using the 0SCALE formula:
 *   $imp = QUANT × VALUE[0BOOL] × (1 + 0BONUS)
 */

import { and, eq, gte, sql } from "drizzle-orm";
import { ulid } from "ulid";
import type { Db } from "@agi/db-schema/client";
import { impactInteractions } from "@agi/db-schema";

// ---------------------------------------------------------------------------
// 0SCALE value mapping
// ---------------------------------------------------------------------------

export const BOOL_VALUES = {
  "0FALSE": -1.0,
  FALSE: -0.5,
  "0-": -0.25,
  NEUTRAL: 0,
  "0+": 0.25,
  TRUE: 0.5,
  "0TRUE": 1.0,
} as const;

export type BoolLabel = keyof typeof BOOL_VALUES;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RecordImpactParams {
  entityId: string;
  coaFingerprint: string;
  channel?: string;
  workType?: string;
  quant: number;
  boolLabel: BoolLabel;
  bonus?: number;
  originNodeId?: string;
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
// Row mapper
// ---------------------------------------------------------------------------

function rowToInteraction(row: typeof impactInteractions.$inferSelect): ImpactInteraction {
  return {
    id: row.id,
    entityId: row.entityId,
    coaFingerprint: row.coaFingerprint,
    channel: row.channel ?? null,
    workType: row.workType ?? null,
    quant: row.quant,
    value0bool: row.value0bool,
    bonus: row.bonus,
    impScore: row.impScore,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    originNodeId: row.originNodeId ?? null,
    relaySignature: row.relaySignature ?? null,
  };
}

// ---------------------------------------------------------------------------
// ImpactRecorder
// ---------------------------------------------------------------------------

export class ImpactRecorder {
  constructor(private readonly db: Db) {}

  async record(params: RecordImpactParams): Promise<ImpactInteraction> {
    const bonus = params.bonus ?? 0;
    const value0bool = BOOL_VALUES[params.boolLabel];
    const impScore = params.quant * value0bool * (1 + bonus);
    const id = ulid();
    const now = new Date();

    await this.db.insert(impactInteractions).values({
      id,
      entityId: params.entityId,
      coaFingerprint: params.coaFingerprint,
      channel: params.channel ?? null,
      workType: params.workType ?? null,
      quant: params.quant,
      value0bool: value0bool,
      bonus,
      impScore,
      originNodeId: params.originNodeId ?? null,
      relaySignature: params.relaySignature ?? null,
      createdAt: now,
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
      createdAt: now.toISOString(),
      originNodeId: params.originNodeId ?? null,
      relaySignature: params.relaySignature ?? null,
    };
  }

  async getBalance(entityId: string): Promise<number> {
    const [row] = await this.db
      .select({ balance: sql<number>`COALESCE(SUM(${impactInteractions.impScore}), 0)` })
      .from(impactInteractions)
      .where(eq(impactInteractions.entityId, entityId));
    return row?.balance ?? 0;
  }

  async getBalanceSince(entityId: string, since: string): Promise<number> {
    const [row] = await this.db
      .select({ balance: sql<number>`COALESCE(SUM(${impactInteractions.impScore}), 0)` })
      .from(impactInteractions)
      .where(and(eq(impactInteractions.entityId, entityId), gte(impactInteractions.createdAt, new Date(since))));
    return row?.balance ?? 0;
  }

  async getPositiveBalanceSince(entityId: string, since: string): Promise<number> {
    const [row] = await this.db
      .select({ balance: sql<number>`COALESCE(SUM(${impactInteractions.impScore}), 0)` })
      .from(impactInteractions)
      .where(
        and(
          eq(impactInteractions.entityId, entityId),
          gte(impactInteractions.createdAt, new Date(since)),
          sql`${impactInteractions.impScore} > 0`,
        ),
      );
    return row?.balance ?? 0;
  }

  async getDistinctEventCount(entityId: string): Promise<number> {
    const [row] = await this.db
      .select({ cnt: sql<number>`COUNT(DISTINCT ${impactInteractions.workType})` })
      .from(impactInteractions)
      .where(eq(impactInteractions.entityId, entityId));
    return row?.cnt ?? 0;
  }

  async getHistory(
    entityId: string,
    opts?: { limit?: number; offset?: number },
  ): Promise<ImpactInteraction[]> {
    const limit = opts?.limit ?? 100;
    const offset = opts?.offset ?? 0;

    const rows = await this.db
      .select()
      .from(impactInteractions)
      .where(eq(impactInteractions.entityId, entityId))
      .orderBy(sql`${impactInteractions.createdAt} DESC`)
      .limit(limit)
      .offset(offset);

    return rows.map(rowToInteraction);
  }
}
