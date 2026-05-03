/**
 * `aionima schema validate` — walk every on-disk config file the gateway
 * reads at boot, run each through its Zod schema, and report all errors
 * with file path + dot-path + message.
 *
 * Origin: cycle 150 incident (s144 t575). The gateway crash-looped because
 * a project.json had repos[] in an old shape that ProjectConfigSchema no
 * longer accepted; the unhandled ZodError surfaced as systemd thrashing.
 * This diagnostic is the thing that should be run BEFORE attempting
 * upgrade or restart whenever schema validation might fail — it tells
 * the operator exactly which file + which path is broken, so the fix
 * can target one config rather than guessing.
 *
 * Exit code = 1 when any validation error is found, 0 when clean. Useful
 * for pre-commit or pre-deploy automation.
 *
 * In scope for this slice (t575 part 1):
 *   - gateway.json validated against AionimaConfigSchema
 *   - every workspace project's project.json validated against ProjectConfigSchema
 *   - human-readable + JSON output modes
 *
 * Out of scope (subsequent slices):
 *   - plugin manifests (no Zod schema yet — landing under sdk migration)
 *   - auto-repair offers (drop unrecognized keys, run migration helpers)
 *   - interactive doctor TUI integration (s144 wider scope)
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { Command } from "commander";
import { AionimaConfigSchema, ProjectConfigSchema } from "@agi/config";
import { bold, dim, green, red, yellow } from "../output.js";

/**
 * Minimal subset of a Zod issue we use here. Imported as a duck-type
 * instead of `import { z } from "zod"` so the CLI package doesn't take
 * a direct zod dep — @agi/config owns that.
 */
interface ZodIssueLike {
  path: (string | number)[];
  message: string;
  code: string;
}

interface SchemaLike {
  safeParse(raw: unknown):
    | { success: true; data: unknown }
    | { success: false; error: { issues: ZodIssueLike[] } };
}

interface ValidationError {
  file: string;
  /** Zod issue path joined with dots — e.g. "repos.0.attachedStacks". */
  path: string;
  message: string;
  /** Zod issue code — useful for filtering in JSON consumers. */
  code: string;
}

interface ValidationResult {
  file: string;
  schemaName: string;
  ok: boolean;
  errors: ValidationError[];
  /** True when the file doesn't exist on disk (treated as ok for optional files). */
  missing?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatZodIssue(file: string, issue: ZodIssueLike): ValidationError {
  return {
    file,
    path: issue.path.join("."),
    message: issue.message,
    code: issue.code,
  };
}

function validateFile(
  file: string,
  schemaName: string,
  schema: SchemaLike,
  required: boolean,
): ValidationResult {
  if (!existsSync(file)) {
    return { file, schemaName, ok: required ? false : true, errors: [], missing: true };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf-8"));
  } catch (err) {
    return {
      file,
      schemaName,
      ok: false,
      errors: [{
        file,
        path: "",
        message: `JSON parse failed: ${err instanceof Error ? err.message : String(err)}`,
        code: "json_parse_error",
      }],
    };
  }
  const result = schema.safeParse(raw);
  if (result.success) {
    return { file, schemaName, ok: true, errors: [] };
  }
  return {
    file,
    schemaName,
    ok: false,
    errors: result.error.issues.map((i: ZodIssueLike) => formatZodIssue(file, i)),
  };
}

/** Resolve the gateway config path the same way the runtime does. */
function gatewayConfigPath(): string {
  return process.env.AIONIMA_CONFIG ?? join(homedir(), ".agi", "gateway.json");
}

/** Walk the workspace.projects[] config to find project dirs. */
function discoverProjectFiles(gatewayJsonPath: string): string[] {
  if (!existsSync(gatewayJsonPath)) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(gatewayJsonPath, "utf-8"));
  } catch {
    return [];
  }
  const projectDirs: string[] = [];
  const ws = (raw as { workspace?: { projects?: unknown[] } } | null)?.workspace?.projects;
  if (Array.isArray(ws)) {
    for (const root of ws) {
      if (typeof root !== "string") continue;
      try {
        const entries = readdirSync(root, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name.startsWith("_")) continue;
          const fullPath = resolve(root, entry.name);
          // Post-s140 layout: project.json at the project root.
          const projectJson = join(fullPath, "project.json");
          if (existsSync(projectJson) && statSync(projectJson).isFile()) {
            projectDirs.push(projectJson);
          }
        }
      } catch {
        // root may not exist in this environment; skip silently
      }
    }
  }
  return projectDirs;
}

// ---------------------------------------------------------------------------
// Output rendering
// ---------------------------------------------------------------------------

function renderHuman(results: ValidationResult[]): void {
  console.log();
  console.log(bold("  aionima schema validate"));
  console.log();

  let totalFiles = 0;
  let cleanFiles = 0;
  let missingOptional = 0;
  let totalErrors = 0;

  for (const r of results) {
    totalFiles += 1;
    if (r.ok && r.missing) {
      missingOptional += 1;
      console.log(`  ${dim("○")} ${dim(r.file)} ${dim("(missing — optional)")}`);
      continue;
    }
    if (r.ok) {
      cleanFiles += 1;
      console.log(`  ${green("✓")} ${r.file} ${dim(`[${r.schemaName}]`)}`);
      continue;
    }
    if (r.missing) {
      totalErrors += 1;
      console.log(`  ${red("✗")} ${r.file} ${dim(`[${r.schemaName}]`)} ${red("MISSING (required)")}`);
      continue;
    }
    console.log(`  ${red("✗")} ${r.file} ${dim(`[${r.schemaName}]`)}`);
    for (const e of r.errors) {
      totalErrors += 1;
      const where = e.path ? yellow(e.path) : yellow("(root)");
      console.log(`      ${where} ${dim("→")} ${e.message} ${dim(`[${e.code}]`)}`);
    }
  }

  console.log();
  console.log(
    `  ${bold("summary:")} ${String(cleanFiles)}/${String(totalFiles)} clean` +
    (missingOptional > 0 ? `, ${String(missingOptional)} missing-optional` : "") +
    (totalErrors > 0 ? `, ${red(`${String(totalErrors)} error(s)`)}` : ""),
  );
  if (totalErrors === 0) {
    console.log(`  ${green("OK")} — all on-disk config files validate cleanly`);
  } else {
    console.log(`  ${red("FAIL")} — fix the listed errors before restart/upgrade`);
  }
  console.log();
}

// ---------------------------------------------------------------------------
// Validate runner (exported for tests + callers)
// ---------------------------------------------------------------------------

export function runSchemaValidate(opts: { configPath?: string } = {}): ValidationResult[] {
  const gatewayJson = opts.configPath ?? gatewayConfigPath();
  const results: ValidationResult[] = [];

  // 1. Gateway config — the most common crash source.
  results.push(validateFile(gatewayJson, "AionimaConfigSchema", AionimaConfigSchema, /* required */ false));

  // 2. Project configs — every project.json the gateway will read at boot.
  const projectFiles = discoverProjectFiles(gatewayJson);
  for (const file of projectFiles) {
    results.push(validateFile(file, "ProjectConfigSchema", ProjectConfigSchema, /* required */ true));
  }

  return results;
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerSchemaCommand(program: Command): void {
  const schema = program.command("schema").description("Schema validation diagnostics for on-disk config");

  schema
    .command("validate")
    .description("Walk every on-disk config file and validate against its Zod schema")
    .option("--json", "Output results as JSON instead of human-readable")
    .action((cmdOpts: { json?: boolean }) => {
      const opts = program.opts<{ config?: string }>();
      const results = runSchemaValidate({ configPath: opts.config });
      const totalErrors = results.reduce((n, r) => n + r.errors.length, 0);
      const missingRequired = results.filter((r) => r.missing && !r.ok).length;
      const failed = totalErrors > 0 || missingRequired > 0;

      if (cmdOpts.json) {
        console.log(JSON.stringify({
          results,
          summary: {
            total: results.length,
            clean: results.filter((r) => r.ok && !r.missing).length,
            missingOptional: results.filter((r) => r.ok && r.missing).length,
            missingRequired,
            errors: totalErrors,
          },
        }, null, 2));
      } else {
        renderHuman(results);
      }

      // Exit explicitly so we don't get held open by any background
      // handles registered via the other registerXxxCommand calls (the
      // run command in particular wires watchers/timers at module load).
      process.exit(failed ? 1 : 0);
    });
}
