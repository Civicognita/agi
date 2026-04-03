/**
 * SharedContainerManager — manages shared database containers.
 *
 * One container per `sharedKey` (e.g. "postgres-17" → container "aionima-shared-postgres-17").
 * Port allocation from the same pool as project containers.
 * Persistence in ~/.agi/shared-containers.json.
 * Reference counting — auto-start on first add, auto-stop on last remove.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync, execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import type { ComponentLogger, Logger } from "./logger.js";
import { createComponentLogger } from "./logger.js";
import type {
  StackContainerConfig,
  StackContainerContext,
  StackDatabaseConfig,
  SharedContainerRecord,
  SharedContainerInfo,
} from "./stack-types.js";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SharedContainer {
  sharedKey: string;
  containerName: string;
  port: number;
  config: StackContainerConfig;
  databaseConfig?: StackDatabaseConfig;
  projects: Set<string>;
}

export interface SharedContainerManagerDeps {
  logger?: Logger;
  /** Callback to allocate a port from the hosting manager's port pool. */
  allocatePort: () => number;
  /** Callback to release a port back to the pool. */
  releasePort: (port: number) => void;
}

// ---------------------------------------------------------------------------
// Persistence path
// ---------------------------------------------------------------------------

function persistencePath(): string {
  const dir = join(homedir(), ".agi");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, "shared-containers.json");
}

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

export class SharedContainerManager {
  private readonly containers = new Map<string, SharedContainer>();
  private readonly mutexes = new Map<string, Promise<void>>();
  private readonly log: ComponentLogger;
  private readonly allocatePort: () => number;
  private readonly releasePort: (port: number) => void;

  constructor(deps: SharedContainerManagerDeps) {
    this.log = createComponentLogger(deps.logger, "shared-containers");
    this.allocatePort = deps.allocatePort;
    this.releasePort = deps.releasePort;
    this.loadPersisted();
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Add a project to a shared container. Starts the container if it's not running.
   * Returns the allocated port and generated DB credentials.
   */
  async addProject(
    sharedKey: string,
    projectPath: string,
    projectHostname: string,
    containerConfig: StackContainerConfig,
    databaseConfig?: StackDatabaseConfig,
  ): Promise<{ port: number; databaseName?: string; databaseUser?: string; databasePassword?: string }> {
    return this.withMutex(sharedKey, async () => {
      let container = this.containers.get(sharedKey);

      if (!container) {
        const port = this.allocatePort();
        const containerName = `aionima-shared-${sharedKey}`;
        container = {
          sharedKey,
          containerName,
          port,
          config: containerConfig,
          databaseConfig,
          projects: new Set(),
        };
        this.containers.set(sharedKey, container);
        await this.startContainer(container);
      }

      container.projects.add(projectPath);

      let databaseName: string | undefined;
      let databaseUser: string | undefined;
      let databasePassword: string | undefined;

      if (databaseConfig) {
        databaseName = this.generateDbName(projectPath);
        databaseUser = databaseName.replace(/_db$/, "");
        databasePassword = generatePassword();

        const ctx: StackContainerContext = {
          projectPath,
          projectHostname,
          allocatedPort: container.port,
          databaseName,
          databaseUser,
          databasePassword,
          mode: "development",
        };

        await this.runDbSetup(container.containerName, databaseConfig, ctx);
      }

      this.persist();
      this.log.info(`added project ${projectPath} to shared container ${sharedKey} (${container.projects.size} projects)`);

      return { port: container.port, databaseName, databaseUser, databasePassword };
    });
  }

  /**
   * Remove a project from a shared container. Optionally tears down its DB.
   * Stops the container if no more projects reference it.
   */
  async removeProject(
    sharedKey: string,
    projectPath: string,
    databaseConfig?: StackDatabaseConfig,
    ctx?: StackContainerContext,
  ): Promise<void> {
    return this.withMutex(sharedKey, async () => {
      const container = this.containers.get(sharedKey);
      if (!container) return;

      // Teardown DB if configured
      if (databaseConfig?.teardownScript && ctx) {
        try {
          const args = databaseConfig.teardownScript(ctx);
          await execFileAsync("podman", ["exec", container.containerName, ...args], { timeout: 30_000 });
        } catch (err) {
          this.log.warn(`DB teardown failed for ${projectPath}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      container.projects.delete(projectPath);

      if (container.projects.size === 0) {
        this.stopContainer(container);
        this.releasePort(container.port);
        this.containers.delete(sharedKey);
        this.log.info(`shared container ${sharedKey} stopped (no projects)`);
      }

      this.persist();
    });
  }

  /** Get info about all shared containers. */
  getAll(): SharedContainerInfo[] {
    return Array.from(this.containers.values()).map((c) => ({
      sharedKey: c.sharedKey,
      containerName: c.containerName,
      port: c.port,
      status: this.checkContainerStatus(c.containerName),
      projectCount: c.projects.size,
    }));
  }

  /** Get connection info for a specific project in a shared container. */
  getConnectionInfo(
    sharedKey: string,
    _projectPath: string,
    databaseName: string,
    databaseUser: string,
    databasePassword: string,
  ): { host: string; port: number; user: string; password: string; database: string; url: string } | null {
    const container = this.containers.get(sharedKey);
    if (!container || !container.databaseConfig) return null;

    const url = container.databaseConfig.connectionUrlTemplate
      .replace("{user}", databaseUser)
      .replace("{password}", databasePassword)
      .replace("{port}", String(container.port))
      .replace("{database}", databaseName);

    return {
      host: "localhost",
      port: container.port,
      user: databaseUser,
      password: databasePassword,
      database: databaseName,
      url,
    };
  }

  /** Check if a shared container exists and has projects. */
  has(sharedKey: string): boolean {
    return this.containers.has(sharedKey);
  }

  /** Get the container name for a shared key. */
  getContainerName(sharedKey: string): string | null {
    return this.containers.get(sharedKey)?.containerName ?? null;
  }

  // -------------------------------------------------------------------------
  // Container lifecycle
  // -------------------------------------------------------------------------

  private async startContainer(container: SharedContainer): Promise<void> {
    const { containerName, port, config } = container;
    const ctx: StackContainerContext = {
      projectPath: "",
      projectHostname: "",
      allocatedPort: port,
      mode: "development",
    };

    const volumes = config.volumeMounts(ctx);
    const envVars = config.env(ctx);
    const cmd = config.command?.(ctx);

    const args = [
      "run", "-d",
      "--name", containerName,
      "--replace",
      "-p", `${port}:${config.internalPort}`,
      "--label", "aionima.managed=true",
      "--label", `aionima.shared-key=${container.sharedKey}`,
    ];

    for (const vol of volumes) {
      args.push("-v", vol);
    }
    for (const [key, val] of Object.entries(envVars)) {
      args.push("-e", `${key}=${val}`);
    }

    args.push(config.image);

    if (cmd) {
      args.push(...cmd);
    }

    try {
      execFileSync("podman", args, { timeout: 60_000 });
      this.log.info(`started shared container ${containerName} on port ${port}`);
    } catch (err) {
      this.log.error(`failed to start shared container ${containerName}: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }

    // Wait for health check if configured
    if (config.healthCheck) {
      await this.waitForHealth(containerName, config.healthCheck);
    }
  }

  private stopContainer(container: SharedContainer): void {
    try {
      execFileSync("podman", ["stop", "-t", "10", container.containerName], { timeout: 30_000 });
    } catch { /* already stopped */ }
    try {
      execFileSync("podman", ["rm", "-f", container.containerName], { timeout: 10_000 });
    } catch { /* already removed */ }
  }

  private async waitForHealth(containerName: string, healthCheck: string, maxAttempts = 30): Promise<void> {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        execFileSync("podman", ["exec", containerName, "sh", "-c", healthCheck], { timeout: 5_000 });
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    this.log.warn(`health check for ${containerName} did not pass after ${maxAttempts} attempts`);
  }

  private async runDbSetup(
    containerName: string,
    dbConfig: StackDatabaseConfig,
    ctx: StackContainerContext,
  ): Promise<void> {
    const args = dbConfig.setupScript(ctx);
    try {
      await execFileAsync("podman", ["exec", containerName, ...args], { timeout: 30_000 });
      this.log.info(`created database ${ctx.databaseName} in ${containerName}`);
    } catch (err) {
      this.log.error(`DB setup failed: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  }

  private checkContainerStatus(containerName: string): "running" | "stopped" | "error" {
    try {
      const result = execFileSync("podman", [
        "inspect", "--format", "{{.State.Status}}", containerName,
      ], { timeout: 5_000 }).toString().trim();
      if (result === "running") return "running";
      return "stopped";
    } catch {
      return "stopped";
    }
  }

  // -------------------------------------------------------------------------
  // DB name generation
  // -------------------------------------------------------------------------

  private generateDbName(projectPath: string): string {
    const slug = projectPath.split("/").pop()!
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 48);

    let name = `${slug}_db`;
    const existing = new Set<string>();
    for (const container of this.containers.values()) {
      for (const p of container.projects) {
        existing.add(this.generateDbNameFromPath(p));
      }
    }

    if (!existing.has(name)) return name;

    let suffix = 2;
    while (existing.has(`${slug}_${suffix}_db`)) suffix++;
    return `${slug}_${suffix}_db`;
  }

  private generateDbNameFromPath(projectPath: string): string {
    const slug = projectPath.split("/").pop()!
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 48);
    return `${slug}_db`;
  }

  // -------------------------------------------------------------------------
  // Mutex for per-key serialization
  // -------------------------------------------------------------------------

  private async withMutex<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.mutexes.get(key) ?? Promise.resolve();
    let release: () => void;
    const next = new Promise<void>((r) => { release = r; });
    this.mutexes.set(key, next);

    await prev;
    try {
      return await fn();
    } finally {
      release!();
    }
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  private persist(): void {
    const data: Record<string, SharedContainerRecord & { projects: string[] }> = {};
    for (const [key, container] of this.containers) {
      data[key] = {
        port: container.port,
        containerName: container.containerName,
        projects: Array.from(container.projects),
      };
    }
    try {
      writeFileSync(persistencePath(), JSON.stringify(data, null, 2));
    } catch (err) {
      this.log.warn(`failed to persist shared containers: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private loadPersisted(): void {
    const path = persistencePath();
    if (!existsSync(path)) return;
    try {
      const data = JSON.parse(readFileSync(path, "utf-8")) as Record<
        string,
        SharedContainerRecord & { projects?: string[] }
      >;
      for (const [key, record] of Object.entries(data)) {
        // We only restore metadata here — actual container/config state
        // will be reconciled when plugins register their stacks.
        this.containers.set(key, {
          sharedKey: key,
          containerName: record.containerName,
          port: record.port,
          config: null as unknown as StackContainerConfig, // Filled on stack registration
          projects: new Set(record.projects ?? []),
        });
      }
    } catch {
      // Ignore corrupt persistence
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generatePassword(): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = randomBytes(16);
  let result = "";
  for (let i = 0; i < 16; i++) {
    result += chars[bytes[i]! % chars.length];
  }
  return result;
}
