/**
 * ProjectConfigManager — single service that owns ALL reads and writes
 * to per-project config files (~/.agi/{slug}/project.json).
 *
 * Replaces scattered raw readFileSync/writeFileSync across:
 *   - hosting-manager.ts (readHostingMeta, writeHostingMeta, getProjectStacks, etc.)
 *   - server-runtime-state.ts (GET/POST/PUT /api/projects)
 *   - tools/project-tools.ts (manage_project list/create/update)
 *
 * All mutations validate via Zod before writing and emit change events
 * so the dashboard can update in real-time via WebSocket.
 */

import { EventEmitter } from "node:events";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import {
  ProjectConfigSchema,
  type ProjectConfig,
  type ProjectHosting,
  type ProjectStackInstance,
} from "@aionima/config";
import { projectConfigPath } from "./project-config-path.js";
import { createComponentLogger } from "./logger.js";
import type { Logger, ComponentLogger } from "./logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProjectConfigManagerDeps {
  logger?: Logger;
}

export interface ProjectConfigChangeEvent {
  projectPath: string;
  config: ProjectConfig;
  changedKeys: string[];
}

export interface ProjectConfigCreateOpts {
  tynnToken?: string;
  category?: string;
  type?: string;
  description?: string;
}

// ---------------------------------------------------------------------------
// ProjectConfigManager
// ---------------------------------------------------------------------------

export class ProjectConfigManager extends EventEmitter {
  private readonly log: ComponentLogger;
  /** Per-path mutex to serialize read-modify-write operations. */
  private readonly locks = new Map<string, Promise<void>>();

  constructor(deps: ProjectConfigManagerDeps = {}) {
    super();
    this.log = createComponentLogger(deps.logger, "project-config");
  }

  // -------------------------------------------------------------------------
  // Core CRUD
  // -------------------------------------------------------------------------

  /**
   * Read a project config. Returns null if file doesn't exist or is invalid.
   * Uses safeParse for graceful degradation on legacy/corrupt files.
   */
  read(projectPath: string): ProjectConfig | null {
    const resolved = resolvePath(projectPath);
    const metaPath = this.resolveConfigPath(resolved);

    if (!existsSync(metaPath)) return null;

    try {
      const raw = JSON.parse(readFileSync(metaPath, "utf-8"));
      const result = ProjectConfigSchema.safeParse(raw);
      if (!result.success) {
        this.log.warn(`invalid project config at ${metaPath}: ${result.error.message}`);
        return null;
      }
      return result.data;
    } catch {
      return null;
    }
  }

  /**
   * Write a full project config (validates before persisting).
   * Emits "changed" event with all top-level keys.
   */
  write(projectPath: string, config: ProjectConfig): void {
    const resolved = resolvePath(projectPath);
    const metaPath = this.resolveConfigPath(resolved);

    // Validate strictly before writing
    const validated = ProjectConfigSchema.parse(config);

    mkdirSync(dirname(metaPath), { recursive: true });
    writeFileSync(metaPath, JSON.stringify(validated, null, 2) + "\n", "utf-8");

    this.emitChanged(resolved, validated, Object.keys(validated));
  }

  /**
   * Atomic read-modify-write with per-path locking.
   * Merges the patch into the existing config, validates, and writes.
   * Returns the updated config.
   */
  async update(projectPath: string, patch: Partial<ProjectConfig>): Promise<ProjectConfig> {
    const resolved = resolvePath(projectPath);

    return this.withLock(resolved, () => {
      const raw = this.readRaw(resolved);
      this.ensureRequiredFields(raw, resolved);
      const existing = ProjectConfigSchema.safeParse(raw).data ?? { name: raw.name as string } as ProjectConfig;
      const merged = this.deepMerge(existing as Record<string, unknown>, patch as Record<string, unknown>);
      this.ensureRequiredFields(merged, resolved);

      // Determine which top-level keys changed
      const changedKeys = Object.keys(patch).filter(
        (key) => JSON.stringify((existing as Record<string, unknown>)[key]) !== JSON.stringify(merged[key]),
      );

      const validated = ProjectConfigSchema.parse(merged);
      const metaPath = this.resolveConfigPath(resolved);
      mkdirSync(dirname(metaPath), { recursive: true });
      writeFileSync(metaPath, JSON.stringify(validated, null, 2) + "\n", "utf-8");

      if (changedKeys.length > 0) {
        this.emitChanged(resolved, validated, changedKeys);
      }

      return validated;
    });
  }

  /** Check if a project config file exists. */
  exists(projectPath: string): boolean {
    const resolved = resolvePath(projectPath);
    return existsSync(this.resolveConfigPath(resolved));
  }

  /** Create a new project config with sensible defaults. */
  create(projectPath: string, name: string, opts: ProjectConfigCreateOpts = {}): ProjectConfig {
    const config: ProjectConfig = {
      name,
      createdAt: new Date().toISOString(),
      ...(opts.tynnToken ? { tynnToken: opts.tynnToken } : {}),
      ...(opts.category ? { category: opts.category as ProjectConfig["category"] } : {}),
      ...(opts.type ? { type: opts.type } : {}),
      ...(opts.description ? { description: opts.description } : {}),
    };

    this.write(projectPath, config);
    return config;
  }

  // -------------------------------------------------------------------------
  // Hosting sub-object
  // -------------------------------------------------------------------------

  /** Read hosting config. Returns null if no hosting section exists. */
  readHosting(projectPath: string): ProjectHosting | null {
    const config = this.read(projectPath);
    return config?.hosting ?? null;
  }

  /**
   * Update hosting config (merge patch into existing hosting section).
   * Creates hosting section if absent.
   */
  async updateHosting(projectPath: string, patch: Partial<ProjectHosting>): Promise<void> {
    const resolved = resolvePath(projectPath);

    await this.withLock(resolved, () => {
      const existing = this.readRaw(resolved);
      const hosting = (existing.hosting ?? {}) as Record<string, unknown>;

      // Merge patch into existing hosting, preserving stacks and other fields
      for (const [key, value] of Object.entries(patch)) {
        if (value !== undefined) {
          hosting[key] = value;
        }
      }

      existing.hosting = hosting;
      this.ensureRequiredFields(existing, resolved);

      const validated = ProjectConfigSchema.parse(existing);
      const metaPath = this.resolveConfigPath(resolved);
      mkdirSync(dirname(metaPath), { recursive: true });
      writeFileSync(metaPath, JSON.stringify(validated, null, 2) + "\n", "utf-8");

      this.emitChanged(resolved, validated, ["hosting"]);
    });
  }

  // -------------------------------------------------------------------------
  // Stack operations
  // -------------------------------------------------------------------------

  /** Get all stack instances for a project. */
  getStacks(projectPath: string): ProjectStackInstance[] {
    const hosting = this.readHosting(projectPath);
    return hosting?.stacks ?? [];
  }

  /** Add a stack instance to the project. */
  async addStack(projectPath: string, instance: ProjectStackInstance): Promise<void> {
    const resolved = resolvePath(projectPath);

    await this.withLock(resolved, () => {
      const existing = this.readRaw(resolved);
      const hosting = (existing.hosting ?? {}) as Record<string, unknown>;
      const stacks = (hosting.stacks ?? []) as ProjectStackInstance[];
      stacks.push(instance);
      hosting.stacks = stacks;
      existing.hosting = hosting;
      this.ensureRequiredFields(existing, resolved);

      const validated = ProjectConfigSchema.parse(existing);
      const metaPath = this.resolveConfigPath(resolved);
      mkdirSync(dirname(metaPath), { recursive: true });
      writeFileSync(metaPath, JSON.stringify(validated, null, 2) + "\n", "utf-8");

      this.emitChanged(resolved, validated, ["hosting"]);
    });
  }

  /** Remove a stack instance from the project by stack ID. */
  async removeStack(projectPath: string, stackId: string): Promise<void> {
    const resolved = resolvePath(projectPath);

    await this.withLock(resolved, () => {
      const existing = this.readRaw(resolved);
      const hosting = (existing.hosting ?? {}) as Record<string, unknown>;
      const stacks = (hosting.stacks ?? []) as ProjectStackInstance[];
      hosting.stacks = stacks.filter((s) => s.stackId !== stackId);
      existing.hosting = hosting;
      this.ensureRequiredFields(existing, resolved);

      const validated = ProjectConfigSchema.parse(existing);
      const metaPath = this.resolveConfigPath(resolved);
      mkdirSync(dirname(metaPath), { recursive: true });
      writeFileSync(metaPath, JSON.stringify(validated, null, 2) + "\n", "utf-8");

      this.emitChanged(resolved, validated, ["hosting"]);
    });
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /**
   * Resolve the config file path. All project configs live in ~/.agi/{slug}/project.json.
   * Legacy .nexus-project.json / .aionima-project.json files inside project dirs
   * are no longer supported — they were cleaned up by migrate-project-configs.sh.
   */
  private resolveConfigPath(resolvedProjectPath: string): string {
    return projectConfigPath(resolvedProjectPath);
  }

  /**
   * Read raw JSON from disk (no schema validation).
   * Returns empty object if file doesn't exist.
   */
  private readRaw(resolvedProjectPath: string): Record<string, unknown> {
    const metaPath = this.resolveConfigPath(resolvedProjectPath);
    if (!existsSync(metaPath)) return {};
    try {
      return JSON.parse(readFileSync(metaPath, "utf-8")) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  /**
   * Ensure required fields exist on a raw config object.
   * Legacy project.json files (from old HostingManager) may only have a
   * hosting section with no name/createdAt. This backfills them from the
   * project path so Zod validation doesn't throw.
   */
  private ensureRequiredFields(raw: Record<string, unknown>, resolvedPath: string): void {
    if (!raw.name) {
      const parts = resolvedPath.split("/");
      raw.name = parts[parts.length - 1] ?? "project";
    }
    if (!raw.createdAt) {
      raw.createdAt = new Date().toISOString();
    }
  }

  /** Emit a change event. */
  private emitChanged(projectPath: string, config: ProjectConfig, changedKeys: string[]): void {
    const event: ProjectConfigChangeEvent = { projectPath, config, changedKeys };
    this.emit("changed", event);
  }

  /**
   * Per-path lock to serialize concurrent read-modify-write operations.
   * Prevents data loss when multiple writers (agent + REST + hosting manager)
   * try to update the same project.json simultaneously.
   */
  private async withLock<T>(resolvedPath: string, fn: () => T): Promise<T> {
    const key = resolvedPath;
    const prev = this.locks.get(key) ?? Promise.resolve();

    let resolve: () => void;
    const next = new Promise<void>((r) => { resolve = r; });
    this.locks.set(key, next);

    await prev;
    try {
      return fn();
    } finally {
      resolve!();
      // Clean up lock if it's still ours (no new waiter queued)
      if (this.locks.get(key) === next) {
        this.locks.delete(key);
      }
    }
  }

  /**
   * Deep merge two objects. Arrays are replaced, not concatenated.
   * Preserves passthrough keys from the target that aren't in source.
   */
  private deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
    const result = { ...target };
    for (const [key, value] of Object.entries(source)) {
      if (value === undefined) continue;
      if (
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        typeof result[key] === "object" &&
        result[key] !== null &&
        !Array.isArray(result[key])
      ) {
        result[key] = this.deepMerge(
          result[key] as Record<string, unknown>,
          value as Record<string, unknown>,
        );
      } else {
        result[key] = value;
      }
    }
    return result;
  }
}
