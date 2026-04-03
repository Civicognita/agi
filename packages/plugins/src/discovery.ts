/**
 * Plugin discovery — scan directories for plugin manifests.
 * Adapted from OpenClaw's discovery.ts.
 *
 * Supports manifest formats:
 *   1. package.json with an `aionima` field (preferred)
 *   2. package.json with a `nexus` field (legacy)
 *   3. aionima-plugin.json or nexus-plugin.json (backwards compat)
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve as resolvePath } from "node:path";
import { validateManifest } from "./security.js";
import type { AionimaPluginManifest, PluginCategory, ProvidesLabel } from "./types.js";

export interface DiscoveredPlugin {
  manifest: AionimaPluginManifest;
  basePath: string;
  entryPath: string;
}

export interface DiscoveryResult {
  plugins: DiscoveredPlugin[];
  errors: { path: string; error: string }[];
}

const MANIFEST_FILENAMES = ["aionima-plugin.json", "nexus-plugin.json"];
const PACKAGE_JSON = "package.json";

/**
 * Try loading manifest from package.json `aionima` or `nexus` field first,
 * then fall back to aionima-plugin.json / nexus-plugin.json for backwards compat.
 */
function tryLoadManifest(dir: string): DiscoveredPlugin | { error: string } {
  // 1. Try package.json with aionima field (preferred) or nexus field (legacy)
  const pkgPath = join(dir, PACKAGE_JSON);
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as Record<string, unknown>;
      const pluginField = (pkg.aionima ?? pkg.nexus) as Record<string, unknown> | undefined;

      if (pluginField && typeof pluginField === "object" && pluginField.id) {
        const manifest: AionimaPluginManifest = {
          id: pluginField.id as string,
          name: (pluginField.name as string) ?? (pkg.name as string) ?? pluginField.id as string,
          version: (pluginField.version as string) ?? (pkg.version as string) ?? "0.0.0",
          description: (pluginField.description as string) ?? (pkg.description as string) ?? "",
          author: (pluginField.author as string) ?? (pkg.author as string) ?? undefined,
          aionimaVersion: (pluginField.aionimaVersion as string) ?? (pluginField.nexusVersion as string) ?? ">=0.1.0",
          permissions: (pluginField.permissions ?? []) as AionimaPluginManifest["permissions"],
          entry: (pluginField.entry as string) ?? "./src/index.ts",
          projectTypes: (pluginField.projectTypes as string[]) ?? undefined,
          category: (pluginField.category as PluginCategory) ?? undefined,
          provides: (pluginField.provides as ProvidesLabel[]) ?? undefined,
          depends: (pluginField.depends as string[]) ?? undefined,
          bakedIn: (pluginField.bakedIn as boolean) ?? undefined,
          disableable: (pluginField.disableable as boolean) ?? undefined,
        };

        const validation = validateManifest(manifest);
        if (!validation.valid) {
          return { error: `Invalid manifest in package.json plugin field: ${validation.errors.join("; ")}` };
        }

        // Prefer compiled dist/index.js when available (marketplace plugins
        // are built by deploy into self-contained bundles)
        const distEntry = resolvePath(dir, "dist/index.js");
        if (existsSync(distEntry)) {
          return { manifest, basePath: dir, entryPath: distEntry };
        }

        const entryPath = resolvePath(dir, manifest.entry);
        if (!existsSync(entryPath)) {
          return { error: `Entry file not found: ${manifest.entry}` };
        }

        return { manifest, basePath: dir, entryPath };
      }
    } catch {
      // Invalid JSON in package.json — fall through to legacy manifest
    }
  }

  // 2. Fall back to aionima-plugin.json or nexus-plugin.json
  let manifestPath: string | undefined;
  for (const filename of MANIFEST_FILENAMES) {
    const candidate = join(dir, filename);
    if (existsSync(candidate)) {
      manifestPath = candidate;
      break;
    }
  }
  if (!manifestPath) {
    return { error: `No ${PACKAGE_JSON} aionima/nexus field or manifest JSON found` };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(manifestPath, "utf-8"));
  } catch {
    return { error: `Invalid JSON in ${manifestPath}` };
  }

  const validation = validateManifest(raw);
  if (!validation.valid) {
    return { error: `Invalid manifest: ${validation.errors.join("; ")}` };
  }

  const manifest = raw as AionimaPluginManifest;

  // Prefer compiled dist/index.js when available
  const distEntry = resolvePath(dir, "dist/index.js");
  if (existsSync(distEntry)) {
    return { manifest, basePath: dir, entryPath: distEntry };
  }

  const entryPath = resolvePath(dir, manifest.entry);

  if (!existsSync(entryPath)) {
    return { error: `Entry file not found: ${manifest.entry}` };
  }

  return { manifest, basePath: dir, entryPath };
}

export function discoverPlugins(searchPaths: string[]): DiscoveryResult {
  const plugins: DiscoveredPlugin[] = [];
  const errors: { path: string; error: string }[] = [];

  for (const searchPath of searchPaths) {
    if (!existsSync(searchPath)) continue;

    try {
      const entries = readdirSync(searchPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const pluginDir = join(searchPath, entry.name);
        const result = tryLoadManifest(pluginDir);

        if ("error" in result) {
          errors.push({ path: pluginDir, error: result.error });
        } else {
          plugins.push(result);
        }
      }
    } catch {
      // searchPath may not be readable
    }
  }

  return { plugins, errors };
}

export interface SearchPathOptions {
  /** User's workspace root (from config). Used for user-installed plugins. */
  workspaceRoot: string;
  /** Gateway installation directory (process.cwd()). */
  installDir?: string;
}

export function getDefaultSearchPaths(optsOrRoot: string | SearchPathOptions): string[] {
  const opts = typeof optsOrRoot === "string"
    ? { workspaceRoot: optsOrRoot }
    : optsOrRoot;

  const { workspaceRoot } = opts;
  const paths: string[] = [
    join(workspaceRoot, ".plugins"),                // user-installed plugins
    join(workspaceRoot, ".aionima", "plugins"),      // standard location
    join(workspaceRoot, ".nexus", "plugins"),        // legacy backwards compat
  ];

  return paths;
}

/**
 * Scan a directory for channel subdirectories (all subdirs, no prefix filter).
 */
export function discoverChannelPlugins(channelsDir: string): DiscoveryResult {
  const plugins: DiscoveredPlugin[] = [];
  const errors: { path: string; error: string }[] = [];

  if (!existsSync(channelsDir)) return { plugins, errors };

  try {
    const entries = readdirSync(channelsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const pluginDir = join(channelsDir, entry.name);
      const result = tryLoadManifest(pluginDir);

      if ("error" in result) {
        errors.push({ path: pluginDir, error: result.error });
      } else {
        plugins.push(result);
      }
    }
  } catch {
    // channelsDir may not be readable
  }

  return { plugins, errors };
}

/**
 * Scan a directory for plugin subdirectories matching a prefix (default: "plugin-").
 * Reusable core for marketplace, in-repo, and other prefixed plugin directories.
 */
export function discoverPrefixedPlugins(dir: string, prefix = "plugin-"): DiscoveryResult {
  const plugins: DiscoveredPlugin[] = [];
  const errors: { path: string; error: string }[] = [];

  if (!existsSync(dir)) return { plugins, errors };

  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith(prefix)) continue;
      const pluginDir = join(dir, entry.name);
      const result = tryLoadManifest(pluginDir);

      if ("error" in result) {
        errors.push({ path: pluginDir, error: result.error });
      } else {
        plugins.push(result);
      }
    }
  } catch {
    // dir may not exist or be readable
  }

  return { plugins, errors };
}

/**
 * Scan the marketplace plugins/ directory for all plugin subdirectories.
 * Expects the marketplace repo structure: marketplaceDir/plugins/plugin-{name}/
 */
export function discoverMarketplacePlugins(marketplaceDir: string): DiscoveryResult {
  return discoverPrefixedPlugins(join(marketplaceDir, "plugins"));
}

