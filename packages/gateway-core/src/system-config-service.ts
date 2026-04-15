/**
 * SystemConfigService — single service that owns ALL reads and writes
 * to the system config file (~/.agi/gateway.json, formerly aionima.json).
 *
 * Replaces scattered raw readFileSync/writeFileSync across:
 *   - tools/agent-tools.ts (manage_config, manage_plugins)
 *   - server-runtime-state.ts (GET/PUT/PATCH /api/config)
 *
 * All mutations validate via Zod before writing and emit change events
 * so the dashboard and config watcher can react in real-time.
 */

import { EventEmitter } from "node:events";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { AionimaConfigSchema, type AionimaConfig } from "@aionima/config";
import { createComponentLogger } from "./logger.js";
import type { Logger, ComponentLogger } from "./logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SystemConfigServiceDeps {
  configPath: string;
  logger?: Logger;
}

export interface SystemConfigChangeEvent {
  changedKeys: string[];
  config: AionimaConfig;
}

// ---------------------------------------------------------------------------
// SystemConfigService
// ---------------------------------------------------------------------------

export class SystemConfigService extends EventEmitter {
  private readonly configPath: string;
  private readonly log: ComponentLogger;

  constructor(deps: SystemConfigServiceDeps) {
    super();
    this.configPath = deps.configPath;
    this.log = createComponentLogger(deps.logger, "system-config");
  }

  // -------------------------------------------------------------------------
  // Read operations
  // -------------------------------------------------------------------------

  /** Read and validate the full system config. */
  read(): AionimaConfig {
    if (!existsSync(this.configPath)) {
      return AionimaConfigSchema.parse({});
    }

    try {
      const raw = JSON.parse(readFileSync(this.configPath, "utf-8"));
      return AionimaConfigSchema.parse(raw);
    } catch (err) {
      this.log.warn(`failed to read config at ${this.configPath}: ${err instanceof Error ? err.message : String(err)}`);
      return AionimaConfigSchema.parse({});
    }
  }

  /** Read a specific key via dot-notation path (e.g. "plugins.screensaver.design"). */
  readKey(dotPath: string): unknown {
    const config = this.read() as Record<string, unknown>;
    const keys = dotPath.split(".");
    let current: unknown = config;

    for (const key of keys) {
      if (current == null || typeof current !== "object") return undefined;
      current = (current as Record<string, unknown>)[key];
    }

    return current;
  }

  // -------------------------------------------------------------------------
  // Write operations
  // -------------------------------------------------------------------------

  /** Replace the entire config (validates before writing). */
  write(config: Record<string, unknown>): void {
    const validated = AionimaConfigSchema.parse(config);
    this.persist(validated, Object.keys(validated));
  }

  /**
   * Update a single key via dot-notation path.
   * Creates intermediate objects as needed.
   */
  patch(dotPath: string, value: unknown): void {
    const raw = this.readRaw();
    const keys = dotPath.split(".");
    let current = raw;

    // Navigate to parent, creating intermediate objects
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i]!;
      if (current[key] == null || typeof current[key] !== "object") {
        current[key] = {};
      }
      current = current[key] as Record<string, unknown>;
    }

    // Set the leaf value
    const leafKey = keys[keys.length - 1]!;
    if (value === null || value === undefined) {
      delete current[leafKey];
    } else {
      current[leafKey] = value;
    }

    // Validate the full config after mutation
    const validated = AionimaConfigSchema.parse(raw);
    this.persist(validated, [keys[0]!]);
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /** Read raw JSON without validation. */
  private readRaw(): Record<string, unknown> {
    if (!existsSync(this.configPath)) return {};
    try {
      return JSON.parse(readFileSync(this.configPath, "utf-8")) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  /** Write validated config to disk and emit change event. */
  private persist(config: AionimaConfig, changedKeys: string[]): void {
    mkdirSync(dirname(this.configPath), { recursive: true });
    writeFileSync(this.configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");

    const event: SystemConfigChangeEvent = { changedKeys, config };
    this.emit("changed", event);

    this.log.info(`config updated: ${changedKeys.join(", ")}`);
  }
}
