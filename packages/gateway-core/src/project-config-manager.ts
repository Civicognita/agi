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
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import {
  ProjectConfigSchema,
  type ProjectConfig,
  type ProjectHosting,
  type ProjectStackInstance,
  type ProjectRepo,
  type ProjectRoomBinding,
} from "@agi/config";
import { projectConfigPath } from "./project-config-path.js";
import { createComponentLogger } from "./logger.js";
import type { Logger, ComponentLogger } from "./logger.js";
import {
  provisionProjectRepos,
  type CloneFn,
  type ProvisionResult,
} from "./repos-provisioner.js";

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
  // s130 phase B (t515 slice 3) — multi-repo provisioning
  // -------------------------------------------------------------------------

  /**
   * Provision all `repos[]` entries from the project's config into
   * `<projectPath>/repos/<name>/`. Idempotent — entries whose target
   * dir already exists are skipped. Errors are captured per-repo so
   * one bad URL doesn't block the others.
   *
   * Returns a per-repo + aggregate result, or null when the project
   * has no config (read returned null) or no repos[] field. Logs the
   * outcomes via the manager's component logger.
   *
   * **Sync** — calls into git via execFileSync. Callers that need a
   * non-blocking variant should wrap in setImmediate or use a worker
   * thread. The default cloneFn enforces a 120s per-clone timeout.
   *
   * Pass options.cloneFn to inject a mock for tests.
   */
  provisionRepos(
    projectPath: string,
    options: { cloneFn?: CloneFn } = {},
  ): ProvisionResult | null {
    const config = this.read(projectPath);
    if (config === null) return null;
    const repos = config.repos;
    if (!repos || repos.length === 0) return null;

    const result = provisionProjectRepos(projectPath, repos, options);

    if (result.provisioned > 0 || result.errors > 0) {
      this.log.info(
        `repos provisioned for ${projectPath}: ${String(result.provisioned)} cloned, ${String(result.skipped)} skipped, ${String(result.errors)} errored`,
      );
    }
    for (const r of result.repos) {
      if (r.outcome === "error") {
        this.log.warn(`repo ${r.name} provisioning failed: ${r.error ?? "unknown"}`);
      }
    }
    return result;
  }

  // -------------------------------------------------------------------------
  // s130 t515 B6a — repos[] CRUD for the dashboard editor + API surface
  // -------------------------------------------------------------------------

  /**
   * Add a new repo to the project's `repos[]`. Validates against the
   * full ProjectConfigSchema (which enforces uniqueness of name/port/
   * externalPath + at-most-one-isDefault), then optionally clones via
   * provisionRepos when `options.provision` is true (default).
   *
   * Throws when:
   *   - Project config doesn't exist
   *   - Schema validation fails (caller surfaces the zod error)
   *
   * Atomic via `update()`'s per-path lock.
   */
  async addRepo(projectPath: string, repo: ProjectRepo, options: { provision?: boolean; cloneFn?: CloneFn } = {}): Promise<ProjectConfig> {
    const resolved = resolvePath(projectPath);
    const existing = this.read(resolved);
    if (!existing) throw new Error(`Project config not found at ${resolved}`);

    const repos = [...(existing.repos ?? []), repo];
    const updated = await this.update(resolved, { repos });

    if (options.provision !== false) {
      this.provisionRepos(resolved, options.cloneFn ? { cloneFn: options.cloneFn } : {});
    }

    return updated;
  }

  /**
   * Update fields on an existing repo (looked up by name). Patch is
   * merged into the matching entry; full ProjectConfig validates after.
   * Returns the updated config.
   *
   * Throws when:
   *   - Project config doesn't exist
   *   - No repo with the given name exists
   *   - Schema validation fails after merge
   */
  async updateRepo(projectPath: string, name: string, patch: Partial<ProjectRepo>): Promise<ProjectConfig> {
    const resolved = resolvePath(projectPath);
    const existing = this.read(resolved);
    if (!existing) throw new Error(`Project config not found at ${resolved}`);

    const repos = existing.repos ?? [];
    const idx = repos.findIndex((r) => r.name === name);
    if (idx === -1) throw new Error(`Repo not found: ${name}`);

    const merged = { ...repos[idx], ...patch } as ProjectRepo;
    const newRepos = [...repos];
    newRepos[idx] = merged;

    return this.update(resolved, { repos: newRepos });
  }

  /**
   * Remove a repo from the project's `repos[]`. The repo's checkout
   * directory at `<projectPath>/repos/<name>/` is moved to
   * `<projectPath>/.trash/repos-<name>-<timestamp>/` per s130's
   * soft-delete convention. Owner can recover or purge later.
   *
   * Throws when:
   *   - Project config doesn't exist
   *   - No repo with the given name exists
   */
  async removeRepo(projectPath: string, name: string): Promise<ProjectConfig> {
    const resolved = resolvePath(projectPath);
    const existing = this.read(resolved);
    if (!existing) throw new Error(`Project config not found at ${resolved}`);

    const repos = existing.repos ?? [];
    const repo = repos.find((r) => r.name === name);
    if (!repo) throw new Error(`Repo not found: ${name}`);

    // Remove from config
    const newRepos = repos.filter((r) => r.name !== name);
    const updated = await this.update(resolved, { repos: newRepos });

    // Soft-delete the checkout dir (best effort — config update already
    // succeeded; failing the move shouldn't block).
    try {
      const checkoutPath = repo.path ?? `${resolved}/repos/${name}`;
      if (existsSync(checkoutPath)) {
        const ts = new Date().toISOString().replace(/[:.]/g, "-");
        const trashPath = `${resolved}/.trash/repos-${name}-${ts}`;
        mkdirSync(dirname(trashPath), { recursive: true });
        renameSync(checkoutPath, trashPath);
        this.log.info(`repo ${name} moved to ${trashPath}`);
      }
    } catch (err) {
      this.log.warn(`failed to soft-delete repo ${name}: ${err instanceof Error ? err.message : String(err)}`);
    }

    return updated;
  }

  /** Read just the repos[] array for a project — convenience for the API surface. */
  getRepos(projectPath: string): ProjectRepo[] {
    return this.read(projectPath)?.repos ?? [];
  }

  // -------------------------------------------------------------------------
  // Channel-room bindings — CHN-D (s165) slice 2, 2026-05-14
  //
  // Mirrors the repos-collection helpers above. Bindings are simpler:
  // no checkout dir, no clone side-effect, no soft-delete — they're
  // pure JSON entries. Uniqueness is enforced at schema-validate time
  // (ProjectConfigSchema.refine — no two bindings share channelId+roomId).
  // -------------------------------------------------------------------------

  /** Read just the rooms[] array for a project — convenience for the API surface. */
  listRoomBindings(projectPath: string): ProjectRoomBinding[] {
    return this.read(projectPath)?.rooms ?? [];
  }

  /**
   * Add a channel-room binding to the project's `rooms[]`. Throws if
   * the (channelId, roomId) pair already exists (uniqueness invariant).
   * Returns the updated config.
   *
   * The caller typically stamps `boundAt` to the current ISO timestamp;
   * the schema accepts any non-empty string so test fixtures can pin it.
   */
  async addRoomBinding(
    projectPath: string,
    binding: ProjectRoomBinding,
  ): Promise<ProjectConfig> {
    const resolved = resolvePath(projectPath);
    const existing = this.read(resolved);
    if (existing === null) throw new Error(`Project config not found at ${resolved}`);

    const rooms = existing.rooms ?? [];
    const duplicate = rooms.find(
      (r) => r.channelId === binding.channelId && r.roomId === binding.roomId,
    );
    if (duplicate !== undefined) {
      throw new Error(
        `Binding already exists: ${binding.channelId}::${binding.roomId} — remove the existing one first`,
      );
    }

    const newRooms = [...rooms, binding];
    return this.update(resolved, { rooms: newRooms });
  }

  /**
   * Remove a channel-room binding by (channelId, roomId). Throws when
   * the binding isn't found. Returns the updated config.
   */
  async removeRoomBinding(
    projectPath: string,
    channelId: string,
    roomId: string,
  ): Promise<ProjectConfig> {
    const resolved = resolvePath(projectPath);
    const existing = this.read(resolved);
    if (existing === null) throw new Error(`Project config not found at ${resolved}`);

    const rooms = existing.rooms ?? [];
    const idx = rooms.findIndex(
      (r) => r.channelId === channelId && r.roomId === roomId,
    );
    if (idx === -1) {
      throw new Error(`Binding not found: ${channelId}::${roomId}`);
    }

    const newRooms = rooms.filter((_, i) => i !== idx);
    return this.update(resolved, { rooms: newRooms });
  }

  /**
   * Find the project bound to a given (channelId, roomId) pair, if any.
   * CHN-C slice 1 (s164) primitive — the gateway dispatcher uses this to
   * route inbound channel events to the right project's cage.
   *
   * `candidatePaths` is the list of project paths to scan; the manager
   * does NOT enumerate workspace roots itself (that's the caller's job,
   * typically by walking `config.workspace.projects[]` sub-directories).
   *
   * Uniqueness across PROJECTS is not enforced by the schema — only
   * uniqueness within ONE project. If two projects bind the same room
   * (which shouldn't happen but is technically allowed), the first
   * project scanned wins. Returns null when no binding matches.
   *
   * O(N*M) worst case (N candidates, M bindings/candidate). Realistic
   * project counts make this trivially fast; caching can land later if
   * dispatch latency ever matters.
   */
  findProjectByRoom(
    channelId: string,
    roomId: string,
    candidatePaths: string[],
  ): { projectPath: string; binding: ProjectRoomBinding } | null {
    for (const candidate of candidatePaths) {
      const resolved = resolvePath(candidate);
      const config = this.read(resolved);
      if (config === null) continue;
      const rooms = config.rooms ?? [];
      const match = rooms.find(
        (r) => r.channelId === channelId && r.roomId === roomId,
      );
      if (match !== undefined) {
        return { projectPath: resolved, binding: match };
      }
    }
    return null;
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
