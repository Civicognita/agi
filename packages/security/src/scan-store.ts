/**
 * ScanStore — SQLite persistence for security scan runs and findings.
 * Database lives at ~/.agi/security.db following Aionima runtime data conventions.
 */

import Database from "better-sqlite3";
import { join } from "node:path";
import { homedir } from "node:os";
import { mkdirSync } from "node:fs";
import type {
  SecurityFinding,
  ScanRun,
  ScanConfig,
  ScanStatus,
  FindingSeverity,
  FindingStatus,
  SecuritySummary,
} from "./types.js";

export class ScanStore {
  private readonly db: Database.Database;

  constructor(dbPath?: string) {
    const dir = join(homedir(), ".agi");
    mkdirSync(dir, { recursive: true });
    const path = dbPath ?? join(dir, "security.db");
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS scan_runs (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'pending',
        config_json TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        finding_counts_json TEXT NOT NULL DEFAULT '{}',
        total_findings INTEGER NOT NULL DEFAULT 0,
        scanner_results_json TEXT NOT NULL DEFAULT '[]',
        error TEXT
      );

      CREATE TABLE IF NOT EXISTS security_findings (
        id TEXT PRIMARY KEY,
        scan_id TEXT NOT NULL REFERENCES scan_runs(id),
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        check_id TEXT NOT NULL,
        scan_type TEXT NOT NULL,
        severity TEXT NOT NULL,
        confidence TEXT NOT NULL DEFAULT 'medium',
        cwe_json TEXT NOT NULL DEFAULT '[]',
        owasp_json TEXT NOT NULL DEFAULT '[]',
        evidence_json TEXT NOT NULL DEFAULT '{}',
        remediation_json TEXT NOT NULL DEFAULT '{}',
        standards_json TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_findings_scan_id ON security_findings(scan_id);
      CREATE INDEX IF NOT EXISTS idx_findings_severity ON security_findings(severity);
      CREATE INDEX IF NOT EXISTS idx_findings_status ON security_findings(status);
      CREATE INDEX IF NOT EXISTS idx_findings_created ON security_findings(created_at);
      CREATE INDEX IF NOT EXISTS idx_findings_scan_type ON security_findings(scan_type);
    `);
  }

  // -- Scan runs --

  createScanRun(id: string, config: ScanConfig): void {
    this.db.prepare(`
      INSERT INTO scan_runs (id, status, config_json, started_at, finding_counts_json)
      VALUES (?, 'pending', ?, ?, '{}')
    `).run(id, JSON.stringify(config), new Date().toISOString());
  }

  updateScanRun(id: string, updates: {
    status?: ScanStatus;
    completedAt?: string;
    findingCounts?: Record<FindingSeverity, number>;
    totalFindings?: number;
    scannerResults?: unknown[];
    error?: string;
  }): void {
    const fields: string[] = [];
    const values: unknown[] = [];
    if (updates.status !== undefined) { fields.push("status = ?"); values.push(updates.status); }
    if (updates.completedAt !== undefined) { fields.push("completed_at = ?"); values.push(updates.completedAt); }
    if (updates.findingCounts !== undefined) { fields.push("finding_counts_json = ?"); values.push(JSON.stringify(updates.findingCounts)); }
    if (updates.totalFindings !== undefined) { fields.push("total_findings = ?"); values.push(updates.totalFindings); }
    if (updates.scannerResults !== undefined) { fields.push("scanner_results_json = ?"); values.push(JSON.stringify(updates.scannerResults)); }
    if (updates.error !== undefined) { fields.push("error = ?"); values.push(updates.error); }
    if (fields.length === 0) return;
    values.push(id);
    this.db.prepare(`UPDATE scan_runs SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  }

  getScanRun(id: string): ScanRun | undefined {
    const row = this.db.prepare("SELECT * FROM scan_runs WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return this.rowToScanRun(row);
  }

  listScanRuns(opts?: { projectPath?: string; limit?: number; offset?: number }): ScanRun[] {
    const limit = opts?.limit ?? 50;
    const offset = opts?.offset ?? 0;
    let sql = "SELECT * FROM scan_runs";
    const params: unknown[] = [];
    if (opts?.projectPath) {
      sql += " WHERE json_extract(config_json, '$.targetPath') = ?";
      params.push(opts.projectPath);
    }
    sql += " ORDER BY started_at DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => this.rowToScanRun(r));
  }

  // -- Findings --

  insertFindings(findings: SecurityFinding[]): void {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO security_findings
      (id, scan_id, title, description, check_id, scan_type, severity, confidence, cwe_json, owasp_json, evidence_json, remediation_json, standards_json, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const tx = this.db.transaction((items: SecurityFinding[]) => {
      for (const f of items) {
        stmt.run(
          f.id, f.scanId, f.title, f.description, f.checkId, f.scanType,
          f.severity, f.confidence,
          JSON.stringify(f.cwe ?? []), JSON.stringify(f.owasp ?? []),
          JSON.stringify(f.evidence), JSON.stringify(f.remediation),
          f.standards ? JSON.stringify(f.standards) : null,
          f.status, f.createdAt,
        );
      }
    });
    tx(findings);
  }

  getFindings(scanId: string): SecurityFinding[] {
    const rows = this.db.prepare("SELECT * FROM security_findings WHERE scan_id = ? ORDER BY severity, created_at").all(scanId) as Record<string, unknown>[];
    return rows.map(r => this.rowToFinding(r));
  }

  queryFindings(opts?: {
    severity?: FindingSeverity;
    scanType?: string;
    status?: FindingStatus;
    projectPath?: string;
    limit?: number;
    offset?: number;
  }): SecurityFinding[] {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (opts?.severity) { conditions.push("f.severity = ?"); params.push(opts.severity); }
    if (opts?.scanType) { conditions.push("f.scan_type = ?"); params.push(opts.scanType); }
    if (opts?.status) { conditions.push("f.status = ?"); params.push(opts.status); }
    if (opts?.projectPath) {
      conditions.push("json_extract(r.config_json, '$.targetPath') = ?");
      params.push(opts.projectPath);
    }
    let sql = "SELECT f.* FROM security_findings f";
    if (opts?.projectPath) sql += " JOIN scan_runs r ON f.scan_id = r.id";
    if (conditions.length > 0) sql += " WHERE " + conditions.join(" AND ");
    sql += " ORDER BY CASE f.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END, f.created_at DESC";
    if (opts?.limit !== undefined) {
      sql += ` LIMIT ? OFFSET ?`;
      params.push(opts.limit, opts?.offset ?? 0);
    }
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => this.rowToFinding(r));
  }

  updateFindingStatus(findingId: string, status: FindingStatus): boolean {
    const result = this.db.prepare("UPDATE security_findings SET status = ? WHERE id = ?").run(status, findingId);
    return result.changes > 0;
  }

  // -- Summary --

  getSummary(projectPath?: string): SecuritySummary {
    const findingConditions: string[] = [];
    const params: unknown[] = [];
    let joinClause = "";

    if (projectPath) {
      joinClause = " JOIN scan_runs r ON f.scan_id = r.id";
      findingConditions.push("json_extract(r.config_json, '$.targetPath') = ?");
      params.push(projectPath);
    }

    const severitySql = `SELECT severity, COUNT(*) as cnt FROM security_findings f${joinClause}${findingConditions.length ? " WHERE " + findingConditions.join(" AND ") : ""} GROUP BY severity`;
    const severityRows = this.db.prepare(severitySql).all(...params) as { severity: string; cnt: number }[];

    const statusSql = `SELECT status, COUNT(*) as cnt FROM security_findings f${joinClause}${findingConditions.length ? " WHERE " + findingConditions.join(" AND ") : ""} GROUP BY status`;
    const statusRows = this.db.prepare(statusSql).all(...params) as { status: string; cnt: number }[];

    const typeSql = `SELECT scan_type, COUNT(*) as cnt FROM security_findings f${joinClause}${findingConditions.length ? " WHERE " + findingConditions.join(" AND ") : ""} GROUP BY scan_type`;
    const typeRows = this.db.prepare(typeSql).all(...params) as { scan_type: string; cnt: number }[];

    let scanCountSql = "SELECT COUNT(*) as cnt FROM scan_runs";
    let lastScanSql = "SELECT MAX(started_at) as last FROM scan_runs";
    const scanParams: unknown[] = [];
    if (projectPath) {
      const cond = " WHERE json_extract(config_json, '$.targetPath') = ?";
      scanCountSql += cond;
      lastScanSql += cond;
      scanParams.push(projectPath);
    }

    const scanCount = (this.db.prepare(scanCountSql).get(...scanParams) as { cnt: number }).cnt;
    const lastScan = (this.db.prepare(lastScanSql).get(...scanParams) as { last: string | null }).last;

    const bySeverity = { critical: 0, high: 0, medium: 0, low: 0, info: 0 } as Record<FindingSeverity, number>;
    for (const r of severityRows) bySeverity[r.severity as FindingSeverity] = r.cnt;

    const byStatus = { open: 0, acknowledged: 0, mitigated: 0, false_positive: 0 } as Record<string, number>;
    for (const r of statusRows) byStatus[r.status] = r.cnt;

    const byScanType = {} as Record<string, number>;
    for (const r of typeRows) byScanType[r.scan_type] = r.cnt;

    const totalFindings = Object.values(bySeverity).reduce((a, b) => a + b, 0);

    return { totalFindings, bySeverity, byStatus, byScanType, lastScanAt: lastScan ?? undefined, scanCount } as SecuritySummary;
  }

  // -- Helpers --

  private rowToScanRun(row: Record<string, unknown>): ScanRun {
    return {
      id: row.id as string,
      status: row.status as ScanRun["status"],
      config: JSON.parse(row.config_json as string),
      startedAt: row.started_at as string,
      completedAt: (row.completed_at as string) || undefined,
      findingCounts: JSON.parse(row.finding_counts_json as string),
      totalFindings: row.total_findings as number,
      scannerResults: JSON.parse(row.scanner_results_json as string),
      error: (row.error as string) || undefined,
    };
  }

  private rowToFinding(row: Record<string, unknown>): SecurityFinding {
    return {
      id: row.id as string,
      scanId: row.scan_id as string,
      title: row.title as string,
      description: row.description as string,
      checkId: row.check_id as string,
      scanType: row.scan_type as SecurityFinding["scanType"],
      severity: row.severity as SecurityFinding["severity"],
      confidence: row.confidence as SecurityFinding["confidence"],
      cwe: JSON.parse(row.cwe_json as string),
      owasp: JSON.parse(row.owasp_json as string),
      evidence: JSON.parse(row.evidence_json as string),
      remediation: JSON.parse(row.remediation_json as string),
      standards: row.standards_json ? JSON.parse(row.standards_json as string) : undefined,
      createdAt: row.created_at as string,
      status: row.status as SecurityFinding["status"],
    };
  }

  close(): void {
    this.db.close();
  }
}
