/**
 * Dev-Mode marketplace source resolution.
 *
 * When Dev Mode is ON, plugin + MApp marketplace catalogs are polled from
 * the owner's forks (`wishborn/agi-marketplace`, etc.) instead of the
 * canonical `Civicognita/*`. This is a pure function of gateway config —
 * no side effects, so the scheduled auto-sync task can call it every tick
 * and react to toggle changes without a restart.
 *
 * Config shape (from `~/.agi/gateway.json`):
 *   {
 *     "gateway": { "updateChannel": "main" | "dev" },
 *     "dev": {
 *       "enabled": true,
 *       "marketplaceRepo": "wishborn/agi-marketplace",
 *       "mappMarketplaceRepo": "wishborn/agi-mapp-marketplace"
 *     }
 *   }
 */

export interface MarketplaceSourceConfig {
  gateway?: {
    updateChannel?: string;
  };
  dev?: {
    enabled?: boolean;
    marketplaceRepo?: string;
    mappMarketplaceRepo?: string;
  };
}

export type MarketplaceKind = "plugin" | "mapp";

const OFFICIAL_REFS: Record<MarketplaceKind, string> = {
  plugin: "Civicognita/agi-marketplace",
  mapp: "Civicognita/agi-mapp-marketplace",
};

/**
 * Resolve the active marketplace source ref.
 *
 * Returns the fork ref (e.g. `wishborn/agi-marketplace#dev`) when Dev Mode
 * is enabled AND the matching `dev.*Repo` is configured. Otherwise returns
 * the Civicognita canonical ref on the configured update channel.
 */
export function resolveMarketplaceSource(
  config: MarketplaceSourceConfig,
  kind: MarketplaceKind,
): string {
  const channel = config.gateway?.updateChannel ?? "main";
  const devEnabled = config.dev?.enabled === true;

  if (devEnabled) {
    const key = kind === "plugin" ? "marketplaceRepo" : "mappMarketplaceRepo";
    const forkRepo = config.dev?.[key];
    if (forkRepo && typeof forkRepo === "string" && forkRepo.length > 0) {
      // Preserve branch suffix if the owner already specified one.
      // Otherwise default Dev Mode forks track the `dev` branch.
      return forkRepo.includes("#") ? forkRepo : `${forkRepo}#dev`;
    }
  }

  return `${OFFICIAL_REFS[kind]}#${channel}`;
}
