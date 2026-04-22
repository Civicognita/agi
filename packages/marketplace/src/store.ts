/**
 * MarketplaceStore — Postgres/drizzle persistence for plugin and MApp catalog +
 * installed state.
 *
 * Uses four tables from @agi/db-schema:
 *   - pluginsMarketplace  — catalog index (one row per plugin name + sourceRef)
 *   - pluginsInstalled    — locally installed plugin state
 *   - mappsMarketplace    — MApp catalog index
 *   - mappsInstalled      — locally installed MApp state
 *
 * Runtime status ("is this plugin active?") is NOT stored in DB — that lives
 * in the MarketplaceManager's in-memory cache (per owner direction 2026-04-21).
 */

import { and, eq, ilike, or, sql } from "drizzle-orm";
import type { Db } from "@agi/db-schema/client";
import {
  pluginsMarketplace,
  pluginsInstalled,
  mappsMarketplace,
  mappsInstalled,
} from "@agi/db-schema";
import type {
  MarketplacePluginEntry,
  MarketplaceItemType,
  InstalledItem,
  CatalogDiff,
  CatalogSearchParams,
  TrustTier,
  MAppCatalogEntry,
} from "./types.js";

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

function rowToPluginEntry(
  row: typeof pluginsMarketplace.$inferSelect,
): MarketplacePluginEntry & { sourceRef: string } {
  // The `source` column actually holds the trust-tier label
  // ("official" / "third-party"), NOT the install-path source. The
  // real install source (relative path like "./plugins/plugin-X" or
  // a GitHubSource object) lives in the `manifest` JSONB column.
  // Without reading from manifest, installer.ts gets row.sourceRef
  // (the GitHub ref) as the "source" and tries to find it as a
  // literal subdirectory, which fails with
  // "Subdirectory 'wishborn/agi-marketplace#dev' not found".
  const manifestSource = (row.manifest as Record<string, unknown> | null)?.["source"];
  const resolvedSource = (manifestSource ?? row.sourceRef) as MarketplacePluginEntry["source"];
  return {
    name: row.name,
    source: resolvedSource,
    description: row.description ?? undefined,
    type: (row.type as MarketplaceItemType) ?? "plugin",
    version: row.version,
    author: row.authorName ? { name: row.authorName, email: row.authorEmail ?? undefined } : undefined,
    category: row.category ?? undefined,
    tags: Array.isArray(row.tags) ? row.tags as string[] : undefined,
    keywords: Array.isArray(row.keywords) ? row.keywords as string[] : undefined,
    license: row.license ?? undefined,
    homepage: row.homepage ?? undefined,
    provides: Array.isArray(row.provides) ? row.provides as string[] : undefined,
    depends: Array.isArray(row.depends) ? row.depends as string[] : undefined,
    trustTier: (row.trustTier as TrustTier | null) ?? undefined,
    integrityHash: row.integrityHash ?? undefined,
    signedBy: row.signedBy ?? undefined,
    sourceRef: row.sourceRef,
  };
}

function rowToInstalledItem(
  row: typeof pluginsInstalled.$inferSelect,
): InstalledItem {
  return {
    name: row.name,
    sourceId: 0, // legacy field — no longer stored; set to 0
    type: row.type as MarketplaceItemType,
    version: row.version,
    installedAt: row.installedAt instanceof Date ? row.installedAt.toISOString() : String(row.installedAt),
    installPath: row.installPath ?? "",
    sourceJson: row.sourceRef,
    integrityHash: row.integrityHash ?? undefined,
    trustTier: (row.trustTier as TrustTier | null) ?? undefined,
  };
}

function rowToMAppEntry(
  row: typeof mappsMarketplace.$inferSelect,
): MAppCatalogEntry {
  return {
    id: row.mappId,
    sourceId: 0, // legacy field
    author: row.author,
    description: row.description ?? undefined,
    category: row.category ?? undefined,
    version: row.version,
    sourcePath: row.sourcePath ?? `mapps/${row.author}/${row.mappId}.json`,
  };
}

// ---------------------------------------------------------------------------
// MarketplaceStore
// ---------------------------------------------------------------------------

export class MarketplaceStore {
  constructor(private readonly db: Db) {}

  // -------------------------------------------------------------------------
  // Plugin catalog
  // -------------------------------------------------------------------------

  /**
   * Replace the catalog for a sourceRef with the just-fetched plugins. Returns a
   * CatalogDiff describing what changed relative to the previous state.
   */
  async syncPlugins(
    sourceRef: string,
    plugins: MarketplacePluginEntry[],
  ): Promise<CatalogDiff> {
    // Determine marketplace source type based on sourceRef
    const isOfficial = /Civicognita/i.test(sourceRef);
    const sourceType = isOfficial ? "official" : "third-party";

    // Capture previous state for diffing
    const prevRows = await this.db
      .select({ name: pluginsMarketplace.name, version: pluginsMarketplace.version })
      .from(pluginsMarketplace)
      .where(eq(pluginsMarketplace.sourceRef, sourceRef));

    const prev = new Map<string, string>();
    for (const row of prevRows) prev.set(row.name, row.version);

    const next = new Map<string, string>();
    for (const p of plugins) next.set(p.name, p.version ?? "");

    const added: string[] = [];
    const updated: Array<{ name: string; from: string; to: string }> = [];
    for (const [name, toVer] of next) {
      if (!prev.has(name)) {
        added.push(name);
      } else {
        const fromVer = prev.get(name)!;
        if (fromVer !== toVer) updated.push({ name, from: fromVer, to: toVer });
      }
    }
    const removed: string[] = [];
    for (const name of prev.keys()) {
      if (!next.has(name)) removed.push(name);
    }

    // Replace catalog for this sourceRef atomically
    await this.db.transaction(async (tx) => {
      await tx
        .delete(pluginsMarketplace)
        .where(eq(pluginsMarketplace.sourceRef, sourceRef));

      if (plugins.length > 0) {
        await tx.insert(pluginsMarketplace).values(
          plugins.map((p) => ({
            name: p.name,
            source: sourceType as typeof pluginsMarketplace.$inferInsert["source"],
            sourceRef,
            description: p.description ?? null,
            type: p.type ?? "plugin",
            version: p.version ?? "",
            authorName: p.author?.name ?? null,
            authorEmail: p.author?.email ?? null,
            category: p.category ?? null,
            tags: (p.tags ?? null) as unknown[] | null,
            keywords: (p.keywords ?? null) as unknown[] | null,
            license: p.license ?? null,
            homepage: p.homepage ?? null,
            provides: (p.provides ?? null) as unknown[] | null,
            depends: (p.depends ?? null) as unknown[] | null,
            trustTier: p.trustTier ?? (isOfficial ? "official" : "unknown"),
            integrityHash: p.integrityHash ?? null,
            signedBy: p.signedBy ?? null,
            manifest: (typeof p.source === "object" && p.source !== null ? p.source : { source: p.source }) as Record<string, unknown>,
          })),
        );
      }
    });

    return { added, updated, removed, total: plugins.length };
  }

  async searchPlugins(
    params: CatalogSearchParams,
  ): Promise<(MarketplacePluginEntry & { sourceRef: string })[]> {
    const conditions = [];

    if (params.type) conditions.push(eq(pluginsMarketplace.type, params.type));
    if (params.category) conditions.push(eq(pluginsMarketplace.category, params.category));
    if (params.provides) {
      conditions.push(
        sql`${pluginsMarketplace.provides}::text LIKE ${"%" + params.provides + "%"}`,
      );
    }
    if (params.q) {
      conditions.push(
        or(
          ilike(pluginsMarketplace.name, `%${params.q}%`),
          ilike(pluginsMarketplace.description, `%${params.q}%`),
        ),
      );
    }

    const rows = conditions.length > 0
      ? await this.db.select().from(pluginsMarketplace).where(and(...conditions))
      : await this.db.select().from(pluginsMarketplace);

    return rows.map(rowToPluginEntry);
  }

  async getPlugin(
    name: string,
    sourceRef: string,
  ): Promise<(MarketplacePluginEntry & { sourceRef: string }) | undefined> {
    const [row] = await this.db
      .select()
      .from(pluginsMarketplace)
      .where(
        and(
          eq(pluginsMarketplace.name, name),
          eq(pluginsMarketplace.sourceRef, sourceRef),
        ),
      );
    return row ? rowToPluginEntry(row) : undefined;
  }

  // -------------------------------------------------------------------------
  // Installed plugins
  // -------------------------------------------------------------------------

  async addInstalled(item: InstalledItem): Promise<void> {
    await this.db
      .insert(pluginsInstalled)
      .values({
        name: item.name,
        source: "official",
        sourceRef: item.sourceJson,
        type: item.type,
        version: item.version,
        installPath: item.installPath,
        integrityHash: item.integrityHash ?? null,
        trustTier: (item.trustTier ?? "unknown") as typeof pluginsInstalled.$inferInsert["trustTier"],
        installedAt: new Date(item.installedAt),
      })
      .onConflictDoUpdate({
        target: pluginsInstalled.name,
        set: {
          sourceRef: item.sourceJson,
          type: item.type,
          version: item.version,
          installPath: item.installPath,
          integrityHash: item.integrityHash ?? null,
          trustTier: (item.trustTier ?? "unknown") as typeof pluginsInstalled.$inferInsert["trustTier"],
          installedAt: new Date(item.installedAt),
        },
      });
  }

  async removeInstalled(name: string): Promise<void> {
    await this.db
      .delete(pluginsInstalled)
      .where(eq(pluginsInstalled.name, name));
  }

  async getInstalled(): Promise<InstalledItem[]> {
    const rows = await this.db.select().from(pluginsInstalled);
    return rows.map(rowToInstalledItem);
  }

  async isInstalled(name: string): Promise<boolean> {
    const [row] = await this.db
      .select({ name: pluginsInstalled.name })
      .from(pluginsInstalled)
      .where(eq(pluginsInstalled.name, name));
    return row !== undefined;
  }

  // -------------------------------------------------------------------------
  // MApp catalog
  // -------------------------------------------------------------------------

  async syncMApps(
    sourceRef: string,
    mapps: Array<{
      id: string;
      author?: string;
      description?: string;
      category?: string;
      version?: string;
      source?: string;
    }>,
  ): Promise<void> {
    const isOfficial = /Civicognita/i.test(sourceRef);

    await this.db.transaction(async (tx) => {
      await tx
        .delete(mappsMarketplace)
        .where(eq(mappsMarketplace.sourceRef, sourceRef));

      if (mapps.length > 0) {
        await tx.insert(mappsMarketplace).values(
          mapps.map((m) => {
            const author = m.author ?? "civicognita";
            const sourcePath = m.source?.replace(/^\.\//, "") ?? `mapps/${author}/${m.id}.json`;
            return {
              mappId: m.id,
              source: (isOfficial ? "official" : "third-party") as typeof mappsMarketplace.$inferInsert["source"],
              sourceRef,
              author,
              description: m.description ?? null,
              category: m.category ?? null,
              version: m.version ?? "",
              sourcePath,
            };
          }),
        );
      }
    });
  }

  async getMAppCatalog(sourceRef?: string): Promise<MAppCatalogEntry[]> {
    const rows = sourceRef
      ? await this.db
          .select()
          .from(mappsMarketplace)
          .where(eq(mappsMarketplace.sourceRef, sourceRef))
      : await this.db.select().from(mappsMarketplace);
    return rows.map(rowToMAppEntry);
  }

  async getMApp(
    mappId: string,
    sourceRef: string,
  ): Promise<MAppCatalogEntry | undefined> {
    const [row] = await this.db
      .select()
      .from(mappsMarketplace)
      .where(
        and(
          eq(mappsMarketplace.mappId, mappId),
          eq(mappsMarketplace.sourceRef, sourceRef),
        ),
      );
    return row ? rowToMAppEntry(row) : undefined;
  }

  // -------------------------------------------------------------------------
  // Installed MApps
  // -------------------------------------------------------------------------

  async addInstalledMApp(params: {
    mappId: string;
    sourceRef: string;
    version: string;
    installPath?: string;
  }): Promise<void> {
    await this.db
      .insert(mappsInstalled)
      .values({
        mappId: params.mappId,
        source: "official",
        sourceRef: params.sourceRef,
        version: params.version,
        installPath: params.installPath ?? null,
      })
      .onConflictDoUpdate({
        target: mappsInstalled.mappId,
        set: {
          sourceRef: params.sourceRef,
          version: params.version,
          installPath: params.installPath ?? null,
        },
      });
  }

  async removeInstalledMApp(mappId: string): Promise<void> {
    await this.db
      .delete(mappsInstalled)
      .where(eq(mappsInstalled.mappId, mappId));
  }

  async getInstalledMApps(): Promise<Array<{ mappId: string; version: string; installPath: string | null; installedAt: string }>> {
    const rows = await this.db.select().from(mappsInstalled);
    return rows.map((r) => ({
      mappId: r.mappId,
      version: r.version,
      installPath: r.installPath ?? null,
      installedAt: r.installedAt instanceof Date ? r.installedAt.toISOString() : String(r.installedAt),
    }));
  }

  async isMAppInstalled(mappId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ mappId: mappsInstalled.mappId })
      .from(mappsInstalled)
      .where(eq(mappsInstalled.mappId, mappId));
    return row !== undefined;
  }
}
