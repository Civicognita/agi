/**
 * IncidentStore — security incident tracking for compliance.
 *
 * Tracks incidents with severity, status, breach classification,
 * and notification clock (GDPR 72h, HIPAA 60d).
 *
 * Compliance: UCS-IR-01 (HIPAA breach ≤60d, GDPR ≤72h, PCI incident support).
 */

import type BetterSqlite3 from "better-sqlite3";
import { ulid } from "ulid";
import type { Database } from "./db.js";

type NamedStmt<P extends object> = BetterSqlite3.Statement<[P]>;
type PosStmt<P extends unknown[]> = BetterSqlite3.Statement<P>;

export type IncidentSeverity = "critical" | "high" | "medium" | "low" | "info";
export type IncidentStatus = "detected" | "investigating" | "contained" | "resolved" | "closed";
export type BreachClassification = "reportable_hipaa" | "reportable_gdpr" | "reportable_both" | "not_reportable" | "under_review";

export interface Incident {
  id: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  breachClassification: BreachClassification;
  title: string;
  description: string;
  affectedDataTypes: string[];
  affectedSystems: string[];
  detectionTime: string;
  awarenessTime: string;
  containmentTime: string | null;
  resolutionTime: string | null;
  gdprDeadline: string | null;
  hipaaDeadline: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateIncidentParams {
  severity: IncidentSeverity;
  title: string;
  description: string;
  affectedDataTypes?: string[];
  affectedSystems?: string[];
  breachClassification?: BreachClassification;
  createdBy?: string;
}

interface IncidentRow {
  id: string;
  severity: string;
  status: string;
  breach_classification: string;
  title: string;
  description: string;
  affected_data_types: string;
  affected_systems: string;
  detection_time: string;
  awareness_time: string;
  containment_time: string | null;
  resolution_time: string | null;
  gdpr_deadline: string | null;
  hipaa_deadline: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

function toIncident(row: IncidentRow): Incident {
  return {
    id: row.id,
    severity: row.severity as IncidentSeverity,
    status: row.status as IncidentStatus,
    breachClassification: row.breach_classification as BreachClassification,
    title: row.title,
    description: row.description,
    affectedDataTypes: JSON.parse(row.affected_data_types) as string[],
    affectedSystems: JSON.parse(row.affected_systems) as string[],
    detectionTime: row.detection_time,
    awarenessTime: row.awareness_time,
    containmentTime: row.containment_time,
    resolutionTime: row.resolution_time,
    gdprDeadline: row.gdpr_deadline,
    hipaaDeadline: row.hipaa_deadline,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const CREATE_INCIDENTS = `
CREATE TABLE IF NOT EXISTS incidents (
  id                    TEXT NOT NULL PRIMARY KEY,
  severity              TEXT NOT NULL DEFAULT 'medium',
  status                TEXT NOT NULL DEFAULT 'detected',
  breach_classification TEXT NOT NULL DEFAULT 'under_review',
  title                 TEXT NOT NULL,
  description           TEXT NOT NULL DEFAULT '',
  affected_data_types   TEXT NOT NULL DEFAULT '[]',
  affected_systems      TEXT NOT NULL DEFAULT '[]',
  detection_time        TEXT NOT NULL,
  awareness_time        TEXT NOT NULL,
  containment_time      TEXT,
  resolution_time       TEXT,
  gdpr_deadline         TEXT,
  hipaa_deadline        TEXT,
  created_by            TEXT NOT NULL DEFAULT 'system',
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
)` as const;

export class IncidentStore {
  private readonly stmtInsert: NamedStmt<Record<string, unknown>>;
  private readonly stmtGetAll: PosStmt<[number]>;
  private readonly stmtGetOne: PosStmt<[string]>;
  private readonly stmtUpdateStatus: PosStmt<[string, string, string]>;
  private readonly stmtUpdateBreach: PosStmt<[string, string | null, string | null, string, string]>;

  constructor(private readonly db: Database) {
    db.exec(CREATE_INCIDENTS);

    this.stmtInsert = db.prepare(`
      INSERT INTO incidents (id, severity, status, breach_classification, title, description,
        affected_data_types, affected_systems, detection_time, awareness_time,
        gdpr_deadline, hipaa_deadline, created_by, created_at, updated_at)
      VALUES (@id, @severity, @status, @breach_classification, @title, @description,
        @affected_data_types, @affected_systems, @detection_time, @awareness_time,
        @gdpr_deadline, @hipaa_deadline, @created_by, @created_at, @updated_at)
    `);

    this.stmtGetAll = db.prepare(`SELECT * FROM incidents ORDER BY created_at DESC LIMIT ?`);
    this.stmtGetOne = db.prepare(`SELECT * FROM incidents WHERE id = ?`);
    this.stmtUpdateStatus = db.prepare(`UPDATE incidents SET status = ?, updated_at = ? WHERE id = ?`);
    this.stmtUpdateBreach = db.prepare(`UPDATE incidents SET breach_classification = ?, gdpr_deadline = ?, hipaa_deadline = ?, updated_at = ? WHERE id = ?`);
  }

  create(params: CreateIncidentParams): Incident {
    const now = new Date().toISOString();
    const id = ulid();

    // GDPR: 72 hours from awareness
    const gdprDeadline = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
    // HIPAA: 60 days from discovery
    const hipaaDeadline = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();

    this.stmtInsert.run({
      id,
      severity: params.severity,
      status: "detected",
      breach_classification: params.breachClassification ?? "under_review",
      title: params.title,
      description: params.description,
      affected_data_types: JSON.stringify(params.affectedDataTypes ?? []),
      affected_systems: JSON.stringify(params.affectedSystems ?? []),
      detection_time: now,
      awareness_time: now,
      gdpr_deadline: gdprDeadline,
      hipaa_deadline: hipaaDeadline,
      created_by: params.createdBy ?? "system",
      created_at: now,
      updated_at: now,
    });

    return this.get(id)!;
  }

  get(id: string): Incident | null {
    const row = this.stmtGetOne.get(id) as IncidentRow | undefined;
    return row ? toIncident(row) : null;
  }

  list(limit = 50): Incident[] {
    return (this.stmtGetAll.all(limit) as IncidentRow[]).map(toIncident);
  }

  updateStatus(id: string, status: IncidentStatus): void {
    const now = new Date().toISOString();
    this.stmtUpdateStatus.run(status, now, id);

    // Auto-set containment/resolution times
    if (status === "contained") {
      this.db.prepare(`UPDATE incidents SET containment_time = ? WHERE id = ? AND containment_time IS NULL`).run(now, id);
    }
    if (status === "resolved" || status === "closed") {
      this.db.prepare(`UPDATE incidents SET resolution_time = ? WHERE id = ? AND resolution_time IS NULL`).run(now, id);
    }
  }

  updateBreachClassification(id: string, classification: BreachClassification): void {
    const now = new Date().toISOString();
    const gdpr = classification.includes("gdpr") || classification === "reportable_both"
      ? new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString() : null;
    const hipaa = classification.includes("hipaa") || classification === "reportable_both"
      ? new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString() : null;
    this.stmtUpdateBreach.run(classification, gdpr, hipaa, now, id);
  }

  getOverdue(): Incident[] {
    const now = new Date().toISOString();
    const rows = this.db.prepare(`
      SELECT * FROM incidents
      WHERE status NOT IN ('resolved', 'closed')
        AND ((gdpr_deadline IS NOT NULL AND gdpr_deadline < ?) OR (hipaa_deadline IS NOT NULL AND hipaa_deadline < ?))
      ORDER BY created_at DESC
    `).all(now, now) as IncidentRow[];
    return rows.map(toIncident);
  }
}
