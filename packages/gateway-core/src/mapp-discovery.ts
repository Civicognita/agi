/**
 * MApp Discovery — scans ~/.agi/mapps/{author}/{slug}.json at boot.
 *
 * Validates each file against the MApp Zod schema and registers
 * valid definitions in the MAppRegistry.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MAppDefinitionSchema } from "@aionima/config";
import type { MAppDefinition } from "@aionima/sdk";
import type { MAppRegistry } from "./mapp-registry.js";
import { createComponentLogger } from "./logger.js";
import type { Logger } from "./logger.js";

/** Maps legacy MApp categories to the new consolidated set. */
const CATEGORY_MIGRATION_MAP: Record<string, string> = {
  reader: "viewer",
  gallery: "viewer",
  dashboard: "viewer",
  editor: "production",
  suite: "production",
};

export interface MAppDiscoveryResult {
  loaded: number;
  skipped: number;
  errors: Array<{ path: string; error: string }>;
}

/**
 * Discover and load all MApps from the mapps directory.
 *
 * @param mappsDir — Absolute path to ~/.agi/mapps/
 * @param registry — MAppRegistry to populate
 * @param logger — Optional logger
 */
export function discoverMApps(
  mappsDir: string,
  registry: MAppRegistry,
  logger?: Logger,
): MAppDiscoveryResult {
  const log = createComponentLogger(logger, "mapp-discovery");
  const result: MAppDiscoveryResult = { loaded: 0, skipped: 0, errors: [] };

  if (!existsSync(mappsDir)) {
    log.info(`mapps directory not found: ${mappsDir}`);
    return result;
  }

  // Walk ~/.agi/mapps/{author}/
  let authorDirs: string[];
  try {
    authorDirs = readdirSync(mappsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name);
  } catch {
    return result;
  }

  for (const author of authorDirs) {
    const authorPath = join(mappsDir, author);
    let files: string[];
    try {
      files = readdirSync(authorPath)
        .filter((f) => f.endsWith(".json") && !f.startsWith("."));
    } catch {
      continue;
    }

    for (const file of files) {
      const filePath = join(authorPath, file);
      try {
        const raw = JSON.parse(readFileSync(filePath, "utf-8"));
        // Migrate legacy category values before validation
        if (typeof raw.category === "string" && raw.category in CATEGORY_MIGRATION_MAP) {
          raw.category = CATEGORY_MIGRATION_MAP[raw.category];
        }
        const parsed = MAppDefinitionSchema.safeParse(raw);

        if (!parsed.success) {
          const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
          result.errors.push({ path: filePath, error: `Schema validation failed: ${issues}` });
          result.skipped++;
          log.warn(`invalid MApp at ${filePath}: ${issues}`);
          continue;
        }

        // Verify author matches directory
        if (parsed.data.author !== author) {
          log.warn(`MApp at ${filePath} has author "${parsed.data.author}" but is in directory "${author}" — using directory name`);
        }

        registry.register(parsed.data as import("@aionima/sdk").MAppDefinition);
        result.loaded++;
        log.info(`loaded MApp: ${parsed.data.name} (${parsed.data.id}) by ${author}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push({ path: filePath, error: msg });
        result.skipped++;
        log.warn(`failed to load MApp at ${filePath}: ${msg}`);
      }
    }
  }

  log.info(`MApp discovery: ${String(result.loaded)} loaded, ${String(result.skipped)} skipped`);
  return result;
}

// ---------------------------------------------------------------------------
// Marketplace catalog scanning
// ---------------------------------------------------------------------------

export interface MAppCatalogEntry {
  definition: MAppDefinition;
  sourcePath: string;
  installed: boolean;
}

/**
 * Scan the MApp marketplace repo for available MApps.
 * Returns parsed definitions with install status (whether ~/.agi/mapps/ has a copy).
 */
export function scanMAppMarketplace(
  marketplaceDir: string,
  mappsDir: string,
): MAppCatalogEntry[] {
  const entries: MAppCatalogEntry[] = [];
  const mappsRoot = join(marketplaceDir, "mapps");

  if (!existsSync(mappsRoot)) return entries;

  let authorDirs: string[];
  try {
    authorDirs = readdirSync(mappsRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name);
  } catch {
    return entries;
  }

  for (const author of authorDirs) {
    const authorPath = join(mappsRoot, author);
    let files: string[];
    try {
      files = readdirSync(authorPath).filter((f) => f.endsWith(".json") && !f.startsWith("."));
    } catch {
      continue;
    }

    for (const file of files) {
      const filePath = join(authorPath, file);
      try {
        const raw = JSON.parse(readFileSync(filePath, "utf-8"));
        if (typeof raw.category === "string" && raw.category in CATEGORY_MIGRATION_MAP) {
          raw.category = CATEGORY_MIGRATION_MAP[raw.category];
        }
        const parsed = MAppDefinitionSchema.safeParse(raw);
        if (!parsed.success) continue;

        const def = parsed.data as MAppDefinition;
        const installedPath = join(mappsDir, author, `${def.id}.json`);
        entries.push({
          definition: def,
          sourcePath: filePath,
          installed: existsSync(installedPath),
        });
      } catch {
        // Skip unparseable files
      }
    }
  }

  return entries;
}
