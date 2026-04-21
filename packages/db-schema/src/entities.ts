/**
 * Entity graph + federation tables.
 *
 * Consolidates entity-model's SQLite `entities` table and Local-ID's Postgres
 * `entities` table into a single source of truth. Local-ID's columns (scope,
 * parent_entity_id, user_id) are canonical; federation columns (geid,
 * public_key_pem, home_node_id, federation_consent) and COA compliance columns
 * (source_ip, integrity_hash) from entity-model are merged in.
 *
 * `geid_local` consolidates Local-ID's `geid_local` + entity-model's `geid_mappings`.
 */

import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Entity scope taxonomy:
 * - `local` — `~` prefix aliases; not HIVE-registered, exists only on this node
 * - `registered` — `#` / `$` prefix; HIVE-ID registered (canonical identity)
 * - `federated` — cross-node replica of a remote registered entity
 */
export const entityScopeEnum = pgEnum("entity_scope", [
  "local",
  "registered",
  "federated",
]);

/**
 * Verification tier — progression from unverified → trusted via proof review.
 * `sealed` is the legacy pre-consolidation equivalent of `trusted` (kept for
 * back-compat with rows migrated out of SQLite). `disabled` is a terminal
 * state for entities that have been deactivated (e.g., a user was removed
 * but their historical COA records must persist).
 */
export const verificationTierEnum = pgEnum("verification_tier", [
  "unverified",
  "pending",
  "verified",
  "trusted",
  "sealed",
  "disabled",
]);

/** Federation consent flag — governs cross-node data sharing. */
export const federationConsentEnum = pgEnum("federation_consent", [
  "none",
  "discoverable",
  "full",
]);

/**
 * Entity registry — individuals (#E), organizations (#O), teams (#T),
 * families (#F), agents ($A). Root of the identity graph.
 */
export const entities = pgTable(
  "entities",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    displayName: text("display_name").notNull(),
    coaAlias: text("coa_alias").notNull(),
    scope: entityScopeEnum("scope").notNull().default("local"),
    parentEntityId: text("parent_entity_id"),
    userId: text("user_id"),
    verificationTier: verificationTierEnum("verification_tier")
      .notNull()
      .default("unverified"),
    geid: text("geid"),
    publicKeyPem: text("public_key_pem"),
    homeNodeId: text("home_node_id"),
    federationConsent: federationConsentEnum("federation_consent")
      .notNull()
      .default("none"),
    sourceIp: text("source_ip"),
    integrityHash: text("integrity_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    coaAliasIdx: uniqueIndex("entities_coa_alias_idx").on(t.coaAlias),
    parentIdx: index("entities_parent_idx").on(t.parentEntityId),
    userIdx: index("entities_user_idx").on(t.userId),
  }),
);

/**
 * Channel account mapping — links external channel identities (Telegram,
 * Discord, etc.) to AGI entities.
 */
export const channelAccounts = pgTable(
  "channel_accounts",
  {
    id: text("id").primaryKey(),
    entityId: text("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    channel: text("channel").notNull(),
    channelUserId: text("channel_user_id").notNull(),
    verified: boolean("verified").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    channelUserIdx: uniqueIndex("channel_accounts_channel_user_idx").on(
      t.channel,
      t.channelUserId,
    ),
    entityIdx: index("channel_accounts_entity_idx").on(t.entityId),
  }),
);

/**
 * Local GEID keypair storage. Consolidation of entity-model `geid_mappings`
 * and Local-ID `geid_local`. Keyed on entity.
 */
export const geidLocal = pgTable(
  "geid_local",
  {
    entityId: text("entity_id")
      .primaryKey()
      .references(() => entities.id, { onDelete: "cascade" }),
    geid: text("geid").notNull(),
    publicKeyPem: text("public_key_pem").notNull(),
    privateKeyPem: text("private_key_pem"),
    discoverable: boolean("discoverable").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    geidIdx: uniqueIndex("geid_local_geid_idx").on(t.geid),
  }),
);

/** Agent binding — owner ↔ agent relationship (e.g. owner #E0 ↔ agent $A0). */
export const agentBindings = pgTable(
  "agent_bindings",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    agentId: text("agent_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    bindingType: text("binding_type").notNull().default("primary"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    ownerAgentIdx: uniqueIndex("agent_bindings_owner_agent_idx").on(
      t.ownerId,
      t.agentId,
    ),
  }),
);

/** On-chain-ready registration audit — entity creation history with signatures. */
export const registrations = pgTable("registrations", {
  id: text("id").primaryKey(),
  entityId: text("entity_id")
    .notNull()
    .references(() => entities.id, { onDelete: "cascade" }),
  registrationType: text("registration_type").notNull(),
  referrerEntityId: text("referrer_entity_id").references(() => entities.id),
  referralSource: text("referral_source"),
  referralResult: text("referral_result"),
  agentEntityId: text("agent_entity_id").references(() => entities.id),
  recordHash: text("record_hash"),
  recordSignature: text("record_signature"),
  chainTxId: text("chain_tx_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Organization membership — role + impact share allocation. */
export const memberships = pgTable(
  "memberships",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    memberId: text("member_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    status: text("status").notNull().default("pending"),
    impactShare: integer("impact_share_bps").notNull().default(1000),
    invitedBy: text("invited_by").notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgMemberIdx: uniqueIndex("memberships_org_member_idx").on(t.orgId, t.memberId),
  }),
);

/**
 * Access grant — fine-grained role + scope per entity. Used by dashboard
 * permission checks outside of the raw `users.dashboard_role`.
 */
export const accessGrants = pgTable("access_grants", {
  id: text("id").primaryKey(),
  entityId: text("entity_id")
    .notNull()
    .references(() => entities.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("viewer"),
  scope: text("scope").notNull().default("read-only"),
  grantedBy: text("granted_by").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Entity map cache — resolved remote entity → address mappings for federation.
 * Cache-line semantics: rows expire via `expires_at`.
 */
export const entityMapCache = pgTable("entity_map_cache", {
  geid: text("geid").primaryKey(),
  address: text("address").notNull(),
  entityMap: jsonb("entity_map").notNull(),
  homeNodeId: text("home_node_id").notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  version: integer("version").notNull().default(1),
});

/** Known federation peer — for cross-node discovery and data relay. */
export const federationPeers = pgTable("federation_peers", {
  nodeId: text("node_id").primaryKey(),
  geid: text("geid").notNull(),
  endpoint: text("endpoint").notNull(),
  publicKey: text("public_key").notNull(),
  trustLevel: integer("trust_level").notNull().default(0),
  discoveryMethod: text("discovery_method").notNull().default("manual"),
  displayName: text("display_name"),
  lastSeen: timestamp("last_seen", { withTimezone: true }).notNull().defaultNow(),
  lastHandshake: timestamp("last_handshake", { withTimezone: true }),
  failureCount: integer("failure_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
