/**
 * IncidentStore — security incident tracking for compliance.
 *
 * Tracks incidents with severity, status, breach classification,
 * and notification clock (GDPR 72h, HIPAA 60d).
 *
 * Compliance: UCS-IR-01 (HIPAA breach ≤60d, GDPR ≤72h, PCI incident support).
 */

import { and, eq, isNotNull, lt, or, sql } from "drizzle-orm";
import { ulid } from "ulid";
import type { Db } from "@agi/db-schema/client";
import { incidents } from "@agi/db-schema";

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

// ---------------------------------------------------------------------------
// Row mapper
// ---------------------------------------------------------------------------

function toIso(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  return d instanceof Date ? d.toISOString() : String(d);
}

function toIncident(row: typeof incidents.$inferSelect): Incident {
  const dataTypes = Array.isArray(row.affectedDataTypes)
    ? (row.affectedDataTypes as string[])
    : [];
  const systems = Array.isArray(row.affectedSystems)
    ? (row.affectedSystems as string[])
    : [];

  return {
    id: row.id,
    severity: row.severity as IncidentSeverity,
    status: row.status as IncidentStatus,
    breachClassification: (row.breachClassification ?? "under_review") as BreachClassification,
    title: row.title,
    description: row.description,
    affectedDataTypes: dataTypes,
    affectedSystems: systems,
    detectionTime: toIso(row.detectionTime) ?? "",
    awarenessTime: toIso(row.awarenessTime) ?? "",
    containmentTime: toIso(row.containmentTime),
    resolutionTime: toIso(row.resolutionTime),
    gdprDeadline: toIso(row.gdprDeadline),
    hipaaDeadline: toIso(row.hipaaDeadline),
    createdBy: row.createdBy,
    createdAt: toIso(row.createdAt) ?? "",
    updatedAt: toIso(row.updatedAt) ?? "",
  };
}

// ---------------------------------------------------------------------------
// IncidentStore
// ---------------------------------------------------------------------------

export class IncidentStore {
  constructor(private readonly db: Db) {}

  async create(params: CreateIncidentParams): Promise<Incident> {
    const now = new Date();
    const id = ulid();

    const gdprDeadline = new Date(Date.now() + 72 * 60 * 60 * 1000);
    const hipaaDeadline = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);

    await this.db.insert(incidents).values({
      id,
      severity: (params.severity ?? "medium") as typeof incidents.$inferInsert["severity"],
      status: "detected",
      breachClassification: (params.breachClassification ?? "under_review") as typeof incidents.$inferInsert["breachClassification"],
      title: params.title,
      description: params.description,
      affectedDataTypes: (params.affectedDataTypes ?? []) as unknown as Record<string, unknown>,
      affectedSystems: (params.affectedSystems ?? []) as unknown as Record<string, unknown>,
      detectionTime: now,
      awarenessTime: now,
      gdprDeadline,
      hipaaDeadline,
      createdBy: params.createdBy ?? "system",
      createdAt: now,
      updatedAt: now,
    });

    const record = await this.get(id);
    return record!;
  }

  async get(id: string): Promise<Incident | null> {
    const [row] = await this.db.select().from(incidents).where(eq(incidents.id, id));
    return row ? toIncident(row) : null;
  }

  async list(limit = 50): Promise<Incident[]> {
    const rows = await this.db
      .select()
      .from(incidents)
      .orderBy(sql`${incidents.createdAt} DESC`)
      .limit(limit);
    return rows.map(toIncident);
  }

  async updateStatus(id: string, status: IncidentStatus): Promise<void> {
    const now = new Date();
    await this.db.update(incidents)
      .set({ status: status as typeof incidents.$inferInsert["status"], updatedAt: now })
      .where(eq(incidents.id, id));

    if (status === "contained") {
      await this.db.update(incidents)
        .set({ containmentTime: now })
        .where(and(eq(incidents.id, id), sql`${incidents.containmentTime} IS NULL`));
    }
    if (status === "resolved" || status === "closed") {
      await this.db.update(incidents)
        .set({ resolutionTime: now })
        .where(and(eq(incidents.id, id), sql`${incidents.resolutionTime} IS NULL`));
    }
  }

  async updateBreachClassification(id: string, classification: BreachClassification): Promise<void> {
    const now = new Date();
    const gdpr = classification.includes("gdpr") || classification === "reportable_both"
      ? new Date(Date.now() + 72 * 60 * 60 * 1000) : null;
    const hipaa = classification.includes("hipaa") || classification === "reportable_both"
      ? new Date(Date.now() + 60 * 24 * 60 * 60 * 1000) : null;

    await this.db.update(incidents)
      .set({
        breachClassification: classification as typeof incidents.$inferInsert["breachClassification"],
        gdprDeadline: gdpr,
        hipaaDeadline: hipaa,
        updatedAt: now,
      })
      .where(eq(incidents.id, id));
  }

  async getOverdue(): Promise<Incident[]> {
    const now = new Date();
    const rows = await this.db
      .select()
      .from(incidents)
      .where(
        and(
          sql`${incidents.status} NOT IN ('resolved', 'closed')`,
          or(
            and(isNotNull(incidents.gdprDeadline), lt(incidents.gdprDeadline, now)),
            and(isNotNull(incidents.hipaaDeadline), lt(incidents.hipaaDeadline, now)),
          ),
        ),
      )
      .orderBy(sql`${incidents.createdAt} DESC`);
    return rows.map(toIncident);
  }
}
