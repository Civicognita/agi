/**
 * MAppMarketplaceManager — orchestrator for MApp (MagicApp) marketplace operations.
 *
 * Mirrors MarketplaceManager's source management pattern but simplified for MApps:
 * - MApps are single JSON files (no git clone, no build step)
 * - Install = fetch JSON from GitHub → validate → write to ~/.agi/mapps/{author}/{id}.json
 * - Sources are GitHub repos containing a marketplace.json with a `mapps` array
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { MarketplaceStore } from "./store.js";
import { parseSourceRef } from "./catalog-fetcher.js";
import type { MAppSource, MAppCatalogEntry } from "./types.js";

export interface MAppMarketplaceManagerOptions {
  store: MarketplaceStore;
  /** Directory where MApps are installed (e.g. ~/.agi/mapps). */
  mappsDir: string;
  /** Gateway update channel (e.g. "dev" or "main"). */
  updateChannel: string;
}

export class MAppMarketplaceManager {
  private store: MarketplaceStore;
  private mappsDir: string;
  private updateChannel: string;

  constructor(options: MAppMarketplaceManagerOptions) {
    this.store = options.store;
    this.mappsDir = options.mappsDir;
    this.updateChannel = options.updateChannel;
  }

  // -------------------------------------------------------------------------
  // Sources
  // -------------------------------------------------------------------------

  getSources(): MAppSource[] {
    return this.store.getMAppSources();
  }

  addSource(ref: string, name?: string): MAppSource {
    const { type } = parseSourceRef(ref);
    return this.store.addMAppSource(ref, type, name ?? ref);
  }

  removeSource(id: number): void {
    this.store.removeMAppSource(id);
  }

  async syncSource(id: number): Promise<{ ok: boolean; error?: string; mappCount?: number }> {
    const source = this.store.getMAppSource(id);
    if (!source) return { ok: false, error: "Source not found" };

    const catalog = await this.fetchCatalogFromSource(source.ref);
    if (!catalog.ok) return { ok: false, error: catalog.error };

    this.store.syncMApps(id, catalog.mapps);
    return { ok: true, mappCount: catalog.mapps.length };
  }

  // -------------------------------------------------------------------------
  // Catalog
  // -------------------------------------------------------------------------

  getCatalog(): MAppCatalogEntry[] {
    return this.store.getMAppCatalog();
  }

  getCatalogWithInstalled(): (MAppCatalogEntry & { installed: boolean })[] {
    const catalog = this.store.getMAppCatalog();
    return catalog.map((entry) => ({
      ...entry,
      installed: existsSync(join(this.mappsDir, entry.author, `${entry.id}.json`)),
    }));
  }

  // -------------------------------------------------------------------------
  // Install / Uninstall
  // -------------------------------------------------------------------------

  async install(appId: string, sourceId: number): Promise<{ ok: boolean; error?: string }> {
    const entry = this.store.getMApp(appId, sourceId);
    if (!entry) return { ok: false, error: "MApp not found in catalog" };

    const source = this.store.getMAppSource(sourceId);
    if (!source) return { ok: false, error: "Source not found" };

    // Fetch the MApp JSON from GitHub
    const result = await this.fetchFileFromSource(source.ref, entry.sourcePath);
    if (!result.ok) return { ok: false, error: result.error };

    // Write to disk
    const installDir = join(this.mappsDir, entry.author);
    const installPath = join(installDir, `${appId}.json`);
    mkdirSync(installDir, { recursive: true });
    writeFileSync(installPath, JSON.stringify(result.data, null, 2) + "\n", "utf-8");

    return { ok: true };
  }

  uninstall(appId: string, author: string): { ok: boolean; error?: string } {
    const installPath = join(this.mappsDir, author, `${appId}.json`);
    if (!existsSync(installPath)) return { ok: false, error: "MApp not installed" };
    unlinkSync(installPath);
    return { ok: true };
  }

  getInstalled(): Array<{ id: string; author: string; version?: string }> {
    const catalog = this.store.getMAppCatalog();
    const installed: Array<{ id: string; author: string; version?: string }> = [];
    for (const entry of catalog) {
      const path = join(this.mappsDir, entry.author, `${entry.id}.json`);
      if (existsSync(path)) {
        try {
          const data = JSON.parse(readFileSync(path, "utf-8")) as { version?: string };
          installed.push({ id: entry.id, author: entry.author, version: data.version });
        } catch {
          installed.push({ id: entry.id, author: entry.author });
        }
      }
    }
    return installed;
  }

  // -------------------------------------------------------------------------
  // Updates
  // -------------------------------------------------------------------------

  /**
   * Sync catalog from all sources, then update all installed MApps with new versions.
   */
  async syncAndUpdateAll(): Promise<{ synced: number; updated: string[]; errors: string[] }> {
    let synced = 0;
    for (const source of this.store.getMAppSources()) {
      const result = await this.syncSource(source.id);
      if (result.ok) synced += result.mappCount ?? 0;
    }

    const catalog = this.store.getMAppCatalog();
    const updated: string[] = [];
    const errors: string[] = [];

    for (const entry of catalog) {
      const installPath = join(this.mappsDir, entry.author, `${entry.id}.json`);
      if (!existsSync(installPath)) continue; // Only update installed MApps

      // Compare versions
      try {
        const local = JSON.parse(readFileSync(installPath, "utf-8")) as { version?: string };
        if (local.version === entry.version) continue; // Already up to date
      } catch { /* re-fetch on parse error */ }

      // Fetch and write updated version
      const source = this.store.getMAppSource(entry.sourceId);
      if (!source) continue;

      const result = await this.fetchFileFromSource(source.ref, entry.sourcePath);
      if (!result.ok) {
        errors.push(`${entry.id}: ${result.error}`);
        continue;
      }

      writeFileSync(installPath, JSON.stringify(result.data, null, 2) + "\n", "utf-8");
      updated.push(entry.id);
    }

    return { synced, updated, errors };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async fetchCatalogFromSource(ref: string): Promise<{ ok: boolean; mapps: Array<{ id: string; author?: string; description?: string; category?: string; version?: string; source?: string }>; error?: string }> {
    const result = await this.fetchFileFromSource(ref, "marketplace.json");
    if (!result.ok) return { ok: false, mapps: [], error: result.error };
    const data = result.data as { mapps?: unknown[] };
    if (!Array.isArray(data.mapps)) return { ok: false, mapps: [], error: "marketplace.json missing mapps array" };
    return { ok: true, mapps: data.mapps as Array<{ id: string; author?: string; description?: string; category?: string; version?: string; source?: string }> };
  }

  private async fetchFileFromSource(ref: string, path: string): Promise<{ ok: boolean; data?: unknown; error?: string }> {
    // Parse ref to get repo and branch
    const repoMatch = ref.match(/(?:github\.com\/)?([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)/);
    const repo = repoMatch?.[1];
    if (!repo) return { ok: false, error: `Cannot parse repo from ref: ${ref}` };

    const branchMatch = ref.match(/#([a-zA-Z0-9_.-]+)$/);
    const branch = branchMatch?.[1] ?? this.updateChannel;

    // Try GitHub Contents API first (supports private repos with token)
    const apiUrl = `https://api.github.com/repos/${repo}/contents/${path}?ref=${branch}`;
    try {
      const headers: Record<string, string> = { Accept: "application/vnd.github.raw+json" };
      const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
      if (token) headers.Authorization = `token ${token}`;

      const res = await fetch(apiUrl, { headers, signal: AbortSignal.timeout(15_000) });
      if (res.ok) {
        const data = await res.json() as unknown;
        return { ok: true, data };
      }

      // Fallback to raw.githubusercontent.com
      const rawUrl = `https://raw.githubusercontent.com/${repo}/${branch}/${path}`;
      const rawRes = await fetch(rawUrl, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!rawRes.ok) return { ok: false, error: `HTTP ${rawRes.status}` };
      const rawData = await rawRes.json() as unknown;
      return { ok: true, data: rawData };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
