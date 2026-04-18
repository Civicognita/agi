/**
 * ServiceManager — manages infrastructure service containers (databases, caches, etc.)
 * registered by plugins.
 *
 * Each service runs as a Podman container with `label=agi.service=true`.
 * Data volumes mount under `{dataDir}/services/{serviceId}/`.
 * Service port allocation uses range 5000-5099 to avoid colliding with project ports (4000-4099).
 */

import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createComponentLogger } from "./logger.js";
import type { Logger, ComponentLogger } from "./logger.js";
import type { PluginRegistry } from "@agi/plugins";

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
  extensions?: string[];
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
        "ps", "-a", "--filter", "label=agi.service=true", "--format", "{{.Names}}",
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
    const containerName = `agi-svc-${id}`;
    const dataPath = join(this.dataDir, "services", id);

    if (!existsSync(dataPath)) {
      mkdirSync(dataPath, { recursive: true });
    }

    const args: string[] = [
      "run", "-d",
      "--name", containerName,
      "--restart=on-failure:5",
      "--label", "agi.service=true",
      "--label", `agi.service.id=${id}`,
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

    const containerName = `agi-svc-${id}`;
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
        // Service wasn't started by this manager — check if a container running
        // the same image is already up (e.g. started by another service or an
        // external compose stack).
        let externalStatus: "running" | "stopped" = "stopped";
        let externalPort: number | null = null;
        try {
          // First: exact ancestor match
          const lines = execFileSync(this.containerRuntime, [
            "ps", "--filter", `ancestor=${svc.containerImage}`,
            "--format", "{{.Names}}\t{{.Ports}}",
          ], { stdio: "pipe", timeout: 10_000 }).toString().trim();
          if (lines.length > 0) {
            externalStatus = "running";
            // Try to extract the host port from "0.0.0.0:5432->5432/tcp" notation
            const firstLine = lines.split("\n")[0] ?? "";
            const portMatch = /(\d+)->\d+\/tcp/.exec(firstLine);
            if (portMatch?.[1]) externalPort = Number(portMatch[1]);
          }
        } catch { /* runtime unavailable or no match */ }

        // Fallback: if still stopped, search all running containers for a
        // matching engine name. This handles cases where an externally-managed
        // container (e.g. from another compose stack) uses a different image
        // tag than the one registered by the plugin.
        if (externalStatus === "stopped") {
          const engineName = svc.containerImage.includes("postgres") ? "postgres"
            : svc.containerImage.includes("mariadb") ? "mariadb"
            : svc.containerImage.includes("redis") ? "redis"
            : null;
          if (engineName) {
            try {
              const allLines = execFileSync(this.containerRuntime, [
                "ps", "--format", "{{.Names}}\t{{.Image}}\t{{.Ports}}",
              ], { stdio: "pipe", timeout: 10_000 }).toString().trim();
              for (const line of allLines.split("\n")) {
                if (line.toLowerCase().includes(engineName)) {
                  externalStatus = "running";
                  const portMatch = /(\d+)->\d+\/tcp/.exec(line);
                  if (portMatch?.[1]) externalPort = Number(portMatch[1]);
                  break;
                }
              }
            } catch { /* runtime unavailable */ }
          }
        }

        // Parse extension badges from the service description
        const extensions: string[] = [];
        if (svc.description.includes("pgvector")) extensions.push("pgvector");
        if (svc.description.includes("PostGIS")) extensions.push("PostGIS");
        if (svc.description.includes("pgcrypto")) extensions.push("pgcrypto");

        return {
          id: svc.id,
          name: svc.name,
          description: svc.description,
          image: svc.containerImage,
          status: externalStatus,
          port: externalPort,
          enabled,
          ...(extensions.length > 0 ? { extensions } : {}),
        };
      }

      // Check actual container state for manager-owned container
      let status: "running" | "stopped" | "error" = "running";
      try {
        const raw = execFileSync(this.containerRuntime, [
          "inspect", "--format", "{{.State.Status}}", `agi-svc-${svc.id}`,
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

  /** Check whether a container image is locally available (pulled), or
   *  whether an external container using the same engine is already running.
   *  Returns true in both cases so the service card is always shown when the
   *  service is reachable. */
  isImageAvailable(image: string): boolean {
    try {
      execFileSync(this.containerRuntime, ["image", "exists", image], { stdio: "pipe", timeout: 5_000 });
      return true;
    } catch {
      // Image not pulled — but check if an external container for the same
      // engine is already running (e.g. docker.io/library/postgres:16-alpine
      // instead of ghcr.io/civicognita/postgres:17).
      const engineName = image.includes("postgres") ? "postgres"
        : image.includes("mariadb") ? "mariadb"
        : image.includes("redis") ? "redis"
        : null;
      if (engineName) {
        try {
          const allLines = execFileSync(this.containerRuntime, [
            "ps", "--format", "{{.Names}}\t{{.Image}}",
          ], { stdio: "pipe", timeout: 5_000 }).toString().trim();
          for (const line of allLines.split("\n")) {
            if (line.toLowerCase().includes(engineName)) return true;
          }
        } catch { /* runtime unavailable */ }
      }
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
