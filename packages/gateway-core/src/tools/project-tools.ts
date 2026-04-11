/**
 * Project Tools — manage_project
 *
 * Single tool with action discriminator: list, create, update, info.
 * Reuses logic from the REST API endpoints in server-runtime-state.ts.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { basename, dirname, join, resolve as resolvePath } from "node:path";
import type { ToolHandler } from "../tool-registry.js";
import { projectConfigPath } from "../project-config-path.js";
import type { ProjectConfigManager } from "../project-config-manager.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SACRED_PROJECT_NAMES = new Set(["agi", "prime", "bots", "id"]);

function isSacredProjectPath(pathStr: string): boolean {
  return SACRED_PROJECT_NAMES.has(basename(pathStr).toLowerCase());
}

export interface ProjectToolConfig {
  projectDirs: string[];
  /** ProjectConfigManager for validated config operations. */
  projectConfigManager?: ProjectConfigManager;
  /** Late-bound hosting manager for URLs, container status, tunnels. */
  hostingManager?: { getProjectHostingInfo(path: string): unknown; getProjectDevCommands(path: string): Record<string, string> };
  /** Late-bound stack registry for stack definitions. */
  stackRegistry?: { get(id: string): { id: string; label: string; description: string; category: string } | undefined };
  /** Late-bound MApp registry for MagicApp definitions. */
  mappRegistry?: { get(id: string): { id: string; name: string; description: string; category: string; version: string } | undefined };
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

    return JSON.stringify({ error: `Unknown action: ${action}. Use "list", "create", "update", "info", or "delete".` });
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
  return JSON.stringify({ ok: true, name, slug, path: targetDir, cloned, hasGit });
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

  return JSON.stringify({
    path: targetPath,
    config: projectConfig,
    git: { branch, remote, status: gitStatus, commits },
    hosting,
    devCommands,
    stacks,
    magicApps,
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
// Manifest + Input Schema
// ---------------------------------------------------------------------------

export const MANAGE_PROJECT_MANIFEST = {
  name: "manage_project",
  description:
    "Manage workspace projects. Actions: list (all projects), create (new project with optional git clone), " +
    "update (rename or set tynnToken), info (git branch, remote, status, recent commits), " +
    "delete (permanently remove a project directory — requires confirm: true).",
  requiresState: ["ONLINE" as const],
  requiresTier: ["verified" as const, "sealed" as const],
};

export const MANAGE_PROJECT_INPUT_SCHEMA = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["list", "create", "update", "info", "delete"],
      description: 'Project operation: "list", "create", "update", "info", or "delete"',
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
