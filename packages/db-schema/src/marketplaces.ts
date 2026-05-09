/**
 * Marketplace tables.
 *
 * **These tables are index caches, not source of truth.** The canonical data
 * lives in the marketplace repo manifests (Plugin Marketplace repo, MApp
 * Marketplace repo). These tables exist so AGI doesn't hit each manifest
 * constantly — they're refreshed on agi config change OR when a new version
 * of a marketplace repo is detected and pulled.
 *
 * Running-code caches on the MarketplaceManager drive status checks, NOT DB
 * reads (per owner direction 2026-04-21).
 *
 * Each `*_marketplace` catalog table includes a `source` column (`official` /
 * `owner-fork` / `third-party`) so Dev Mode can track which fork a plugin
 * came from and the dashboard can surface provenance.
 */

import {
  bigserial,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const marketplaceSourceEnum = pgEnum("marketplace_source", [
  "official",
  "owner-fork",
  "third-party",
]);

/**
 * Plugin marketplace catalog index.
 *
 * One row per (plugin name, source). `source` distinguishes the Civicognita
 * official marketplace from owner custodian forks and community third-party
 * catalogs.
 */
export const pluginsMarketplace = pgTable(
  "plugins_marketplace",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    name: text("name").notNull(),
    source: marketplaceSourceEnum("source").notNull().default("official"),
    sourceRef: text("source_ref").notNull(),
    description: text("description"),
    type: text("type").notNull().default("plugin"),
    version: text("version").notNull(),
    authorName: text("author_name"),
    authorEmail: text("author_email"),
    category: text("category"),
    tags: jsonb("tags"),
    keywords: jsonb("keywords"),
    license: text("license"),
    homepage: text("homepage"),
    provides: jsonb("provides"),
    depends: jsonb("depends"),
    /** Previous names this plugin used. Catalog matcher resolves either
     *  the primary name OR any alias (see MarketplacePluginEntry.aliases
     *  + marketplace-manager dependency lookup). Persists Phase M's
     *  aionima-* → agi-* rename mapping so older requires: arrays in
     *  stack manifests keep resolving. */
    aliases: jsonb("aliases"),
    trustTier: text("trust_tier"),
    integrityHash: text("integrity_hash"),
    signedBy: text("signed_by"),
    manifest: jsonb("manifest"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    nameSourceIdx: uniqueIndex("plugins_marketplace_name_source_idx").on(
      t.name,
      t.sourceRef,
    ),
    sourceIdx: index("plugins_marketplace_source_idx").on(t.source),
    typeIdx: index("plugins_marketplace_type_idx").on(t.type),
  }),
);

/**
 * Locally installed plugin state — what's actually active on this node.
 * Separate from the catalog above (which may list plugins that aren't
 * installed).
 */
export const pluginsInstalled = pgTable(
  "plugins_installed",
  {
    name: text("name").primaryKey(),
    source: marketplaceSourceEnum("source").notNull().default("official"),
    sourceRef: text("source_ref").notNull(),
    type: text("type").notNull().default("plugin"),
    version: text("version").notNull(),
    installPath: text("install_path"),
    integrityHash: text("integrity_hash"),
    trustTier: text("trust_tier"),
    installedAt: timestamp("installed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    sourceIdx: index("plugins_installed_source_idx").on(t.source),
  }),
);

/**
 * MApp marketplace catalog index. Same shape rationale as plugins_marketplace.
 */
export const mappsMarketplace = pgTable(
  "mapps_marketplace",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    mappId: text("mapp_id").notNull(),
    source: marketplaceSourceEnum("source").notNull().default("official"),
    sourceRef: text("source_ref").notNull(),
    author: text("author").notNull().default("civicognita"),
    /** Human-readable display name from the MApp manifest (s145 t598).
     *  Nullable for backward compat — older catalogs without this field
     *  fall back to a humanized id in the dashboard. */
    name: text("name"),
    description: text("description"),
    category: text("category"),
    version: text("version").notNull(),
    sourcePath: text("source_path"),
    manifest: jsonb("manifest"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    mappSourceIdx: uniqueIndex("mapps_marketplace_mapp_source_idx").on(
      t.mappId,
      t.sourceRef,
    ),
    sourceIdx: index("mapps_marketplace_source_idx").on(t.source),
  }),
);

/** Locally installed MApp state. */
export const mappsInstalled = pgTable(
  "mapps_installed",
  {
    mappId: text("mapp_id").primaryKey(),
    source: marketplaceSourceEnum("source").notNull().default("official"),
    sourceRef: text("source_ref").notNull(),
    version: text("version").notNull(),
    installPath: text("install_path"),
    installedAt: timestamp("installed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    sourceIdx: index("mapps_installed_source_idx").on(t.source),
  }),
);
