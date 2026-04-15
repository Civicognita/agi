/**
 * Load and validate AionimaConfig from a YAML/JSON file.
 *
 * Supports `$ENV{VAR_NAME}` placeholders in string values — resolved from
 * process.env before Zod validation so secrets can live in .env instead of
 * the config JSON.
 */

import { readFile } from "node:fs/promises";
import { existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { AionimaConfigSchema, type AionimaConfig } from "@aionima/config";

/** Default config file search paths (first found wins). The primary path is
 * `~/.agi/gateway.json`; the in-project paths are kept as fallbacks for dev
 * repos that ship a local config. The primary path used to be `aionima.json`
 * and is auto-migrated on first boot — see `findConfigFile()`. */
const DEFAULT_PATHS = [
  join(homedir(), ".agi", "gateway.json"),
  "./gateway.json",
  "./gateway.yaml",
  "./config/gateway.json",
];

/** Legacy paths from before the rename to gateway.json (v0 → v1 transition). */
const LEGACY_PATHS = [
  join(homedir(), ".agi", "aionima.json"),
  "./aionima.json",
  "./aionima.yaml",
  "./config/aionima.json",
];

export interface ConfigResult {
  config: AionimaConfig;
  path: string;
}

/**
 * Load config from a specific path or search defaults.
 * Throws on validation error or if no config found.
 */
export async function loadConfig(configPath?: string): Promise<ConfigResult> {
  const path = configPath ?? findConfigFile();

  if (!path) {
    throw new Error(
      "No config file found. Create ~/.agi/gateway.json or use --config <path>",
    );
  }

  const raw = await readFile(path, "utf-8");
  const parsed: unknown = JSON.parse(raw);
  const resolved = resolveEnvRefs(parsed);
  const config = AionimaConfigSchema.parse(resolved);

  return { config, path };
}

/**
 * Validate a config file and return detailed errors.
 * Returns null if valid, or an array of error messages.
 */
export async function validateConfigFile(
  configPath?: string,
): Promise<{ path: string; errors: string[] | null }> {
  const path = configPath ?? findConfigFile();

  if (!path) {
    return { path: "(not found)", errors: ["No config file found"] };
  }

  try {
    const raw = await readFile(path, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    const result = AionimaConfigSchema.safeParse(parsed);

    if (result.success) {
      return { path, errors: null };
    }

    const errors = result.error.issues.map(
      (issue) => `${issue.path.join(".")}: ${issue.message}`,
    );
    return { path, errors };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { path, errors: [msg] };
  }
}

function findConfigFile(): string | undefined {
  const found = DEFAULT_PATHS.find((p) => existsSync(p));
  if (found) return found;

  // Legacy migration: if a pre-rename `aionima.json` exists at the same
  // location as a new-name path would, rename it in place and return the
  // new path. Runs once; after the rename, DEFAULT_PATHS wins.
  for (let i = 0; i < LEGACY_PATHS.length; i++) {
    const legacy = LEGACY_PATHS[i]!;
    const target = DEFAULT_PATHS[i]!;
    if (existsSync(legacy) && !existsSync(target)) {
      try {
        renameSync(legacy, target);
        // eslint-disable-next-line no-console
        console.warn(`[aionima] renamed ${legacy} → ${target} (aionima.json → gateway.json)`);
        return target;
      } catch {
        // Permission denied or cross-device: fall back to reading legacy in place.
        return legacy;
      }
    }
  }
  return undefined;
}

/**
 * Recursively walk a parsed JSON value and replace `$ENV{VAR_NAME}` strings
 * with the corresponding `process.env` value.  Throws if the referenced env
 * var is unset or empty.
 */
export function resolveEnvRefs(obj: unknown, path: string[] = []): unknown {
  if (typeof obj === "string") {
    const match = obj.match(/^\$ENV\{(\w+)\}$/);
    if (match) {
      const name = match[1]!;
      const value = process.env[name];
      if (value === undefined || value === "")
        throw new Error(
          `Config at "${path.join(".")}" references $ENV{${name}} but it is not set`,
        );
      return value;
    }
    return obj;
  }
  if (Array.isArray(obj))
    return obj.map((item, i) => resolveEnvRefs(item, [...path, String(i)]));
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj))
      result[key] = resolveEnvRefs(value, [...path, key]);
    return result;
  }
  return obj;
}
