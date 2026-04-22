/**
 * Project Tools — manage_project
 *
 * Single tool with action discriminator: list, create, update, info.
 * Reuses logic from the REST API endpoints in server-runtime-state.ts.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { execSync, spawnSync } from "node:child_process";
import { basename, dirname, join, resolve as resolvePath } from "node:path";
import type { ToolHandler } from "../tool-registry.js";
import { projectConfigPath } from "../project-config-path.js";
import type { ProjectConfigManager } from "../project-config-manager.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SACRED_PROJECT_NAMES = new Set(["agi", "prime", "id", "marketplace", "mapp-marketplace"]);

function isSacredProjectPath(pathStr: string): boolean {
  return SACRED_PROJECT_NAMES.has(basename(pathStr).toLowerCase());
}

export interface ProjectToolConfig {
  projectDirs: string[];
  /** ProjectConfigManager for validated config operations. */
  projectConfigManager?: ProjectConfigManager;
  /** Late-bound hosting manager for URLs, container status, tunnels. */
  hostingManager?: {
    getProjectHostingInfo(path: string): unknown;
    getProjectDevCommands(path: string): Record<string, string>;
    detectProjectDefaults(path: string): { projectType: string; docRoot: string; startCommand: string | null };
    enableProject(path: string, meta: unknown): Promise<void>;
    disableProject(path: string): Promise<void>;
    restartProject(path: string): { ok: boolean; error?: string };
    regenerateCaddyfile(): void;
  };
  /** Late-bound stack registry for stack definitions. */
  stackRegistry?: { get(id: string): { id: string; label: string; description: string; category: string } | undefined };
  /** Late-bound MApp registry for MagicApp definitions. */
  mappRegistry?: { get(id: string): { id: string; name: string; description: string; category: string; version: string } | undefined };
  /** Hosting base domain (e.g. "ai.on"). */
  baseDomain?: string;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export function createManageProjectHandler(config: ProjectToolConfig): ToolHandler {
  return async (input: Record<string, unknown>): Promise<string> => {
    const action = String(input.action ?? "");

    if (action === "list") {
      return handleList(config);
    }
    if (action === "create") {
      return handleCreate(config, input);
    }
    if (action === "update") {
      return handleUpdate(config, input);
    }
    if (action === "info") {
      return handleInfo(config, input);
    }
    if (action === "delete") {
      return handleDelete(config, input);
    }
    if (action === "host") {
      return handleHost(config, input);
    }
    if (action === "unhost") {
      return handleUnhost(config, input);
    }
    if (action === "restart") {
      return handleRestart(config, input);
    }
    if (action === "diagnose") {
      return handleDiagnose(config, input);
    }

    return JSON.stringify({ error: `Unknown action: ${action}. Use "list", "create", "update", "info", "delete", "host", "unhost", "restart", or "diagnose".` });
  };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function handleList(config: ProjectToolConfig): string {
  const projects: { name: string; path: string; hasGit: boolean; tynnToken: string | null }[] = [];
  const mgr = config.projectConfigManager;

  for (const dir of config.projectDirs) {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith(".")) continue;
        const fullPath = resolvePath(dir, entry.name);
        const hasGit = existsSync(join(fullPath, ".git"));
        let tynnToken: string | null = null;

        if (mgr) {
          const cfg = mgr.read(fullPath);
          tynnToken = cfg?.tynnToken ?? null;
        } else {
          const metaPath = projectConfigPath(fullPath);
          if (existsSync(metaPath)) {
            try {
              const meta = JSON.parse(readFileSync(metaPath, "utf-8")) as { tynnToken?: string; name?: string };
              tynnToken = meta.tynnToken ?? null;
            } catch { /* ignore malformed metadata */ }
          }
        }
        projects.push({ name: entry.name, path: fullPath, hasGit, tynnToken });
      }
    } catch { /* directory may not exist */ }
  }

  return JSON.stringify({ projects });
}

function handleCreate(config: ProjectToolConfig, input: Record<string, unknown>): string {
  if (config.projectDirs.length === 0) {
    return JSON.stringify({ error: "No workspace.projects directories configured" });
  }

  const name = input.name ? String(input.name).trim() : "";
  if (name.length === 0) {
    return JSON.stringify({ error: "Project name is required" });
  }

  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  if (slug.length === 0) {
    return JSON.stringify({ error: "Invalid project name" });
  }

  const targetDir = resolvePath(config.projectDirs[0]!, slug);
  if (existsSync(targetDir)) {
    return JSON.stringify({ error: `Project folder already exists: ${slug}` });
  }

  mkdirSync(targetDir, { recursive: true });

  // Clone repo if remote provided
  let cloned = false;
  const repoRemote = input.repoRemote ? String(input.repoRemote).trim() : "";
  if (repoRemote.length > 0) {
    try {
      execSync(`git clone ${JSON.stringify(repoRemote)} .`, {
        cwd: targetDir,
        stdio: "pipe",
        timeout: 60000,
      });
      cloned = true;
    } catch (err) {
      return JSON.stringify({
        error: `Folder created but git clone failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // Write metadata via ProjectConfigManager or legacy fallback
  const tynnToken = input.tynnToken ? String(input.tynnToken).trim() : "";
  const category = input.category ? String(input.category).trim() : "";
  const mgr = config.projectConfigManager;

  if (mgr) {
    const opts: Record<string, string> = {};
    if (tynnToken.length > 0) opts.tynnToken = tynnToken;
    if (category.length > 0) opts.category = category;
    mgr.create(targetDir, name, Object.keys(opts).length > 0 ? opts : undefined);
  } else {
    const meta: Record<string, unknown> = { name, createdAt: new Date().toISOString() };
    if (tynnToken.length > 0) {
      meta.tynnToken = tynnToken;
    }
    const createMetaPath = projectConfigPath(targetDir);
    mkdirSync(dirname(createMetaPath), { recursive: true });
    writeFileSync(createMetaPath, JSON.stringify(meta, null, 2) + "\n", "utf-8");
  }

  const hasGit = cloned || existsSync(join(targetDir, ".git"));

  // Read hosting config to provide the project URL
  const baseDomain = "ai.on"; // TODO: read from config
  const projectUrl = `https://${slug.replace(/_/g, "-")}.${baseDomain}`;

  return JSON.stringify({
    ok: true,
    name,
    slug,
    path: targetDir,
    cloned,
    hasGit,
    hosting: {
      url: projectUrl,
      status: "not started",
    },
    hint: `Project created. Next: write your code to ${targetDir}, then call manage_project with action "host" and path "${targetDir}" to start the container. The app will be at ${projectUrl}. NEVER run npm/node/python directly.`,
  });
}

function handleUpdate(config: ProjectToolConfig, input: Record<string, unknown>): string {
  const pathStr = input.path ? String(input.path) : "";
  if (pathStr.length === 0) {
    return JSON.stringify({ error: "path is required" });
  }

  const targetPath = resolvePath(pathStr);
  const isInWorkspace = config.projectDirs.some((dir) => targetPath.startsWith(resolvePath(dir)));
  if (!isInWorkspace) {
    return JSON.stringify({ error: "Path is not inside a configured workspace.projects directory" });
  }
  if (!existsSync(targetPath) || !statSync(targetPath).isDirectory()) {
    return JSON.stringify({ error: "Project directory does not exist" });
  }
  if (isSacredProjectPath(targetPath)) {
    return JSON.stringify({ error: "Sacred projects cannot be modified" });
  }

  const mgr = config.projectConfigManager;

  if (mgr) {
    // Build patch from input
    const patch: Record<string, unknown> = {};
    const name = input.name !== undefined ? String(input.name).trim() : "";
    if (name.length > 0) patch.name = name;

    if (input.tynnToken === null || input.tynnToken === "null" || input.tynnToken === "") {
      patch.tynnToken = undefined; // Will be stripped on merge
    } else if (input.tynnToken !== undefined && typeof input.tynnToken === "string") {
      patch.tynnToken = input.tynnToken.trim();
    }

    void mgr.update(targetPath, patch);
    return JSON.stringify({ ok: true });
  }

  // Legacy fallback
  const updateMetaPath = projectConfigPath(targetPath);
  let meta: Record<string, unknown> = {};
  if (existsSync(updateMetaPath)) {
    try {
      meta = JSON.parse(readFileSync(updateMetaPath, "utf-8")) as Record<string, unknown>;
    } catch { /* start fresh if malformed */ }
  }

  const name = input.name !== undefined ? String(input.name).trim() : "";
  if (name.length > 0) {
    meta.name = name;
  }

  if (input.tynnToken === null || input.tynnToken === "null" || input.tynnToken === "") {
    delete meta.tynnToken;
  } else if (input.tynnToken !== undefined && typeof input.tynnToken === "string") {
    meta.tynnToken = input.tynnToken.trim();
  }

  mkdirSync(dirname(updateMetaPath), { recursive: true });
  writeFileSync(updateMetaPath, JSON.stringify(meta, null, 2) + "\n", "utf-8");
  return JSON.stringify({ ok: true });
}

function handleInfo(config: ProjectToolConfig, input: Record<string, unknown>): string {
  const pathStr = input.path ? String(input.path) : "";
  if (pathStr.length === 0) {
    return JSON.stringify({ error: "path is required" });
  }

  const targetPath = resolvePath(pathStr);
  const isInWorkspace = config.projectDirs.some((dir) => targetPath.startsWith(resolvePath(dir)));
  if (!isInWorkspace) {
    return JSON.stringify({ error: "Path is not inside a configured workspace.projects directory" });
  }
  if (!existsSync(targetPath) || !statSync(targetPath).isDirectory()) {
    return JSON.stringify({ error: "Project directory does not exist" });
  }

  // Git info
  const hasGit = existsSync(join(targetPath, ".git"));
  let branch: string | null = null;
  let remote: string | null = null;
  let gitStatus: "clean" | "dirty" | null = null;
  const commits: { hash: string; message: string }[] = [];

  if (hasGit) {
    try { branch = execSync(`git -C ${JSON.stringify(targetPath)} rev-parse --abbrev-ref HEAD`, { timeout: 5000, stdio: "pipe" }).toString().trim(); } catch { /* */ }
    try { remote = execSync(`git -C ${JSON.stringify(targetPath)} remote get-url origin`, { timeout: 5000, stdio: "pipe" }).toString().trim(); } catch { /* */ }
    try {
      const porcelain = execSync(`git -C ${JSON.stringify(targetPath)} status --porcelain`, { timeout: 5000, stdio: "pipe" }).toString().trim();
      gitStatus = porcelain.length === 0 ? "clean" : "dirty";
    } catch { /* */ }
    try {
      const logOutput = execSync(`git -C ${JSON.stringify(targetPath)} log --oneline -5`, { timeout: 5000, stdio: "pipe" }).toString().trim();
      if (logOutput.length > 0) {
        for (const line of logOutput.split("\n")) {
          const spaceIdx = line.indexOf(" ");
          if (spaceIdx > 0) commits.push({ hash: line.slice(0, spaceIdx), message: line.slice(spaceIdx + 1) });
        }
      }
    } catch { /* */ }
  }

  // Project config (name, category, description, type)
  let projectConfig: Record<string, unknown> | null = null;
  if (config.projectConfigManager) {
    try {
      const cfg = config.projectConfigManager.read(targetPath);
      if (cfg) {
        projectConfig = {
          name: cfg.name,
          category: cfg.category ?? null,
          type: cfg.type ?? null,
          description: cfg.description ?? null,
          tynnToken: cfg.tynnToken ?? null,
        };
      }
    } catch { /* */ }
  }

  // Hosting info (local URL, tunnel URL, container status)
  let hosting: Record<string, unknown> | null = null;
  if (config.hostingManager) {
    try {
      const info = config.hostingManager.getProjectHostingInfo(targetPath) as {
        enabled?: boolean;
        hostname?: string;
        status?: string;
        url?: string | null;
        tunnelUrl?: string | null;
        port?: number | null;
        internalPort?: number | null;
        mode?: string;
        containerName?: string;
        viewer?: string | null;
        error?: string;
      } | null;
      if (info) {
        hosting = {
          enabled: info.enabled ?? false,
          status: info.status ?? "unconfigured",
          localUrl: info.url ?? null,
          tunnelUrl: info.tunnelUrl ?? null,
          hostname: info.hostname ?? null,
          port: info.port ?? null,
          mode: info.mode ?? null,
          containerName: info.containerName ?? null,
          viewer: info.viewer ?? null,
        };
      }
    } catch { /* */ }
  }

  // Dev commands from stacks
  let devCommands: Record<string, string> | null = null;
  if (config.hostingManager) {
    try {
      const cmds = config.hostingManager.getProjectDevCommands(targetPath);
      if (Object.keys(cmds).length > 0) devCommands = cmds;
    } catch { /* */ }
  }

  // Stacks attached to this project
  let stacks: Array<{ stackId: string; label: string; category: string; description: string }> | null = null;
  if (config.projectConfigManager && config.stackRegistry) {
    try {
      const stackInstances = config.projectConfigManager.getStacks(targetPath);
      if (stackInstances.length > 0) {
        stacks = stackInstances.map((si) => {
          const def = config.stackRegistry!.get(si.stackId);
          return {
            stackId: si.stackId,
            label: def?.label ?? si.stackId,
            category: def?.category ?? "unknown",
            description: def?.description ?? "",
          };
        });
      }
    } catch { /* */ }
  }

  // MagicApps attached to this project
  let magicApps: Array<{ id: string; name: string; category: string; description: string }> | null = null;
  if (config.projectConfigManager && config.mappRegistry) {
    try {
      const cfg = config.projectConfigManager.read(targetPath);
      const appIds = cfg?.magicApps ?? [];
      if (appIds.length > 0) {
        magicApps = appIds.map((id: string) => {
          const def = config.mappRegistry!.get(id);
          return {
            id,
            name: def?.name ?? id,
            category: def?.category ?? "unknown",
            description: def?.description ?? "",
          };
        });
      }
    } catch { /* */ }
  }

  // Generate a contextual hint based on container state
  const hostingEnabled = (hosting as Record<string, unknown> | null)?.enabled === true;
  const hostingStatus = String((hosting as Record<string, unknown> | null)?.status ?? "unconfigured");
  let hint: string;
  if (!hostingEnabled) {
    hint = `Hosting is not enabled. Use manage_project action "host" with path "${targetPath}" to start the container.`;
  } else if (hostingStatus === "running") {
    const url = (hosting as Record<string, unknown>).localUrl as string | null;
    hint = `Container is running. Project is live at ${url ?? "URL unavailable"}. Use "restart" after code changes.`;
  } else if (hostingStatus === "error") {
    hint = `Container has an error. Try manage_project action "restart" with path "${targetPath}".`;
  } else if (hostingStatus === "stopped" || hostingStatus === "exited") {
    hint = `Container is stopped. Use manage_project action "host" with path "${targetPath}" to start it.`;
  } else {
    hint = `Container status: ${hostingStatus}. Use "info" to re-check.`;
  }

  return JSON.stringify({
    path: targetPath,
    config: projectConfig,
    git: { branch, remote, status: gitStatus, commits },
    hosting,
    devCommands,
    stacks,
    magicApps,
    hint,
  });
}

function handleDelete(config: ProjectToolConfig, input: Record<string, unknown>): string {
  const pathStr = input.path ? String(input.path) : "";
  if (pathStr.length === 0) {
    return JSON.stringify({ error: "path is required" });
  }

  const targetPath = resolvePath(pathStr);
  const isInWorkspace = config.projectDirs.some((dir) => targetPath.startsWith(resolvePath(dir)));
  if (!isInWorkspace) {
    return JSON.stringify({ error: "Path is not inside a configured workspace.projects directory" });
  }
  if (!existsSync(targetPath) || !statSync(targetPath).isDirectory()) {
    return JSON.stringify({ error: "Project directory does not exist" });
  }
  if (isSacredProjectPath(targetPath)) {
    return JSON.stringify({ error: "Sacred projects cannot be deleted" });
  }

  if (input.confirm !== true) {
    return JSON.stringify({
      error: 'confirm must be true to delete a project. This will permanently remove the directory and all its contents.',
    });
  }

  rmSync(targetPath, { recursive: true, force: true });
  return JSON.stringify({ ok: true, path: targetPath, deleted: true });
}

// ---------------------------------------------------------------------------
// Host / Unhost / Restart
// ---------------------------------------------------------------------------

async function handleHost(config: ProjectToolConfig, input: Record<string, unknown>): Promise<string> {
  const pathStr = input.path ? String(input.path) : "";
  if (!pathStr) return JSON.stringify({ error: "path is required" });
  if (!config.hostingManager) return JSON.stringify({ error: "Hosting manager not available" });

  const targetPath = resolvePath(pathStr);
  const detected = config.hostingManager.detectProjectDefaults(targetPath);
  const slug = basename(targetPath).toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const baseDomain = config.baseDomain ?? "ai.on";

  const meta = {
    enabled: true,
    type: (input.type as string) ?? detected.projectType,
    hostname: (input.hostname as string) ?? slug,
    docRoot: (input.docRoot as string) ?? detected.docRoot,
    startCommand: (input.startCommand as string) ?? detected.startCommand,
    port: null,
    mode: ((input.mode as string) ?? "production") as "production" | "development",
    internalPort: input.internalPort ? Number(input.internalPort) : null,
    runtimeId: (input.runtimeId as string) ?? null,
  };

  try {
    await config.hostingManager.enableProject(targetPath, meta);
    config.hostingManager.regenerateCaddyfile();
    const info = config.hostingManager.getProjectHostingInfo(targetPath) as Record<string, unknown> | null;
    return JSON.stringify({
      ok: true,
      hosting: {
        enabled: true,
        url: `https://${meta.hostname}.${baseDomain}`,
        status: info?.status ?? "starting",
        containerName: info?.containerName ?? null,
      },
      hint: `Container is starting. The project will be available at https://${meta.hostname}.${baseDomain} once the container is ready.`,
    });
  } catch (err) {
    return JSON.stringify({ error: `Failed to enable hosting: ${err instanceof Error ? err.message : String(err)}` });
  }
}

async function handleUnhost(config: ProjectToolConfig, input: Record<string, unknown>): Promise<string> {
  const pathStr = input.path ? String(input.path) : "";
  if (!pathStr) return JSON.stringify({ error: "path is required" });
  if (!config.hostingManager) return JSON.stringify({ error: "Hosting manager not available" });

  try {
    await config.hostingManager.disableProject(resolvePath(pathStr));
    config.hostingManager.regenerateCaddyfile();
    return JSON.stringify({ ok: true, hint: "Hosting disabled. Container stopped." });
  } catch (err) {
    return JSON.stringify({ error: `Failed to disable hosting: ${err instanceof Error ? err.message : String(err)}` });
  }
}

function handleRestart(config: ProjectToolConfig, input: Record<string, unknown>): string {
  const pathStr = input.path ? String(input.path) : "";
  if (!pathStr) return JSON.stringify({ error: "path is required" });
  if (!config.hostingManager) return JSON.stringify({ error: "Hosting manager not available" });

  const result = config.hostingManager.restartProject(resolvePath(pathStr));
  if (result.ok) {
    const slug = basename(resolvePath(pathStr)).toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const baseDomain = config.baseDomain ?? "ai.on";
    return JSON.stringify({ ok: true, hint: `Container restarted. Project available at https://${slug}.${baseDomain}` });
  }
  return JSON.stringify({ error: result.error ?? "Restart failed" });
}

// ---------------------------------------------------------------------------
// Failure class signals used by diagnose
// ---------------------------------------------------------------------------

interface DiagnoseResult {
  class: string;
  message: string;
  remediation: string;
  rawLogTail: string;
}

const FAILURE_PATTERNS: Array<{
  pattern: RegExp;
  class: string;
  message: string;
  remediation: string;
}> = [
  {
    pattern: /ENOSPC|no space left on device|disk quota exceeded/i,
    class: "disk_full",
    message: "Disk space exhausted on host",
    remediation: "Free disk space on the host (check `df -h`). Remove unused container images with `podman image prune -a`.",
  },
  {
    pattern: /EADDRINUSE|address already in use|bind.*EADDRINUSE/i,
    class: "port_conflict",
    message: "Port already in use",
    remediation: "Another process or container is bound to the same port. Check `ss -tlnp` and stop the conflicting process, or change the project's port in hosting config.",
  },
  {
    pattern: /Cannot find module|MODULE_NOT_FOUND|No such file.*dist\/|missing.*dist\//i,
    class: "missing_build_artifact",
    message: "Build artifact missing",
    remediation: "The container cannot find compiled output. Run the project build (e.g., `pnpm build` or `npm run build`) in the project directory, then restart the container.",
  },
  {
    pattern: /Killed|OOM kill|Out of memory|memory limit exceeded/i,
    class: "oom_killed",
    message: "Container killed by OOM (out-of-memory)",
    remediation: "The container exceeded its memory limit. Increase the container memory limit in hosting config, or reduce the application's memory usage.",
  },
  {
    pattern: /ECONNREFUSED|connection refused|connect ECONNREFUSED/i,
    class: "connection_refused",
    message: "Dependency connection refused",
    remediation: "The application tried to connect to a service (database, Redis, etc.) that is not reachable. Verify that dependent services are running and reachable from the container.",
  },
  {
    pattern: /permission denied|EACCES|EPERM/i,
    class: "permission_denied",
    message: "File or socket permission denied",
    remediation: "The container process does not have permission to access a file or socket. Check that the working directory and all required files are readable/writable by the container user.",
  },
];

function handleDiagnose(config: ProjectToolConfig, input: Record<string, unknown>): string {
  const pathStr = input.path ? String(input.path) : "";
  if (!pathStr) return JSON.stringify({ error: "path is required" });
  if (!config.hostingManager) return JSON.stringify({ error: "Hosting manager not available" });

  const targetPath = resolvePath(pathStr);
  const info = config.hostingManager.getProjectHostingInfo(targetPath) as {
    enabled?: boolean;
    containerName?: string;
    status?: string;
  } | null;

  if (!info?.enabled) {
    return JSON.stringify({ error: "Project is not hosted. Enable hosting first with the 'host' action." });
  }

  const containerName = info.containerName;
  if (!containerName) {
    return JSON.stringify({ error: "Could not determine container name for this project." });
  }

  // Fetch last 50 lines of container logs via spawnSync (no shell, no injection risk)
  let rawLogTail = "";
  const logsResult = spawnSync("podman", ["logs", "--tail", "50", containerName], {
    timeout: 15000,
    encoding: "utf8",
  });
  rawLogTail = ((logsResult.stdout ?? "") + (logsResult.stderr ?? "")).trim();

  // Check dmesg for OOM kills (non-fatal — may require elevated permissions)
  let dmesgOom = "";
  try {
    const dmesgResult = spawnSync("dmesg", ["--time-format", "iso"], {
      timeout: 8000,
      encoding: "utf8",
    });
    const dmesgOutput = dmesgResult.stdout ?? "";
    dmesgOom = dmesgOutput
      .split("\n")
      .filter((line) => /oom|killed process/i.test(line))
      .slice(-5)
      .join("\n");
  } catch { /* dmesg access may be restricted — non-fatal */ }

  const combinedLog = `${rawLogTail}\n${dmesgOom}`.trim();

  // Match against failure patterns (first match wins)
  for (const fp of FAILURE_PATTERNS) {
    if (fp.pattern.test(combinedLog)) {
      const result: DiagnoseResult = {
        class: fp.class,
        message: fp.message,
        remediation: fp.remediation,
        rawLogTail: rawLogTail.slice(-3000), // cap at ~3 KB for token budget
      };
      return JSON.stringify(result);
    }
  }

  // Check container status for generic exit
  const containerStatus = info.status ?? "unknown";
  if (containerStatus === "exited" || containerStatus === "stopped") {
    const result: DiagnoseResult = {
      class: "container_exited",
      message: `Container exited (status: ${containerStatus}) — no recognised failure pattern found`,
      remediation: "Review the raw log tail below for clues. Common causes: uncaught exception at startup, missing environment variable, or broken entrypoint. Use 'restart' after fixing the root cause.",
      rawLogTail: rawLogTail.slice(-3000),
    };
    return JSON.stringify(result);
  }

  // Container appears healthy — surface status + recent logs
  return JSON.stringify({
    class: "healthy",
    message: `Container is in '${containerStatus}' state with no error patterns in recent logs`,
    remediation: "No action needed. If the project is inaccessible, check DNS and Caddy routing.",
    rawLogTail: rawLogTail.slice(-3000),
  });
}

// ---------------------------------------------------------------------------
// Manifest + Input Schema
// ---------------------------------------------------------------------------

export const MANAGE_PROJECT_MANIFEST = {
  name: "manage_project",
  description:
    "Manage workspace projects: list, create, update, info, delete, host, unhost, restart, diagnose. " +
    "IMPORTANT: Projects run in Podman containers at https://{slug}.ai.on — NOT localhost. " +
    "After 'create', use 'host' to start the container. Use 'restart' after code changes. " +
    "Use 'info' to check container status and get the URL. " +
    "Use 'diagnose' when a container is broken — it reads logs and classifies the failure class. " +
    "NEVER run npm/node/python directly on the host. " +
    "Aion-only: workers cannot mutate project configuration and must request changes via taskmaster_handoff.",
  requiresState: ["ONLINE" as const],
  requiresTier: ["verified" as const, "sealed" as const],
  agentOnly: true as const,
};

export const MANAGE_PROJECT_INPUT_SCHEMA = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["list", "create", "update", "info", "delete", "host", "unhost", "restart", "diagnose"],
      description: 'Project operation. After create, use "host" to start the container. Use "restart" after code changes. Use "diagnose" when a container is failing to identify the failure class and remediation.',
    },
    name: {
      type: "string",
      description: "Project name (for create and update)",
    },
    path: {
      type: "string",
      description: "Project path (for update and info)",
    },
    tynnToken: {
      type: "string",
      description: "Tynn project token (for create and update; empty string or null to clear)",
    },
    repoRemote: {
      type: "string",
      description: "Git clone URL (for create only)",
    },
    category: {
      type: "string",
      enum: ["web", "app", "literature", "media", "administration", "ops", "monorepo"],
      description: 'Project category (for create). Administrative projects are not locally hosted.',
    },
    confirm: {
      type: "boolean",
      description: "Must be true to confirm destructive delete (for delete only)",
    },
  },
  required: ["action"],
};
