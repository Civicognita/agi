/**
 * MarketplaceManager — orchestrator combining store, fetcher, and installer.
 *
 * Claude Code-compatible: marketplaces are GitHub repos (or URLs) containing
 * .claude-plugin/marketplace.json. Plugins are installed from GitHub, npm, or git.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MarketplaceStore } from "./store.js";
import { fetchCatalog, parseSourceRef } from "./catalog-fetcher.js";
import { installPlugin, uninstallPlugin, computePluginIntegrityHash } from "./installer.js";
import type {
  MarketplaceSource,
  MarketplacePluginEntry,
  MarketplaceItemType,
  InstalledItem,
  CatalogDiff,
  CatalogSearchParams,
} from "./types.js";

export interface MarketplaceManagerOptions {
  dbPath: string;
  workspaceRoot: string;
  /** Override the plugin cache directory. Defaults to {workspaceRoot}/.plugins/cache. */
  cacheDir?: string;
  /** Path to the AGI install directory (for loading required-plugins.json). */
  installDir?: string;
}

export class MarketplaceManager {
  private store: MarketplaceStore;
  private workspaceRoot: string;
  private cacheDir?: string;
  private requiredPluginIds: Set<string>;
  // Removed — checkUpdates now diffs remote vs local live, no cached state needed.

  constructor(options: MarketplaceManagerOptions) {
    this.store = new MarketplaceStore(options.dbPath);
    this.workspaceRoot = options.workspaceRoot;
    this.cacheDir = options.cacheDir;
    this.requiredPluginIds = this.loadRequiredPluginIds(options.installDir);
  }

  /** Expose the underlying store for shared access (e.g. MApp Marketplace Manager). */
  getStore(): MarketplaceStore {
    return this.store;
  }

  private loadRequiredPluginIds(installDir?: string): Set<string> {
    const dir = installDir ?? process.cwd();
    const reqPath = join(dir, "config/required-plugins.json");
    if (!existsSync(reqPath)) return new Set();
    try {
      const data = JSON.parse(readFileSync(reqPath, "utf-8")) as {
        plugins: Array<{ id: string }>;
      };
      return new Set(data.plugins.map(p => p.id));
    } catch {
      return new Set();
    }
  }

  // -------------------------------------------------------------------------
  // Sources
  // -------------------------------------------------------------------------

  getSources(): MarketplaceSource[] {
    return this.store.getSources();
  }

  /**
   * Add a marketplace source.
   * @param ref GitHub shorthand ("owner/repo"), git URL, or direct JSON URL.
   * @param name Optional display name (auto-populated on first sync).
   */
  addSource(ref: string, name?: string): MarketplaceSource {
    const { type } = parseSourceRef(ref);
    return this.store.addSource(ref, type, name ?? ref);
  }

  removeSource(id: number): void {
    this.store.removeSource(id);
  }

  async syncSource(
    id: number,
  ): Promise<{ ok: boolean; error?: string; diff?: CatalogDiff }> {
    const source = this.store.getSource(id);
    if (!source) return { ok: false, error: "Source not found" };

    const result = await fetchCatalog(source.ref);
    if (!result.ok || !result.catalog) {
      return { ok: false, error: result.error };
    }

    const diff = this.store.syncPlugins(id, result.catalog.plugins, source.ref);
    return { ok: true, diff };
  }

  /**
   * Sync catalog from a local marketplace directory (reads marketplace.json).
   * Used at boot to ensure the DB catalog matches the local repo state.
   */
  syncLocalCatalog(marketplaceDir: string): { ok: boolean; pluginCount?: number; error?: string } {
    const catalogPath = join(marketplaceDir, "marketplace.json");
    if (!existsSync(catalogPath)) {
      return { ok: false, error: `marketplace.json not found at ${catalogPath}` };
    }
    try {
      const raw = JSON.parse(readFileSync(catalogPath, "utf-8")) as {
        plugins?: Array<Record<string, unknown>>;
      };
      if (!Array.isArray(raw.plugins)) {
        return { ok: false, error: "marketplace.json missing plugins array" };
      }
      const sources = this.store.getSources();
      if (sources.length === 0) return { ok: false, error: "No marketplace sources configured" };
      const sourceId = sources[0]!.id;
      const sourceRef = sources[0]!.ref;
      this.store.syncPlugins(sourceId, raw.plugins as unknown as MarketplacePluginEntry[], sourceRef);
      return { ok: true, pluginCount: raw.plugins.length };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Reconcile installed plugins against the marketplace source directory.
   * Re-installs any plugins whose source files have changed (based on integrity hash).
   */
  async reconcileInstalled(marketplaceDir: string): Promise<{ updated: string[]; errors: string[] }> {
    const installed = this.store.getInstalled();
    const updated: string[] = [];
    const errors: string[] = [];

    for (const item of installed) {
      // Only reconcile plugins that came from a local marketplace source (relative paths)
      const catalogPlugin = this.store.getPlugin(item.name, item.sourceId);
      if (!catalogPlugin) continue;
      const source = catalogPlugin.source;
      if (typeof source !== "string") continue; // Not a relative path source

      // Compute fresh hash from marketplace source directory
      const subdir = (source as string).replace(/^\.\//, "");
      const srcDir = join(marketplaceDir, subdir);
      if (!existsSync(srcDir)) continue;

      const freshHash = computePluginIntegrityHash(srcDir);
      if (freshHash === item.integrityHash) continue; // No changes

      // Re-install from GitHub source and rebuild in cache
      try {
        this.store.removeInstalled(item.name);
        const result = await this.install(item.name, item.sourceId);
        if (result.ok) {
          updated.push(item.name);
        } else {
          errors.push(`${item.name}: ${result.error ?? "unknown"}`);
        }
      } catch (err) {
        errors.push(`${item.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return { updated, errors };
  }

  // -------------------------------------------------------------------------
  // Catalog
  // -------------------------------------------------------------------------

  searchCatalog(params: CatalogSearchParams): (MarketplacePluginEntry & { sourceId: number; installed: boolean })[] {
    const plugins = this.store.searchPlugins(params);
    return plugins.map((p) => ({
      ...p,
      installed: this.store.isInstalled(p.name),
    }));
  }

  // -------------------------------------------------------------------------
  // Install / Uninstall
  // -------------------------------------------------------------------------

  async install(pluginName: string, sourceId: number): Promise<{ ok: boolean; error?: string; installPath?: string; missingDeps?: string[]; autoInstalled?: string[] }> {
    const plugin = this.store.getPlugin(pluginName, sourceId);
    if (!plugin) return { ok: false, error: "Plugin not found in catalog" };

    if (this.store.isInstalled(pluginName)) {
      return { ok: false, error: "Plugin already installed" };
    }

    // Auto-install missing dependencies
    const autoInstalled: string[] = [];
    if (plugin.depends && plugin.depends.length > 0) {
      const installedNames = new Set(this.store.getInstalled().map(i => i.name));
      const missing = plugin.depends.filter(dep => !installedNames.has(dep));

      if (missing.length > 0) {
        const allCatalog = this.store.searchPlugins({});
        const unresolvedDeps: string[] = [];

        for (const dep of missing) {
          const depPlugin = allCatalog.find(p => p.name === dep);
          if (!depPlugin) {
            unresolvedDeps.push(dep);
            continue;
          }
          const depResult = await this.install(dep, depPlugin.sourceId);
          if (!depResult.ok) {
            return { ok: false, error: `Failed to auto-install dependency "${dep}": ${depResult.error}`, missingDeps: [dep] };
          }
          autoInstalled.push(dep);
          if (depResult.autoInstalled) autoInstalled.push(...depResult.autoInstalled);
        }

        if (unresolvedDeps.length > 0) {
          return { ok: false, error: `Missing dependencies not found in any catalog: ${unresolvedDeps.join(", ")}`, missingDeps: unresolvedDeps };
        }
      }
    }

    const itemType: MarketplaceItemType = (plugin.type as MarketplaceItemType) ?? "plugin";

    const sourceInfo = this.store.getSource(sourceId);

    try {
      const { installPath, integrityHash } = await installPlugin(
        pluginName,
        plugin.source,
        itemType,
        { workspaceRoot: this.workspaceRoot, cacheDir: this.cacheDir, sourceRef: sourceInfo?.ref },
      );
      this.store.addInstalled({
        name: pluginName,
        sourceId,
        type: itemType,
        version: plugin.version ?? "0.0.0",
        installedAt: new Date().toISOString(),
        installPath,
        sourceJson: plugin.sourceJson,
        integrityHash: integrityHash || undefined,
        trustTier: plugin.trustTier,
      });
      return { ok: true, installPath, autoInstalled: autoInstalled.length > 0 ? autoInstalled : undefined };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  uninstall(pluginName: string, force?: boolean): { ok: boolean; error?: string; dependents?: string[] } {
    const installed = this.store.getInstalled().find((i) => i.name === pluginName);
    if (!installed) return { ok: false, error: "Plugin not installed" };

    // Block uninstall of required plugins
    if (this.requiredPluginIds.has(pluginName) && !force) {
      return { ok: false, error: "Required by the Aionima gateway — cannot be uninstalled" };
    }

    // Check if other installed plugins depend on this one
    if (!force) {
      const allCatalog = this.store.searchPlugins({});
      const installedNames = new Set(this.store.getInstalled().map(i => i.name));
      const dependents = allCatalog
        .filter(p => installedNames.has(p.name) && p.depends?.includes(pluginName))
        .map(p => p.name);
      if (dependents.length > 0) {
        return { ok: false, error: `Required by: ${dependents.join(", ")}`, dependents };
      }
    }

    try {
      uninstallPlugin(installed.installPath);
      this.store.removeInstalled(pluginName);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  isInstalled(name: string): boolean {
    return this.store.isInstalled(name);
  }

  /** Add an installed record for a plugin already in cache but missing from the DB. */
  backfillInstalled(item: { name: string; sourceId: number; type: string; version: string; installedAt: string; installPath: string; sourceJson: string }): void {
    this.store.addInstalled({
      name: item.name,
      sourceId: item.sourceId,
      type: item.type as import("./types.js").MarketplaceItemType,
      version: item.version,
      installedAt: item.installedAt,
      installPath: item.installPath,
      sourceJson: item.sourceJson,
    });
  }

  getInstalled(): InstalledItem[] {
    return this.store.getInstalled();
  }

  /**
   * Update a single installed plugin to the latest version from the catalog.
   * Removes old files, reinstalls from source, and updates the DB record.
   */
  async updatePlugin(
    pluginName: string,
    sourceId: number,
  ): Promise<{ ok: boolean; error?: string; installPath?: string; oldVersion: string; newVersion: string }> {
    const installed = this.store.getInstalled().find((i) => i.name === pluginName);
    if (!installed) return { ok: false, error: "Plugin not installed", oldVersion: "", newVersion: "" };

    const catalogPlugin = this.store.getPlugin(pluginName, sourceId);
    if (!catalogPlugin) return { ok: false, error: "Plugin not found in catalog", oldVersion: installed.version, newVersion: "" };

    const oldVersion = installed.version;
    const newVersion = catalogPlugin.version ?? "0.0.0";

    // Remove old plugin files from disk
    try {
      uninstallPlugin(installed.installPath);
    } catch {
      // Best-effort — directory may already be gone
    }
    this.store.removeInstalled(pluginName);

    // Reinstall from marketplace source
    const itemType: MarketplaceItemType = (catalogPlugin.type as MarketplaceItemType) ?? "plugin";
    const sourceInfo = this.store.getSource(sourceId);

    try {
      const { installPath, integrityHash } = await installPlugin(
        pluginName,
        catalogPlugin.source,
        itemType,
        { workspaceRoot: this.workspaceRoot, cacheDir: this.cacheDir, sourceRef: sourceInfo?.ref },
      );
      this.store.addInstalled({
        name: pluginName,
        sourceId,
        type: itemType,
        version: newVersion,
        installedAt: new Date().toISOString(),
        installPath,
        sourceJson: catalogPlugin.sourceJson,
        integrityHash: integrityHash || undefined,
        trustTier: catalogPlugin.trustTier,
      });
      return { ok: true, installPath, oldVersion, newVersion };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err), oldVersion, newVersion };
    }
  }

  /**
   * Sync catalog from all GitHub sources, then update every installed plugin
   * that has a newer version available. Returns what changed.
   */
  async syncAndUpdateAll(): Promise<{ synced: number; updated: string[]; errors: string[] }> {
    // 1. Sync catalog from all configured sources (GitHub)
    let synced = 0;
    for (const source of this.store.getSources()) {
      const result = await this.syncSource(source.id);
      if (result.ok) synced += result.diff?.total ?? 0;
    }

    // 2. Find and apply all available updates
    const { updates } = this.checkUpdates();
    const updated: string[] = [];
    const errors: string[] = [];

    for (const { pluginName, sourceId } of updates) {
      const result = await this.updatePlugin(pluginName, sourceId);
      if (result.ok) {
        updated.push(pluginName);
      } else {
        errors.push(`${pluginName}: ${result.error ?? "unknown"}`);
      }
    }

    return { synced, updated, errors };
  }

  /**
   * Check for plugin updates. Local-only — compares installed plugin versions
   * against the already-synced catalog. No remote fetch. The catalog sync
   * (which runs at boot and on manual refresh) handles discovery of new
   * plugins via CatalogDiff.added.
   *
   * Returns { updates, newInMarketplace } where:
   * - updates: installed plugins whose catalog version differs from installed
   * - newInMarketplace: catalog plugins that aren't installed (NOT "new since
   *   last sync" — just "available to install"). The page-level banner uses
   *   this count but it's informational, not an action prompt.
   */
  checkUpdates(): {
    updates: { pluginName: string; currentVersion: string; availableVersion: string; sourceId: number }[];
    newInMarketplace: { pluginName: string; version: string; description: string }[];
  } {
    const updates: { pluginName: string; currentVersion: string; availableVersion: string; sourceId: number }[] = [];

    const installed = this.store.getInstalled();
    const installedNames = new Set(installed.map((i) => i.name));

    for (const item of installed) {
      const catalogPlugin = this.store.getPlugin(item.name, item.sourceId);
      if (catalogPlugin?.version && catalogPlugin.version !== item.version) {
        updates.push({
          pluginName: item.name,
          currentVersion: item.version,
          availableVersion: catalogPlugin.version,
          sourceId: item.sourceId,
        });
      }
    }

    // Catalog plugins not yet installed — informational, not "new since last sync"
    const newInMarketplace: { pluginName: string; version: string; description: string }[] = [];
    const allCatalog = this.searchCatalog({});
    for (const entry of allCatalog) {
      if (!installedNames.has(entry.name)) {
        newInMarketplace.push({
          pluginName: entry.name,
          version: entry.version ?? "0.0.0",
          description: entry.description ?? "",
        });
      }
    }

    return { updates, newInMarketplace };
  }

  close(): void {
    this.store.close();
  }
}
