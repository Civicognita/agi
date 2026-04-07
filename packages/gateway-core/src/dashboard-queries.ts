/**
 * Dashboard Aggregation Queries — Task #154
 *
 * Efficient SQLite aggregation queries for the impact dashboard.
 * Time-bucketed impact summaries, domain-grouped breakdowns,
 * leaderboard ranking, and COA chain exploration.
 *
 * Uses prepared statements for performance.
 * All queries are read-only.
 */

import type BetterSqlite3 from "better-sqlite3";

import type { Database } from "@aionima/entity-model";

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
// SQL bucket expressions
// ---------------------------------------------------------------------------

function bucketExpression(bucket: TimeBucket): string {
  switch (bucket) {
    case "hour":
      return "strftime('%Y-%m-%dT%H:00:00Z', created_at)";
    case "day":
      return "strftime('%Y-%m-%dT00:00:00Z', created_at)";
    case "week":
      // ISO week: Monday-based. Use day-of-year minus weekday.
      return "strftime('%Y-W%W', created_at)";
    case "month":
      return "strftime('%Y-%m-01T00:00:00Z', created_at)";
  }
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface OverviewRow {
  total_imp: number;
  interaction_count: number;
  entity_count: number;
}

interface WindowImpRow {
  window_imp: number;
}

interface TopChannelRow {
  channel: string;
  cnt: number;
}

interface ActivityRow {
  id: string;
  entity_id: string;
  display_name: string;
  channel: string | null;
  work_type: string | null;
  imp_score: number;
  created_at: string;
}

interface TimelineRow {
  bucket_start: string;
  total_imp: number;
  positive_imp: number;
  negative_imp: number;
  interaction_count: number;
}

interface BreakdownRow {
  key: string;
  total_imp: number;
  cnt: number;
}

interface LeaderboardRow {
  entity_id: string;
  display_name: string;
  verification_tier: string;
  total_imp: number;
}

interface EntityProfileRow {
  id: string;
  type: string;
  display_name: string;
  verification_tier: string;
  coa_alias: string;
}

interface COARow {
  fingerprint: string;
  resource_id: string;
  entity_id: string;
  display_name: string;
  node_id: string;
  chain_counter: number;
  work_type: string;
  ref: string | null;
  action: string | null;
  payload_hash: string | null;
  created_at: string;
  imp_score: number | null;
}

interface CountRow {
  cnt: number;
}

// ---------------------------------------------------------------------------
// DashboardQueries
// ---------------------------------------------------------------------------

export class DashboardQueries {
  private readonly db: Database;

  // Cached prepared statements (lazy)
  private _stmtOverview: BetterSqlite3.Statement<[], OverviewRow> | null = null;
  private _stmtRecentActivity: BetterSqlite3.Statement<[{ limit: number }], ActivityRow> | null = null;

  constructor(db: Database) {
    this.db = db;
  }

  // ---------------------------------------------------------------------------
  // Overview
  // ---------------------------------------------------------------------------

  getOverview(windowDays = 90, recentLimit = 20): DashboardOverview {
    // Total stats
    const overviewStmt = this._stmtOverview ?? (this._stmtOverview = this.db.prepare<[], OverviewRow>(`
      SELECT
        COALESCE(SUM(imp_score), 0) AS total_imp,
        COUNT(*) AS interaction_count,
        COUNT(DISTINCT entity_id) AS entity_count
      FROM impact_interactions
    `));

    const overview = overviewStmt.get();
    const totalImp = overview?.total_imp ?? 0;
    const interactionCount = overview?.interaction_count ?? 0;
    const entityCount = overview?.entity_count ?? 0;

    // Window stats
    const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();
    const windowStmt = this.db.prepare<[{ since: string }], WindowImpRow>(`
      SELECT COALESCE(SUM(imp_score), 0) AS window_imp
      FROM impact_interactions
      WHERE created_at >= @since
    `);
    const windowImp = windowStmt.get({ since })?.window_imp ?? 0;

    // Top channel
    const topChannelStmt = this.db.prepare<[], TopChannelRow>(`
      SELECT channel, COUNT(*) AS cnt
      FROM impact_interactions
      WHERE channel IS NOT NULL
      GROUP BY channel
      ORDER BY cnt DESC
      LIMIT 1
    `);
    const topChannel = topChannelStmt.get()?.channel ?? null;

    // Recent activity
    const recentActivity = this.getRecentActivity(recentLimit);

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

  getRecentActivity(limit = 20): ActivityEntry[] {
    const stmt = this._stmtRecentActivity ?? (this._stmtRecentActivity = this.db.prepare<[{ limit: number }], ActivityRow>(`
      SELECT
        ii.id,
        ii.entity_id,
        COALESCE(e.display_name, 'Unknown') AS display_name,
        ii.channel,
        ii.work_type,
        ii.imp_score,
        ii.created_at
      FROM impact_interactions ii
      LEFT JOIN entities e ON e.id = ii.entity_id
      ORDER BY ii.created_at DESC
      LIMIT @limit
    `));

    return stmt.all({ limit }).map((row) => ({
      id: row.id,
      entityId: row.entity_id,
      entityName: row.display_name,
      channel: row.channel,
      workType: row.work_type,
      impScore: row.imp_score,
      createdAt: row.created_at,
    }));
  }

  // ---------------------------------------------------------------------------
  // Timeline
  // ---------------------------------------------------------------------------

  getTimeline(
    bucket: TimeBucket,
    entityId?: string,
    since?: string,
    until?: string,
  ): TimelineBucket[] {
    const bucketExpr = bucketExpression(bucket);
    const conditions: string[] = [];
    const params: Record<string, string> = {};

    if (entityId !== undefined) {
      conditions.push("entity_id = @entity_id");
      params["entity_id"] = entityId;
    }
    if (since !== undefined) {
      conditions.push("created_at >= @since");
      params["since"] = since;
    }
    if (until !== undefined) {
      conditions.push("created_at <= @until");
      params["until"] = until;
    }

    const whereClause = conditions.length > 0
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    const sql = `
      SELECT
        ${bucketExpr} AS bucket_start,
        COALESCE(SUM(imp_score), 0) AS total_imp,
        COALESCE(SUM(CASE WHEN imp_score > 0 THEN imp_score ELSE 0 END), 0) AS positive_imp,
        COALESCE(SUM(CASE WHEN imp_score < 0 THEN imp_score ELSE 0 END), 0) AS negative_imp,
        COUNT(*) AS interaction_count
      FROM impact_interactions
      ${whereClause}
      GROUP BY bucket_start
      ORDER BY bucket_start ASC
    `;

    const stmt = this.db.prepare<[Record<string, string>], TimelineRow>(sql);
    return stmt.all(params).map((row) => ({
      bucketStart: row.bucket_start,
      totalImp: row.total_imp,
      positiveImp: row.positive_imp,
      negativeImp: row.negative_imp,
      interactionCount: row.interaction_count,
    }));
  }

  // ---------------------------------------------------------------------------
  // Breakdown
  // ---------------------------------------------------------------------------

  getBreakdown(
    dimension: BreakdownDimension,
    entityId?: string,
    since?: string,
    until?: string,
  ): { slices: BreakdownSlice[]; total: number } {
    if (dimension === "domain") {
      return this.getDomainBreakdown(entityId, since, until);
    }

    const columnName = dimension === "channel" ? "channel" : "work_type";
    const conditions: string[] = [`${columnName} IS NOT NULL`];
    const params: Record<string, string> = {};

    if (entityId !== undefined) {
      conditions.push("entity_id = @entity_id");
      params["entity_id"] = entityId;
    }
    if (since !== undefined) {
      conditions.push("created_at >= @since");
      params["since"] = since;
    }
    if (until !== undefined) {
      conditions.push("created_at <= @until");
      params["until"] = until;
    }

    const whereClause = conditions.length > 0
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    const sql = `
      SELECT
        ${columnName} AS key,
        COALESCE(SUM(imp_score), 0) AS total_imp,
        COUNT(*) AS cnt
      FROM impact_interactions
      ${whereClause}
      GROUP BY ${columnName}
      ORDER BY total_imp DESC
    `;

    const rows = this.db.prepare<[Record<string, string>], BreakdownRow>(sql).all(params);
    const total = rows.reduce((sum, r) => sum + r.total_imp, 0);

    const slices: BreakdownSlice[] = rows.map((row) => ({
      key: row.key,
      totalImp: row.total_imp,
      count: row.cnt,
      percentage: total !== 0 ? (row.total_imp / total) * 100 : 0,
    }));

    return { slices, total };
  }

  /**
   * Domain breakdown maps work_type to impactinomics domains
   * (governance, community, innovation, operations, knowledge, technology).
   * Computed in application code since the mapping is not in the DB.
   */
  private getDomainBreakdown(
    entityId?: string,
    since?: string,
    until?: string,
  ): { slices: BreakdownSlice[]; total: number } {
    const conditions: string[] = [];
    const params: Record<string, string> = {};

    if (entityId !== undefined) {
      conditions.push("entity_id = @entity_id");
      params["entity_id"] = entityId;
    }
    if (since !== undefined) {
      conditions.push("created_at >= @since");
      params["since"] = since;
    }
    if (until !== undefined) {
      conditions.push("created_at <= @until");
      params["until"] = until;
    }

    const whereClause = conditions.length > 0
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    const sql = `
      SELECT
        work_type AS key,
        COALESCE(SUM(imp_score), 0) AS total_imp,
        COUNT(*) AS cnt
      FROM impact_interactions
      ${whereClause}
      GROUP BY work_type
    `;

    const rows = this.db.prepare<[Record<string, string>], BreakdownRow>(sql).all(params);

    // Aggregate by domain
    const domainMap = new Map<string, { totalImp: number; count: number }>();
    for (const row of rows) {
      const domain = workTypeToDomain(row.key);
      const existing = domainMap.get(domain) ?? { totalImp: 0, count: 0 };
      existing.totalImp += row.total_imp;
      existing.count += row.cnt;
      domainMap.set(domain, existing);
    }

    const total = [...domainMap.values()].reduce((sum, d) => sum + d.totalImp, 0);

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

  getLeaderboard(
    windowDays = 90,
    limit = 25,
    offset = 0,
  ): { entries: LeaderboardEntry[]; total: number } {
    const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();

    // Count total entities with impact
    const countStmt = this.db.prepare<[{ since: string }], CountRow>(`
      SELECT COUNT(DISTINCT entity_id) AS cnt
      FROM impact_interactions
      WHERE created_at >= @since
    `);
    const total = countStmt.get({ since })?.cnt ?? 0;

    // Get ranked entities
    const sql = `
      SELECT
        ii.entity_id,
        COALESCE(e.display_name, 'Unknown') AS display_name,
        COALESCE(e.verification_tier, 'unverified') AS verification_tier,
        COALESCE(SUM(ii.imp_score), 0) AS total_imp
      FROM impact_interactions ii
      LEFT JOIN entities e ON e.id = ii.entity_id
      WHERE ii.created_at >= @since
      GROUP BY ii.entity_id
      ORDER BY total_imp DESC
      LIMIT @limit OFFSET @offset
    `;

    type LeaderParams = { since: string; limit: number; offset: number };
    const rows = this.db.prepare<[LeaderParams], LeaderboardRow>(sql)
      .all({ since, limit, offset });

    // Calculate lifetime totals and bonus for each entry
    const balanceStmt = this.db.prepare<[{ entity_id: string }], { balance: number }>(`
      SELECT COALESCE(SUM(imp_score), 0) AS balance
      FROM impact_interactions
      WHERE entity_id = @entity_id
    `);

    const bonusStmt = this.db.prepare<[{ entity_id: string; since: string }], { balance: number }>(`
      SELECT COALESCE(SUM(imp_score), 0) AS balance
      FROM impact_interactions
      WHERE entity_id = @entity_id AND created_at >= @since AND imp_score > 0
    `);

    const entries: LeaderboardEntry[] = rows.map((row, index) => {
      const lifetimeBalance = balanceStmt.get({ entity_id: row.entity_id })?.balance ?? 0;
      const positiveWindow = bonusStmt.get({ entity_id: row.entity_id, since })?.balance ?? 0;
      const bonus = Math.min(positiveWindow / 100, 2.0);

      return {
        entityId: row.entity_id,
        entityName: row.display_name,
        verificationTier: row.verification_tier,
        totalImp: lifetimeBalance,
        windowImp: row.total_imp,
        currentBonus: bonus,
        rank: offset + index + 1,
      };
    });

    return { entries, total };
  }

  // ---------------------------------------------------------------------------
  // Entity Profile
  // ---------------------------------------------------------------------------

  getEntityProfile(entityId: string, windowDays = 90): EntityImpactProfile | null {
    const entityStmt = this.db.prepare<[{ entity_id: string }], EntityProfileRow>(`
      SELECT id, type, display_name, verification_tier, coa_alias
      FROM entities
      WHERE id = @entity_id
    `);

    const entity = entityStmt.get({ entity_id: entityId });
    if (entity === undefined) return null;

    const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();

    // Lifetime + window balances
    const lifetimeStmt = this.db.prepare<[{ entity_id: string }], { balance: number }>(`
      SELECT COALESCE(SUM(imp_score), 0) AS balance
      FROM impact_interactions WHERE entity_id = @entity_id
    `);
    const windowStmt = this.db.prepare<[{ entity_id: string; since: string }], { balance: number }>(`
      SELECT COALESCE(SUM(imp_score), 0) AS balance
      FROM impact_interactions WHERE entity_id = @entity_id AND created_at >= @since
    `);
    const positiveStmt = this.db.prepare<[{ entity_id: string; since: string }], { balance: number }>(`
      SELECT COALESCE(SUM(imp_score), 0) AS balance
      FROM impact_interactions WHERE entity_id = @entity_id AND created_at >= @since AND imp_score > 0
    `);
    const eventCountStmt = this.db.prepare<[{ entity_id: string }], { cnt: number }>(`
      SELECT COUNT(DISTINCT work_type) AS cnt
      FROM impact_interactions WHERE entity_id = @entity_id
    `);

    const lifetimeImp = lifetimeStmt.get({ entity_id: entityId })?.balance ?? 0;
    const windowImp = windowStmt.get({ entity_id: entityId, since })?.balance ?? 0;
    const positiveWindow = positiveStmt.get({ entity_id: entityId, since })?.balance ?? 0;
    const distinctEventTypes = eventCountStmt.get({ entity_id: entityId })?.cnt ?? 0;
    const currentBonus = Math.min(positiveWindow / 100, 2.0);

    // Breakdowns
    const { slices: domainBreakdown } = this.getBreakdown("domain", entityId);
    const { slices: channelBreakdown } = this.getBreakdown("channel", entityId);

    // Recent activity
    const recentStmt = this.db.prepare<[{ entity_id: string; limit: number }], ActivityRow>(`
      SELECT
        ii.id,
        ii.entity_id,
        COALESCE(e.display_name, 'Unknown') AS display_name,
        ii.channel,
        ii.work_type,
        ii.imp_score,
        ii.created_at
      FROM impact_interactions ii
      LEFT JOIN entities e ON e.id = ii.entity_id
      WHERE ii.entity_id = @entity_id
      ORDER BY ii.created_at DESC
      LIMIT @limit
    `);

    const recentActivity = recentStmt.all({ entity_id: entityId, limit: 20 }).map((row) => ({
      id: row.id,
      entityId: row.entity_id,
      entityName: row.display_name,
      channel: row.channel,
      workType: row.work_type,
      impScore: row.imp_score,
      createdAt: row.created_at,
    }));

    return {
      entityId: entity.id,
      entityName: entity.display_name,
      entityType: entity.type,
      verificationTier: entity.verification_tier,
      coaAlias: entity.coa_alias,
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

  getCOAEntries(params: COAExplorerParams): {
    entries: COAExplorerEntry[];
    total: number;
    hasMore: boolean;
  } {
    const limit = params.limit ?? 50;
    const offset = params.offset ?? 0;
    const conditions: string[] = [];
    const sqlParams: Record<string, string | number> = {};

    if (params.entityId !== undefined) {
      conditions.push("c.entity_id = @entity_id");
      sqlParams["entity_id"] = params.entityId;
    }
    if (params.fingerprint !== undefined) {
      conditions.push("c.fingerprint LIKE @fingerprint");
      sqlParams["fingerprint"] = `%${params.fingerprint}%`;
    }
    if (params.workType !== undefined) {
      conditions.push("c.work_type = @work_type");
      sqlParams["work_type"] = params.workType;
    }
    if (params.since !== undefined) {
      conditions.push("c.created_at >= @since");
      sqlParams["since"] = params.since;
    }
    if (params.until !== undefined) {
      conditions.push("c.created_at <= @until");
      sqlParams["until"] = params.until;
    }

    const whereClause = conditions.length > 0
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    // Count total
    const countSql = `SELECT COUNT(*) AS cnt FROM coa_chains c ${whereClause}`;
    type SqlParams = Record<string, string | number>;
    const total = this.db.prepare<[SqlParams], CountRow>(countSql)
      .get(sqlParams)?.cnt ?? 0;

    // Fetch page
    const sql = `
      SELECT
        c.fingerprint,
        c.resource_id,
        c.entity_id,
        COALESCE(e.display_name, 'Unknown') AS display_name,
        c.node_id,
        c.chain_counter,
        c.work_type,
        c.ref,
        c.action,
        c.payload_hash,
        c.created_at,
        ii.imp_score
      FROM coa_chains c
      LEFT JOIN entities e ON e.id = c.entity_id
      LEFT JOIN impact_interactions ii ON ii.coa_fingerprint = c.fingerprint
      ${whereClause}
      ORDER BY c.created_at DESC
      LIMIT @limit OFFSET @offset
    `;

    sqlParams["limit"] = limit;
    sqlParams["offset"] = offset;

    const rows = this.db.prepare<[SqlParams], COARow>(sql).all(sqlParams);

    const entries: COAExplorerEntry[] = rows.map((row) => ({
      fingerprint: row.fingerprint,
      resourceId: row.resource_id,
      entityId: row.entity_id,
      entityName: row.display_name,
      nodeId: row.node_id,
      chainCounter: row.chain_counter,
      workType: row.work_type,
      ref: row.ref,
      action: row.action,
      payloadHash: row.payload_hash,
      createdAt: row.created_at,
      impScore: row.imp_score,
    }));

    return {
      entries,
      total,
      hasMore: offset + limit < total,
    };
  }
}
