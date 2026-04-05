/**
 * HostingManager — manages local network project hosting via Caddy + dnsmasq + Podman.
 *
 * Responsibilities:
 *   - Infrastructure health check (Caddy, dnsmasq, Podman)
 *   - Caddyfile generation from hosted projects -> `sudo caddy reload`
 *   - Podman container lifecycle (rootless containers per project type)
 *   - Port pool allocation (configurable range, default 4000-4099)
 *   - Status polling for container health
 *   - On startup: load all ~/.agi/{slug}/project.json with hosting.enabled, start containers
 *   - On shutdown: stop all containers, clear polling
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import { join, resolve as resolvePath, dirname } from "node:path";
import { execSync, execFileSync, spawnSync, spawn, type ChildProcess } from "node:child_process";
import { createComponentLogger } from "./logger.js";
import { projectConfigPath } from "./project-config-path.js";
import type { Logger, ComponentLogger } from "./logger.js";
import type { ProjectTypeRegistry } from "./project-types.js";
import type { PluginRegistry } from "@aionima/plugins";
import type { StackRegistry } from "./stack-registry.js";
import type { SharedContainerManager } from "./shared-container-manager.js";
import type { ProjectStackInstance, StackContainerContext, StackDefinition, StackContainerConfig } from "./stack-types.js";
import type { ProjectConfigManager } from "./project-config-manager.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InstallActionResult {
  actionId: string;
  ok: boolean;
  output?: string;
  error?: string;
}

export interface DetectedProjectConfig {
  projectType: string;
  suggestedStacks: string[];
  docRoot: string;
  startCommand: string | null;
}

export interface HostingConfig {
  enabled: boolean;
  lanIp: string;
  baseDomain: string;
  /** Extra domain names that should also reverse-proxy to the gateway. */
  domainAliases?: string[];
  gatewayPort: number;
  portRangeStart: number;
  containerRuntime: "podman";
  statusPollIntervalMs: number;
  /** Local ID service config — when enabled, generates a Caddy entry for id.{baseDomain}. */
  idService?: {
    enabled: boolean;
    port: number;
    subdomain: string;
  };
}

export interface ProjectHostingMeta {
  enabled: boolean;
  type: string;
  hostname: string;
  docRoot: string | null;
  startCommand: string | null;
  port: number | null;
  mode: "production" | "development";
  internalPort: number | null;
  runtimeId?: string | null;
  tunnelUrl?: string | null;
}

export interface HostedProject {
  path: string;
  meta: ProjectHostingMeta;
  containerId: string | null;
  containerName: string | null;
  status: "running" | "stopped" | "error" | "unconfigured";
  error?: string;
  tunnelPid: number | null;
  tunnelUrl: string | null;
}

export interface InfraStatus {
  ready: boolean;
  caddy: { installed: boolean; running: boolean };
  dnsmasq: { installed: boolean; running: boolean; configured: boolean };
  podman: { installed: boolean; rootless: boolean };
}

export interface HostingManagerDeps {
  config: HostingConfig;
  workspaceProjects: string[];
  projectTypeRegistry?: ProjectTypeRegistry;
  pluginRegistry?: PluginRegistry;
  stackRegistry?: StackRegistry;
  sharedContainerManager?: SharedContainerManager;
  projectConfigManager?: ProjectConfigManager;
  logger?: Logger;
}

// ---------------------------------------------------------------------------
// Container image and port constants
// @deprecated — Legacy fallback for un-migrated projects. Container config
// now lives in StackDefinition.containerConfig (registered by stack plugins).
// Will be removed once all existing projects have migrated to stack-based hosting.
// ---------------------------------------------------------------------------

const CONTAINER_IMAGES: Record<string, string> = {
  static: "nginx:alpine",
  php: "php:8.5-apache",
  node: "node:22-alpine",
  laravel: "php:8.5-apache",
  nextjs: "node:22-alpine",
  "web-app": "node:22-alpine",
  "api-service": "node:22-alpine",
  nuxt: "node:22-alpine",
  "react-vite": "nginx:alpine",
};

const CONTAINER_INTERNAL_PORTS: Record<string, number> = {
  static: 80,
  php: 80,
  node: 3000,
  laravel: 80,
  nextjs: 3000,
  nuxt: 3000,
  "react-vite": 80,
};

const PORT_POOL_SIZE = 100;

/**
 * Migration map: old framework-based project types → broad project types + corresponding stacks.
 * Used during initialize() to auto-migrate existing projects to the new model.
 */
const MIGRATION_MAP: Record<string, { newType: string; autoStack: string }> = {
  laravel:      { newType: "web-app",      autoStack: "stack-laravel" },
  nextjs:       { newType: "web-app",      autoStack: "stack-nextjs" },
  nuxt:         { newType: "web-app",      autoStack: "stack-nuxt" },
  node:         { newType: "api-service",  autoStack: "stack-node-app" },
  php:          { newType: "web-app",      autoStack: "stack-php-app" },
  "react-vite": { newType: "web-app",      autoStack: "stack-react-vite" },
  static:       { newType: "static-site",  autoStack: "stack-static-hosting" },
};

// ---------------------------------------------------------------------------
// HostingManager
// ---------------------------------------------------------------------------

export class HostingManager {
  private readonly config: HostingConfig;
  private readonly workspaceProjects: string[];
  private readonly log: ComponentLogger;
  private readonly projects = new Map<string, HostedProject>();
  private readonly allocatedPorts = new Set<number>();
  private readonly registry: ProjectTypeRegistry | null;
  private readonly pluginReg: PluginRegistry | null;
  private readonly stackReg: StackRegistry | null;
  private readonly sharedContainers: SharedContainerManager | null;
  private readonly configMgr: ProjectConfigManager | null;
  private readonly tunnelProcesses = new Map<string, ChildProcess>();
  private onStatusChange: (() => void) | null = null;
  private statusPollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(deps: HostingManagerDeps) {
    this.config = deps.config;
    this.workspaceProjects = deps.workspaceProjects;
    this.registry = deps.projectTypeRegistry ?? null;
    this.pluginReg = deps.pluginRegistry ?? null;
    this.stackReg = deps.stackRegistry ?? null;
    this.sharedContainers = deps.sharedContainerManager ?? null;
    this.configMgr = deps.projectConfigManager ?? null;
    this.log = createComponentLogger(deps.logger, "hosting");
  }

  /** Expose the project type registry. */
  getProjectTypeRegistry(): ProjectTypeRegistry | null {
    return this.registry;
  }

  /** Expose the stack registry for tool lookups. */
  getStackRegistry(): StackRegistry | null {
    return this.stackReg;
  }

  /** Expose hosting config for API routes. */
  getConfig(): HostingConfig {
    return this.config;
  }

  /** Register a callback for status changes (used by dashboard broadcaster). */
  setOnStatusChange(cb: () => void): void {
    this.onStatusChange = cb;
  }

  // -------------------------------------------------------------------------
  // Early boot — write system domains to Caddyfile + reload
  // Called before full initialization so the dashboard reverse proxy is
  // available immediately after restart (project domains come later).
  // -------------------------------------------------------------------------

  regenerateSystemDomains(): void {
    if (!this.config.enabled) return;
    if (!this.isCaddyInstalled() || !this.isCaddyRunning()) {
      this.log.warn("caddy not available — skipping early system domain setup");
      return;
    }
    // Delegate to the full regenerate — it already handles the system/project
    // split via section markers. At this point no projects are loaded, so the
    // PROJECT DOMAINS section will be empty, which is fine.
    this.regenerateCaddyfile();
    this.log.info("system domains configured (early boot)");

    // Ensure the Caddy root CA is in the system trust store.
    // `caddy trust` is idempotent — it's a no-op if already installed.
    // This covers first boot after hosting-setup.sh and CA regeneration.
    this.ensureCaddyCATrusted();
  }

  /**
   * Install the Caddy internal root CA into the system trust store.
   * Required for `tls internal` certs to be trusted by browsers and curl.
   * Idempotent — Caddy skips the install if the CA is already trusted.
   */
  private ensureCaddyCATrusted(): void {
    try {
      execSync("sudo caddy trust 2>&1", { stdio: "pipe", timeout: 15_000 });
      this.log.info("Caddy root CA verified in system trust store");
    } catch (err) {
      this.log.warn(`failed to install Caddy CA: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // -------------------------------------------------------------------------
  // Infrastructure checks
  // -------------------------------------------------------------------------

  checkInfrastructure(): InfraStatus {
    const caddy = {
      installed: this.isCaddyInstalled(),
      running: this.isCaddyRunning(),
    };
    const dnsmasq = {
      installed: this.isDnsmasqInstalled(),
      running: this.isDnsmasqRunning(),
      configured: existsSync("/etc/dnsmasq.d/ai-on.conf"),
    };
    const podman = {
      installed: this.isPodmanInstalled(),
      rootless: this.isPodmanRootless(),
    };
    return {
      ready: caddy.installed && caddy.running && dnsmasq.installed && dnsmasq.running && dnsmasq.configured && podman.installed,
      caddy,
      dnsmasq,
      podman,
    };
  }

  private isCaddyInstalled(): boolean {
    try {
      execSync("which caddy", { stdio: "pipe", timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  private isCaddyRunning(): boolean {
    try {
      const result = execSync("systemctl is-active caddy", { stdio: "pipe", timeout: 5000 }).toString().trim();
      return result === "active";
    } catch {
      return false;
    }
  }

  private isDnsmasqInstalled(): boolean {
    try {
      // Check for the dnsmasq package (not just dnsmasq-base which lacks the systemd service)
      const result = execSync("dpkg -l dnsmasq 2>/dev/null | grep -c '^ii'", { stdio: "pipe", timeout: 5000 }).toString().trim();
      return result === "1";
    } catch {
      return false;
    }
  }

  private isDnsmasqRunning(): boolean {
    try {
      const result = execSync("systemctl is-active dnsmasq", { stdio: "pipe", timeout: 5000 }).toString().trim();
      return result === "active";
    } catch {
      return false;
    }
  }

  private isPodmanInstalled(): boolean {
    try {
      execSync("which podman", { stdio: "pipe", timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  private isPodmanRootless(): boolean {
    try {
      const result = execFileSync("podman", ["info", "--format", "{{.Host.Security.Rootless}}"], {
        stdio: "pipe",
        timeout: 10_000,
      }).toString().trim();
      return result === "true";
    } catch {
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Initialization (called during gateway startup)
  // -------------------------------------------------------------------------

  async initialize(): Promise<void> {
    if (!this.config.enabled) {
      this.log.info("hosting disabled in config");
      return;
    }

    const infra = this.checkInfrastructure();
    if (!infra.ready) {
      this.log.warn("hosting infrastructure not ready — skipping auto-start");
      return;
    }

    // Clean up any stale aionima-managed containers from prior runs
    try {
      const stale = execFileSync("podman", ["ps", "-a", "--filter", "label=aionima.managed=true", "--format", "{{.Names}}"], { stdio: "pipe", timeout: 15_000 }).toString().trim();
      if (stale.length > 0) {
        for (const name of stale.split("\n")) {
          try { execFileSync("podman", ["rm", "-f", name], { stdio: "pipe", timeout: 15_000 }); } catch { /* ignore */ }
        }
        this.log.info(`cleaned up ${String(stale.split("\n").length)} stale container(s)`);
      }
    } catch { /* podman not available */ }

    // Scan all workspace project dirs — migrate old types and re-enable hosted projects.
    for (const dir of this.workspaceProjects) {
      try {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
          const fullPath = resolvePath(dir, entry.name);

          // Auto-migrate old framework types → broad type + stack
          this.migrateProjectType(fullPath);

          const meta = this.readHostingMeta(fullPath);
          if (meta !== null && meta.enabled) {
            await this.enableProject(fullPath, meta);
          }
        }
      } catch {
        // Directory may not exist
      }
    }

    // Generate Caddyfile and reload (always — even with zero projects,
    // so the ai.on dashboard reverse proxy is configured)
    this.regenerateCaddyfile();

    // Start status polling
    this.startStatusPolling();

    const count = Array.from(this.projects.values()).filter((p) => p.status === "running").length;
    this.log.info(`hosting initialized: ${String(count)} project(s) running`);
  }

  // -------------------------------------------------------------------------
  // Project metadata I/O
  // -------------------------------------------------------------------------

  readHostingMeta(projectPath: string): ProjectHostingMeta | null {
    // Delegate to ProjectConfigManager when available
    if (this.configMgr) {
      const hosting = this.configMgr.readHosting(projectPath);
      if (!hosting) return null;
      return {
        enabled: hosting.enabled,
        type: hosting.type ?? "static",
        hostname: hosting.hostname ?? this.slugFromPath(projectPath),
        docRoot: hosting.docRoot ?? null,
        startCommand: hosting.startCommand ?? null,
        port: hosting.port ?? null,
        mode: hosting.mode ?? "production",
        internalPort: hosting.internalPort ?? null,
        runtimeId: hosting.runtimeId ?? null,
        tunnelUrl: hosting.tunnelUrl ?? null,
      };
    }

    // Legacy fallback (no config manager)
    const metaPath = projectConfigPath(projectPath);
    const legacyPath = join(projectPath, ".nexus-project.json");
    if (!existsSync(metaPath) && !existsSync(legacyPath)) return null;
    const actualPath = existsSync(metaPath) ? metaPath : legacyPath;

    try {
      const raw = JSON.parse(readFileSync(actualPath, "utf-8")) as Record<string, unknown>;
      const hosting = raw.hosting as Record<string, unknown> | undefined;
      if (!hosting) return null;

      return {
        enabled: hosting.enabled === true,
        type: (hosting.type as string) ?? "static",
        hostname: (hosting.hostname as string) ?? this.slugFromPath(projectPath),
        docRoot: (hosting.docRoot as string) ?? null,
        startCommand: (hosting.startCommand as string) ?? null,
        port: (hosting.port as number) ?? null,
        mode: (hosting.mode as "production" | "development") ?? "production",
        internalPort: (hosting.internalPort as number) ?? null,
        runtimeId: (hosting.runtimeId as string) ?? null,
        tunnelUrl: (hosting.tunnelUrl as string) ?? null,
      };
    } catch {
      return null;
    }
  }

  private writeHostingMeta(projectPath: string, meta: ProjectHostingMeta): void {
    // Delegate to ProjectConfigManager when available
    if (this.configMgr) {
      void this.configMgr.updateHosting(projectPath, {
        enabled: meta.enabled,
        type: meta.type,
        hostname: meta.hostname,
        docRoot: meta.docRoot,
        startCommand: meta.startCommand,
        port: meta.port,
        mode: meta.mode,
        internalPort: meta.internalPort,
        ...(meta.runtimeId != null ? { runtimeId: meta.runtimeId } : {}),
        ...(meta.tunnelUrl != null ? { tunnelUrl: meta.tunnelUrl } : {}),
      });
      return;
    }

    // Legacy fallback (no config manager)
    const metaPath = projectConfigPath(projectPath);
    let existing: Record<string, unknown> = {};
    if (existsSync(metaPath)) {
      try {
        existing = JSON.parse(readFileSync(metaPath, "utf-8")) as Record<string, unknown>;
      } catch { /* start fresh */ }
    }

    // Preserve existing hosting fields (e.g. stacks) that aren't part of meta
    const existingHosting = (existing.hosting ?? {}) as Record<string, unknown>;
    existing.hosting = {
      ...existingHosting,
      enabled: meta.enabled,
      type: meta.type,
      hostname: meta.hostname,
      docRoot: meta.docRoot,
      startCommand: meta.startCommand,
      port: meta.port,
      mode: meta.mode,
      internalPort: meta.internalPort,
      ...(meta.runtimeId ? { runtimeId: meta.runtimeId } : {}),
      ...(meta.tunnelUrl ? { tunnelUrl: meta.tunnelUrl } : {}),
    };

    mkdirSync(dirname(metaPath), { recursive: true });
    writeFileSync(metaPath, JSON.stringify(existing, null, 2) + "\n", "utf-8");
  }

  private slugFromPath(projectPath: string): string {
    const parts = projectPath.split("/");
    return (parts[parts.length - 1] ?? "project").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  }

  /**
   * Migrate old framework-based project types (e.g. "laravel", "nextjs") to
   * broad project types ("web-app", "api-service") and auto-install the
   * corresponding stack if not already present.
   */
  private migrateProjectType(projectPath: string): void {
    // When using config manager, read via the validated service
    if (this.configMgr) {
      const config = this.configMgr.read(projectPath);
      if (!config?.hosting) return;

      const currentType = config.hosting.type;
      if (!currentType) return;

      const migration = MIGRATION_MAP[currentType];
      if (!migration) return;

      const stacks = config.hosting.stacks ?? [];
      const newStacks = stacks.some((s) => s.stackId === migration.autoStack)
        ? stacks
        : [...stacks, { stackId: migration.autoStack, addedAt: new Date().toISOString() }];

      void this.configMgr.updateHosting(projectPath, {
        type: migration.newType,
        stacks: newStacks,
      });

      this.log.info(`[${this.slugFromPath(projectPath)}] migrated type "${currentType}" → "${migration.newType}" + stack "${migration.autoStack}"`);
      return;
    }

    // Legacy fallback
    const metaPath = projectConfigPath(projectPath);
    if (!existsSync(metaPath)) return;

    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(readFileSync(metaPath, "utf-8")) as Record<string, unknown>;
    } catch {
      return;
    }

    const hosting = raw.hosting as Record<string, unknown> | undefined;
    if (!hosting) return;

    const currentType = hosting.type as string | undefined;
    if (!currentType) return;

    const migration = MIGRATION_MAP[currentType];
    if (!migration) return; // Already a broad type or unknown — nothing to do

    // Update type to broad category
    hosting.type = migration.newType;

    // Auto-add the corresponding stack if not already present
    const stacks = (hosting.stacks ?? []) as ProjectStackInstance[];
    if (!stacks.some((s) => s.stackId === migration.autoStack)) {
      stacks.push({
        stackId: migration.autoStack,
        addedAt: new Date().toISOString(),
      });
      hosting.stacks = stacks;
    }

    raw.hosting = hosting;
    mkdirSync(dirname(metaPath), { recursive: true });
    writeFileSync(metaPath, JSON.stringify(raw, null, 2) + "\n", "utf-8");
    this.log.info(`[${this.slugFromPath(projectPath)}] migrated type "${currentType}" → "${migration.newType}" + stack "${migration.autoStack}"`);
  }

  // -------------------------------------------------------------------------
  // Enable / Disable hosting
  // -------------------------------------------------------------------------

  async enableProject(
    projectPath: string,
    meta: ProjectHostingMeta,
  ): Promise<HostedProject> {
    const resolved = resolvePath(projectPath);

    // All types get a port for container port mapping
    if (meta.port !== null) {
      if (this.allocatedPorts.has(meta.port) || !this.isPortAvailable(meta.port)) {
        this.log.warn(`[${meta.hostname}] persisted port ${String(meta.port)} is in use — reallocating`);
        meta.port = this.allocatePort();
      } else {
        this.allocatedPorts.add(meta.port);
      }
    } else {
      meta.port = this.allocatePort();
    }

    // Check for hostname collision
    for (const existing of this.projects.values()) {
      if (existing.meta.hostname === meta.hostname && existing.path !== resolved) {
        throw new Error(`Hostname "${meta.hostname}" is already in use by ${existing.path}`);
      }
    }

    const containerName = `aionima-${meta.hostname}`;

    const hosted: HostedProject = {
      path: resolved,
      meta,
      containerId: null,
      containerName,
      status: "stopped",
      tunnelPid: null,
      tunnelUrl: null,
    };

    this.projects.set(resolved, hosted);

    // Start container
    this.startContainer(hosted);

    // Persist metadata
    this.writeHostingMeta(resolved, meta);

    this.log.info(`enabled hosting: ${meta.hostname}.${this.config.baseDomain} (${meta.type})`);
    this.notifyStatusChange();
    return hosted;
  }

  async disableProject(projectPath: string): Promise<void> {
    const resolved = resolvePath(projectPath);
    const hosted = this.projects.get(resolved);
    if (!hosted) return;

    // Kill tunnel if active
    this.disableTunnel(resolved);

    // Stop container
    this.stopContainer(hosted);

    // Release port
    if (hosted.meta.port !== null) {
      this.allocatedPorts.delete(hosted.meta.port);
    }

    // Update metadata
    hosted.meta.enabled = false;
    this.writeHostingMeta(resolved, hosted.meta);

    this.projects.delete(resolved);

    // Regenerate Caddyfile
    this.regenerateCaddyfile();

    this.log.info(`disabled hosting: ${hosted.meta.hostname}.${this.config.baseDomain}`);
    this.notifyStatusChange();
  }

  async configureProject(
    projectPath: string,
    updates: Partial<Omit<ProjectHostingMeta, "enabled">>,
  ): Promise<HostedProject | null> {
    const resolved = resolvePath(projectPath);
    let hosted = this.projects.get(resolved);

    // Auto-enable if not in active map but has meta on disk
    if (!hosted) {
      const meta = this.readHostingMeta(resolved);
      if (meta) {
        Object.assign(meta, updates, { enabled: true });
        hosted = await this.enableProject(resolved, meta);
        this.regenerateCaddyfile();
        this.notifyStatusChange();
        return hosted;
      }
      return null;
    }

    const hadContainer = hosted.containerId !== null;

    // Apply updates
    if (updates.type !== undefined) hosted.meta.type = updates.type;
    if (updates.hostname !== undefined) {
      hosted.meta.hostname = updates.hostname;
      hosted.containerName = `aionima-${updates.hostname}`;
    }
    if (updates.docRoot !== undefined) hosted.meta.docRoot = updates.docRoot;
    if (updates.startCommand !== undefined) hosted.meta.startCommand = updates.startCommand;
    if (updates.mode !== undefined) hosted.meta.mode = updates.mode;
    if (updates.internalPort !== undefined) hosted.meta.internalPort = updates.internalPort;
    if (updates.runtimeId !== undefined) hosted.meta.runtimeId = updates.runtimeId;

    // Restart container with new config
    if (hadContainer) {
      this.stopContainer(hosted);
    }
    this.startContainer(hosted);

    this.writeHostingMeta(resolved, hosted.meta);
    this.regenerateCaddyfile();
    this.notifyStatusChange();

    return hosted;
  }

  // -------------------------------------------------------------------------
  // Container lifecycle
  // -------------------------------------------------------------------------

  /**
   * Resolve container config from the project's installed stacks.
   * Returns the first per-project (shared === false) stack container config,
   * or null if no stack provides one.
   */
  private resolveStackContainerConfig(hosted: HostedProject): StackContainerConfig | null {
    if (!this.stackReg) return null;

    const stacks = this.getProjectStacks(hosted.path);
    if (stacks.length === 0) return null;

    for (const instance of stacks) {
      const def = this.stackReg.get(instance.stackId);
      if (def?.containerConfig && !def.containerConfig.shared) {
        return def.containerConfig;
      }
    }

    return null;
  }

  private startContainer(hosted: HostedProject): void {
    if (hosted.meta.port === null) {
      hosted.status = "error";
      hosted.error = "No port allocated";
      return;
    }

    const containerName = hosted.containerName ?? `aionima-${hosted.meta.hostname}`;

    // Clean up any stale container with the same name
    try {
      execFileSync("podman", ["rm", "-f", containerName], { stdio: "pipe", timeout: 15_000 });
    } catch {
      // Container may not exist — that's fine
    }

    // -----------------------------------------------------------------------
    // Primary path: resolve container config from installed stacks
    // -----------------------------------------------------------------------

    const stackConfig = this.resolveStackContainerConfig(hosted);
    if (stackConfig) {
      const ctx: StackContainerContext = {
        projectPath: hosted.path,
        projectHostname: hosted.meta.hostname,
        allocatedPort: hosted.meta.port,
        mode: hosted.meta.mode,
      };

      const internalPort = hosted.meta.internalPort ?? stackConfig.internalPort;

      const args: string[] = [
        "run", "-d",
        "--name", containerName,
        "--restart=on-failure:10",
        "--label", "aionima.managed=true",
        "--label", `aionima.hostname=${hosted.meta.hostname}`,
        "--label", `aionima.project=${hosted.path}`,
        "-p", `${String(hosted.meta.port)}:${String(internalPort)}`,
      ];

      for (const vol of stackConfig.volumeMounts(ctx)) {
        args.push("-v", vol);
      }
      for (const [key, value] of Object.entries(stackConfig.env(ctx))) {
        args.push("-e", `${key}=${value}`);
      }

      // Set working directory to /app (where project is typically mounted)
      args.push("-w", "/app");

      // Use runtime-selected image if available, otherwise stack's default
      const runtimeDef = hosted.meta.runtimeId
        ? this.pluginReg?.getRuntimes().find(r => r.id === hosted.meta.runtimeId)
        : undefined;
      args.push(runtimeDef?.containerImage ?? stackConfig.image);

      const cmdTokens = stackConfig.command?.(ctx);
      if (cmdTokens) {
        args.push(...cmdTokens);
      }

      this.execContainerStart(hosted, containerName, args, "stack");
      return;
    }

    // -----------------------------------------------------------------------
    // Legacy fallback (deprecated): ProjectType registry + hardcoded constants
    // @deprecated — Remove after existing projects migrate to stack-based hosting
    // -----------------------------------------------------------------------

    const typeDef = this.registry?.get(hosted.meta.type);
    const runtimeDef = hosted.meta.runtimeId
      ? this.pluginReg?.getRuntimes().find(r => r.id === hosted.meta.runtimeId)
      : undefined;

    const knownType = hosted.meta.type;
    const internalPort = hosted.meta.internalPort
      ?? runtimeDef?.internalPort
      ?? typeDef?.containerConfig?.internalPort
      ?? CONTAINER_INTERNAL_PORTS[knownType]
      ?? 3000;
    const image = runtimeDef?.containerImage
      ?? typeDef?.containerConfig?.image
      ?? CONTAINER_IMAGES[knownType]
      ?? "node:22-alpine";

    const args: string[] = [
      "run", "-d",
      "--name", containerName,
      "--restart=on-failure:10",
      "--label", "aionima.managed=true",
      "--label", `aionima.hostname=${hosted.meta.hostname}`,
      "--label", `aionima.project=${hosted.path}`,
      "-p", `${String(hosted.meta.port)}:${String(internalPort)}`,
    ];

    if (typeDef?.containerConfig) {
      const cfg = typeDef.containerConfig;
      const volumes = cfg.volumeMounts(hosted.path, hosted.meta);
      for (const vol of volumes) {
        args.push("-v", vol);
      }
      const envVars = cfg.env(hosted.meta);
      for (const [key, value] of Object.entries(envVars)) {
        args.push("-e", `${key}=${value}`);
      }
      if (hosted.meta.type === "node") {
        args.push("-w", "/app");
      }
      args.push(image);
      const cmdTokens = cfg.command?.(hosted.meta);
      if (cmdTokens) {
        args.push(...cmdTokens);
      } else if (hosted.meta.type === "node" && !hosted.meta.startCommand) {
        hosted.status = "error";
        hosted.error = "Missing startCommand for Node.js project";
        return;
      }
    } else {
      switch (hosted.meta.type) {
        case "static": {
          const docRoot = hosted.meta.docRoot ?? "dist";
          const hostPath = join(hosted.path, docRoot);
          args.push("-v", `${hostPath}:/usr/share/nginx/html:ro,Z`);
          args.push(image);
          break;
        }
        case "php": {
          const docRoot = hosted.meta.docRoot ?? "public";
          args.push("-v", `${hosted.path}:/var/www/html:Z`);
          args.push(image);
          if (docRoot !== ".") {
            args.push("bash", "-c",
              `sed -i 's|/var/www/html|/var/www/html/${docRoot}|g' /etc/apache2/sites-available/000-default.conf /etc/apache2/apache2.conf && a2enmod rewrite && docker-php-entrypoint apache2-foreground`);
          }
          break;
        }
        case "node": {
          if (!hosted.meta.startCommand) {
            hosted.status = "error";
            hosted.error = "Missing startCommand for Node.js project";
            return;
          }
          args.push("-v", `${hosted.path}:/app:Z`);
          args.push("-w", "/app");
          args.push("-e", `PORT=${String(internalPort)}`);
          args.push("-e", `NODE_ENV=${hosted.meta.mode}`);
          args.push(image);
          const cmdTokens = hosted.meta.startCommand.split(/\s+/);
          args.push(...cmdTokens);
          break;
        }
        default: {
          // Generic fallback: mount project, run startCommand if provided
          if (!hosted.meta.startCommand) {
            hosted.status = "error";
            hosted.error = `No container configuration for project type "${hosted.meta.type}". Add a stack or set a start command.`;
            return;
          }
          args.push("-v", `${hosted.path}:/app:Z`);
          args.push("-w", "/app");
          args.push("-e", `PORT=${String(internalPort)}`);
          args.push("-e", `NODE_ENV=${hosted.meta.mode}`);
          args.push(image);
          args.push(...hosted.meta.startCommand.split(/\s+/));
          break;
        }
      }
    }

    this.execContainerStart(hosted, containerName, args, "legacy");
  }

  /** Execute podman run and update hosted project state. */
  private execContainerStart(
    hosted: HostedProject,
    containerName: string,
    args: string[],
    source: "stack" | "legacy",
  ): void {
    try {
      const result = execFileSync("podman", args, {
        stdio: "pipe",
        timeout: 60_000,
      }).toString().trim();

      hosted.containerId = result;
      hosted.containerName = containerName;
      hosted.status = "running";
      hosted.error = undefined;

      this.log.info(`[${hosted.meta.hostname}] container started: ${containerName} (port ${String(hosted.meta.port)}) [${source}]`);
    } catch (err) {
      hosted.status = "error";
      hosted.error = err instanceof Error ? err.message : String(err);
      this.log.error(`[${hosted.meta.hostname}] failed to start container: ${hosted.error}`);
    }
  }

  private stopContainer(hosted: HostedProject): void {
    if (!hosted.containerName) return;

    try {
      execFileSync("podman", ["stop", "-t", "10", hosted.containerName], {
        stdio: "pipe",
        timeout: 30_000,
      });
    } catch {
      // Container may already be stopped
    }

    try {
      execFileSync("podman", ["rm", "-f", hosted.containerName], {
        stdio: "pipe",
        timeout: 15_000,
      });
    } catch {
      // Container may already be removed
    }

    hosted.containerId = null;
    hosted.status = "stopped";
    this.log.info(`[${hosted.meta.hostname}] container stopped: ${hosted.containerName}`);
  }

  restartProject(projectPath: string): boolean {
    const resolved = resolvePath(projectPath);
    const hosted = this.projects.get(resolved);
    if (!hosted) return false;

    this.stopContainer(hosted);
    this.startContainer(hosted);
    this.notifyStatusChange();
    return true;
  }

  // -------------------------------------------------------------------------
  // Container logs
  // -------------------------------------------------------------------------

  getContainerLogs(
    projectPath: string,
    tail = 100,
    sourceType?: "container" | "container-file",
    containerFilePath?: string,
  ): string | null {
    const resolved = resolvePath(projectPath);
    const hosted = this.projects.get(resolved);
    if (!hosted?.containerName) return null;

    try {
      if (sourceType === "container-file" && containerFilePath) {
        return execFileSync("podman", [
          "exec", hosted.containerName,
          "tail", "-n", String(tail), containerFilePath,
        ], { stdio: "pipe", timeout: 10_000 }).toString();
      }
      // podman logs sends container stdout to its stdout and container stderr
      // to its stderr — we need both (Node.js apps typically log to stderr)
      const result = spawnSync("podman", ["logs", "--tail", String(tail), hosted.containerName], {
        stdio: "pipe",
        timeout: 10_000,
      });
      const stdout = result.stdout?.toString() ?? "";
      const stderr = result.stderr?.toString() ?? "";
      return (stdout + stderr).trim();
    } catch {
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // Status polling
  // -------------------------------------------------------------------------

  private startStatusPolling(): void {
    if (this.statusPollTimer !== null) return;
    this.statusPollTimer = setInterval(
      () => this.pollContainerStatuses(),
      this.config.statusPollIntervalMs,
    );
  }

  private pollContainerStatuses(): void {
    let changed = false;

    for (const hosted of this.projects.values()) {
      if (!hosted.containerName) continue;

      let newStatus: "running" | "stopped" | "error";
      try {
        const raw = execFileSync(
          "podman",
          ["inspect", "--format", "{{.State.Status}}", hosted.containerName],
          { stdio: "pipe", timeout: 10_000 },
        ).toString().trim();

        if (raw === "running") {
          newStatus = "running";
        } else if (raw === "exited" || raw === "stopped") {
          newStatus = "stopped";
        } else {
          newStatus = "error";
        }
      } catch {
        // Container not found
        newStatus = "stopped";
        hosted.containerId = null;
      }

      if (hosted.status !== newStatus) {
        hosted.status = newStatus;
        changed = true;
      }
    }

    if (changed) {
      this.notifyStatusChange();
    }
  }

  // -------------------------------------------------------------------------
  // Port allocation
  // -------------------------------------------------------------------------

  /** Check whether a TCP port is free using `ss`. */
  private isPortAvailable(port: number): boolean {
    try {
      const out = execFileSync("ss", ["-tlnH", `sport = :${String(port)}`], { stdio: "pipe", timeout: 5_000 }).toString();
      return out.trim().length === 0;
    } catch {
      return true; // ss failed — assume free
    }
  }

  private allocatePort(): number {
    const start = this.config.portRangeStart;
    for (let i = 0; i < PORT_POOL_SIZE; i++) {
      const port = start + i;
      if (!this.allocatedPorts.has(port) && this.isPortAvailable(port)) {
        this.allocatedPorts.add(port);
        return port;
      }
    }
    throw new Error(`Port pool exhausted (${String(start)}-${String(start + PORT_POOL_SIZE - 1)})`);
  }

  // -------------------------------------------------------------------------
  // Caddyfile generation
  // -------------------------------------------------------------------------

  regenerateCaddyfile(): void {
    const SYSTEM_BEGIN = "# === SYSTEM DOMAINS ===";
    const SYSTEM_END = "# === END SYSTEM DOMAINS ===";
    const PROJECTS_BEGIN = "# === PROJECT DOMAINS ===";
    const PROJECTS_END = "# === END PROJECT DOMAINS ===";
    const CUSTOM_BEGIN = "# --- BEGIN CUSTOM ---";
    const CUSTOM_END = "# --- END CUSTOM ---";

    // Read existing Caddyfile to preserve sections we don't own
    let existingSystem = "";
    let customBlock = "";
    try {
      const existing = readFileSync("/etc/caddy/Caddyfile", "utf8");

      // Preserve custom block
      const customBeginIdx = existing.indexOf(CUSTOM_BEGIN);
      const customEndIdx = existing.indexOf(CUSTOM_END);
      if (customBeginIdx !== -1 && customEndIdx !== -1) {
        customBlock = existing.slice(customBeginIdx, customEndIdx + CUSTOM_END.length);
      }

      // Preserve existing system section (only used when we can't rebuild it,
      // e.g. plugins haven't loaded yet)
      const sysBeginIdx = existing.indexOf(SYSTEM_BEGIN);
      const sysEndIdx = existing.indexOf(SYSTEM_END);
      if (sysBeginIdx !== -1 && sysEndIdx !== -1) {
        existingSystem = existing.slice(sysBeginIdx, sysEndIdx + SYSTEM_END.length);
      }
    } catch {
      // No existing Caddyfile — skip
    }

    const blocks: string[] = [];

    blocks.push("# aionima hosting — auto-generated by HostingManager");
    blocks.push("# Do not edit manually (except between CUSTOM markers).\n");

    // ---- System domains section ----
    // Only rebuild if we have the plugin registry (plugins loaded).
    // Otherwise preserve the existing system section so plugin subdomains
    // aren't lost when projects are toggled before plugins activate.
    const hasPluginRoutes = this.pluginReg && this.pluginReg.getSubdomainRoutes().length > 0;

    if (hasPluginRoutes || !existingSystem) {
      blocks.push(SYSTEM_BEGIN);
      blocks.push("");

      const gw = `localhost:${String(this.config.gatewayPort)}`;

      // Gateway (dashboard)
      const gatewayDomains = [this.config.baseDomain, ...(this.config.domainAliases ?? [])].join(", ");
      blocks.push(`${gatewayDomains} {`);
      blocks.push(`    tls internal`);
      blocks.push(`    reverse_proxy ${gw}`);
      blocks.push(`}\n`);

      // Database portal — always present as a system domain
      blocks.push(`db.${this.config.baseDomain} {`);
      blocks.push(`    tls internal`);
      blocks.push(`    reverse_proxy ${gw}`);
      blocks.push(`}\n`);

      // Local ID service — when enabled, reverse-proxy id.{baseDomain} to the ID service port
      if (this.config.idService?.enabled) {
        const idSubdomain = this.config.idService.subdomain ?? "id";
        const idPort = this.config.idService.port ?? 3200;
        blocks.push(`${idSubdomain}.${this.config.baseDomain} {`);
        blocks.push(`    tls internal`);
        blocks.push(`    reverse_proxy localhost:${String(idPort)}`);
        blocks.push(`}\n`);
      }

      // Plugin-registered subdomain routes
      if (this.pluginReg) {
        for (const { route } of this.pluginReg.getSubdomainRoutes()) {
          const fqdn = `${route.subdomain}.${this.config.baseDomain}`;
          const target = route.target === "gateway" ? gw : `localhost:${String(route.target)}`;

          blocks.push(`${fqdn} {`);
          blocks.push(`    tls internal`);
          blocks.push(`    reverse_proxy ${target}`);
          blocks.push(`}\n`);
        }
      }

      // Custom block (e.g. papa.ai.on)
      if (customBlock) {
        blocks.push(customBlock);
      } else {
        blocks.push(CUSTOM_BEGIN);
        blocks.push(CUSTOM_END);
      }

      blocks.push("");
      blocks.push(SYSTEM_END);
    } else {
      // Preserve existing system section as-is
      blocks.push(existingSystem);
    }

    blocks.push("");

    // ---- Project domains section ----
    blocks.push(PROJECTS_BEGIN);
    blocks.push("");

    for (const hosted of this.projects.values()) {
      if (!hosted.meta.enabled || hosted.meta.port === null) continue;

      const fqdn = `${hosted.meta.hostname}.${this.config.baseDomain}`;

      blocks.push(`${fqdn} {`);
      blocks.push(`    tls internal`);
      blocks.push(`    reverse_proxy localhost:${String(hosted.meta.port)}`);
      blocks.push(`}\n`);
    }

    blocks.push(PROJECTS_END);
    blocks.push("");

    const caddyfile = blocks.join("\n");

    try {
      execSync(`sudo tee /etc/caddy/Caddyfile > /dev/null`, {
        input: caddyfile,
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 5000,
      });
      this.log.info("Caddyfile regenerated");
    } catch (err) {
      this.log.error(`failed to write Caddyfile: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    // Reload Caddy
    try {
      execSync("sudo caddy reload --config /etc/caddy/Caddyfile", {
        stdio: "pipe",
        timeout: 10_000,
      });
      this.log.info("Caddy reloaded");
    } catch (err) {
      this.log.error(`failed to reload Caddy: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // -------------------------------------------------------------------------
  // Status
  // -------------------------------------------------------------------------

  getStatus(): {
    ready: boolean;
    baseDomain: string;
    caddy: { installed: boolean; running: boolean };
    dnsmasq: { installed: boolean; running: boolean; configured: boolean };
    podman: { installed: boolean; rootless: boolean };
    projects: {
      path: string;
      hostname: string;
      type: string;
      status: "running" | "stopped" | "error" | "unconfigured";
      port: number | null;
      url: string | null;
      mode: "production" | "development";
      internalPort: number | null;
      tunnelUrl?: string | null;
      containerName?: string;
      image?: string;
      error?: string;
    }[];
  } {
    const infra = this.checkInfrastructure();
    const projects = Array.from(this.projects.values()).map((hosted) => {
      const knownType = hosted.meta.type;
      return {
        path: hosted.path,
        hostname: hosted.meta.hostname,
        type: hosted.meta.type,
        status: hosted.status,
        port: hosted.meta.port,
        mode: hosted.meta.mode,
        internalPort: hosted.meta.internalPort,
        url: hosted.status === "running"
          ? `https://${hosted.meta.hostname}.${this.config.baseDomain}`
          : null,
        ...(hosted.tunnelUrl ? { tunnelUrl: hosted.tunnelUrl } : {}),
        ...(hosted.containerName ? { containerName: hosted.containerName } : {}),
        ...(CONTAINER_IMAGES[knownType] ? { image: CONTAINER_IMAGES[knownType] } : {}),
        ...(hosted.error !== undefined ? { error: hosted.error } : {}),
      };
    });

    return {
      ...infra,
      baseDomain: this.config.baseDomain,
      projects,
    };
  }

  /** Get the running container name for a project (or null if not running). */
  getContainerName(projectPath: string): string | null {
    const resolved = resolvePath(projectPath);
    const hosted = this.projects.get(resolved);
    if (!hosted || hosted.status !== "running" || !hosted.containerName) return null;
    return hosted.containerName;
  }

  /** Get hosting info for a specific project (merged into GET /api/projects response). */
  getProjectHostingInfo(projectPath: string): {
    enabled: boolean;
    type: string;
    hostname: string;
    docRoot: string | null;
    startCommand: string | null;
    port: number | null;
    mode: "production" | "development";
    internalPort: number | null;
    runtimeId?: string | null;
    status: "running" | "stopped" | "error" | "unconfigured";
    tunnelUrl?: string | null;
    containerName?: string;
    image?: string;
    error?: string;
    url: string | null;
  } {
    const resolved = resolvePath(projectPath);
    const hosted = this.projects.get(resolved);

    if (hosted) {
      const knownType = hosted.meta.type;
      // Resolve image from runtime definition, then stack config, then hardcoded fallback
      const runtimeDef = hosted.meta.runtimeId
        ? this.pluginReg?.getRuntimes().find(r => r.id === hosted.meta.runtimeId)
        : undefined;
      const stackConfig = this.resolveStackContainerConfig(hosted);
      const resolvedImage = runtimeDef?.containerImage
        ?? stackConfig?.image
        ?? CONTAINER_IMAGES[knownType];
      return {
        enabled: hosted.meta.enabled,
        type: hosted.meta.type,
        hostname: hosted.meta.hostname,
        docRoot: hosted.meta.docRoot,
        startCommand: hosted.meta.startCommand,
        port: hosted.meta.port,
        mode: hosted.meta.mode,
        internalPort: hosted.meta.internalPort,
        runtimeId: hosted.meta.runtimeId ?? null,
        status: hosted.status,
        ...(hosted.tunnelUrl ? { tunnelUrl: hosted.tunnelUrl } : {}),
        ...(hosted.containerName ? { containerName: hosted.containerName } : {}),
        ...(resolvedImage ? { image: resolvedImage } : {}),
        ...(hosted.error !== undefined ? { error: hosted.error } : {}),
        url: hosted.status === "running"
          ? `https://${hosted.meta.hostname}.${this.config.baseDomain}`
          : null,
      };
    }

    // Check if project has hosting meta but is not active
    const meta = this.readHostingMeta(resolved);
    if (meta) {
      return {
        enabled: meta.enabled,
        type: meta.type,
        hostname: meta.hostname,
        docRoot: meta.docRoot,
        startCommand: meta.startCommand,
        port: meta.port,
        mode: meta.mode,
        internalPort: meta.internalPort,
        runtimeId: meta.runtimeId ?? null,
        status: "unconfigured",
        url: null,
      };
    }

    // No hosting config at all
    return {
      enabled: false,
      type: "static",
      hostname: this.slugFromPath(projectPath),
      docRoot: null,
      startCommand: null,
      port: null,
      mode: "production",
      internalPort: null,
      status: "unconfigured",
      url: null,
    };
  }

  // -------------------------------------------------------------------------
  // Project type detection
  // -------------------------------------------------------------------------

  detectProjectDefaults(projectPath: string): DetectedProjectConfig {
    const has = (name: string) => existsSync(join(projectPath, name));
    const anyMatch = (pattern: RegExp) => {
      try {
        return readdirSync(projectPath).some((f) => pattern.test(f));
      } catch {
        return false;
      }
    };

    // Parse package.json and composer.json once upfront
    let pkgDeps: Record<string, string> = {};
    let pkgScripts: Record<string, string> = {};
    let composerRequire: Record<string, string> = {};
    const hasPackageJson = has("package.json");
    const hasComposerJson = has("composer.json");

    if (hasPackageJson) {
      try {
        const pkg = JSON.parse(readFileSync(join(projectPath, "package.json"), "utf-8")) as {
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
          scripts?: Record<string, string>;
        };
        pkgDeps = { ...pkg.dependencies, ...pkg.devDependencies };
        pkgScripts = pkg.scripts ?? {};
      } catch { /* malformed — fall through */ }
    }

    if (hasComposerJson) {
      try {
        const composer = JSON.parse(readFileSync(join(projectPath, "composer.json"), "utf-8")) as {
          require?: Record<string, string>;
          "require-dev"?: Record<string, string>;
        };
        composerRequire = { ...composer.require, ...composer["require-dev"] };
      } catch { /* malformed — fall through */ }
    }

    // 1. Laravel (composer.json with laravel/framework)
    if (hasComposerJson && "laravel/framework" in composerRequire) {
      return { projectType: "web-app", suggestedStacks: ["stack-laravel"], docRoot: "public", startCommand: null };
    }

    // 2. WordPress (composer.json with roots/wordpress or johnpbloch/wordpress-core)
    if (hasComposerJson && ("roots/wordpress" in composerRequire || "johnpbloch/wordpress-core" in composerRequire)) {
      return { projectType: "web-app", suggestedStacks: ["stack-php-app"], docRoot: "web/wp", startCommand: null };
    }

    // 3. Next.js (config file or package.json dep)
    if (has("next.config.ts") || has("next.config.js") || has("next.config.mjs") || "next" in pkgDeps) {
      return { projectType: "web-app", suggestedStacks: ["stack-nextjs"], docRoot: ".", startCommand: "npm start" };
    }

    // 4. Nuxt (config file or package.json dep)
    if (has("nuxt.config.ts") || has("nuxt.config.js") || "nuxt" in pkgDeps) {
      return { projectType: "web-app", suggestedStacks: ["stack-nuxt"], docRoot: ".", startCommand: "npm start" };
    }

    // 5. React + Vite
    if (hasPackageJson && "react" in pkgDeps && "vite" in pkgDeps) {
      return { projectType: "web-app", suggestedStacks: ["stack-react-vite"], docRoot: "dist", startCommand: null };
    }

    // 6. Generic Node.js with start script
    if (hasPackageJson && pkgScripts.start) {
      return { projectType: "api-service", suggestedStacks: ["stack-node-app"], docRoot: ".", startCommand: "npm start" };
    }

    // 7. Vite only (no React)
    if (hasPackageJson && "vite" in pkgDeps) {
      return { projectType: "static-site", suggestedStacks: ["stack-static-hosting"], docRoot: "dist", startCommand: null };
    }

    // 8. Generic PHP (composer.json)
    if (hasComposerJson) {
      return { projectType: "web-app", suggestedStacks: ["stack-php-app"], docRoot: "public", startCommand: null };
    }

    // 9. Loose .php files
    if (anyMatch(/\.php$/)) {
      return { projectType: "web-app", suggestedStacks: ["stack-php-app"], docRoot: ".", startCommand: null };
    }

    // 10. Python (manage.py + requirements.txt/pyproject.toml)
    if (has("manage.py") && (has("requirements.txt") || has("pyproject.toml"))) {
      return { projectType: "api-service", suggestedStacks: [], docRoot: ".", startCommand: "python manage.py runserver" };
    }

    // 11. Static (index.html in root)
    if (has("index.html")) {
      return { projectType: "static-site", suggestedStacks: ["stack-static-hosting"], docRoot: ".", startCommand: null };
    }

    // 12. Fallback
    return { projectType: "static-site", suggestedStacks: ["stack-static-hosting"], docRoot: "dist", startCommand: null };
  }

  // -------------------------------------------------------------------------
  // Shutdown
  // -------------------------------------------------------------------------

  async shutdown(): Promise<void> {
    this.log.info("shutting down hosted projects...");

    // Stop polling
    if (this.statusPollTimer !== null) {
      clearInterval(this.statusPollTimer);
      this.statusPollTimer = null;
    }

    // Kill all tunnel processes
    for (const [, proc] of this.tunnelProcesses) {
      try { proc.kill(); } catch { /* already dead */ }
    }
    this.tunnelProcesses.clear();

    // Stop all containers
    for (const hosted of this.projects.values()) {
      this.stopContainer(hosted);
    }
    this.projects.clear();
    this.allocatedPorts.clear();
    this.log.info("hosting manager shut down");
  }

  // -------------------------------------------------------------------------
  // Cloudflare Quick Tunnels
  // -------------------------------------------------------------------------

  /** Locate the cloudflared binary. Throws if not installed. */
  private ensureCloudflared(): string {
    try {
      return execSync("which cloudflared", { stdio: "pipe", timeout: 5000 }).toString().trim();
    } catch {
      throw new Error(
        "cloudflared not installed. Run: curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o /tmp/cloudflared.deb && sudo dpkg -i /tmp/cloudflared.deb",
      );
    }
  }

  /** Spin up a Cloudflare quick tunnel for a hosted project. */
  async enableTunnel(projectPath: string): Promise<{ url: string }> {
    const resolved = resolvePath(projectPath);
    const hosted = this.projects.get(resolved);
    if (!hosted) throw new Error("Project is not hosted");
    if (hosted.status !== "running") throw new Error("Project container is not running");

    // Already active?
    const existing = this.tunnelProcesses.get(resolved);
    if (existing && hosted.tunnelUrl) {
      return { url: hosted.tunnelUrl };
    }

    const bin = this.ensureCloudflared();

    return new Promise<{ url: string }>((resolve, reject) => {
      const child = spawn(bin, ["tunnel", "--url", `http://localhost:${String(hosted.meta.port)}`], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stderrBuf = "";
      const urlRegex = /https:\/\/[-a-z0-9]+\.trycloudflare\.com/;
      let resolved_url = false;

      const timeout = setTimeout(() => {
        if (!resolved_url) {
          try { child.kill(); } catch { /* ignore */ }
          this.tunnelProcesses.delete(resolved);
          reject(new Error("Timed out waiting for cloudflared tunnel URL (15s)"));
        }
      }, 15_000);

      child.stderr.on("data", (data: Buffer) => {
        stderrBuf += data.toString();
        const match = urlRegex.exec(stderrBuf);
        if (match && !resolved_url) {
          resolved_url = true;
          clearTimeout(timeout);
          const url = match[0];

          hosted.tunnelUrl = url;
          hosted.tunnelPid = child.pid ?? null;
          hosted.meta.tunnelUrl = url;
          this.tunnelProcesses.set(resolved, child);
          this.writeHostingMeta(resolved, hosted.meta);
          this.notifyStatusChange();

          this.log.info(`[${hosted.meta.hostname}] tunnel active: ${url}`);
          resolve({ url });
        }
      });

      child.on("close", () => {
        clearTimeout(timeout);
        if (this.tunnelProcesses.get(resolved) === child) {
          this.tunnelProcesses.delete(resolved);
          hosted.tunnelUrl = null;
          hosted.tunnelPid = null;
          hosted.meta.tunnelUrl = null;
          this.writeHostingMeta(resolved, hosted.meta);
          this.notifyStatusChange();
          this.log.info(`[${hosted.meta.hostname}] tunnel closed`);
        }
        if (!resolved_url) {
          reject(new Error(`cloudflared exited before providing a URL. stderr: ${stderrBuf.slice(0, 500)}`));
        }
      });

      child.on("error", (err) => {
        clearTimeout(timeout);
        this.tunnelProcesses.delete(resolved);
        if (!resolved_url) {
          reject(new Error(`cloudflared spawn error: ${err.message}`));
        }
      });
    });
  }

  /** Kill a running tunnel for a hosted project. */
  disableTunnel(projectPath: string): void {
    const resolved = resolvePath(projectPath);
    const proc = this.tunnelProcesses.get(resolved);
    if (!proc) return;

    try { proc.kill(); } catch { /* already dead */ }
    this.tunnelProcesses.delete(resolved);

    const hosted = this.projects.get(resolved);
    if (hosted) {
      hosted.tunnelUrl = null;
      hosted.tunnelPid = null;
      hosted.meta.tunnelUrl = null;
      this.writeHostingMeta(resolved, hosted.meta);
      this.log.info(`[${hosted.meta.hostname}] tunnel disabled`);
    }
    this.notifyStatusChange();
  }

  // -------------------------------------------------------------------------
  // Stack management
  // -------------------------------------------------------------------------

  /**
   * Add a stack to a project. For DB stacks with shared containers,
   * delegates to SharedContainerManager.
   */
  async addStack(projectPath: string, stackId: string): Promise<ProjectStackInstance> {
    const resolved = resolvePath(projectPath);
    if (!this.stackReg) throw new Error("Stack registry not available");

    const def = this.stackReg.get(stackId);
    if (!def) throw new Error(`Stack "${stackId}" not found in registry`);

    let databaseName: string | undefined;
    let databaseUser: string | undefined;
    let databasePassword: string | undefined;

    // Handle shared DB containers
    if (def.containerConfig?.shared && this.sharedContainers) {
      const hosted = this.projects.get(resolved);
      const hostname = hosted?.meta.hostname ?? this.slugFromPath(resolved);

      const result = await this.sharedContainers.addProject(
        def.containerConfig.sharedKey!,
        resolved,
        hostname,
        def.containerConfig,
        def.databaseConfig,
      );

      databaseName = result.databaseName;
      databaseUser = result.databaseUser;
      databasePassword = result.databasePassword;
    }

    const instance: ProjectStackInstance = {
      stackId,
      databaseName,
      databaseUser,
      databasePassword,
      addedAt: new Date().toISOString(),
    };

    // Persist to ~/.agi/{slug}/project.json
    this.writeStackInstance(resolved, instance);

    // Auto-run install actions sequentially
    const actionResults = await this.runInstallActions(resolved, def);

    this.notifyStatusChange();

    return { ...instance, actionResults } as ProjectStackInstance & { actionResults?: InstallActionResult[] };
  }

  /** Run install actions for a stack definition in the given project directory. */
  private async runInstallActions(projectPath: string, def: StackDefinition): Promise<InstallActionResult[]> {
    if (!def.installActions || def.installActions.length === 0) return [];
    const results: InstallActionResult[] = [];

    for (const action of def.installActions) {
      try {
        this.log.info(`[${def.id}] running action: ${action.label} (${action.id})`);
        execSync(action.command, {
          cwd: projectPath,
          timeout: 120_000,
          stdio: "pipe",
          env: { ...process.env },
        });
        results.push({ actionId: action.id, ok: true });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.log.warn(`[${def.id}] action "${action.id}" failed: ${msg}`);
        results.push({ actionId: action.id, ok: false, error: msg });
        if (!action.optional) break;
      }
    }

    return results;
  }

  /** Run a single install action by ID for a stack on a project. */
  async runStackAction(projectPath: string, stackId: string, actionId: string): Promise<InstallActionResult> {
    const resolved = resolvePath(projectPath);
    if (!this.stackReg) throw new Error("Stack registry not available");

    const def = this.stackReg.get(stackId);
    if (!def) throw new Error(`Stack "${stackId}" not found in registry`);

    const action = def.installActions?.find((a) => a.id === actionId);
    if (!action) throw new Error(`Action "${actionId}" not found in stack "${stackId}"`);

    try {
      this.log.info(`[${stackId}] re-running action: ${action.label} (${action.id})`);
      const output = execSync(action.command, {
        cwd: resolved,
        timeout: 120_000,
        stdio: "pipe",
        env: { ...process.env },
      });
      return { actionId: action.id, ok: true, output: output.toString().slice(0, 4096) };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { actionId: action.id, ok: false, error: msg };
    }
  }

  /** Get aggregated dev commands from all installed stacks for a project. */
  getProjectDevCommands(projectPath: string): Record<string, string> {
    const resolved = resolvePath(projectPath);
    if (!this.stackReg) return {};

    const stacks = this.getProjectStacks(resolved);
    const merged: Record<string, string> = {};

    for (const instance of stacks) {
      const def = this.stackReg.get(instance.stackId);
      if (!def?.devCommands) continue;
      for (const [key, cmd] of Object.entries(def.devCommands)) {
        if (cmd && !merged[key]) merged[key] = cmd;
      }
    }

    return merged;
  }

  /**
   * Remove a stack from a project. Tears down DB if applicable,
   * removes from shared container.
   */
  async removeStack(projectPath: string, stackId: string): Promise<void> {
    const resolved = resolvePath(projectPath);
    if (!this.stackReg) throw new Error("Stack registry not available");

    const def = this.stackReg.get(stackId);
    const stacks = this.getProjectStacks(resolved);
    const instance = stacks.find((s) => s.stackId === stackId);
    if (!instance) return;

    // Handle shared DB container teardown
    if (def?.containerConfig?.shared && this.sharedContainers && def.databaseConfig) {
      const hosted = this.projects.get(resolved);
      const hostname = hosted?.meta.hostname ?? this.slugFromPath(resolved);
      const port = this.sharedContainers.has(def.containerConfig.sharedKey!)
        ? 0 : 0; // Port is managed internally by SharedContainerManager

      const ctx: StackContainerContext = {
        projectPath: resolved,
        projectHostname: hostname,
        allocatedPort: port,
        databaseName: instance.databaseName,
        databaseUser: instance.databaseUser,
        databasePassword: instance.databasePassword,
        mode: "development",
      };

      await this.sharedContainers.removeProject(
        def.containerConfig.sharedKey!,
        resolved,
        def.databaseConfig,
        ctx,
      );
    }

    // Remove from ~/.agi/{slug}/project.json
    this.removeStackInstance(resolved, stackId);
    this.notifyStatusChange();
  }

  /** Get all stack instances for a project. */
  getProjectStacks(projectPath: string): ProjectStackInstance[] {
    // Delegate to ProjectConfigManager when available
    if (this.configMgr) {
      return this.configMgr.getStacks(projectPath);
    }

    // Legacy fallback
    const resolved = resolvePath(projectPath);
    const metaPath = projectConfigPath(resolved);
    if (!existsSync(metaPath)) return [];
    try {
      const raw = JSON.parse(readFileSync(metaPath, "utf-8")) as Record<string, unknown>;
      const hosting = raw.hosting as Record<string, unknown> | undefined;
      const stacks = hosting?.stacks as ProjectStackInstance[] | undefined;
      return stacks ?? [];
    } catch {
      return [];
    }
  }

  private writeStackInstance(projectPath: string, instance: ProjectStackInstance): void {
    // Delegate to ProjectConfigManager when available
    if (this.configMgr) {
      void this.configMgr.addStack(projectPath, instance);
      return;
    }

    // Legacy fallback
    const metaPath = projectConfigPath(projectPath);
    let existing: Record<string, unknown> = {};
    if (existsSync(metaPath)) {
      try {
        existing = JSON.parse(readFileSync(metaPath, "utf-8")) as Record<string, unknown>;
      } catch { /* start fresh */ }
    }

    const hosting = (existing.hosting ?? {}) as Record<string, unknown>;
    const stacks = (hosting.stacks ?? []) as ProjectStackInstance[];
    stacks.push(instance);
    hosting.stacks = stacks;
    existing.hosting = hosting;
    mkdirSync(dirname(metaPath), { recursive: true });
    writeFileSync(metaPath, JSON.stringify(existing, null, 2) + "\n", "utf-8");
  }

  private removeStackInstance(projectPath: string, stackId: string): void {
    // Delegate to ProjectConfigManager when available
    if (this.configMgr) {
      void this.configMgr.removeStack(projectPath, stackId);
      return;
    }

    // Legacy fallback
    const metaPath = projectConfigPath(projectPath);
    if (!existsSync(metaPath)) return;
    try {
      const existing = JSON.parse(readFileSync(metaPath, "utf-8")) as Record<string, unknown>;
      const hosting = (existing.hosting ?? {}) as Record<string, unknown>;
      const stacks = (hosting.stacks ?? []) as ProjectStackInstance[];
      hosting.stacks = stacks.filter((s) => s.stackId !== stackId);
      existing.hosting = hosting;
      mkdirSync(dirname(metaPath), { recursive: true });
      writeFileSync(metaPath, JSON.stringify(existing, null, 2) + "\n", "utf-8");
    } catch { /* ignore */ }
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private notifyStatusChange(): void {
    if (this.onStatusChange) {
      this.onStatusChange();
    }
  }
}
