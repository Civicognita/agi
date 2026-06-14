/**
 * Path resolution for PRIME and service directories.
 *
 * Dev Mode swaps the origin remote of the canonical directories
 * (via upgrade.sh's `ensure_origin_remote`) rather than using
 * parallel `*_dev` sibling directories. Resolvers prefer the explicit
 * config override; fall back to the canonical shared path.
 */

import { existsSync } from "node:fs";
import type { AionimaConfig } from "@agi/config";

function resolveSharedDir(configured: string | undefined, legacyDevPath: string, canonical: string): string {
  if (configured) return configured;
  // Backwards compat: if a legacy `*_dev` dir still exists and the
  // canonical dir does not, keep using the legacy one.
  if (existsSync(legacyDevPath) && !existsSync(canonical)) return legacyDevPath;
  return canonical;
}

export function resolvePrimeDir(config: AionimaConfig): string {
  if (config.dev?.enabled) {
    return resolveSharedDir(config.dev.primeDir, "/opt/agi-prime_dev", "/opt/agi-prime");
  }
  return config.prime?.dir ?? "/opt/agi-prime";
}

export function resolveMarketplaceDir(config: AionimaConfig): string {
  if (config.dev?.enabled) {
    return resolveSharedDir(config.dev.marketplaceDir, "/opt/agi-marketplace_dev", "/opt/agi-marketplace");
  }
  return config.marketplace?.dir ?? "/opt/agi-marketplace";
}


