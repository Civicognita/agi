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
/**
 * Normalize a user-provided fork ref to the `owner/repo[#branch]` form
 * the marketplace sync expects. Accepts:
 *   - "wishborn/agi-marketplace"                        → owner/repo shorthand
 *   - "wishborn/agi-marketplace#dev"                    → shorthand with branch
 *   - "https://github.com/wishborn/agi-marketplace.git" → full HTTPS URL
 *   - "git@github.com:wishborn/agi-marketplace.git"     → SSH URL
 * Returns the canonical `owner/repo[#branch]` form or the original
 * string if it didn't match a known pattern.
 */
function normalizeForkRef(raw: string, defaultBranch: string): string {
  if (raw.includes("#")) return raw;

  const httpsMatch = raw.match(/^https?:\/\/github\.com\/([^/]+)\/([^/#?]+?)(?:\.git)?(?:[/?#].*)?$/i);
  if (httpsMatch) {
    return `${httpsMatch[1]}/${httpsMatch[2]}#${defaultBranch}`;
  }

  const sshMatch = raw.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (sshMatch) {
    return `${sshMatch[1]}/${sshMatch[2]}#${defaultBranch}`;
  }

  if (/^[^/\s]+\/[^/\s]+$/.test(raw)) {
    return `${raw}#${defaultBranch}`;
  }

  return raw;
}

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
      // Dev Mode fork refs default to the `dev` branch. Accept full
      // URLs as well as owner/repo shorthand so gateway.json written
      // by /api/dev/switch (which stores full HTTPS URLs) resolves
      // the same as manually-entered shorthand.
      return normalizeForkRef(forkRepo, "dev");
    }
  }

  return `${OFFICIAL_REFS[kind]}#${channel}`;
}
