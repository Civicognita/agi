/**
 * Path resolution for PRIME and service directories.
 *
 * Dev mode switches to personal fork directories; production uses system paths.
 */

import type { AionimaConfig } from "@agi/config";

export function resolvePrimeDir(config: AionimaConfig): string {
  if (config.dev?.enabled) {
    return config.dev.primeDir ?? "/opt/agi-prime_dev";
  }
  return config.prime?.dir ?? "/opt/agi-prime";
}

export function resolveMarketplaceDir(config: AionimaConfig): string {
  if (config.dev?.enabled) {
    return config.dev.marketplaceDir ?? "/opt/agi-marketplace_dev";
  }
  return config.marketplace?.dir ?? "/opt/agi-marketplace";
}

export function resolveIdDir(config: AionimaConfig): string {
  if (config.dev?.enabled) {
    return config.dev.idDir ?? "/opt/agi-local-id_dev";
  }
  return config.idService?.dir ?? "/opt/agi-local-id";
}
