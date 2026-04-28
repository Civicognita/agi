/**
 * UsageStore — LLM token usage and cost tracking per invocation (drizzle/Postgres).
 *
 * Persists token counts, estimated USD cost, and project attribution
 * for every completed agent invocation. Enables True Cost per project.
 */

import { and, eq, gte, sql } from "drizzle-orm";
import { ulid } from "ulid";
import type { Db } from "@agi/db-schema/client";
import { usageLog, providerBalanceLog } from "@agi/db-schema";
import { estimateCost } from "./model-pricing.js";
export { estimateCost };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UsageRecord {
  id: string;
  entityId: string;
  projectPath: string | null;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  coaFingerprint: string | null;
  toolCount: number;
  loopCount: number;
  createdAt: string;
  source: "chat" | "worker";
}

export interface RecordUsageParams {
  entityId: string;
  projectPath?: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  coaFingerprint?: string;
  toolCount?: number;
  loopCount?: number;
  source?: "chat" | "worker";
  costMode?: string;
  escalated?: boolean;
  originalModel?: string;
}

export interface UsageSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  invocationCount: number;
}

export interface ProjectCost {
  projectPath: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  invocationCount: number;
}

export interface ProjectSourceCost {
  projectPath: string;
  source: "chat" | "worker";
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  invocationCount: number;
}

// ---------------------------------------------------------------------------
// UsageStore
// ---------------------------------------------------------------------------

export class UsageStore {
  constructor(private readonly db: Db) {}

  async recordBalance(provider: string, balanceUsd: number): Promise<void> {
    const id = ulid();
    const now = new Date();
    await this.db.insert(providerBalanceLog).values({
      id,
      provider,
      balanceUsd,
      recordedAt: now,
    });
  }

  async getBalanceHistory(provider: string, days = 7): Promise<Array<{ balance: number; recordedAt: string }>> {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const rows = await this.db
      .select({ balance: providerBalanceLog.balanceUsd, recordedAt: providerBalanceLog.recordedAt })
      .from(providerBalanceLog)
      .where(and(eq(providerBalanceLog.provider, provider), gte(providerBalanceLog.recordedAt, cutoff)))
      .orderBy(providerBalanceLog.recordedAt);

    return rows.map((r) => ({
      balance: r.balance,
      recordedAt: r.recordedAt instanceof Date ? r.recordedAt.toISOString() : String(r.recordedAt),
    }));
  }

  async record(params: RecordUsageParams): Promise<UsageRecord> {
    const id = ulid();
    const now = new Date();
    const costUsd = estimateCost(params.model, params.inputTokens, params.outputTokens);
    const source = params.source ?? "chat";

    await this.db.insert(usageLog).values({
      id,
      entityId: params.entityId,
      projectPath: params.projectPath ?? null,
      provider: params.provider,
      model: params.model,
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
      costUsd,
      coaFingerprint: params.coaFingerprint ?? null,
      toolCount: params.toolCount ?? 0,
      loopCount: params.loopCount ?? 0,
      source,
      costMode: params.costMode ?? "balanced",
      escalated: params.escalated ?? false,
      originalModel: params.originalModel ?? null,
      createdAt: now,
    });

    return {
      id,
      entityId: params.entityId,
      projectPath: params.projectPath ?? null,
      provider: params.provider,
      model: params.model,
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
      costUsd,
      coaFingerprint: params.coaFingerprint ?? null,
      toolCount: params.toolCount ?? 0,
      loopCount: params.loopCount ?? 0,
      createdAt: now.toISOString(),
      source,
    };
  }

  async getSummary(days = 30): Promise<UsageSummary> {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const [row] = await this.db
      .select({
        input: sql<number>`COALESCE(SUM(${usageLog.inputTokens}), 0)`,
        output: sql<number>`COALESCE(SUM(${usageLog.outputTokens}), 0)`,
        cost: sql<number>`COALESCE(SUM(${usageLog.costUsd}), 0)`,
        cnt: sql<number>`COUNT(*)`,
      })
      .from(usageLog)
      .where(gte(usageLog.createdAt, cutoff));

    return {
      totalInputTokens: row?.input ?? 0,
      totalOutputTokens: row?.output ?? 0,
      totalCostUsd: Math.round((row?.cost ?? 0) * 10000) / 10000,
      invocationCount: row?.cnt ?? 0,
    };
  }

  async getByProject(days = 30): Promise<ProjectCost[]> {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const rows = await this.db
      .select({
        projectPath: usageLog.projectPath,
        input: sql<number>`SUM(${usageLog.inputTokens})`,
        output: sql<number>`SUM(${usageLog.outputTokens})`,
        cost: sql<number>`SUM(${usageLog.costUsd})`,
        cnt: sql<number>`COUNT(*)`,
      })
      .from(usageLog)
      .where(and(gte(usageLog.createdAt, cutoff), sql`${usageLog.projectPath} IS NOT NULL`))
      .groupBy(usageLog.projectPath)
      .orderBy(sql`SUM(${usageLog.costUsd}) DESC`);

    return rows.map((r) => ({
      projectPath: r.projectPath ?? "",
      inputTokens: r.input ?? 0,
      outputTokens: r.output ?? 0,
      costUsd: Math.round((r.cost ?? 0) * 10000) / 10000,
      invocationCount: r.cnt ?? 0,
    }));
  }

  async getByProjectAndSource(days = 30): Promise<ProjectSourceCost[]> {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const rows = await this.db
      .select({
        projectPath: usageLog.projectPath,
        source: usageLog.source,
        input: sql<number>`SUM(${usageLog.inputTokens})`,
        output: sql<number>`SUM(${usageLog.outputTokens})`,
        cost: sql<number>`SUM(${usageLog.costUsd})`,
        cnt: sql<number>`COUNT(*)`,
      })
      .from(usageLog)
      .where(and(gte(usageLog.createdAt, cutoff), sql`${usageLog.projectPath} IS NOT NULL`))
      .groupBy(usageLog.projectPath, usageLog.source)
      .orderBy(sql`SUM(${usageLog.costUsd}) DESC`);

    return rows.map((r) => ({
      projectPath: r.projectPath ?? "",
      source: (r.source === "worker" ? "worker" : "chat") as "chat" | "worker",
      inputTokens: r.input ?? 0,
      outputTokens: r.output ?? 0,
      costUsd: Math.round((r.cost ?? 0) * 10000) / 10000,
      invocationCount: r.cnt ?? 0,
    }));
  }

  async getHistory(days = 30, bucket: "hour" | "day" = "day"): Promise<Array<{
    period: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    count: number;
  }>> {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    // PostgreSQL's date_trunc expects a literal text first arg. Branch at
    // compile time on the validated bucket so the SQL has a literal.
    //
    // GROUP BY uses ordinal position (`GROUP BY 1`) instead of repeating the
    // expression, because drizzle 0.45 inlines bound parameters differently
    // between SELECT and GROUP BY clauses — the textual non-match makes
    // PostgreSQL reject the bucketed `created_at` as if it weren't grouped.
    // Position-based grouping bypasses the textual-match requirement entirely.
    const bucketSql = bucket === "hour"
      ? sql<Date>`date_trunc('hour', ${usageLog.createdAt})`
      : sql<Date>`date_trunc('day', ${usageLog.createdAt})`;

    const rows = await this.db
      .select({
        period: bucketSql,
        input: sql<number>`SUM(${usageLog.inputTokens})`,
        output: sql<number>`SUM(${usageLog.outputTokens})`,
        cost: sql<number>`SUM(${usageLog.costUsd})`,
        cnt: sql<number>`COUNT(*)`,
      })
      .from(usageLog)
      .where(gte(usageLog.createdAt, cutoff))
      .groupBy(sql`1`)
      .orderBy(sql`1`);

    return rows.map((r) => ({
      period: r.period instanceof Date ? r.period.toISOString() : String(r.period ?? ""),
      inputTokens: r.input ?? 0,
      outputTokens: r.output ?? 0,
      costUsd: Math.round((r.cost ?? 0) * 10000) / 10000,
      count: r.cnt ?? 0,
    }));
  }

  async getByProvider(days = 30): Promise<Array<{ provider: string; inputTokens: number; outputTokens: number; costUsd: number; invocationCount: number }>> {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const rows = await this.db
      .select({
        provider: usageLog.provider,
        input: sql<number>`SUM(${usageLog.inputTokens})`,
        output: sql<number>`SUM(${usageLog.outputTokens})`,
        cost: sql<number>`SUM(${usageLog.costUsd})`,
        cnt: sql<number>`COUNT(*)`,
      })
      .from(usageLog)
      .where(gte(usageLog.createdAt, cutoff))
      .groupBy(usageLog.provider)
      .orderBy(sql`SUM(${usageLog.costUsd}) DESC`);

    return rows.map((r) => ({
      provider: r.provider,
      inputTokens: r.input ?? 0,
      outputTokens: r.output ?? 0,
      costUsd: Math.round((r.cost ?? 0) * 10000) / 10000,
      invocationCount: r.cnt ?? 0,
    }));
  }

  async getByModel(days = 30): Promise<Array<{ model: string; provider: string; inputTokens: number; outputTokens: number; costUsd: number; invocationCount: number }>> {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const rows = await this.db
      .select({
        model: usageLog.model,
        provider: usageLog.provider,
        input: sql<number>`SUM(${usageLog.inputTokens})`,
        output: sql<number>`SUM(${usageLog.outputTokens})`,
        cost: sql<number>`SUM(${usageLog.costUsd})`,
        cnt: sql<number>`COUNT(*)`,
      })
      .from(usageLog)
      .where(gte(usageLog.createdAt, cutoff))
      .groupBy(usageLog.model, usageLog.provider)
      .orderBy(sql`SUM(${usageLog.costUsd}) DESC`);

    return rows.map((r) => ({
      model: r.model,
      provider: r.provider,
      inputTokens: r.input ?? 0,
      outputTokens: r.output ?? 0,
      costUsd: Math.round((r.cost ?? 0) * 10000) / 10000,
      invocationCount: r.cnt ?? 0,
    }));
  }

  async getByCostMode(days = 30): Promise<Array<{ costMode: string; inputTokens: number; outputTokens: number; costUsd: number; invocationCount: number }>> {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const rows = await this.db
      .select({
        costMode: usageLog.costMode,
        input: sql<number>`SUM(${usageLog.inputTokens})`,
        output: sql<number>`SUM(${usageLog.outputTokens})`,
        cost: sql<number>`SUM(${usageLog.costUsd})`,
        cnt: sql<number>`COUNT(*)`,
      })
      .from(usageLog)
      .where(gte(usageLog.createdAt, cutoff))
      .groupBy(usageLog.costMode)
      .orderBy(sql`SUM(${usageLog.costUsd}) DESC`);

    return rows.map((r) => ({
      costMode: r.costMode ?? "balanced",
      inputTokens: r.input ?? 0,
      outputTokens: r.output ?? 0,
      costUsd: Math.round((r.cost ?? 0) * 10000) / 10000,
      invocationCount: r.cnt ?? 0,
    }));
  }

  async getEscalationRate(days = 30): Promise<{ total: number; escalated: number; rate: number }> {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const [row] = await this.db
      .select({
        total: sql<number>`COUNT(*)`,
        escalated: sql<number>`SUM(CASE WHEN ${usageLog.escalated} = TRUE THEN 1 ELSE 0 END)`,
      })
      .from(usageLog)
      .where(gte(usageLog.createdAt, cutoff));

    const total = row?.total ?? 0;
    const escalated = row?.escalated ?? 0;
    return { total, escalated, rate: total > 0 ? escalated / total : 0 };
  }
}
