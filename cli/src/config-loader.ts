/**
 * Load and validate AionimaConfig from a YAML/JSON file.
 *
 * Supports `$ENV{VAR_NAME}` placeholders in string values — resolved from
 * process.env before Zod validation so secrets can live in .env instead of
 * the config JSON.
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { AionimaConfigSchema, type AionimaConfig } from "@aionima/config";

/** Default config file search paths (first found wins) */
const DEFAULT_PATHS = [
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
      "No config file found. Create ~/.agi/aionima.json or use --config <path>",
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
  return DEFAULT_PATHS.find((p) => existsSync(p));
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
