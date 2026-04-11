/**
 * @aionima/marketplace — Claude Code-compatible plugin marketplace.
 */

export { MarketplaceStore } from "./store.js";
export { MarketplaceManager } from "./marketplace-manager.js";
export type { MarketplaceManagerOptions } from "./marketplace-manager.js";
export { MAppMarketplaceManager } from "./mapp-marketplace-manager.js";
export type { MAppMarketplaceManagerOptions } from "./mapp-marketplace-manager.js";
export { fetchCatalog, parseSourceRef } from "./catalog-fetcher.js";
export type { FetchCatalogResult } from "./catalog-fetcher.js";
export { installPlugin, uninstallPlugin, getInstallPath } from "./installer.js";
export type { InstallContext } from "./installer.js";
export type {
  MarketplaceItemType,
  MarketplacePluginEntry,
  MarketplaceCatalog,
  MarketplaceSource,
  MarketplaceSourceType,
  PluginSource,
  GitHubSource,
  GitUrlSource,
  NpmSource,
  PipSource,
  InstalledItem,
  CatalogSearchParams,
  MAppSource,
  MAppCatalogEntry,
  MAppCatalog,
} from "./types.js";
