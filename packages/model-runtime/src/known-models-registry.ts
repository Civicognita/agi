/**
 * KnownModelsRegistry — Maps HuggingFace model IDs to CustomRuntimeDefinition.
 *
 * Two sources of definitions:
 * 1. BUILTIN_MODELS — hardcoded entries for well-known custom models (Kronos, etc.)
 * 2. User-defined JSON files from ~/.agi/custom-runtimes/*.json — loaded at construction
 *
 * JSON files must export a single CustomRuntimeDefinition object or an array of them.
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { CustomRuntimeDefinition } from "./types.js";

// ---------------------------------------------------------------------------
// Builtin models
// ---------------------------------------------------------------------------

const BUILTIN_MODELS: Map<string, CustomRuntimeDefinition> = new Map([
  [
    "NeoQuasar/Kronos-base",
    {
      id: "NeoQuasar/Kronos-base",
      label: "Kronos-base",
      description: "Financial time series forecasting model. Accepts OHLCV candlestick data and returns predicted price series.",
      sourceRepo: "https://github.com/shiyu-coder/Kronos.git",
      internalPort: 8000,
      healthCheckPath: "/health",
      endpoints: {
        predict: "/predict",
        health: "/health",
      },
      env: {},
      hfModels: ["NeoQuasar/Kronos-base", "NeoQuasar/Kronos-Tokenizer-base"],
    },
  ],
  [
    "NeoQuasar/Kronos-Tokenizer-base",
    {
      id: "NeoQuasar/Kronos-Tokenizer-base",
      label: "Kronos-Tokenizer-base",
      description: "Kronos financial tokenizer — companion to Kronos-base. Use the Kronos-base entry for container builds.",
      sourceRepo: "https://github.com/shiyu-coder/Kronos.git",
      internalPort: 8000,
      healthCheckPath: "/health",
      endpoints: {
        predict: "/predict",
        health: "/health",
      },
      env: {},
      hfModels: ["NeoQuasar/Kronos-base", "NeoQuasar/Kronos-Tokenizer-base"],
    },
  ],
]);

// ---------------------------------------------------------------------------
// KnownModelsRegistry
// ---------------------------------------------------------------------------

export class KnownModelsRegistry {
  private readonly registry: Map<string, CustomRuntimeDefinition>;

  /**
   * @param customRuntimesDir Directory to scan for user-defined JSON runtime files.
   *   Defaults to ~/.agi/custom-runtimes/. Pass undefined to skip loading user files.
   */
  constructor(customRuntimesDir?: string) {
    // Start with a copy of builtins so user files can override them
    this.registry = new Map(BUILTIN_MODELS);
    this.loadUserFiles(customRuntimesDir);
  }

  /**
   * Look up a model ID in the registry. Returns undefined if not found.
   * Checks the exact model ID, then falls back to a case-insensitive match.
   */
  lookup(modelId: string): CustomRuntimeDefinition | undefined {
    const exact = this.registry.get(modelId);
    if (exact) return exact;

    // Case-insensitive fallback
    const lower = modelId.toLowerCase();
    for (const [key, def] of this.registry) {
      if (key.toLowerCase() === lower) return def;
    }

    return undefined;
  }

  /** Return all registered definitions (builtins + user-defined). */
  getAll(): Map<string, CustomRuntimeDefinition> {
    return new Map(this.registry);
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private loadUserFiles(dir?: string): void {
    const runtimesDir = dir ?? join(process.env["HOME"] ?? "/root", ".agi", "custom-runtimes");

    if (!existsSync(runtimesDir)) return;

    let entries: string[];
    try {
      entries = readdirSync(runtimesDir);
    } catch {
      // Unreadable directory — skip silently
      return;
    }

    for (const filename of entries) {
      if (!filename.endsWith(".json")) continue;

      const filePath = join(runtimesDir, filename);
      let raw: string;
      try {
        raw = readFileSync(filePath, "utf8");
      } catch {
        continue;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue;
      }

      const defs = Array.isArray(parsed) ? parsed : [parsed];
      for (const def of defs) {
        if (this.isValidDefinition(def)) {
          this.registry.set(def.id, def);
        }
      }
    }
  }

  private isValidDefinition(obj: unknown): obj is CustomRuntimeDefinition {
    if (!obj || typeof obj !== "object") return false;
    const d = obj as Record<string, unknown>;
    return (
      typeof d["id"] === "string" &&
      typeof d["label"] === "string" &&
      typeof d["description"] === "string" &&
      typeof d["internalPort"] === "number" &&
      typeof d["healthCheckPath"] === "string" &&
      d["endpoints"] !== null && typeof d["endpoints"] === "object"
    );
  }
}
