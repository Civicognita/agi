/**
 * Audit trail tables.
 *
 * Permanent records for compliance + impact accounting. Distinguished from
 * operational state (which lives elsewhere) by append-only semantics — rows
 * are rarely updated and never deleted.
 *
 * `revocation_audit` is the renamed entity-model `sessions` compliance trail
 * (SOC 2 CC6). The other `sessions` table (auth cookies) lives in `auth.ts`.
 */

import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { entities } from "./entities.js";

/** Communication direction. */
export const commsDirectionEnum = pgEnum("comms_direction", [
  "inbound",
  "outbound",
]);

/**
 * COA chain — immutable audit trail of agent actions. Chain-of-authority
 * records per task. Fingerprint is the deterministic hash of the full chain.
 */
export const coaChains = pgTable(
  "coa_chains",
  {
    fingerprint: text("fingerprint").primaryKey(),
    resourceId: text("resource_id").notNull(),
    entityId: text("entity_id")
      .notNull()
      .references(() => entities.id),
    nodeId: text("node_id").notNull(),
    chainCounter: integer("chain_counter").notNull(),
    workType: text("work_type").notNull(),
    ref: text("ref"),
    action: text("action"),
    payloadHash: text("payload_hash"),
    forkId: text("fork_id"),
    sourceIp: text("source_ip"),
    integrityHash: text("integrity_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    entityIdx: index("coa_chains_entity_idx").on(t.entityId),
    createdIdx: index("coa_chains_created_idx").on(t.createdAt),
  }),
);

/**
 * Impact interaction — quantified impact contributions. Links work output
 * value to a COA chain entry. 0bool/quant/bonus/imp_score come from the
 * impact accounting model.
 */
export const impactInteractions = pgTable(
  "impact_interactions",
  {
    id: text("id").primaryKey(),
    entityId: text("entity_id")
      .notNull()
      .references(() => entities.id),
    coaFingerprint: text("coa_fingerprint")
      .notNull()
      .references(() => coaChains.fingerprint),
    channel: text("channel"),
    workType: text("work_type"),
    quant: doublePrecision("quant").notNull(),
    value0bool: doublePrecision("value_0bool").notNull(),
    bonus: doublePrecision("bonus").notNull().default(0),
    impScore: doublePrecision("imp_score").notNull(),
    originNodeId: text("origin_node_id"),
    relaySignature: text("relay_signature"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    entityIdx: index("impact_interactions_entity_idx").on(t.entityId),
    coaIdx: index("impact_interactions_coa_idx").on(t.coaFingerprint),
  }),
);

/**
 * Communication transcript — inbound/outbound channel messages with full
 * payload. Separate from the live `message_queue` runtime (platform.ts).
 */
export const commsLog = pgTable(
  "comms_log",
  {
    id: text("id").primaryKey(),
    channel: text("channel").notNull(),
    direction: commsDirectionEnum("direction").notNull(),
    senderId: text("sender_id").notNull(),
    senderName: text("sender_name"),
    subject: text("subject"),
    preview: text("preview").notNull(),
    fullPayload: jsonb("full_payload").notNull(),
    entityId: text("entity_id").references(() => entities.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    entityIdx: index("comms_log_entity_idx").on(t.entityId),
    createdIdx: index("comms_log_created_idx").on(t.createdAt),
  }),
);

/**
 * LLM usage log — per-invocation token usage, cost, attribution.
 * Drives billing and cost analytics.
 */
export const usageLog = pgTable(
  "usage_log",
  {
    id: text("id").primaryKey(),
    entityId: text("entity_id"),
    projectPath: text("project_path"),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    costUsd: doublePrecision("cost_usd").notNull(),
    coaFingerprint: text("coa_fingerprint"),
    toolCount: integer("tool_count").notNull().default(0),
    loopCount: integer("loop_count").notNull().default(0),
    source: text("source").notNull().default("chat"),
    costMode: text("cost_mode"),
    escalated: boolean("escalated").notNull().default(false),
    originalModel: text("original_model"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    entityIdx: index("usage_log_entity_idx").on(t.entityId),
    providerIdx: index("usage_log_provider_idx").on(t.provider),
    createdIdx: index("usage_log_created_idx").on(t.createdAt),
  }),
);

/** Historical provider account balance snapshots — reconciliation trail. */
export const providerBalanceLog = pgTable(
  "provider_balance_log",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(),
    balanceUsd: doublePrecision("balance_usd").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    providerRecordedIdx: index("provider_balance_log_provider_recorded_idx").on(
      t.provider,
      t.recordedAt,
    ),
  }),
);

/**
 * Revocation audit — compliance trail of all issued/revoked sessions + API
 * keys. Kept permanently for SOC 2 CC6. Separate from `auth_sessions` (which
 * tracks ACTIVE cookies only, deleted on logout/expiry).
 */
export const revocationAudit = pgTable(
  "revocation_audit",
  {
    id: text("id").primaryKey(),
    entityId: text("entity_id"),
    tokenHash: text("token_hash").notNull(),
    kind: text("kind").notNull().default("session"),
    sourceIp: text("source_ip").notNull().default(""),
    userAgent: text("user_agent").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => ({
    entityIdx: index("revocation_audit_entity_idx").on(t.entityId),
    tokenHashIdx: index("revocation_audit_token_hash_idx").on(t.tokenHash),
  }),
);
