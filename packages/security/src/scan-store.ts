/**
 * ScanStore — Postgres/drizzle persistence for security scan runs and findings.
 * Uses the unified agi_data database via @agi/db-schema.
 */

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@agi/db-schema/client";
import { scanRuns, securityFindings } from "@agi/db-schema";
import type {
  SecurityFinding,
  ScanRun,
  ScanConfig,
  ScanStatus,
  FindingSeverity,
  FindingStatus,
  SecuritySummary,
  ScannerRunResult,
} from "./types.js";

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

function rowToScanRun(row: typeof scanRuns.$inferSelect): ScanRun {
  return {
    id: row.id,
    status: row.status as ScanStatus,
    config: row.config as ScanConfig,
    startedAt: row.startedAt instanceof Date ? row.startedAt.toISOString() : String(row.startedAt),
    completedAt: row.completedAt
      ? row.completedAt instanceof Date
        ? row.completedAt.toISOString()
        : String(row.completedAt)
      : undefined,
    findingCounts: (row.findingCounts ?? {}) as Record<FindingSeverity, number>,
    totalFindings: row.totalFindings,
    scannerResults: (row.scannerResults ?? []) as ScannerRunResult[],
    error: row.error ?? undefined,
  };
}

function rowToFinding(row: typeof securityFindings.$inferSelect): SecurityFinding {
  return {
    id: row.id,
    scanId: row.scanId,
    title: row.title,
    description: row.description,
    checkId: row.checkId,
    scanType: row.scanType as SecurityFinding["scanType"],
    severity: row.severity as SecurityFinding["severity"],
    confidence: row.confidence as SecurityFinding["confidence"],
    cwe: (row.cwe ?? []) as string[],
    owasp: (row.owasp ?? []) as string[],
    evidence: row.evidence as SecurityFinding["evidence"],
    remediation: row.remediation as SecurityFinding["remediation"],
    standards: row.standards as SecurityFinding["standards"] | undefined,
    status: row.status as SecurityFinding["status"],
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
  };
}

// ---------------------------------------------------------------------------
// ScanStore
// ---------------------------------------------------------------------------

export class ScanStore {
  constructor(private readonly db: Db) {}

  // -- Scan runs --

  async createScanRun(id: string, config: ScanConfig): Promise<void> {
    await this.db.insert(scanRuns).values({
      id,
      status: "pending",
      config: config as unknown as Record<string, unknown>,
      findingCounts: {},
      totalFindings: 0,
      scannerResults: [],
    });
  }

  async updateScanRun(id: string, updates: {
    status?: ScanStatus;
    completedAt?: string;
    findingCounts?: Record<FindingSeverity, number>;
    totalFindings?: number;
    scannerResults?: unknown[];
    error?: string;
  }): Promise<void> {
    const set: Partial<typeof scanRuns.$inferInsert> = {};
    if (updates.status !== undefined) set.status = updates.status as typeof scanRuns.$inferInsert["status"];
    if (updates.completedAt !== undefined) set.completedAt = new Date(updates.completedAt);
    if (updates.findingCounts !== undefined) set.findingCounts = updates.findingCounts as Record<string, unknown>;
    if (updates.totalFindings !== undefined) set.totalFindings = updates.totalFindings;
    if (updates.scannerResults !== undefined) set.scannerResults = updates.scannerResults as unknown[];
    if (updates.error !== undefined) set.error = updates.error;
    if (Object.keys(set).length === 0) return;
    await this.db.update(scanRuns).set(set).where(eq(scanRuns.id, id));
  }

  async getScanRun(id: string): Promise<ScanRun | undefined> {
    const [row] = await this.db
      .select()
      .from(scanRuns)
      .where(eq(scanRuns.id, id));
    return row ? rowToScanRun(row) : undefined;
  }

  async listScanRuns(opts?: {
    projectPath?: string;
    limit?: number;
    offset?: number;
  }): Promise<ScanRun[]> {
    const limit = opts?.limit ?? 50;
    const offset = opts?.offset ?? 0;

    if (opts?.projectPath) {
      // Filter by targetPath inside the config jsonb
      const rows = await this.db
        .select()
        .from(scanRuns)
        .where(sql`${scanRuns.config}->>'targetPath' = ${opts.projectPath}`)
        .orderBy(desc(scanRuns.startedAt))
        .limit(limit)
        .offset(offset);
      return rows.map(rowToScanRun);
    }

    const rows = await this.db
      .select()
      .from(scanRuns)
      .orderBy(desc(scanRuns.startedAt))
      .limit(limit)
      .offset(offset);
    return rows.map(rowToScanRun);
  }

  // -- Findings --

  async insertFindings(findings: SecurityFinding[]): Promise<void> {
    if (findings.length === 0) return;
    await this.db
      .insert(securityFindings)
      .values(
        findings.map((f) => ({
          id: f.id,
          scanId: f.scanId,
          title: f.title,
          description: f.description,
          checkId: f.checkId,
          scanType: f.scanType,
          severity: f.severity as typeof securityFindings.$inferInsert["severity"],
          confidence: f.confidence as typeof securityFindings.$inferInsert["confidence"],
          cwe: (f.cwe ?? []) as unknown[],
          owasp: (f.owasp ?? []) as unknown[],
          evidence: f.evidence as Record<string, unknown>,
          remediation: f.remediation as unknown as Record<string, unknown>,
          standards: f.standards as Record<string, unknown> | undefined,
          status: f.status as typeof securityFindings.$inferInsert["status"],
          createdAt: new Date(f.createdAt),
        })),
      )
      .onConflictDoNothing();
  }

  async getFindings(scanId: string): Promise<SecurityFinding[]> {
    const rows = await this.db
      .select()
      .from(securityFindings)
      .where(eq(securityFindings.scanId, scanId))
      .orderBy(
        asc(securityFindings.severity),
        asc(securityFindings.createdAt),
      );
    return rows.map(rowToFinding);
  }

  async queryFindings(opts?: {
    severity?: FindingSeverity;
    scanType?: string;
    status?: FindingStatus;
    projectPath?: string;
    limit?: number;
    offset?: number;
  }): Promise<SecurityFinding[]> {
    const conditions = [];
    if (opts?.severity) conditions.push(eq(securityFindings.severity, opts.severity as typeof securityFindings.$inferInsert["severity"]));
    if (opts?.scanType) conditions.push(eq(securityFindings.scanType, opts.scanType));
    if (opts?.status) conditions.push(eq(securityFindings.status, opts.status as "open" | "acknowledged" | "mitigated" | "false_positive"));

    // Severity ordering via CASE expression
    const severityOrder = sql`CASE ${securityFindings.severity} WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END`;

    if (opts?.projectPath) {
      // Join with scan_runs to filter by config->targetPath
      const rows = await this.db
        .select({ finding: securityFindings })
        .from(securityFindings)
        .innerJoin(scanRuns, eq(securityFindings.scanId, scanRuns.id))
        .where(
          and(
            ...conditions,
            sql`${scanRuns.config}->>'targetPath' = ${opts.projectPath}`,
          ),
        )
        .orderBy(asc(severityOrder), desc(securityFindings.createdAt))
        .limit(opts?.limit ?? 1000)
        .offset(opts?.offset ?? 0);
      return rows.map((r) => rowToFinding(r.finding));
    }

    const query = this.db
      .select()
      .from(securityFindings)
      .orderBy(asc(severityOrder), desc(securityFindings.createdAt));

    if (conditions.length > 0) {
      query.where(and(...conditions));
    }

    if (opts?.limit !== undefined) {
      query.limit(opts.limit).offset(opts.offset ?? 0);
    }

    const rows = await query;
    return rows.map(rowToFinding);
  }

  async updateFindingStatus(findingId: string, status: FindingStatus): Promise<boolean> {
    const result = await this.db
      .update(securityFindings)
      .set({ status: status as typeof securityFindings.$inferInsert["status"] })
      .where(eq(securityFindings.id, findingId));
    return (result.rowCount ?? 0) > 0;
  }

  // -- Summary --

  async getSummary(projectPath?: string): Promise<SecuritySummary> {
    let scanRunIds: string[] | undefined;

    if (projectPath) {
      const runs = await this.db
        .select({ id: scanRuns.id })
        .from(scanRuns)
        .where(sql`${scanRuns.config}->>'targetPath' = ${projectPath}`);
      scanRunIds = runs.map((r) => r.id);
      if (scanRunIds.length === 0) {
        return {
          totalFindings: 0,
          bySeverity: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
          byStatus: { open: 0, acknowledged: 0, mitigated: 0, false_positive: 0 },
          byScanType: {} as Record<string, number>,
          lastScanAt: undefined,
          scanCount: 0,
        };
      }
    }

    // Severity counts
    const severityRows = await this.db
      .select({
        severity: securityFindings.severity,
        cnt: sql<number>`COUNT(*)::int`,
      })
      .from(securityFindings)
      .where(scanRunIds ? inArray(securityFindings.scanId, scanRunIds) : undefined)
      .groupBy(securityFindings.severity);

    // Status counts
    const statusRows = await this.db
      .select({
        status: securityFindings.status,
        cnt: sql<number>`COUNT(*)::int`,
      })
      .from(securityFindings)
      .where(scanRunIds ? inArray(securityFindings.scanId, scanRunIds) : undefined)
      .groupBy(securityFindings.status);

    // Scan type counts
    const typeRows = await this.db
      .select({
        scanType: securityFindings.scanType,
        cnt: sql<number>`COUNT(*)::int`,
      })
      .from(securityFindings)
      .where(scanRunIds ? inArray(securityFindings.scanId, scanRunIds) : undefined)
      .groupBy(securityFindings.scanType);

    // Scan run count + last scan
    const [scanStats] = await this.db
      .select({
        cnt: sql<number>`COUNT(*)::int`,
        last: sql<string | null>`MAX(${scanRuns.startedAt})`,
      })
      .from(scanRuns)
      .where(scanRunIds ? inArray(scanRuns.id, scanRunIds) : undefined);

    const bySeverity = { critical: 0, high: 0, medium: 0, low: 0, info: 0 } as Record<FindingSeverity, number>;
    for (const r of severityRows) bySeverity[r.severity as FindingSeverity] = r.cnt;

    const byStatus = { open: 0, acknowledged: 0, mitigated: 0, false_positive: 0 } as Record<string, number>;
    for (const r of statusRows) byStatus[r.status] = r.cnt;

    const byScanType = {} as Record<string, number>;
    for (const r of typeRows) byScanType[r.scanType] = r.cnt;

    const totalFindings = Object.values(bySeverity).reduce((a, b) => a + b, 0);
    const lastScanAt = scanStats?.last ? String(scanStats.last) : undefined;

    return {
      totalFindings,
      bySeverity,
      byStatus,
      byScanType,
      lastScanAt,
      scanCount: scanStats?.cnt ?? 0,
    } as SecuritySummary;
  }
}
