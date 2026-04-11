/**
 * MarketplaceStore — SQLite-backed storage for sources, plugins, and installed items.
 * Compatible with Claude Code's marketplace.json format.
 */

import Database from "better-sqlite3";
import { MARKETPLACE_SCHEMA, MARKETPLACE_MIGRATIONS } from "./schema.sql.js";
import type {
  MarketplaceSource,
  MarketplacePluginEntry,
  MarketplaceItemType,
  InstalledItem,
  CatalogSearchParams,
  TrustTier,
  MAppSource,
  MAppCatalogEntry,
} from "./types.js";

export class MarketplaceStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(MARKETPLACE_SCHEMA);
    // Run schema migrations (add provides/depends columns)
    for (const sql of MARKETPLACE_MIGRATIONS) {
      try { this.db.exec(sql); } catch { /* column already exists — no-op */ }
    }
  }

  // -------------------------------------------------------------------------
  // Sources
  // -------------------------------------------------------------------------

  addSource(ref: string, sourceType: string, name: string, description?: string): MarketplaceSource {
    const stmt = this.db.prepare(
      "INSERT INTO marketplace_sources (ref, source_type, name, description) VALUES (?, ?, ?, ?)",
    );
    const info = stmt.run(ref, sourceType, name, description ?? null);
    return {
      id: Number(info.lastInsertRowid),
      ref,
      sourceType: sourceType as MarketplaceSource["sourceType"],
      name,
      description,
      lastSyncedAt: null,
      pluginCount: 0,
    };
  }

  removeSource(id: number): void {
    this.db.prepare("DELETE FROM marketplace_sources WHERE id = ?").run(id);
  }

  getSources(): MarketplaceSource[] {
    const rows = this.db.prepare("SELECT * FROM marketplace_sources ORDER BY id").all() as {
      id: number;
      ref: string;
      source_type: string;
      name: string;
      description: string | null;
      last_synced_at: string | null;
      plugin_count: number;
    }[];
    return rows.map((r) => ({
      id: r.id,
      ref: r.ref,
      sourceType: r.source_type as MarketplaceSource["sourceType"],
      name: r.name,
      description: r.description ?? undefined,
      lastSyncedAt: r.last_synced_at,
      pluginCount: r.plugin_count,
    }));
  }

  getSource(id: number): MarketplaceSource | undefined {
    const row = this.db.prepare("SELECT * FROM marketplace_sources WHERE id = ?").get(id) as {
      id: number;
      ref: string;
      source_type: string;
      name: string;
      description: string | null;
      last_synced_at: string | null;
      plugin_count: number;
    } | undefined;
    if (!row) return undefined;
    return {
      id: row.id,
      ref: row.ref,
      sourceType: row.source_type as MarketplaceSource["sourceType"],
      name: row.name,
      description: row.description ?? undefined,
      lastSyncedAt: row.last_synced_at,
      pluginCount: row.plugin_count,
    };
  }

  // -------------------------------------------------------------------------
  // Plugins (catalog)
  // -------------------------------------------------------------------------

  syncPlugins(sourceId: number, plugins: MarketplacePluginEntry[], sourceRef?: string): void {
    // Determine if this is the official Civicognita marketplace
    const isOfficial = sourceRef !== undefined && /Civicognita/i.test(sourceRef);

    const txn = this.db.transaction(() => {
      this.db.prepare("DELETE FROM marketplace_plugins WHERE source_id = ?").run(sourceId);
      const insert = this.db.prepare(`
        INSERT INTO marketplace_plugins (name, source_id, description, type, version, author_name, author_email, category, tags, keywords, license, homepage, source_json, provides, depends, trust_tier, integrity_hash, signed_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const p of plugins) {
        const trustTier: TrustTier = p.trustTier ?? (isOfficial ? "official" : "unknown");
        insert.run(
          p.name,
          sourceId,
          p.description ?? null,
          p.type ?? "plugin",
          p.version ?? null,
          p.author?.name ?? null,
          p.author?.email ?? null,
          p.category ?? null,
          p.tags ? JSON.stringify(p.tags) : null,
          p.keywords ? JSON.stringify(p.keywords) : null,
          p.license ?? null,
          p.homepage ?? null,
          JSON.stringify(p.source),
          p.provides ? JSON.stringify(p.provides) : null,
          p.depends ? JSON.stringify(p.depends) : null,
          trustTier,
          p.integrityHash ?? null,
          p.signedBy ?? null,
        );
      }
      this.db.prepare(
        "UPDATE marketplace_sources SET last_synced_at = ?, plugin_count = ? WHERE id = ?",
      ).run(new Date().toISOString(), plugins.length, sourceId);
    });
    txn();
  }

  searchPlugins(params: CatalogSearchParams): (MarketplacePluginEntry & { sourceId: number; sourceJson: string })[] {
    let sql = "SELECT * FROM marketplace_plugins WHERE 1=1";
    const bindings: unknown[] = [];

    if (params.type) {
      sql += " AND type = ?";
      bindings.push(params.type);
    }
    if (params.category) {
      sql += " AND category = ?";
      bindings.push(params.category);
    }
    if (params.provides) {
      sql += " AND provides LIKE ?";
      bindings.push(`%"${params.provides}"%`);
    }
    if (params.q) {
      sql += " AND (name LIKE ? OR description LIKE ?)";
      const q = `%${params.q}%`;
      bindings.push(q, q);
    }
    sql += " ORDER BY name";

    const rows = this.db.prepare(sql).all(...bindings) as {
      name: string;
      source_id: number;
      description: string | null;
      type: string;
      version: string | null;
      author_name: string | null;
      author_email: string | null;
      category: string | null;
      tags: string | null;
      keywords: string | null;
      license: string | null;
      homepage: string | null;
      source_json: string;
      provides: string | null;
      depends: string | null;
      trust_tier: string | null;
      integrity_hash: string | null;
      signed_by: string | null;
    }[];

    return rows.map((r) => ({
      name: r.name,
      sourceId: r.source_id,
      source: JSON.parse(r.source_json) as MarketplacePluginEntry["source"],
      description: r.description ?? undefined,
      type: (r.type as MarketplaceItemType) ?? "plugin",
      version: r.version ?? undefined,
      author: r.author_name ? { name: r.author_name, email: r.author_email ?? undefined } : undefined,
      category: r.category ?? undefined,
      tags: r.tags ? (JSON.parse(r.tags) as string[]) : undefined,
      keywords: r.keywords ? (JSON.parse(r.keywords) as string[]) : undefined,
      license: r.license ?? undefined,
      homepage: r.homepage ?? undefined,
      sourceJson: r.source_json,
      provides: r.provides ? (JSON.parse(r.provides) as string[]) : undefined,
      depends: r.depends ? (JSON.parse(r.depends) as string[]) : undefined,
      trustTier: (r.trust_tier as TrustTier | null) ?? undefined,
      integrityHash: r.integrity_hash ?? undefined,
      signedBy: r.signed_by ?? undefined,
    }));
  }

  getPlugin(name: string, sourceId: number): (MarketplacePluginEntry & { sourceId: number; sourceJson: string }) | undefined {
    const row = this.db.prepare(
      "SELECT * FROM marketplace_plugins WHERE name = ? AND source_id = ?",
    ).get(name, sourceId) as {
      name: string;
      source_id: number;
      description: string | null;
      type: string;
      version: string | null;
      author_name: string | null;
      source_json: string;
      provides: string | null;
      depends: string | null;
      trust_tier: string | null;
      integrity_hash: string | null;
      signed_by: string | null;
    } | undefined;
    if (!row) return undefined;
    return {
      name: row.name,
      sourceId: row.source_id,
      source: JSON.parse(row.source_json) as MarketplacePluginEntry["source"],
      description: row.description ?? undefined,
      type: (row.type as MarketplaceItemType) ?? "plugin",
      version: row.version ?? undefined,
      author: row.author_name ? { name: row.author_name } : undefined,
      sourceJson: row.source_json,
      provides: row.provides ? (JSON.parse(row.provides) as string[]) : undefined,
      depends: row.depends ? (JSON.parse(row.depends) as string[]) : undefined,
      trustTier: (row.trust_tier as TrustTier | null) ?? undefined,
      integrityHash: row.integrity_hash ?? undefined,
      signedBy: row.signed_by ?? undefined,
    };
  }

  // -------------------------------------------------------------------------
  // Installed
  // -------------------------------------------------------------------------

  addInstalled(item: InstalledItem): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO marketplace_installed (name, source_id, type, version, installed_at, install_path, source_json, integrity_hash, trust_tier)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      item.name,
      item.sourceId,
      item.type,
      item.version,
      item.installedAt,
      item.installPath,
      item.sourceJson,
      item.integrityHash ?? null,
      item.trustTier ?? "unknown",
    );
  }

  removeInstalled(name: string): void {
    this.db.prepare("DELETE FROM marketplace_installed WHERE name = ?").run(name);
  }

  getInstalled(): InstalledItem[] {
    const rows = this.db.prepare("SELECT * FROM marketplace_installed ORDER BY installed_at DESC").all() as {
      name: string;
      source_id: number;
      type: string;
      version: string;
      installed_at: string;
      install_path: string;
      source_json: string;
      integrity_hash: string | null;
      trust_tier: string | null;
    }[];
    return rows.map((r) => ({
      name: r.name,
      sourceId: r.source_id,
      type: r.type as InstalledItem["type"],
      version: r.version,
      installedAt: r.installed_at,
      installPath: r.install_path,
      sourceJson: r.source_json,
      integrityHash: r.integrity_hash ?? undefined,
      trustTier: (r.trust_tier as TrustTier | null) ?? undefined,
    }));
  }

  isInstalled(name: string): boolean {
    const row = this.db.prepare("SELECT 1 FROM marketplace_installed WHERE name = ?").get(name);
    return row !== undefined;
  }

  // -------------------------------------------------------------------------
  // MApp Sources
  // -------------------------------------------------------------------------

  addMAppSource(ref: string, sourceType: string, name: string): MAppSource {
    const info = this.db.prepare(
      "INSERT INTO mapp_sources (ref, source_type, name) VALUES (?, ?, ?)",
    ).run(ref, sourceType, name);
    return { id: Number(info.lastInsertRowid), ref, sourceType: sourceType as MAppSource["sourceType"], name, lastSyncedAt: null, mappCount: 0 };
  }

  removeMAppSource(id: number): void {
    this.db.prepare("DELETE FROM mapp_sources WHERE id = ?").run(id);
  }

  getMAppSources(): MAppSource[] {
    const rows = this.db.prepare("SELECT * FROM mapp_sources ORDER BY id").all() as {
      id: number; ref: string; source_type: string; name: string; last_synced_at: string | null; mapp_count: number;
    }[];
    return rows.map((r) => ({
      id: r.id, ref: r.ref, sourceType: r.source_type as MAppSource["sourceType"],
      name: r.name, lastSyncedAt: r.last_synced_at, mappCount: r.mapp_count,
    }));
  }

  getMAppSource(id: number): MAppSource | undefined {
    const row = this.db.prepare("SELECT * FROM mapp_sources WHERE id = ?").get(id) as {
      id: number; ref: string; source_type: string; name: string; last_synced_at: string | null; mapp_count: number;
    } | undefined;
    if (!row) return undefined;
    return {
      id: row.id, ref: row.ref, sourceType: row.source_type as MAppSource["sourceType"],
      name: row.name, lastSyncedAt: row.last_synced_at, mappCount: row.mapp_count,
    };
  }

  // -------------------------------------------------------------------------
  // MApp Catalog
  // -------------------------------------------------------------------------

  syncMApps(sourceId: number, mapps: Array<{ id: string; author?: string; description?: string; category?: string; version?: string; source?: string }>): void {
    const txn = this.db.transaction(() => {
      this.db.prepare("DELETE FROM mapp_catalog WHERE source_id = ?").run(sourceId);
      const insert = this.db.prepare(
        "INSERT INTO mapp_catalog (id, source_id, author, description, category, version, source_path) VALUES (?, ?, ?, ?, ?, ?, ?)",
      );
      for (const m of mapps) {
        const author = m.author ?? "civicognita";
        const sourcePath = m.source?.replace(/^\.\//, "") ?? `mapps/${author}/${m.id}.json`;
        insert.run(m.id, sourceId, author, m.description ?? null, m.category ?? null, m.version ?? null, sourcePath);
      }
      this.db.prepare("UPDATE mapp_sources SET last_synced_at = ?, mapp_count = ? WHERE id = ?")
        .run(new Date().toISOString(), mapps.length, sourceId);
    });
    txn();
  }

  getMAppCatalog(sourceId?: number): MAppCatalogEntry[] {
    const sql = sourceId !== undefined
      ? "SELECT * FROM mapp_catalog WHERE source_id = ? ORDER BY id"
      : "SELECT * FROM mapp_catalog ORDER BY id";
    const rows = (sourceId !== undefined
      ? this.db.prepare(sql).all(sourceId)
      : this.db.prepare(sql).all()
    ) as { id: string; source_id: number; author: string; description: string | null; category: string | null; version: string | null; source_path: string }[];
    return rows.map((r) => ({
      id: r.id, sourceId: r.source_id, author: r.author,
      description: r.description ?? undefined, category: r.category ?? undefined,
      version: r.version ?? undefined, sourcePath: r.source_path,
    }));
  }

  getMApp(id: string, sourceId: number): MAppCatalogEntry | undefined {
    const row = this.db.prepare("SELECT * FROM mapp_catalog WHERE id = ? AND source_id = ?").get(id, sourceId) as {
      id: string; source_id: number; author: string; description: string | null; category: string | null; version: string | null; source_path: string;
    } | undefined;
    if (!row) return undefined;
    return {
      id: row.id, sourceId: row.source_id, author: row.author,
      description: row.description ?? undefined, category: row.category ?? undefined,
      version: row.version ?? undefined, sourcePath: row.source_path,
    };
  }

  close(): void {
    this.db.close();
  }
}
