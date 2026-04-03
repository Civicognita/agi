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

  constructor(options: MarketplaceManagerOptions) {
    this.store = new MarketplaceStore(options.dbPath);
    this.workspaceRoot = options.workspaceRoot;
    this.cacheDir = options.cacheDir;
    this.requiredPluginIds = this.loadRequiredPluginIds(options.installDir);
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

  async syncSource(id: number): Promise<{ ok: boolean; error?: string; pluginCount?: number }> {
    const source = this.store.getSource(id);
    if (!source) return { ok: false, error: "Source not found" };

    const result = await fetchCatalog(source.ref);
    if (!result.ok || !result.catalog) {
      return { ok: false, error: result.error };
    }

    this.store.syncPlugins(id, result.catalog.plugins, source.ref);
    return { ok: true, pluginCount: result.catalog.plugins.length };
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

      // Re-install: remove old, install fresh
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

  getInstalled(): InstalledItem[] {
    return this.store.getInstalled();
  }

  checkUpdates(): { pluginName: string; currentVersion: string; availableVersion: string; sourceId: number }[] {
    const installed = this.store.getInstalled();
    const updates: { pluginName: string; currentVersion: string; availableVersion: string; sourceId: number }[] = [];

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

    return updates;
  }

  close(): void {
    this.store.close();
  }
}
