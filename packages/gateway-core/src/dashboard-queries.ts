/**
 * Dashboard Aggregation Queries — Task #154
 *
 * Efficient Postgres/drizzle aggregation queries for the impact dashboard.
 * Time-bucketed impact summaries, domain-grouped breakdowns,
 * leaderboard ranking, and COA chain exploration.
 *
 * All queries are read-only and async.
 */

import { and, asc, count, countDistinct, desc, eq, gte, isNotNull, lte, sql } from "drizzle-orm";
import type { AnyDb } from "@agi/db-schema/client";
import { coaChains, entities, impactInteractions } from "@agi/db-schema";

import type {
  ActivityEntry,
  BreakdownDimension,
  BreakdownSlice,
  COAExplorerEntry,
  COAExplorerParams,
  DashboardOverview,
  EntityImpactProfile,
  LeaderboardEntry,
  TimeBucket,
  TimelineBucket,
} from "./dashboard-types.js";

// ---------------------------------------------------------------------------
// Domain mapping (work_type → impactinomics domain)
// ---------------------------------------------------------------------------

const WORK_TYPE_DOMAIN_MAP: Record<string, string> = {
  message_in: "community",
  message_out: "community",
  tool_use: "technology",
  task_dispatch: "operations",
  verification: "governance",
  artifact: "knowledge",
  commit: "innovation",
  action: "operations",
  mapp_mint: "innovation",
  mapp_install: "operations",
  mapp_publish: "innovation",
  mapp_execute: "technology",
};

function workTypeToDomain(workType: string | null): string {
  if (workType === null) return "community";
  // Handle LLM-annotated work types like "message_in:llm:TRUE:0.8"
  const baseType = workType.split(":")[0] ?? workType;
  return WORK_TYPE_DOMAIN_MAP[baseType] ?? "community";
}

// ---------------------------------------------------------------------------
// SQL bucket expressions (Postgres date_trunc)
// ---------------------------------------------------------------------------

function bucketExpression(bucket: TimeBucket): ReturnType<typeof sql> {
  switch (bucket) {
    case "hour":
      return sql`date_trunc('hour', ${impactInteractions.createdAt})`;
    case "day":
      return sql`date_trunc('day', ${impactInteractions.createdAt})`;
    case "week":
      return sql`date_trunc('week', ${impactInteractions.createdAt})`;
    case "month":
      return sql`date_trunc('month', ${impactInteractions.createdAt})`;
  }
}

// ---------------------------------------------------------------------------
// DashboardQueries
// ---------------------------------------------------------------------------

export class DashboardQueries {
  constructor(private readonly db: AnyDb) {}

  // ---------------------------------------------------------------------------
  // Overview
  // ---------------------------------------------------------------------------

  async getOverview(windowDays = 90, recentLimit = 20): Promise<DashboardOverview> {
    // Total stats
    const [totalsRow] = await this.db
      .select({
        totalImp: sql<number>`COALESCE(SUM(${impactInteractions.impScore}), 0)`,
        interactionCount: count(impactInteractions.id),
        entityCount: countDistinct(impactInteractions.entityId),
      })
      .from(impactInteractions);

    const totalImp = totalsRow?.totalImp ?? 0;
    const interactionCount = totalsRow?.interactionCount ?? 0;
    const entityCount = totalsRow?.entityCount ?? 0;

    // Window stats
    const since = new Date(Date.now() - windowDays * 86_400_000);
    const [windowRow] = await this.db
      .select({
        windowImp: sql<number>`COALESCE(SUM(${impactInteractions.impScore}), 0)`,
      })
      .from(impactInteractions)
      .where(gte(impactInteractions.createdAt, since));

    const windowImp = windowRow?.windowImp ?? 0;

    // Top channel
    const [topChannelRow] = await this.db
      .select({
        channel: impactInteractions.channel,
        cnt: count(impactInteractions.id),
      })
      .from(impactInteractions)
      .where(isNotNull(impactInteractions.channel))
      .groupBy(impactInteractions.channel)
      .orderBy(desc(count(impactInteractions.id)))
      .limit(1);

    const topChannel = topChannelRow?.channel ?? null;

    // Recent activity
    const recentActivity = await this.getRecentActivity(recentLimit);

    return {
      totalImp,
      windowImp,
      entityCount,
      interactionCount,
      avgImpPerInteraction: interactionCount > 0 ? totalImp / interactionCount : 0,
      topChannel,
      recentActivity,
      computedAt: new Date().toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // Recent Activity
  // ---------------------------------------------------------------------------

  async getRecentActivity(limit = 20): Promise<ActivityEntry[]> {
    const rows = await this.db
      .select({
        id: impactInteractions.id,
        entityId: impactInteractions.entityId,
        displayName: sql<string>`COALESCE(${entities.displayName}, 'Unknown')`,
        channel: impactInteractions.channel,
        workType: impactInteractions.workType,
        impScore: impactInteractions.impScore,
        createdAt: impactInteractions.createdAt,
      })
      .from(impactInteractions)
      .leftJoin(entities, eq(entities.id, impactInteractions.entityId))
      .orderBy(desc(impactInteractions.createdAt))
      .limit(limit);

    return rows.map((row) => ({
      id: row.id,
      entityId: row.entityId,
      entityName: row.displayName,
      channel: row.channel,
      workType: row.workType,
      impScore: row.impScore,
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    }));
  }

  // ---------------------------------------------------------------------------
  // Timeline
  // ---------------------------------------------------------------------------

  async getTimeline(
    bucket: TimeBucket,
    entityId?: string,
    since?: string,
    until?: string,
  ): Promise<TimelineBucket[]> {
    const bucketExpr = bucketExpression(bucket);

    const conditions = [];
    if (entityId !== undefined) conditions.push(eq(impactInteractions.entityId, entityId));
    if (since !== undefined) conditions.push(gte(impactInteractions.createdAt, new Date(since)));
    if (until !== undefined) conditions.push(lte(impactInteractions.createdAt, new Date(until)));

    const rows = await this.db
      .select({
        bucketStart: bucketExpr,
        totalImp: sql<number>`COALESCE(SUM(${impactInteractions.impScore}), 0)`,
        positiveImp: sql<number>`COALESCE(SUM(CASE WHEN ${impactInteractions.impScore} > 0 THEN ${impactInteractions.impScore} ELSE 0 END), 0)`,
        negativeImp: sql<number>`COALESCE(SUM(CASE WHEN ${impactInteractions.impScore} < 0 THEN ${impactInteractions.impScore} ELSE 0 END), 0)`,
        interactionCount: count(impactInteractions.id),
      })
      .from(impactInteractions)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .groupBy(bucketExpr)
      .orderBy(asc(bucketExpr));

    return rows.map((row) => ({
      // Normalize bucketStart to ISO regardless of driver. node-postgres
      // returns Date; pglite returns a Postgres timestamp string like
      // "2026-04-01 00:00:00-06". Parse either through Date to get a
      // stable ISO form for consumers.
      bucketStart: (() => {
        const raw = row.bucketStart;
        if (raw instanceof Date) return raw.toISOString();
        if (raw === null || raw === undefined) return "";
        const parsed = new Date(String(raw));
        return Number.isNaN(parsed.valueOf()) ? String(raw) : parsed.toISOString();
      })(),
      totalImp: row.totalImp,
      positiveImp: row.positiveImp,
      negativeImp: row.negativeImp,
      interactionCount: row.interactionCount,
    }));
  }

  // ---------------------------------------------------------------------------
  // Breakdown
  // ---------------------------------------------------------------------------

  async getBreakdown(
    dimension: BreakdownDimension,
    entityId?: string,
    since?: string,
    until?: string,
  ): Promise<{ slices: BreakdownSlice[]; total: number }> {
    if (dimension === "domain") {
      return this.getDomainBreakdown(entityId, since, until);
    }

    const column = dimension === "channel"
      ? impactInteractions.channel
      : impactInteractions.workType;

    const conditions = [isNotNull(column)];
    if (entityId !== undefined) conditions.push(eq(impactInteractions.entityId, entityId));
    if (since !== undefined) conditions.push(gte(impactInteractions.createdAt, new Date(since)));
    if (until !== undefined) conditions.push(lte(impactInteractions.createdAt, new Date(until)));

    const rows = await this.db
      .select({
        key: column,
        totalImp: sql<number>`COALESCE(SUM(${impactInteractions.impScore}), 0)`,
        cnt: count(impactInteractions.id),
      })
      .from(impactInteractions)
      .where(and(...conditions))
      .groupBy(column)
      .orderBy(desc(sql<number>`SUM(${impactInteractions.impScore})`));

    const total = rows.reduce((sum, r) => sum + r.totalImp, 0);

    const slices: BreakdownSlice[] = rows.map((row) => ({
      key: row.key ?? "",
      totalImp: row.totalImp,
      count: row.cnt,
      percentage: total !== 0 ? (row.totalImp / total) * 100 : 0,
    }));

    return { slices, total };
  }

  /**
   * Domain breakdown maps work_type to impactinomics domains
   * (governance, community, innovation, operations, knowledge, technology).
   * Computed in application code since the mapping is not in the DB.
   */
  private async getDomainBreakdown(
    entityId?: string,
    since?: string,
    until?: string,
  ): Promise<{ slices: BreakdownSlice[]; total: number }> {
    const conditions = [];
    if (entityId !== undefined) conditions.push(eq(impactInteractions.entityId, entityId));
    if (since !== undefined) conditions.push(gte(impactInteractions.createdAt, new Date(since)));
    if (until !== undefined) conditions.push(lte(impactInteractions.createdAt, new Date(until)));

    const rows = await this.db
      .select({
        key: impactInteractions.workType,
        totalImp: sql<number>`COALESCE(SUM(${impactInteractions.impScore}), 0)`,
        cnt: count(impactInteractions.id),
      })
      .from(impactInteractions)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .groupBy(impactInteractions.workType);

    // Aggregate by domain
    const domainMap = new Map<string, { totalImp: number; count: number }>();
    for (const row of rows) {
      const domain = workTypeToDomain(row.key);
      const existing = domainMap.get(domain) ?? { totalImp: 0, count: 0 };
      existing.totalImp += row.totalImp;
      existing.count += row.cnt;
      domainMap.set(domain, existing);
    }

    const total = [...domainMap.values()].reduce((s, d) => s + d.totalImp, 0);

    const slices: BreakdownSlice[] = [...domainMap.entries()]
      .map(([key, data]) => ({
        key,
        totalImp: data.totalImp,
        count: data.count,
        percentage: total !== 0 ? (data.totalImp / total) * 100 : 0,
      }))
      .sort((a, b) => b.totalImp - a.totalImp);

    return { slices, total };
  }

  // ---------------------------------------------------------------------------
  // Leaderboard
  // ---------------------------------------------------------------------------

  async getLeaderboard(
    windowDays = 90,
    limit = 25,
    offset = 0,
  ): Promise<{ entries: LeaderboardEntry[]; total: number }> {
    const since = new Date(Date.now() - windowDays * 86_400_000);

    // Count total entities with impact in window
    const [countRow] = await this.db
      .select({ cnt: countDistinct(impactInteractions.entityId) })
      .from(impactInteractions)
      .where(gte(impactInteractions.createdAt, since));

    const total = countRow?.cnt ?? 0;

    // Get ranked entities
    const rows = await this.db
      .select({
        entityId: impactInteractions.entityId,
        displayName: sql<string>`COALESCE(${entities.displayName}, 'Unknown')`,
        verificationTier: sql<string>`COALESCE(${entities.verificationTier}, 'unverified')`,
        windowImp: sql<number>`COALESCE(SUM(${impactInteractions.impScore}), 0)`,
      })
      .from(impactInteractions)
      .leftJoin(entities, eq(entities.id, impactInteractions.entityId))
      .where(gte(impactInteractions.createdAt, since))
      .groupBy(impactInteractions.entityId, entities.displayName, entities.verificationTier)
      .orderBy(desc(sql<number>`SUM(${impactInteractions.impScore})`))
      .limit(limit)
      .offset(offset);

    // For each entry, fetch lifetime balance and positive window sum
    const entries: LeaderboardEntry[] = await Promise.all(
      rows.map(async (row, index) => {
        const [lifeRow] = await this.db
          .select({ balance: sql<number>`COALESCE(SUM(${impactInteractions.impScore}), 0)` })
          .from(impactInteractions)
          .where(eq(impactInteractions.entityId, row.entityId));

        const [posRow] = await this.db
          .select({ balance: sql<number>`COALESCE(SUM(${impactInteractions.impScore}), 0)` })
          .from(impactInteractions)
          .where(
            and(
              eq(impactInteractions.entityId, row.entityId),
              gte(impactInteractions.createdAt, since),
              sql`${impactInteractions.impScore} > 0`,
            ),
          );

        const lifetimeBalance = lifeRow?.balance ?? 0;
        const positiveWindow = posRow?.balance ?? 0;
        const bonus = Math.min(positiveWindow / 100, 2.0);

        return {
          entityId: row.entityId,
          entityName: row.displayName,
          verificationTier: row.verificationTier,
          totalImp: lifetimeBalance,
          windowImp: row.windowImp,
          currentBonus: bonus,
          rank: offset + index + 1,
        };
      }),
    );

    return { entries, total };
  }

  // ---------------------------------------------------------------------------
  // Entity Profile
  // ---------------------------------------------------------------------------

  async getEntityProfile(entityId: string, windowDays = 90): Promise<EntityImpactProfile | null> {
    const [entity] = await this.db
      .select({
        id: entities.id,
        type: entities.type,
        displayName: entities.displayName,
        verificationTier: entities.verificationTier,
        coaAlias: entities.coaAlias,
      })
      .from(entities)
      .where(eq(entities.id, entityId));

    if (entity === undefined) return null;

    const since = new Date(Date.now() - windowDays * 86_400_000);

    const [[lifeRow], [windowRow], [posRow], [eventCountRow]] = await Promise.all([
      this.db
        .select({ balance: sql<number>`COALESCE(SUM(${impactInteractions.impScore}), 0)` })
        .from(impactInteractions)
        .where(eq(impactInteractions.entityId, entityId)),
      this.db
        .select({ balance: sql<number>`COALESCE(SUM(${impactInteractions.impScore}), 0)` })
        .from(impactInteractions)
        .where(and(eq(impactInteractions.entityId, entityId), gte(impactInteractions.createdAt, since))),
      this.db
        .select({ balance: sql<number>`COALESCE(SUM(${impactInteractions.impScore}), 0)` })
        .from(impactInteractions)
        .where(
          and(
            eq(impactInteractions.entityId, entityId),
            gte(impactInteractions.createdAt, since),
            sql`${impactInteractions.impScore} > 0`,
          ),
        ),
      this.db
        .select({ cnt: countDistinct(impactInteractions.workType) })
        .from(impactInteractions)
        .where(eq(impactInteractions.entityId, entityId)),
    ]);

    const lifetimeImp = lifeRow?.balance ?? 0;
    const windowImp = windowRow?.balance ?? 0;
    const positiveWindow = posRow?.balance ?? 0;
    const distinctEventTypes = eventCountRow?.cnt ?? 0;
    const currentBonus = Math.min(positiveWindow / 100, 2.0);

    // Breakdowns
    const [{ slices: domainBreakdown }, { slices: channelBreakdown }] = await Promise.all([
      this.getBreakdown("domain", entityId),
      this.getBreakdown("channel", entityId),
    ]);

    // Recent activity
    const recentRows = await this.db
      .select({
        id: impactInteractions.id,
        entityId: impactInteractions.entityId,
        displayName: sql<string>`COALESCE(${entities.displayName}, 'Unknown')`,
        channel: impactInteractions.channel,
        workType: impactInteractions.workType,
        impScore: impactInteractions.impScore,
        createdAt: impactInteractions.createdAt,
      })
      .from(impactInteractions)
      .leftJoin(entities, eq(entities.id, impactInteractions.entityId))
      .where(eq(impactInteractions.entityId, entityId))
      .orderBy(desc(impactInteractions.createdAt))
      .limit(20);

    const recentActivity: ActivityEntry[] = recentRows.map((row) => ({
      id: row.id,
      entityId: row.entityId,
      entityName: row.displayName,
      channel: row.channel,
      workType: row.workType,
      impScore: row.impScore,
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    }));

    return {
      entityId: entity.id,
      entityName: entity.displayName,
      entityType: entity.type,
      verificationTier: entity.verificationTier,
      coaAlias: entity.coaAlias,
      lifetimeImp,
      windowImp,
      currentBonus,
      distinctEventTypes,
      domainBreakdown,
      channelBreakdown,
      recentActivity,
      skillsAuthored: 0,
      recognitionsReceived: 0,
      publicFields: ["entityName", "verificationTier", "lifetimeImp", "domainBreakdown"],
    };
  }

  // ---------------------------------------------------------------------------
  // COA Explorer
  // ---------------------------------------------------------------------------

  async getCOAEntries(params: COAExplorerParams): Promise<{
    entries: COAExplorerEntry[];
    total: number;
    hasMore: boolean;
  }> {
    const limit = params.limit ?? 50;
    const offset = params.offset ?? 0;

    const conditions = [];
    if (params.entityId !== undefined) conditions.push(eq(coaChains.entityId, params.entityId));
    if (params.fingerprint !== undefined) conditions.push(sql`${coaChains.fingerprint} LIKE ${"%" + params.fingerprint + "%"}`);
    if (params.workType !== undefined) conditions.push(eq(coaChains.workType, params.workType));
    if (params.since !== undefined) conditions.push(gte(coaChains.createdAt, new Date(params.since)));
    if (params.until !== undefined) conditions.push(lte(coaChains.createdAt, new Date(params.until)));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Count total
    const [countRow] = await this.db
      .select({ cnt: count(coaChains.fingerprint) })
      .from(coaChains)
      .where(whereClause);

    const total = countRow?.cnt ?? 0;

    // Fetch page
    const rows = await this.db
      .select({
        fingerprint: coaChains.fingerprint,
        resourceId: coaChains.resourceId,
        entityId: coaChains.entityId,
        displayName: sql<string>`COALESCE(${entities.displayName}, 'Unknown')`,
        nodeId: coaChains.nodeId,
        chainCounter: coaChains.chainCounter,
        workType: coaChains.workType,
        ref: coaChains.ref,
        action: coaChains.action,
        payloadHash: coaChains.payloadHash,
        createdAt: coaChains.createdAt,
        impScore: impactInteractions.impScore,
      })
      .from(coaChains)
      .leftJoin(entities, eq(entities.id, coaChains.entityId))
      .leftJoin(impactInteractions, eq(impactInteractions.coaFingerprint, coaChains.fingerprint))
      .where(whereClause)
      .orderBy(desc(coaChains.createdAt))
      .limit(limit)
      .offset(offset);

    const entries: COAExplorerEntry[] = rows.map((row) => ({
      fingerprint: row.fingerprint,
      resourceId: row.resourceId,
      entityId: row.entityId,
      entityName: row.displayName,
      nodeId: row.nodeId,
      chainCounter: row.chainCounter,
      workType: row.workType,
      ref: row.ref,
      action: row.action,
      payloadHash: row.payloadHash,
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
      impScore: row.impScore,
    }));

    return {
      entries,
      total,
      hasMore: offset + limit < total,
    };
  }
}
