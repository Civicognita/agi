/**
 * run_script — agent tool for per-MApp Starlark script execution (s182 Phase C).
 *
 * Actions:
 *   run     — execute an enabled compiled script with JSON input
 *   list    — list scripts registered for a MApp
 *   get     — get details (including compiled state) for a specific script
 *   enable  — allow a script to execute (deny-by-default)
 *   disable — revoke execute permission for a script
 *
 * Phase C gate: `run` requires wasmB64 to be non-null. Scripts without a
 * compiled WASM blob return an informative "not compiled" error until the
 * Starlark→WASM pipeline (Phase D) populates the blob.
 */

import type { ToolHandler, ToolExecutionContext } from "../tool-registry.js";
import type { ScriptRegistry } from "../script-registry.js";
import type { ScriptRunner } from "../script-runner.js";

export interface RunScriptToolConfig {
  scriptRegistry?: ScriptRegistry;
  scriptRunner?: ScriptRunner;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export function createRunScriptHandler(config: RunScriptToolConfig): ToolHandler {
  return async (
    input: Record<string, unknown>,
    _ctx?: ToolExecutionContext,
  ): Promise<string> => {
    const { scriptRegistry, scriptRunner } = config;
    if (!scriptRegistry) {
      return JSON.stringify({ error: "Script registry not available in this environment" });
    }

    const action = String(input.action ?? "");

    // ── list ─────────────────────────────────────────────────────────────────
    if (action === "list") {
      const mappId = String(input.mappId ?? "");
      if (!mappId) return JSON.stringify({ error: "mappId is required for action:list" });
      const scripts = await scriptRegistry.list(mappId);
      return JSON.stringify({
        scripts: scripts.map((s) => ({
          id: s.id,
          name: s.name,
          language: s.language,
          isPacker: s.isPacker,
          enabled: s.enabled,
          compiled: s.wasmB64 !== null,
          timeoutMs: s.timeoutMs,
        })),
      });
    }

    // ── get ──────────────────────────────────────────────────────────────────
    if (action === "get") {
      const scriptId = String(input.scriptId ?? "");
      if (!scriptId) return JSON.stringify({ error: "scriptId is required for action:get" });
      const script = await scriptRegistry.get(scriptId);
      if (!script) return JSON.stringify({ error: `Script not found: ${scriptId}` });
      return JSON.stringify({
        id: script.id,
        mappId: script.mappId,
        name: script.name,
        description: script.description,
        language: script.language,
        isPacker: script.isPacker,
        enabled: script.enabled,
        compiled: script.wasmB64 !== null,
        wasmHash: script.wasmHash,
        timeoutMs: script.timeoutMs,
        maxMemoryPages: script.maxMemoryPages,
        createdAt: script.createdAt,
        updatedAt: script.updatedAt,
      });
    }

    // ── enable / disable ─────────────────────────────────────────────────────
    if (action === "enable" || action === "disable") {
      const scriptId = String(input.scriptId ?? "");
      if (!scriptId) return JSON.stringify({ error: `scriptId is required for action:${action}` });
      const ok = await scriptRegistry.setEnabled(scriptId, action === "enable");
      if (!ok) return JSON.stringify({ error: `Script not found: ${scriptId}` });
      return JSON.stringify({ ok: true, scriptId, enabled: action === "enable" });
    }

    // ── run ──────────────────────────────────────────────────────────────────
    if (action === "run") {
      if (!scriptRunner) {
        return JSON.stringify({ error: "Script execution not available in this environment" });
      }

      const scriptId = String(input.scriptId ?? "");
      if (!scriptId) return JSON.stringify({ error: "scriptId is required for action:run" });

      const script = await scriptRegistry.get(scriptId);
      if (!script) return JSON.stringify({ error: `Script not found: ${scriptId}` });
      if (!script.enabled) {
        return JSON.stringify({
          error: `Script '${script.name}' is disabled — use action:enable to permit execution`,
        });
      }
      if (!script.wasmB64) {
        return JSON.stringify({
          error:
            `Script '${script.name}' has not been compiled to WASM yet. ` +
            "The Starlark→WASM compilation pipeline (Phase D) must run first.",
        });
      }

      const runInput = input.input ?? null;
      const wasmBytes = Buffer.from(script.wasmB64, "base64");

      const result = await scriptRunner.run(new Uint8Array(wasmBytes), runInput, {
        timeoutMs: script.timeoutMs,
        maxMemoryPages: script.maxMemoryPages,
      });

      return JSON.stringify({
        scriptId,
        name: script.name,
        exitReason: result.exitReason,
        exitCode: result.exitCode,
        output: result.output,
        durationMs: result.durationMs,
        inputHash: result.inputHash,
        outputHash: result.outputHash,
      });
    }

    return JSON.stringify({
      error: `Unknown action: ${action}. Valid actions: run, list, get, enable, disable`,
    });
  };
}

// ---------------------------------------------------------------------------
// Manifest + schema
// ---------------------------------------------------------------------------

export const RUN_SCRIPT_MANIFEST = {
  name: "run_script",
  description:
    "Execute and manage per-MApp Starlark scripts. " +
    "Actions: run (execute a compiled script with JSON input), " +
    "list (scripts registered for a MApp), " +
    "get (script details + compiled state), " +
    "enable/disable (control execution permission — deny by default).",
  requiresState: ["LIMBO", "OFFLINE", "ONLINE"],
  requiresTier: ["member", "verified", "trusted", "sealed"],
} as const;

export const RUN_SCRIPT_INPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  required: ["action"],
  properties: {
    action: {
      type: "string",
      enum: ["run", "list", "get", "enable", "disable"],
      description: "Operation to perform.",
    },
    mappId: {
      type: "string",
      description: "MApp bundle identifier. Required for action:list.",
    },
    scriptId: {
      type: "string",
      description: "Script ID. Required for action:run, get, enable, disable.",
    },
    input: {
      description: "JSON input passed to the script. Used with action:run.",
    },
  },
};
