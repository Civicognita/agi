/**
 * Compliance tables.
 *
 * Incident response (GDPR 72h / HIPAA 60d), consent records (GDPR Art 6/7),
 * vendor registry (DPA/BAA), verification workflows, cryptographic seals.
 */

import {
  boolean,
  doublePrecision,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { entities } from "./entities.js";

export const incidentSeverityEnum = pgEnum("incident_severity", [
  "low",
  "medium",
  "high",
  "critical",
]);

export const incidentStatusEnum = pgEnum("incident_status", [
  "detected",
  "investigating",
  "contained",
  "resolved",
  "closed",
]);

export const breachClassificationEnum = pgEnum("breach_classification", [
  "under_review",
  "confirmed_breach",
  "no_breach",
  "near_miss",
]);

export const vendorComplianceStatusEnum = pgEnum("vendor_compliance_status", [
  "unknown",
  "reviewing",
  "approved",
  "rejected",
  "terminated",
  // Legacy values kept for pre-consolidation vendor rows. `compliant` was the
  // SQLite-era synonym for `approved`; rows are migrated as-is rather than
  // remapped so historical audit trails stay accurate.
  "compliant",
]);

export const verificationStatusEnum = pgEnum("verification_status", [
  "pending",
  "approved",
  "rejected",
  "escalated",
]);

export const sealStatusEnum = pgEnum("seal_status", [
  "active",
  "revoked",
  "expired",
]);

/** Security incident tracking — breach notification deadlines + containment. */
export const incidents = pgTable(
  "incidents",
  {
    id: text("id").primaryKey(),
    severity: incidentSeverityEnum("severity").notNull().default("medium"),
    status: incidentStatusEnum("status").notNull().default("detected"),
    breachClassification: breachClassificationEnum("breach_classification")
      .notNull()
      .default("under_review"),
    title: text("title").notNull(),
    description: text("description").notNull(),
    affectedDataTypes: jsonb("affected_data_types"),
    affectedSystems: jsonb("affected_systems"),
    detectionTime: timestamp("detection_time", { withTimezone: true }).notNull(),
    awarenessTime: timestamp("awareness_time", { withTimezone: true }).notNull(),
    containmentTime: timestamp("containment_time", { withTimezone: true }),
    resolutionTime: timestamp("resolution_time", { withTimezone: true }),
    gdprDeadline: timestamp("gdpr_deadline", { withTimezone: true }),
    hipaaDeadline: timestamp("hipaa_deadline", { withTimezone: true }),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    statusIdx: index("incidents_status_idx").on(t.status),
    severityIdx: index("incidents_severity_idx").on(t.severity),
  }),
);

/** User consent records per purpose — GDPR Art 6/7 lawful basis trail. */
export const consents = pgTable(
  "consents",
  {
    id: text("id").primaryKey(),
    entityId: text("entity_id").notNull(),
    purpose: text("purpose").notNull(),
    granted: boolean("granted").notNull().default(false),
    source: text("source").notNull().default("system"),
    version: text("version").notNull().default("1.0"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    entityPurposeIdx: uniqueIndex("consents_entity_purpose_idx").on(
      t.entityId,
      t.purpose,
    ),
  }),
);

/** Third-party vendor registry — DPA/BAA status, compliance review cadence. */
export const vendors = pgTable(
  "vendors",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    type: text("type").notNull().default("other"),
    description: text("description"),
    complianceStatus: vendorComplianceStatusEnum("compliance_status")
      .notNull()
      .default("unknown"),
    dpaSigned: boolean("dpa_signed").notNull().default(false),
    baaSigned: boolean("baa_signed").notNull().default(false),
    lastReviewDate: timestamp("last_review_date", { withTimezone: true }),
    nextReviewDate: timestamp("next_review_date", { withTimezone: true }),
    certifications: jsonb("certifications"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    nameIdx: uniqueIndex("vendors_name_idx").on(t.name),
  }),
);

/** Entity verification workflow — proof submission, review, decision. */
export const verificationRequests = pgTable(
  "verification_requests",
  {
    id: text("id").primaryKey(),
    entityId: text("entity_id")
      .notNull()
      .references(() => entities.id),
    entityType: text("entity_type").notNull(),
    status: verificationStatusEnum("status").notNull().default("pending"),
    proofType: text("proof_type").notNull(),
    proofPayload: jsonb("proof_payload").notNull(),
    proofSubmittedAt: timestamp("proof_submitted_at", { withTimezone: true }).notNull(),
    proofSubmittedBy: text("proof_submitted_by").notNull(),
    reviewerId: text("reviewer_id"),
    decision: text("decision"),
    decisionReason: text("decision_reason"),
    decisionAt: timestamp("decision_at", { withTimezone: true }),
    coaFingerprint: text("coa_fingerprint"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    entityIdx: index("verification_requests_entity_idx").on(t.entityId),
    statusIdx: index("verification_requests_status_idx").on(t.status),
  }),
);

/** Cryptographic seal — proof of entity verification or compliance attestation. */
export const seals = pgTable(
  "seals",
  {
    sealId: text("seal_id").primaryKey(),
    entityId: text("entity_id")
      .notNull()
      .references(() => entities.id),
    entityType: text("entity_type").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
    issuedBy: text("issued_by").notNull(),
    coa: text("coa").notNull(),
    alignmentAa: doublePrecision("alignment_aa").notNull(),
    alignmentUu: doublePrecision("alignment_uu").notNull(),
    alignmentCc: doublePrecision("alignment_cc").notNull(),
    checksum: text("checksum").notNull(),
    grid: text("grid").notNull(),
    status: sealStatusEnum("status").notNull().default("active"),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedBy: text("revoked_by"),
    revokeReason: text("revoke_reason"),
  },
  (t) => ({
    entityIdx: index("seals_entity_idx").on(t.entityId),
    statusIdx: index("seals_status_idx").on(t.status),
  }),
);
