/**
 * Security scanning tables.
 *
 * Tracks security scan runs (SAST, DAST, SCA, secrets, config, container) and
 * the findings produced by each scan. These are NOT in the shared schema by
 * default — they live here so the security package can use the unified agi_data
 * database instead of a separate SQLite file.
 */

import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const scanStatusEnum = pgEnum("scan_status", [
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

export const findingSeverityEnum = pgEnum("finding_severity", [
  "critical",
  "high",
  "medium",
  "low",
  "info",
]);

export const findingConfidenceEnum = pgEnum("finding_confidence", [
  "high",
  "medium",
  "low",
]);

export const findingStatusEnum = pgEnum("finding_status", [
  "open",
  "acknowledged",
  "mitigated",
  "false_positive",
]);

/**
 * Security scan run — one row per scan invocation. Tracks lifecycle state,
 * per-severity finding counts, and serialised scanner results.
 */
export const scanRuns = pgTable(
  "scan_runs",
  {
    id: text("id").primaryKey(),
    status: scanStatusEnum("status").notNull().default("pending"),
    config: jsonb("config").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    findingCounts: jsonb("finding_counts").notNull().default("{}"),
    totalFindings: integer("total_findings").notNull().default(0),
    scannerResults: jsonb("scanner_results").notNull().default("[]"),
    error: text("error"),
  },
  (t) => ({
    statusIdx: index("scan_runs_status_idx").on(t.status),
    startedIdx: index("scan_runs_started_idx").on(t.startedAt),
  }),
);

/**
 * Security finding — one row per vulnerability/issue detected within a scan.
 * Evidence, remediation, and standards mappings are stored as jsonb.
 */
export const securityFindings = pgTable(
  "security_findings",
  {
    id: text("id").primaryKey(),
    scanId: text("scan_id")
      .notNull()
      .references(() => scanRuns.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    checkId: text("check_id").notNull(),
    scanType: text("scan_type").notNull(),
    severity: findingSeverityEnum("severity").notNull(),
    confidence: findingConfidenceEnum("confidence").notNull().default("medium"),
    cwe: jsonb("cwe").notNull().default("[]"),
    owasp: jsonb("owasp").notNull().default("[]"),
    evidence: jsonb("evidence").notNull().default("{}"),
    remediation: jsonb("remediation").notNull().default("{}"),
    standards: jsonb("standards"),
    status: findingStatusEnum("status").notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    scanIdx: index("security_findings_scan_idx").on(t.scanId),
    severityIdx: index("security_findings_severity_idx").on(t.severity),
    statusIdx: index("security_findings_status_idx").on(t.status),
    scanTypeIdx: index("security_findings_scan_type_idx").on(t.scanType),
    createdIdx: index("security_findings_created_idx").on(t.createdAt),
  }),
);
