/**
 * project-env-store — read + write per-project .env file (Wish #7 / s125 t476).
 *
 * Each hosted project has a `<projectPath>/.env` file used at runtime to
 * inject env vars into containers + into MCP server registration. This
 * module provides:
 *
 * - readProjectEnv(projectPath)  — parse current .env into key/value map
 * - listProjectEnvKeys(projectPath) — return KEY names only (for redacted UI)
 * - setProjectEnvVar(projectPath, key, value) — atomic write (temp + rename)
 * - removeProjectEnvVar(projectPath, key) — remove a key from .env
 * - resolveDollarVars(input, env) — replace $VAR refs in a string with env values
 *
 * Security note: never expose values through dashboard read endpoints —
 * only listProjectEnvKeys (key NAMES). The Vault feature (Wish #10 / s128)
 * is the long-term replacement; .env is the bridge.
 */

import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

const ENV_FILE_NAME = ".env";

/** Parse a .env file body into a key/value map. Skips comments + blank lines. */
function parseEnvBody(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const eqIdx = line.indexOf("=");
    if (eqIdx < 0) continue;
    const key = line.slice(0, eqIdx).trim();
    let value = line.slice(eqIdx + 1).trim();
    // Strip surrounding single or double quotes if present.
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key.length > 0) out[key] = value;
  }
  return out;
}

/** Render a key/value map to .env body (alphabetical for stable diffs). */
function serializeEnvBody(env: Record<string, string>): string {
  const lines: string[] = [];
  const keys = Object.keys(env).sort();
  for (const k of keys) {
    const v = env[k] ?? "";
    // Quote if value contains whitespace or special chars; bare otherwise.
    const needsQuote = /[\s"'#$]/.test(v);
    lines.push(`${k}=${needsQuote ? `"${v.replace(/"/g, '\\"')}"` : v}`);
  }
  return lines.join("\n") + "\n";
}

export function readProjectEnv(projectPath: string): Record<string, string> {
  const envPath = join(projectPath, ENV_FILE_NAME);
  if (!existsSync(envPath)) return {};
  try {
    const body = readFileSync(envPath, "utf-8");
    return parseEnvBody(body);
  } catch {
    return {};
  }
}

export function listProjectEnvKeys(projectPath: string): string[] {
  return Object.keys(readProjectEnv(projectPath)).sort();
}

export function setProjectEnvVar(projectPath: string, key: string, value: string): void {
  if (!/^[A-Z_][A-Z0-9_]*$/i.test(key)) {
    throw new Error(`Invalid env var key: "${key}" (must match [A-Z_][A-Z0-9_]*)`);
  }
  const envPath = join(projectPath, ENV_FILE_NAME);
  // Ensure parent dir exists (project might be brand new without a hosted root).
  mkdirSync(dirname(envPath), { recursive: true });
  const current = readProjectEnv(projectPath);
  current[key] = value;
  const body = serializeEnvBody(current);
  // Atomic write: temp file + rename.
  const tmpPath = `${envPath}.tmp`;
  writeFileSync(tmpPath, body, { encoding: "utf-8", mode: 0o600 });
  renameSync(tmpPath, envPath);
}

export function removeProjectEnvVar(projectPath: string, key: string): void {
  const envPath = join(projectPath, ENV_FILE_NAME);
  if (!existsSync(envPath)) return;
  const current = readProjectEnv(projectPath);
  if (!(key in current)) return;
  delete current[key];
  const body = serializeEnvBody(current);
  const tmpPath = `${envPath}.tmp`;
  writeFileSync(tmpPath, body, { encoding: "utf-8", mode: 0o600 });
  renameSync(tmpPath, envPath);
}

/**
 * Resolve `$VAR` references in a string against a key/value map.
 * Used at MCP server registration time to expand authToken / env values
 * pulled from the project's .env without putting secrets in project.json.
 *
 *   resolveDollarVars("$TYNN_API_KEY", env)  → env.TYNN_API_KEY (or "")
 *   resolveDollarVars("npx -y @tynn/mcp-server", env)  → unchanged (no $)
 */
export function resolveDollarVars(input: string, env: Record<string, string>): string {
  if (typeof input !== "string" || !input.includes("$")) return input;
  if (input.startsWith("$") && !input.includes(" ")) {
    // Whole-string $VAR — direct substitution.
    return env[input.slice(1)] ?? "";
  }
  // Inline $VAR substitutions (uncommon for MCP; reserved for future shapes).
  return input.replace(/\$([A-Z_][A-Z0-9_]*)/gi, (_, name: string) => env[name] ?? "");
}

/** Resolve $VAR refs throughout a Record<string,string>. */
export function resolveDollarVarsObject(
  input: Record<string, string> | undefined,
  env: Record<string, string>,
): Record<string, string> | undefined {
  if (input === undefined) return undefined;
  return Object.fromEntries(Object.entries(input).map(([k, v]) => [k, resolveDollarVars(v, env)]));
}
