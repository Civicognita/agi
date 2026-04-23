/**
 * MarketplaceManager — orchestrator combining store, fetcher, and installer.
 *
 * Claude Code-compatible: marketplaces are GitHub repos (or URLs) containing
 * .claude-plugin/marketplace.json. Plugins are installed from GitHub, npm, or git.
 *
 * After Phase 2.2: the store is Postgres/drizzle. All store calls are async.
 * The concept of "MarketplaceSource" with a numeric id is replaced by sourceRef
 * strings (the GitHub/URL reference). A lightweight in-memory source registry
 * (loaded from config or gateway state) tracks the configured sources.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MarketplaceStore } from "./store.js";
import { fetchCatalog, parseSourceRef } from "./catalog-fetcher.js";
import { installPlugin, uninstallPlugin, computePluginIntegrityHash, rebuildPlugin as rebuildPluginInstall } from "./installer.js";
import type { RebuildAllResult } from "./installer.js";
import type {
  MarketplaceSource,
  MarketplacePluginEntry,
  MarketplaceItemType,
  InstalledItem,
  CatalogDiff,
  CatalogSearchParams,
} from "./types.js";

export interface MarketplaceManagerOptions {
  store: MarketplaceStore;
  workspaceRoot: string;
  /** Override the plugin cache directory. Defaults to {workspaceRoot}/.plugins/cache. */
  cacheDir?: string;
  /** Path to the AGI install directory (for loading required-plugins.json). */
  installDir?: string;
  /** Pre-configured source refs (replaces the old DB-backed sources table). */
  sourceRefs?: string[];
}

export class MarketplaceManager {
  private store: MarketplaceStore;
  private workspaceRoot: string;
  private cacheDir?: string;
  private requiredPluginIds: Set<string>;
  // In-memory source registry (sourceRef → display name)
  private sources: Map<string, { ref: string; name: string; type: string }> = new Map();
  // Legacy numeric-id counter for backward compat with callers that pass sourceId numbers
  private sourceIdCounter = 1;
  private sourceIdToRef: Map<number, string> = new Map();
  private refToSourceId: Map<string, number> = new Map();

  constructor(options: MarketplaceManagerOptions) {
    this.store = options.store;
    this.workspaceRoot = options.workspaceRoot;
    this.cacheDir = options.cacheDir;
    this.requiredPluginIds = this.loadRequiredPluginIds(options.installDir);

    // Register any pre-configured source refs
    for (const ref of options.sourceRefs ?? []) {
      this.registerSource(ref, ref);
    }
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

  private registerSource(ref: string, name: string): number {
    if (this.refToSourceId.has(ref)) return this.refToSourceId.get(ref)!;
    const { type } = parseSourceRef(ref);
    const id = this.sourceIdCounter++;
    this.sources.set(ref, { ref, name, type });
    this.sourceIdToRef.set(id, ref);
    this.refToSourceId.set(ref, id);
    return id;
  }

  // -------------------------------------------------------------------------
  // Sources
  // -------------------------------------------------------------------------

  getSources(): MarketplaceSource[] {
    return [...this.sources.values()].map((s, i) => ({
      id: this.refToSourceId.get(s.ref) ?? i + 1,
      ref: s.ref,
      sourceType: s.type as MarketplaceSource["sourceType"],
      name: s.name,
      lastSyncedAt: null,
      pluginCount: 0,
    }));
  }

  /**
   * Add a marketplace source.
   * @param ref GitHub shorthand ("owner/repo"), git URL, or direct JSON URL.
   * @param name Optional display name (auto-populated on first sync).
   */
  addSource(ref: string, name?: string): MarketplaceSource {
    const { type } = parseSourceRef(ref);
    const id = this.registerSource(ref, name ?? ref);
    return {
      id,
      ref,
      sourceType: type as MarketplaceSource["sourceType"],
      name: name ?? ref,
      lastSyncedAt: null,
      pluginCount: 0,
    };
  }

  removeSource(id: number): void {
    const ref = this.sourceIdToRef.get(id);
    if (ref) {
      this.sources.delete(ref);
      this.sourceIdToRef.delete(id);
      this.refToSourceId.delete(ref);
    }
  }

  getSource(id: number): MarketplaceSource | undefined {
    const ref = this.sourceIdToRef.get(id);
    if (!ref) return undefined;
    const s = this.sources.get(ref);
    if (!s) return undefined;
    return {
      id,
      ref: s.ref,
      sourceType: s.type as MarketplaceSource["sourceType"],
      name: s.name,
      lastSyncedAt: null,
      pluginCount: 0,
    };
  }

  async syncSource(
    id: number,
  ): Promise<{ ok: boolean; error?: string; diff?: CatalogDiff }> {
    const ref = this.sourceIdToRef.get(id);
    if (!ref) return { ok: false, error: "Source not found" };

    const result = await fetchCatalog(ref);
    if (!result.ok || !result.catalog) {
      return { ok: false, error: result.error };
    }

    const diff = await this.store.syncPlugins(ref, result.catalog.plugins);
    return { ok: true, diff };
  }

  /**
   * Sync catalog from a local marketplace directory (reads marketplace.json).
   * Used at boot to ensure the DB catalog matches the local repo state.
   */
  async syncLocalCatalog(marketplaceDir: string): Promise<{ ok: boolean; pluginCount?: number; error?: string }> {
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
      const sources = this.getSources();
      if (sources.length === 0) return { ok: false, error: "No marketplace sources configured" };
      const sourceRef = sources[0]!.ref;
      await this.store.syncPlugins(sourceRef, raw.plugins as unknown as MarketplacePluginEntry[]);
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
    const installed = await this.store.getInstalled();
    const updated: string[] = [];
    const errors: string[] = [];

    for (const item of installed) {
      const sourceRef = item.sourceJson;
      const catalogPlugin = await this.store.getPlugin(item.name, sourceRef);
      if (!catalogPlugin) continue;
      const source = catalogPlugin.source;
      if (typeof source !== "string") continue; // Not a relative path source

      // Compute fresh hash from marketplace source directory
      const subdir = (source as string).replace(/^\.\//, "");
      const srcDir = join(marketplaceDir, subdir);
      if (!existsSync(srcDir)) continue;

      const freshHash = computePluginIntegrityHash(srcDir);
      if (freshHash === item.integrityHash) continue; // No changes

      const sourceId = this.refToSourceId.get(sourceRef) ?? this.registerSource(sourceRef, sourceRef);

      // Re-install from GitHub source and rebuild in cache
      try {
        await this.store.removeInstalled(item.name);
        const result = await this.install(item.name, sourceId);
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

  async searchCatalog(params: CatalogSearchParams): Promise<(MarketplacePluginEntry & { sourceId: number; installed: boolean })[]> {
    const plugins = await this.store.searchPlugins(params);
    const results = await Promise.all(
      plugins.map(async (p) => ({
        ...p,
        sourceId: this.refToSourceId.get(p.sourceRef) ?? 0,
        installed: await this.store.isInstalled(p.name),
      })),
    );
    return results;
  }

  // -------------------------------------------------------------------------
  // Install / Uninstall
  // -------------------------------------------------------------------------

  async install(
    pluginName: string,
    sourceId: number,
  ): Promise<{ ok: boolean; error?: string; installPath?: string; missingDeps?: string[]; autoInstalled?: string[] }> {
    const sourceRef = this.sourceIdToRef.get(sourceId) ?? "";
    const plugin = await this.store.getPlugin(pluginName, sourceRef);
    if (!plugin) return { ok: false, error: "Plugin not found in catalog" };

    if (await this.store.isInstalled(pluginName)) {
      return { ok: false, error: "Plugin already installed" };
    }

    // Auto-install missing dependencies
    const autoInstalled: string[] = [];
    if (plugin.depends && plugin.depends.length > 0) {
      const installed = await this.store.getInstalled();
      const installedNames = new Set(installed.map(i => i.name));
      const missing = plugin.depends.filter(dep => !installedNames.has(dep));

      if (missing.length > 0) {
        const allCatalog = await this.store.searchPlugins({});
        const unresolvedDeps: string[] = [];

        for (const dep of missing) {
          const depPlugin = allCatalog.find(p =>
            p.name === dep || (Array.isArray(p.aliases) && p.aliases.includes(dep)),
          );
          if (!depPlugin) {
            unresolvedDeps.push(dep);
            continue;
          }
          const depSourceId = this.refToSourceId.get(depPlugin.sourceRef) ?? 0;
          const depResult = await this.install(dep, depSourceId);
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

    try {
      const { installPath, integrityHash } = await installPlugin(
        pluginName,
        plugin.source,
        itemType,
        { workspaceRoot: this.workspaceRoot, cacheDir: this.cacheDir, sourceRef },
      );
      await this.store.addInstalled({
        name: pluginName,
        sourceId,
        type: itemType,
        version: plugin.version ?? "0.0.0",
        installedAt: new Date().toISOString(),
        installPath,
        sourceJson: plugin.sourceRef,
        integrityHash: integrityHash || undefined,
        trustTier: plugin.trustTier,
      });
      return { ok: true, installPath, autoInstalled: autoInstalled.length > 0 ? autoInstalled : undefined };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async uninstall(pluginName: string, force?: boolean): Promise<{ ok: boolean; error?: string; dependents?: string[] }> {
    const installed = await this.store.getInstalled();
    const item = installed.find((i) => i.name === pluginName);
    if (!item) return { ok: false, error: "Plugin not installed" };

    // Block uninstall of required plugins
    if (this.requiredPluginIds.has(pluginName) && !force) {
      return { ok: false, error: "Required by the Aionima gateway — cannot be uninstalled" };
    }

    // Check if other installed plugins depend on this one
    if (!force) {
      const allCatalog = await this.store.searchPlugins({});
      const installedNames = new Set(installed.map(i => i.name));
      const dependents = allCatalog
        .filter(p => installedNames.has(p.name) && p.depends?.includes(pluginName))
        .map(p => p.name);
      if (dependents.length > 0) {
        return { ok: false, error: `Required by: ${dependents.join(", ")}`, dependents };
      }
    }

    try {
      uninstallPlugin(item.installPath);
      await this.store.removeInstalled(pluginName);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async isInstalled(name: string): Promise<boolean> {
    return this.store.isInstalled(name);
  }

  /** Add an installed record for a plugin already in cache but missing from the DB. */
  async backfillInstalled(item: { name: string; sourceId: number; type: string; version: string; installedAt: string; installPath: string; sourceJson: string }): Promise<void> {
    await this.store.addInstalled({
      name: item.name,
      sourceId: item.sourceId,
      type: item.type as import("./types.js").MarketplaceItemType,
      version: item.version,
      installedAt: item.installedAt,
      installPath: item.installPath,
      sourceJson: item.sourceJson,
    });
  }

  async getInstalled(): Promise<InstalledItem[]> {
    return this.store.getInstalled();
  }

  /**
   * Update a single installed plugin to the latest version from the catalog.
   */
  async updatePlugin(
    pluginName: string,
    sourceId: number,
  ): Promise<{ ok: boolean; error?: string; installPath?: string; oldVersion: string; newVersion: string }> {
    const installed = await this.store.getInstalled();
    const item = installed.find((i) => i.name === pluginName);
    if (!item) return { ok: false, error: "Plugin not installed", oldVersion: "", newVersion: "" };

    const sourceRef = this.sourceIdToRef.get(sourceId) ?? item.sourceJson;
    const catalogPlugin = await this.store.getPlugin(pluginName, sourceRef);
    if (!catalogPlugin) return { ok: false, error: "Plugin not found in catalog", oldVersion: item.version, newVersion: "" };

    const oldVersion = item.version;
    const newVersion = catalogPlugin.version ?? "0.0.0";

    // Remove old plugin files from disk
    try {
      uninstallPlugin(item.installPath);
    } catch {
      // Best-effort — directory may already be gone
    }
    await this.store.removeInstalled(pluginName);

    // Reinstall from marketplace source
    const itemType: MarketplaceItemType = (catalogPlugin.type as MarketplaceItemType) ?? "plugin";

    try {
      const { installPath, integrityHash } = await installPlugin(
        pluginName,
        catalogPlugin.source,
        itemType,
        { workspaceRoot: this.workspaceRoot, cacheDir: this.cacheDir, sourceRef },
      );
      await this.store.addInstalled({
        name: pluginName,
        sourceId,
        type: itemType,
        version: newVersion,
        installedAt: new Date().toISOString(),
        installPath,
        sourceJson: catalogPlugin.sourceRef,
        integrityHash: integrityHash || undefined,
        trustTier: catalogPlugin.trustTier,
      });
      return { ok: true, installPath, oldVersion, newVersion };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err), oldVersion, newVersion };
    }
  }

  async syncAndUpdateAll(): Promise<{ synced: number; updated: string[]; errors: string[] }> {
    // 1. Sync catalog from all configured sources (GitHub)
    let synced = 0;
    for (const source of this.getSources()) {
      const result = await this.syncSource(source.id);
      if (result.ok) synced += result.diff?.total ?? 0;
    }

    // 2. Find and apply all available updates
    const { updates } = await this.checkUpdates();
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

  async checkUpdates(): Promise<{
    updates: { pluginName: string; currentVersion: string; availableVersion: string; sourceId: number }[];
    newInMarketplace: { pluginName: string; version: string; description: string }[];
  }> {
    const updates: { pluginName: string; currentVersion: string; availableVersion: string; sourceId: number }[] = [];

    const installed = await this.store.getInstalled();
    const installedNames = new Set(installed.map((i) => i.name));

    for (const item of installed) {
      const catalogPlugin = await this.store.getPlugin(item.name, item.sourceJson);
      if (catalogPlugin?.version && catalogPlugin.version !== item.version) {
        updates.push({
          pluginName: item.name,
          currentVersion: item.version,
          availableVersion: catalogPlugin.version,
          sourceId: this.refToSourceId.get(item.sourceJson) ?? 0,
        });
      }
    }

    const newInMarketplace: { pluginName: string; version: string; description: string }[] = [];
    const allCatalog = await this.searchCatalog({});
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

  async rebuildPlugin(name: string): Promise<void> {
    const installed = await this.store.getInstalled();
    const item = installed.find(i => i.name === name);
    if (!item) throw new Error(`Plugin "${name}" is not installed`);
    await rebuildPluginInstall(item.installPath);
  }

  async rebuildAll(): Promise<RebuildAllResult> {
    const installed = await this.store.getInstalled();
    const rebuilt: string[] = [];
    const failed: string[] = [];
    for (const item of installed) {
      try {
        await rebuildPluginInstall(item.installPath);
        rebuilt.push(item.name);
      } catch {
        failed.push(item.name);
      }
    }
    return { rebuilt, failed };
  }
}
