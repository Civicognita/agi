/**
 * Path resolution for PRIME and BOTS directories.
 *
 * Dev mode switches to personal fork directories; production uses system paths.
 */

import type { AionimaConfig } from "@aionima/config";

export function resolvePrimeDir(config: AionimaConfig): string {
  if (config.dev?.enabled) {
    return config.dev.primeDir ?? "/opt/aionima-prime_dev";
  }
  return config.prime?.dir ?? "/opt/aionima-prime";
}

export function resolveBotsDir(config: AionimaConfig): string {
  if (config.dev?.enabled) {
    return config.dev.botsDir ?? "/opt/aionima-bots_dev";
  }
  return config.bots?.dir ?? "/opt/aionima-bots";
}

export function resolveMarketplaceDir(config: AionimaConfig): string {
  if (config.dev?.enabled) {
    return config.dev.marketplaceDir ?? "/opt/aionima-marketplace_dev";
  }
  return config.marketplace?.dir ?? "/opt/aionima-marketplace";
}

export function resolveIdDir(config: AionimaConfig): string {
  if (config.dev?.enabled) {
    return config.dev.idDir ?? "/opt/aionima-id_dev";
  }
  return config.idService?.dir ?? "/opt/aionima-id";
}
