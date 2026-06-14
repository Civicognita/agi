/**
 * PackerRunner — executes packer scripts for a MApp (s102 Phase E).
 *
 * Packer scripts are Starlark scripts with isPacker=true that run before agent
 * invocation to produce MApp-specific context. They must be compiled (wasmB64
 * non-null) to execute; uncompiled packers are skipped silently.
 *
 * Typical call site (Phase F agent-pipeline wiring):
 *   const ctx = await runPackers(mappId, { message, entity }, deps);
 *   // inject ctx into system prompt / additional messages
 */

import type { ScriptRegistry, MappScriptRecord } from "./script-registry.js";
import type { ScriptRunner, ScriptResult, ScriptOptions } from "./script-runner.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface PackerExecution {
  /** The script definition that was executed. */
  script: MappScriptRecord;
  /** The ScriptRunner result for this packer. */
  result: ScriptResult;
}

export interface PackerRunnerOptions extends ScriptOptions {
  /**
   * Stop executing remaining packers when one returns exitReason != "ok".
   * @default false
   */
  failFast?: boolean;
}

// ---------------------------------------------------------------------------
// Core function
// ---------------------------------------------------------------------------

/**
 * Execute all enabled, compiled packer scripts for a MApp in order.
 * Packers with wasmB64=null (not yet compiled) are skipped.
 * Returns one PackerExecution per script that ran.
 */
export async function runPackers(
  mappId: string,
  input: unknown,
  deps: { scriptRegistry: ScriptRegistry; scriptRunner: ScriptRunner },
  opts: PackerRunnerOptions = {},
): Promise<PackerExecution[]> {
  const { failFast = false, ...scriptOpts } = opts;
  const { scriptRegistry, scriptRunner } = deps;

  const packers = await scriptRegistry.getEnabledPackers(mappId);
  const compiledPackers = packers.filter((p) => p.wasmB64 !== null);

  const results: PackerExecution[] = [];
  for (const script of compiledPackers) {
    const sourceBytes = new Uint8Array(Buffer.from(script.wasmB64!, "base64"));
    const result = await scriptRunner.run(sourceBytes, input, {
      timeoutMs: script.timeoutMs,
      maxMemoryPages: script.maxMemoryPages,
      ...scriptOpts,
    });
    results.push({ script, result });
    if (failFast && result.exitReason !== "ok") break;
  }
  return results;
}
