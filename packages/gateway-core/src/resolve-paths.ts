/**
 * Path resolution for PRIME and service directories.
 *
 * The original Dev Mode design used parallel `*_dev` directories
 * (/opt/agi-prime_dev, /opt/agi-local-id_dev, /opt/agi-marketplace_dev)
 * so production and dev installs could coexist. Starting in v0.4.66,
 * Dev Mode swaps the *origin remote* of the canonical directories
 * (via upgrade.sh's `ensure_origin_remote`) instead — so `/opt/agi-prime`
 * itself points at the owner's fork when Dev Mode is on.
 *
 * Net effect: the `*_dev` paths are legacy. These resolvers prefer the
 * explicit config override; fall back to the canonical shared path.
 * If an older install still has populated `*_dev` dirs, a future
 * migration step can merge/rename them — for now we bias to the
 * canonical path so Dev Mode users don't see "Corpus not found"
 * banners after upgrading past v0.4.66.
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

export function resolveIdDir(config: AionimaConfig): string {
  if (config.dev?.enabled) {
    return resolveSharedDir(config.dev.idDir, "/opt/agi-local-id_dev", "/opt/agi-local-id");
  }
  return config.idService?.dir ?? "/opt/agi-local-id";
}
