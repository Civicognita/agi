/**
 * Config Hot-Reload — Story 9
 *
 * Watches the aionima config file and emits reload events on change.
 * Uses fs.watch with debouncing to avoid rapid-fire reloads.
 */

import { watch, readFileSync, existsSync } from "node:fs";
import { EventEmitter } from "node:events";
import { AionimaConfigSchema } from "./schema.js";
import type { AionimaConfig } from "./schema.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConfigWatcherOptions {
  /** Path to the config file (e.g., aionima.config.json). */
  configPath: string;
  /** Debounce interval in ms (default: 500). */
  debounceMs?: number;
}

export interface ConfigReloadEvent {
  /** The new validated config. */
  config: AionimaConfig;
  /** Timestamp of the reload. */
  timestamp: string;
  /** Fields that changed (top-level keys). */
  changedKeys: string[];
}

// ---------------------------------------------------------------------------
// ConfigWatcher
// ---------------------------------------------------------------------------

export class ConfigWatcher extends EventEmitter {
  private readonly configPath: string;
  private readonly debounceMs: number;
  private watcher: ReturnType<typeof watch> | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private lastConfig: AionimaConfig | null = null;

  constructor(options: ConfigWatcherOptions) {
    super();
    this.configPath = options.configPath;
    this.debounceMs = options.debounceMs ?? 500;
  }

  /** Start watching the config file. */
  start(): void {
    if (!existsSync(this.configPath)) {
      console.warn(`[config-watcher] file not found: ${this.configPath}`);
      return;
    }

    // Load initial config
    this.lastConfig = this.loadConfig();

    this.watcher = watch(this.configPath, (_eventType) => {
      if (this.debounceTimer !== null) {
        clearTimeout(this.debounceTimer);
      }

      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;
        this.reload();
      }, this.debounceMs);
    });

    console.log(`[config-watcher] watching ${this.configPath}`);
  }

  /** Stop watching. */
  stop(): void {
    if (this.watcher !== null) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  /** Get the current config snapshot. */
  getConfig(): AionimaConfig | null {
    return this.lastConfig;
  }

  private reload(): void {
    try {
      const newConfig = this.loadConfig();
      if (newConfig === null) return;

      // Diff top-level keys
      const changedKeys: string[] = [];
      if (this.lastConfig !== null) {
        const allKeys = new Set([
          ...Object.keys(this.lastConfig),
          ...Object.keys(newConfig),
        ]);
        for (const key of allKeys) {
          const oldVal = JSON.stringify((this.lastConfig as Record<string, unknown>)[key]);
          const newVal = JSON.stringify((newConfig as Record<string, unknown>)[key]);
          if (oldVal !== newVal) {
            changedKeys.push(key);
          }
        }
      }

      this.lastConfig = newConfig;

      const event: ConfigReloadEvent = {
        config: newConfig,
        timestamp: new Date().toISOString(),
        changedKeys,
      };

      this.emit("reload", event);
      console.log(`[config-watcher] reloaded — changed: ${changedKeys.join(", ") || "initial"}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[config-watcher] reload error: ${message}`);
      this.emit("error", err);
    }
  }

  private loadConfig(): AionimaConfig | null {
    try {
      const raw = readFileSync(this.configPath, "utf-8");
      const json = JSON.parse(raw) as unknown;
      return AionimaConfigSchema.parse(json);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[config-watcher] parse error: ${message}`);
      return null;
    }
  }
}
