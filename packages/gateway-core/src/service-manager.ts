/**
 * ServiceManager — manages infrastructure service containers (databases, caches, etc.)
 * registered by plugins.
 *
 * Each service runs as a Podman container with `label=aionima.service=true`.
 * Data volumes mount under `{dataDir}/services/{serviceId}/`.
 * Service port allocation uses range 5000-5099 to avoid colliding with project ports (4000-4099).
 */

import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createComponentLogger } from "./logger.js";
import type { Logger, ComponentLogger } from "./logger.js";
import type { PluginRegistry } from "@aionima/plugins";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ServiceStatus {
  id: string;
  name: string;
  description: string;
  image: string;
  status: "running" | "stopped" | "error";
  port: number | null;
  enabled: boolean;
  error?: string;
}

export interface ServiceOverrides {
  enabled?: boolean;
  port?: number;
  env?: Record<string, string>;
}

export interface ServiceManagerDeps {
  containerRuntime: string;
  dataDir: string;
  logger?: Logger;
  pluginRegistry: PluginRegistry;
  /** Per-service overrides from config. */
  serviceOverrides?: Record<string, ServiceOverrides>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SERVICE_PORT_START = 5000;
const SERVICE_PORT_POOL = 100;

// ---------------------------------------------------------------------------
// ServiceManager
// ---------------------------------------------------------------------------

export class ServiceManager {
  private readonly containerRuntime: string;
  private readonly dataDir: string;
  private readonly log: ComponentLogger;
  private readonly pluginRegistry: PluginRegistry;
  private readonly overrides: Record<string, ServiceOverrides>;
  private readonly allocatedPorts = new Set<number>();
  private readonly running = new Map<string, { containerId: string; port: number }>();

  constructor(deps: ServiceManagerDeps) {
    this.containerRuntime = deps.containerRuntime;
    this.dataDir = deps.dataDir;
    this.log = createComponentLogger(deps.logger, "service-mgr");
    this.pluginRegistry = deps.pluginRegistry;
    this.overrides = deps.serviceOverrides ?? {};
  }

  /** Start all enabled services. */
  async initialize(): Promise<void> {
    const services = this.pluginRegistry.getServices();
    if (services.length === 0) {
      this.log.info("no services registered by plugins");
      return;
    }

    // Clean stale service containers from prior runs
    try {
      const stale = execFileSync(this.containerRuntime, [
        "ps", "-a", "--filter", "label=aionima.service=true", "--format", "{{.Names}}",
      ], { stdio: "pipe", timeout: 15_000 }).toString().trim();
      if (stale.length > 0) {
        for (const name of stale.split("\n")) {
          try { execFileSync(this.containerRuntime, ["rm", "-f", name], { stdio: "pipe", timeout: 15_000 }); } catch { /* ignore */ }
        }
        this.log.info(`cleaned up ${String(stale.split("\n").length)} stale service container(s)`);
      }
    } catch { /* runtime unavailable */ }

    for (const svc of services) {
      const overrides = this.overrides[svc.id];
      if (overrides?.enabled !== true) {
        continue;
      }
      await this.startService(svc.id);
    }
  }

  async startService(id: string): Promise<void> {
    const svc = this.pluginRegistry.getServices().find(s => s.id === id);
    if (!svc) {
      this.log.warn(`service "${id}" not found in registry`);
      return;
    }

    if (this.running.has(id)) {
      this.log.warn(`service "${id}" already running`);
      return;
    }

    const overrides = this.overrides[id];
    const port = overrides?.port ?? this.allocatePort();
    const containerName = `aionima-svc-${id}`;
    const dataPath = join(this.dataDir, "services", id);

    if (!existsSync(dataPath)) {
      mkdirSync(dataPath, { recursive: true });
    }

    const args: string[] = [
      "run", "-d",
      "--name", containerName,
      "--restart=on-failure:5",
      "--label", "aionima.service=true",
      "--label", `aionima.service.id=${id}`,
      "-p", `${String(port)}:${String(svc.defaultPort)}`,
    ];

    // Environment variables
    const env = { ...svc.env, ...overrides?.env };
    for (const [key, value] of Object.entries(env)) {
      args.push("-e", `${key}=${value}`);
    }

    // Volumes
    if (svc.volumes) {
      for (const vol of svc.volumes) {
        const resolved = vol.replace("{dataDir}", dataPath);
        args.push("-v", resolved);
      }
    }

    args.push(svc.containerImage);

    try {
      const result = execFileSync(this.containerRuntime, args, {
        stdio: "pipe",
        timeout: 60_000,
      }).toString().trim();

      this.running.set(id, { containerId: result, port });
      this.allocatedPorts.add(port);
      this.log.info(`started service "${svc.name}" on port ${String(port)}`);
    } catch (err: unknown) {
      const stderr = (err as { stderr?: Buffer | string })?.stderr;
      const detail = stderr ? (Buffer.isBuffer(stderr) ? stderr.toString() : stderr).trim() : "";
      const msg = err instanceof Error ? err.message : String(err);
      this.log.error(`failed to start service "${svc.name}": ${msg}${detail ? `\n${detail}` : ""}`);
    }
  }

  async stopService(id: string): Promise<void> {
    const entry = this.running.get(id);
    if (!entry) return;

    const containerName = `aionima-svc-${id}`;
    try {
      execFileSync(this.containerRuntime, ["stop", "-t", "10", containerName], { stdio: "pipe", timeout: 30_000 });
    } catch (err: unknown) {
      const stderr = (err as { stderr?: Buffer | string })?.stderr;
      const detail = stderr ? (Buffer.isBuffer(stderr) ? stderr.toString() : stderr).trim() : "";
      if (detail) this.log.warn(`stop "${id}": ${detail}`);
    }
    try {
      execFileSync(this.containerRuntime, ["rm", "-f", containerName], { stdio: "pipe", timeout: 15_000 });
    } catch { /* rm -f is best-effort */ }

    this.allocatedPorts.delete(entry.port);
    this.running.delete(id);
    this.log.info(`stopped service "${id}"`);
  }

  async restartService(id: string): Promise<void> {
    await this.stopService(id);
    await this.startService(id);
  }

  getStatus(): ServiceStatus[] {
    const services = this.pluginRegistry.getServices();
    return services.map(svc => {
      const entry = this.running.get(svc.id);
      const overrides = this.overrides[svc.id];
      const enabled = overrides?.enabled === true;

      if (!entry) {
        return {
          id: svc.id,
          name: svc.name,
          description: svc.description,
          image: svc.containerImage,
          status: "stopped" as const,
          port: null,
          enabled,
        };
      }

      // Check actual container state
      let status: "running" | "stopped" | "error" = "running";
      try {
        const raw = execFileSync(this.containerRuntime, [
          "inspect", "--format", "{{.State.Status}}", `aionima-svc-${svc.id}`,
        ], { stdio: "pipe", timeout: 10_000 }).toString().trim();
        if (raw !== "running") status = raw === "exited" ? "stopped" : "error";
      } catch {
        status = "stopped";
      }

      return {
        id: svc.id,
        name: svc.name,
        description: svc.description,
        image: svc.containerImage,
        status,
        port: entry.port,
        enabled,
      };
    });
  }

  async shutdown(): Promise<void> {
    for (const id of this.running.keys()) {
      await this.stopService(id);
    }
    this.allocatedPorts.clear();
    this.log.info("service manager shut down");
  }

  /** Check whether a container image is locally available (pulled). */
  isImageAvailable(image: string): boolean {
    try {
      execFileSync(this.containerRuntime, ["image", "exists", image], { stdio: "pipe", timeout: 5_000 });
      return true;
    } catch {
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Port allocation
  // -------------------------------------------------------------------------

  private allocatePort(): number {
    for (let i = 0; i < SERVICE_PORT_POOL; i++) {
      const port = SERVICE_PORT_START + i;
      if (!this.allocatedPorts.has(port)) {
        this.allocatedPorts.add(port);
        return port;
      }
    }
    throw new Error(`Service port pool exhausted (${String(SERVICE_PORT_START)}-${String(SERVICE_PORT_START + SERVICE_PORT_POOL - 1)})`);
  }
}
