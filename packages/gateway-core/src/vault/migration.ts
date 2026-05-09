/**
 * vault/migration — lift existing .env / gateway.json secrets into the
 * Vault (s128 t497).
 *
 * Walks a project's `.env` file and its `project.json` `mcp.servers` block,
 * surfaces secrets that are referenced via $VAR notation (the legacy path
 * pre-Vault), and offers a structured "migrate" step that:
 *   1. Creates a Vault entry per accepted candidate (project-scoped)
 *   2. Rewrites the project.json reference from `$FOO` → `vault://<id>`
 *   3. Optionally removes the line from `.env` (caller decides — some
 *      env vars are still consumed by build tools, not just MCP)
 *
 * The migration is split into discovery + execution so callers (CLI, UI,
 * agent tool) can prompt the owner between the two phases. Discovery is
 * pure read; execution mutates project config + writes vault entries.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { VaultStorage } from "./storage.js";
import type { VaultEntryType } from "./types.js";

export interface MigrationCandidate {
  /** Env var name as it appears in `.env` (e.g., `TYNN_API_KEY`). */
  envKey: string;
  /** Where the var is referenced from in project config — drives the
   *  caller's confidence that this candidate is a real secret. */
  referencedFrom: Array<{
    /** dot-path to the field in project.json that uses this var. */
    path: string;
    /** Suggested name for the new vault entry, derived from the env key
     *  + the field's purpose. */
    suggestedName: string;
  }>;
  /** Plaintext value of the env var (read from .env at discovery time).
   *  Caller passes this through to `executeMigration` so the migration
   *  is a single discovery → mutate flow without re-reading the .env. */
  value: string;
  /** Suggested type for the vault entry, inferred from field name. */
  suggestedType: VaultEntryType;
}

export interface MigrationPlan {
  /** Project path the migration applies to. */
  projectPath: string;
  /** All `.env` keys that look like candidates for migration (referenced
   *  by at least one $VAR in project.json mcp.servers). */
  candidates: MigrationCandidate[];
}

/** Heuristic: infer vault entry type from env key name. Default `key`. */
function inferType(envKey: string): VaultEntryType {
  const upper = envKey.toUpperCase();
  if (upper.includes("PASSWORD") || upper.includes("PASS") || upper.endsWith("_PW")) return "password";
  if (upper.includes("TOKEN") || upper.includes("BEARER") || upper.includes("JWT")) return "token";
  return "key";
}

function suggestName(envKey: string, fieldPath: string): string {
  // "TYNN_API_KEY" + "mcp.servers.tynn.authToken" → "Tynn API key"
  const fieldName = fieldPath.split(".").pop() ?? "";
  const friendly = envKey
    .split("_")
    .map(p => p.charAt(0) + p.slice(1).toLowerCase())
    .join(" ")
    .trim();
  return friendly.length > 0 ? friendly : fieldName;
}

/** Parse a `.env` file's KEY=VALUE pairs. Strips quotes + comments.
 *  Returns null if the file doesn't exist. */
export function parseEnvFile(envPath: string): Record<string, string> | null {
  if (!existsSync(envPath)) return null;
  const out: Record<string, string> = {};
  for (const rawLine of readFileSync(envPath, "utf-8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim();
    let value = line.slice(eqIdx + 1).trim();
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key.length > 0) out[key] = value;
  }
  return out;
}

/** Walk a project.json's mcp.servers block + collect every `$VAR` reference.
 *  Returns a map of env-key → list of dot-paths where it's referenced. */
export function findEnvReferences(projectConfig: unknown): Record<string, string[]> {
  const refs: Record<string, string[]> = {};
  if (typeof projectConfig !== "object" || projectConfig === null) return refs;

  const mcp = (projectConfig as { mcp?: { servers?: unknown[] } }).mcp;
  const servers = Array.isArray(mcp?.servers) ? mcp.servers : [];

  const collect = (value: unknown, path: string): void => {
    if (typeof value === "string" && value.startsWith("$") && value.length > 1) {
      const key = value.slice(1);
      if (refs[key] === undefined) refs[key] = [];
      refs[key].push(path);
      return;
    }
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) collect(value[i], `${path}[${String(i)}]`);
      return;
    }
    if (typeof value === "object" && value !== null) {
      for (const [k, v] of Object.entries(value)) collect(v, path === "" ? k : `${path}.${k}`);
    }
  };

  for (let i = 0; i < servers.length; i++) {
    collect(servers[i], `mcp.servers[${String(i)}]`);
  }

  return refs;
}

/** Discovery phase: read .env + project.json, return the migration plan.
 *  Pure read — does not mutate anything. */
export function planMigration(projectPath: string): MigrationPlan {
  const envPath = join(projectPath, ".env");
  const env = parseEnvFile(envPath) ?? {};

  const cfgPath = join(projectPath, ".agi", "project.json");
  const projectConfig: unknown = existsSync(cfgPath)
    ? JSON.parse(readFileSync(cfgPath, "utf-8")) as unknown
    : {};

  const references = findEnvReferences(projectConfig);

  const candidates: MigrationCandidate[] = [];
  for (const [envKey, paths] of Object.entries(references)) {
    if (env[envKey] === undefined) continue; // referenced but not defined — skip
    candidates.push({
      envKey,
      referencedFrom: paths.map(p => ({ path: p, suggestedName: suggestName(envKey, p) })),
      value: env[envKey],
      suggestedType: inferType(envKey),
    });
  }

  return { projectPath, candidates };
}

/** Replace `$<envKey>` strings with `vault://<entryId>` throughout a config
 *  object. Returns a new config; does not mutate the input. */
export function rewriteConfigReferences(
  config: unknown,
  envToVaultId: Record<string, string>,
): unknown {
  if (typeof config === "string") {
    if (config.startsWith("$") && config.length > 1) {
      const envKey = config.slice(1);
      const vaultId = envToVaultId[envKey];
      if (vaultId !== undefined) return `vault://${vaultId}`;
    }
    return config;
  }
  if (Array.isArray(config)) {
    return config.map(item => rewriteConfigReferences(item, envToVaultId));
  }
  if (typeof config === "object" && config !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(config)) {
      out[k] = rewriteConfigReferences(v, envToVaultId);
    }
    return out;
  }
  return config;
}

export interface ExecuteMigrationOptions {
  /** VaultStorage instance to write entries through. */
  storage: VaultStorage;
  /** Project path; vault entries are created with this as owningProject. */
  projectPath: string;
  /** Subset of candidates the caller decided to migrate (after owner
   *  confirmation in a UI/CLI). Each must have `envKey`, `value`,
   *  `suggestedType`, and `referencedFrom`. */
  accepted: MigrationCandidate[];
}

export interface ExecuteMigrationResult {
  /** Map of env-key → newly-created vault entry id (for caller-side
   *  diagnostics + the audit trail). */
  created: Record<string, string>;
  /** Whether the project.json was rewritten with vault:// references. */
  configRewritten: boolean;
}

/** Execution phase: create vault entries for each accepted candidate +
 *  rewrite project.json. Idempotent on duplicate runs ONLY if the caller
 *  re-discovers (already-rewritten refs won't appear in the new plan). */
export async function executeMigration(opts: ExecuteMigrationOptions): Promise<ExecuteMigrationResult> {
  const created: Record<string, string> = {};

  // Create vault entries (project-scoped)
  for (const c of opts.accepted) {
    const name = c.referencedFrom[0]?.suggestedName ?? c.envKey;
    const entry = await opts.storage.create({
      name,
      type: c.suggestedType,
      value: c.value,
      owningProject: opts.projectPath,
      description: `Migrated from .env (${c.envKey}) via vault migration helper`,
    });
    created[c.envKey] = entry.id;
  }

  // Rewrite project.json
  const cfgPath = join(opts.projectPath, ".agi", "project.json");
  let configRewritten = false;
  if (existsSync(cfgPath)) {
    const config: unknown = JSON.parse(readFileSync(cfgPath, "utf-8"));
    const rewritten = rewriteConfigReferences(config, created);
    if (JSON.stringify(rewritten) !== JSON.stringify(config)) {
      writeFileSync(cfgPath, JSON.stringify(rewritten, null, 2) + "\n", "utf-8");
      configRewritten = true;
    }
  }

  return { created, configRewritten };
}
