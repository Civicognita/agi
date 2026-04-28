/**
 * Marketplace types — Claude Code-compatible marketplace.json format.
 *
 * Marketplaces are git repos (or URLs) containing .claude-plugin/marketplace.json.
 * Plugins list their source as GitHub repos, npm packages, git URLs, or relative paths.
 * Aionima extends the format with additional item types (skill, theme, workflow, etc.).
 */

// ---------------------------------------------------------------------------
// Plugin source types (how individual plugins are fetched)
// ---------------------------------------------------------------------------

export interface GitHubSource {
  source: "github";
  repo: string;        // "owner/repo"
  ref?: string;        // branch, tag, or commit
  sha?: string;        // pinned commit hash
}

export interface GitUrlSource {
  source: "url";
  url: string;         // "https://gitlab.com/team/plugin.git"
  ref?: string;
  sha?: string;
}

export interface NpmSource {
  source: "npm";
  package: string;     // "@scope/package-name"
  version?: string;    // semver range
  registry?: string;   // custom registry URL
}

export interface PipSource {
  source: "pip";
  package: string;
  version?: string;
}

/** Plugin source — relative path string or typed object. */
export type PluginSource = string | GitHubSource | GitUrlSource | NpmSource | PipSource;

// ---------------------------------------------------------------------------
// Marketplace catalog format (marketplace.json)
// ---------------------------------------------------------------------------

export type MarketplaceItemType =
  | "plugin"
  | "skill"
  | "knowledge"
  | "theme"
  | "workflow"
  | "agent-tool"
  | "channel";

export interface MarketplacePluginEntry {
  name: string;
  source: PluginSource;
  description?: string;
  version?: string;
  author?: { name: string; email?: string };
  category?: string;
  tags?: string[];
  keywords?: string[];
  license?: string;
  homepage?: string;
  /** Aionima extension: item type. Defaults to "plugin" for Claude Code compat. */
  type?: MarketplaceItemType;
  /** Capability labels describing what this plugin provides. */
  provides?: string[];
  /** Plugin IDs this plugin depends on. */
  depends?: string[];
  /**
   * Previous names this plugin used. Catalog resolution treats both `name`
   * and any entry in `aliases` as matching identifiers. Used to handle
   * plugin renames without orphaning existing `requires:` references in
   * stack manifests or other plugins. Phase M (v0.4.0): `aionima-*` slugs
   * → `agi-*` slugs. Aliases preserved so older marketplace.json files
   * keep resolving the renamed plugins.
   */
  aliases?: string[];
  trustTier?: TrustTier;
  integrityHash?: string;
  signedBy?: string;
}

export interface MarketplaceCatalog {
  name: string;
  owner: { name: string; email?: string };
  metadata?: {
    description?: string;
    version?: string;
    pluginRoot?: string;
  };
  plugins: MarketplacePluginEntry[];
}

// ---------------------------------------------------------------------------
// Marketplace source (how the marketplace itself is referenced)
// ---------------------------------------------------------------------------

export type MarketplaceSourceType = "github" | "url" | "local";

export interface MarketplaceSource {
  id: number;
  /** Original reference as the user provided it (e.g. "Civicognita/agi-marketplace"). */
  ref: string;
  /** Resolved source type. */
  sourceType: MarketplaceSourceType;
  /** Display name (from catalog or user-provided). */
  name: string;
  description?: string;
  lastSyncedAt: string | null;
  pluginCount: number;
}

// ---------------------------------------------------------------------------
// Sync diff (returned from syncPlugins / syncSource)
// ---------------------------------------------------------------------------

/**
 * Shape of what changed between the previous catalog state for a source and the
 * just-synced state. `added` / `updated` / `removed` are plugin names; `updated`
 * also carries the version transition. `total` is the count of plugins in the
 * remote catalog after the sync. Empty arrays + `total > 0` means "catalog
 * fetched cleanly but nothing changed since the last sync."
 */
export interface CatalogDiff {
  added: string[];
  updated: Array<{ name: string; from: string; to: string }>;
  removed: string[];
  total: number;
}

// ---------------------------------------------------------------------------
// Installed items
// ---------------------------------------------------------------------------

export interface InstalledItem {
  /** Plugin name (unique within a source). */
  name: string;
  sourceId: number;
  type: MarketplaceItemType;
  version: string;
  installedAt: string;
  installPath: string;
  /** Serialized PluginSource for update checks. */
  sourceJson: string;
  integrityHash?: string;
  trustTier?: TrustTier;
}

// ---------------------------------------------------------------------------
// Trust & integrity
// ---------------------------------------------------------------------------

export type TrustTier = "official" | "verified" | "community" | "unknown";

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface CatalogSearchParams {
  q?: string;
  type?: string;
  category?: string;
  provides?: string;
}

// ---------------------------------------------------------------------------
// MApp Marketplace types
// ---------------------------------------------------------------------------

export interface MAppSource {
  id: number;
  ref: string;
  sourceType: MarketplaceSourceType;
  name: string;
  lastSyncedAt: string | null;
  mappCount: number;
}

export interface MAppCatalogEntry {
  id: string;
  sourceId: number;
  author: string;
  description?: string;
  category?: string;
  version?: string;
  sourcePath: string;
}

export interface MAppCatalog {
  mapps: Array<{
    id: string;
    author?: string;
    description?: string;
    category?: string;
    version?: string;
    source?: string;
  }>;
}
