/**
 * Agent Tools — system management capabilities for the Aionima agent
 *
 * Six consolidated tools using the action discriminator pattern:
 *   manage_marketplace — search, install, uninstall, sources management
 *   manage_plugins     — list, enable, disable plugins
 *   manage_config      — read, write, patch system configuration
 *   manage_stacks      — list, get, add, remove technology stacks
 *   manage_system      — status, upgrade
 *   manage_hosting     — enable, disable, restart, status
 *
 * These are core agent capabilities — registered directly on the ToolRegistry
 * during gateway boot, not via the plugin system.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { execSync, spawn } from "node:child_process";
import { join } from "node:path";
import * as os from "node:os";
import type { ToolHandler } from "../tool-registry.js";
import type { MarketplaceManager } from "@aionima/marketplace";
import type { PluginRegistry } from "@aionima/plugins";
import type { StackRegistry } from "../stack-registry.js";
import type { HostingManager, ProjectHostingMeta } from "../hosting-manager.js";
import type { SystemConfigService } from "../system-config-service.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface AgentToolsConfig {
  /** Path to gateway.json config file. */
  configPath?: string;
  /** MarketplaceManager instance for catalog/install operations. */
  marketplaceManager?: MarketplaceManager;
  /** PluginRegistry for listing loaded plugins. */
  pluginRegistry?: PluginRegistry;
  /** Plugin preferences from config (enabled/disabled state). */
  pluginPrefs?: Record<string, { enabled?: boolean; priority?: number }>;
  /** Discovered plugin metadata (id, name, version, etc). */
  discoveredPlugins?: Array<{
    id: string;
    name: string;
    version: string;
    description: string;
    category: string;
    provides?: string[];
    depends?: string[];
    basePath: string;
    bakedIn: boolean;
    disableable: boolean;
  }>;
  /** StackRegistry for listing technology stacks. */
  stackRegistry?: StackRegistry;
  /** HostingManager for project hosting operations. */
  hostingManager?: HostingManager;
  /** Workspace project directories. */
  projectDirs?: string[];
  /** Path to the AGI repo (for system upgrade). */
  selfRepoPath?: string;
  /** SystemConfigService for validated config operations. */
  systemConfigService?: SystemConfigService;
  /** MAppRegistry for MApp builder tools. */
  mappRegistry?: import("../mapp-registry.js").MAppRegistry;
}

// ---------------------------------------------------------------------------
// manage_marketplace
// ---------------------------------------------------------------------------

export function createManageMarketplaceHandler(config: AgentToolsConfig): ToolHandler {
  return async (input: Record<string, unknown>): Promise<string> => {
    const mp = config.marketplaceManager;
    if (!mp) {
      return JSON.stringify({ error: "Marketplace not available" });
    }

    const action = String(input.action ?? "");

    if (action === "search") {
      const items = mp.searchCatalog({
        q: input.q ? String(input.q) : undefined,
        type: input.type ? String(input.type) : undefined,
        category: input.category ? String(input.category) : undefined,
      });
      return JSON.stringify({ items });
    }

    if (action === "install") {
      const pluginName = input.pluginName ? String(input.pluginName) : "";
      const sourceId = typeof input.sourceId === "number" ? input.sourceId : undefined;
      if (!pluginName || sourceId === undefined) {
        return JSON.stringify({ error: "pluginName and sourceId are required" });
      }
      const result = await mp.install(pluginName, sourceId);
      return JSON.stringify(result);
    }

    if (action === "uninstall") {
      const pluginName = input.pluginName ? String(input.pluginName) : "";
      if (!pluginName) {
        return JSON.stringify({ error: "pluginName is required" });
      }
      const result = mp.uninstall(pluginName);
      return JSON.stringify(result);
    }

    if (action === "list_sources") {
      return JSON.stringify({ sources: mp.getSources() });
    }

    if (action === "add_source") {
      const ref = input.ref ? String(input.ref) : "";
      if (!ref) {
        return JSON.stringify({ error: "ref is required (e.g. 'owner/repo' or URL)" });
      }
      try {
        const source = mp.addSource(ref, input.name ? String(input.name) : undefined);
        return JSON.stringify(source);
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    }

    if (action === "sync_source") {
      const sourceId = typeof input.sourceId === "number" ? input.sourceId : undefined;
      if (sourceId === undefined) {
        return JSON.stringify({ error: "sourceId is required" });
      }
      const result = await mp.syncSource(sourceId);
      return JSON.stringify(result);
    }

    if (action === "list_installed") {
      return JSON.stringify({ installed: mp.getInstalled() });
    }

    if (action === "check_updates") {
      return JSON.stringify(mp.checkUpdates());
    }

    return JSON.stringify({
      error: `Unknown action: ${action}. Use "search", "install", "uninstall", "list_sources", "add_source", "sync_source", "list_installed", or "check_updates".`,
    });
  };
}

export const MANAGE_MARKETPLACE_MANIFEST = {
  name: "manage_marketplace",
  description:
    "Manage the plugin marketplace. Actions: search (query catalog), install (add plugin), uninstall (remove plugin), " +
    "list_sources (marketplace sources), add_source (add marketplace), sync_source (refresh catalog), " +
    "list_installed (installed plugins), check_updates (available updates).",
  requiresState: ["ONLINE" as const],
  requiresTier: ["verified" as const, "sealed" as const],
};

export const MANAGE_MARKETPLACE_INPUT_SCHEMA = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["search", "install", "uninstall", "list_sources", "add_source", "sync_source", "list_installed", "check_updates"],
      description: "Marketplace operation to perform",
    },
    q: { type: "string", description: "Search query (for search)" },
    type: { type: "string", description: "Filter by type: plugin, skill, knowledge, theme (for search)" },
    category: { type: "string", description: "Filter by category: runtime, service, tool, project (for search)" },
    pluginName: { type: "string", description: "Plugin name (for install/uninstall)" },
    sourceId: { type: "number", description: "Source ID (for install/sync_source)" },
    ref: { type: "string", description: "Marketplace reference e.g. 'owner/repo' or URL (for add_source)" },
    name: { type: "string", description: "Display name (for add_source)" },
  },
  required: ["action"],
};

// ---------------------------------------------------------------------------
// manage_plugins
// ---------------------------------------------------------------------------

export function createManagePluginsHandler(config: AgentToolsConfig): ToolHandler {
  return async (input: Record<string, unknown>): Promise<string> => {
    const action = String(input.action ?? "");

    if (action === "list") {
      const loadedPlugins = config.pluginRegistry?.getAll() ?? [];
      const allDiscovered = config.discoveredPlugins ?? [];
      const prefs = config.pluginPrefs;

      const plugins = allDiscovered.length > 0
        ? allDiscovered.map((d) => {
            const active = loadedPlugins.some((l) => l.manifest.id === d.id);
            return {
              id: d.id,
              name: d.name,
              version: d.version,
              description: d.description,
              category: d.category,
              active,
              enabled: prefs?.[d.id]?.enabled !== false,
              bakedIn: d.bakedIn,
              disableable: d.disableable,
            };
          })
        : loadedPlugins.map((p) => ({
            id: p.manifest.id,
            name: p.manifest.name,
            version: p.manifest.version,
            description: p.manifest.description,
            category: p.manifest.category ?? "tool",
            active: true,
            enabled: true,
            bakedIn: p.manifest.bakedIn ?? false,
            disableable: p.manifest.disableable ?? true,
          }));

      return JSON.stringify({ plugins });
    }

    if (action === "enable" || action === "disable") {
      const pluginId = input.pluginId ? String(input.pluginId) : "";
      if (!pluginId) {
        return JSON.stringify({ error: "pluginId is required" });
      }

      const svc = config.systemConfigService;
      if (!svc && !config.configPath) {
        return JSON.stringify({ error: "Config path not available" });
      }

      const enabled = action === "enable";

      // Reject disabling non-disableable baked-in plugins
      if (!enabled) {
        const target = config.discoveredPlugins?.find((d) => d.id === pluginId);
        if (target?.bakedIn && !target.disableable) {
          return JSON.stringify({ error: "This plugin cannot be disabled" });
        }
      }

      try {
        if (svc) {
          svc.patch(`plugins.${pluginId}.enabled`, enabled);
          return JSON.stringify({ ok: true, pluginId, enabled, requiresRestart: true });
        }

        // Legacy fallback
        const raw = JSON.parse(readFileSync(config.configPath!, "utf-8")) as Record<string, unknown>;
        const plugins = (raw.plugins ?? {}) as Record<string, { enabled?: boolean; priority?: number }>;
        if (!plugins[pluginId]) plugins[pluginId] = {};
        plugins[pluginId].enabled = enabled;
        raw.plugins = plugins;
        writeFileSync(config.configPath!, JSON.stringify(raw, null, 2) + "\n", "utf-8");
        return JSON.stringify({ ok: true, pluginId, enabled, requiresRestart: true });
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    }

    return JSON.stringify({
      error: `Unknown action: ${action}. Use "list", "enable", or "disable".`,
    });
  };
}

export const MANAGE_PLUGINS_MANIFEST = {
  name: "manage_plugins",
  description:
    "Manage system plugins. Actions: list (all plugins with active/enabled status), " +
    "enable (activate a plugin), disable (deactivate a plugin). Enable/disable requires restart.",
  requiresState: ["ONLINE" as const],
  requiresTier: ["verified" as const, "sealed" as const],
};

export const MANAGE_PLUGINS_INPUT_SCHEMA = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["list", "enable", "disable"],
      description: "Plugin operation to perform",
    },
    pluginId: {
      type: "string",
      description: "Plugin ID (for enable/disable)",
    },
  },
  required: ["action"],
};

// ---------------------------------------------------------------------------
// manage_config
// ---------------------------------------------------------------------------

export function createManageConfigHandler(config: AgentToolsConfig): ToolHandler {
  return async (input: Record<string, unknown>): Promise<string> => {
    const svc = config.systemConfigService;
    if (!svc && !config.configPath) {
      return JSON.stringify({ error: "Config path not available" });
    }

    const action = String(input.action ?? "");

    if (action === "read") {
      try {
        if (svc) {
          if (input.key && typeof input.key === "string") {
            const value = svc.readKey(input.key);
            return JSON.stringify({ key: input.key, value });
          }
          return JSON.stringify(svc.read());
        }

        // Legacy fallback
        const raw = readFileSync(config.configPath!, "utf-8");
        const parsed: unknown = JSON.parse(raw);

        if (input.key && typeof input.key === "string") {
          const parts = input.key.split(".");
          let current: unknown = parsed;
          for (const part of parts) {
            if (typeof current !== "object" || current === null) {
              return JSON.stringify({ error: `Key not found: ${input.key}` });
            }
            current = (current as Record<string, unknown>)[part];
          }
          return JSON.stringify({ key: input.key, value: current });
        }

        return JSON.stringify(parsed);
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    }

    if (action === "write") {
      if (typeof input.config !== "object" || input.config === null) {
        return JSON.stringify({ error: "config (object) is required for write" });
      }
      try {
        if (svc) {
          svc.write(input.config as Record<string, unknown>);
          return JSON.stringify({ ok: true, message: "Config saved." });
        }
        writeFileSync(config.configPath!, JSON.stringify(input.config, null, 2) + "\n", "utf-8");
        return JSON.stringify({ ok: true, message: "Config saved." });
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    }

    if (action === "patch") {
      if (typeof input.key !== "string" || input.key === "") {
        return JSON.stringify({ error: "key (string) is required for patch" });
      }
      try {
        if (svc) {
          svc.patch(input.key, input.value);
          return JSON.stringify({ ok: true, message: `Config key "${input.key}" updated.` });
        }

        // Legacy fallback
        const raw = readFileSync(config.configPath!, "utf-8");
        const cfg = JSON.parse(raw) as Record<string, unknown>;

        const parts = input.key.split(".");
        let target: Record<string, unknown> = cfg;
        for (let i = 0; i < parts.length - 1; i++) {
          const p = parts[i]!;
          if (typeof target[p] !== "object" || target[p] === null) {
            target[p] = {};
          }
          target = target[p] as Record<string, unknown>;
        }
        target[parts[parts.length - 1]!] = input.value;

        writeFileSync(config.configPath!, JSON.stringify(cfg, null, 2) + "\n", "utf-8");
        return JSON.stringify({ ok: true, message: `Config key "${input.key}" updated.` });
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    }

    return JSON.stringify({
      error: `Unknown action: ${action}. Use "read", "write", or "patch".`,
    });
  };
}

export const MANAGE_CONFIG_MANIFEST = {
  name: "manage_config",
  description:
    "Manage system configuration (gateway.json). Actions: read (full config or a specific key via dot-notation), " +
    "write (replace entire config), patch (update a single key using dot-notation path).",
  requiresState: ["ONLINE" as const],
  requiresTier: ["verified" as const, "sealed" as const],
};

export const MANAGE_CONFIG_INPUT_SCHEMA = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["read", "write", "patch"],
      description: "Config operation to perform",
    },
    key: {
      type: "string",
      description: "Dot-notation config key e.g. 'plugins.screensaver.design' (for read/patch)",
    },
    value: {
      description: "Value to set (for patch). Can be any JSON type.",
    },
    config: {
      type: "object",
      description: "Full config object (for write)",
    },
  },
  required: ["action"],
};

// ---------------------------------------------------------------------------
// manage_stacks
// ---------------------------------------------------------------------------

export function createManageStacksHandler(config: AgentToolsConfig): ToolHandler {
  return async (input: Record<string, unknown>): Promise<string> => {
    const action = String(input.action ?? "");

    if (action === "list") {
      if (!config.stackRegistry) {
        return JSON.stringify({ error: "Stack registry not available" });
      }
      const filter: { projectCategory?: string; stackCategory?: string } = {};
      if (input.category && typeof input.category === "string") {
        filter.projectCategory = input.category;
      }
      if (input.stackCategory && typeof input.stackCategory === "string") {
        filter.stackCategory = input.stackCategory;
      }
      const stacks = config.stackRegistry.toJSON(
        Object.keys(filter).length > 0 ? filter as Parameters<StackRegistry["toJSON"]>[0] : undefined,
      );
      return JSON.stringify({ stacks });
    }

    if (action === "get") {
      if (!config.stackRegistry) {
        return JSON.stringify({ error: "Stack registry not available" });
      }
      const stackId = input.stackId ? String(input.stackId) : "";
      if (!stackId) {
        return JSON.stringify({ error: "stackId is required" });
      }
      const stack = config.stackRegistry.get(stackId);
      if (!stack) {
        return JSON.stringify({ error: `Stack not found: ${stackId}` });
      }
      return JSON.stringify(stack);
    }

    if (action === "add") {
      if (!config.hostingManager) {
        return JSON.stringify({ error: "Hosting manager not available" });
      }
      const path = input.path ? String(input.path) : "";
      const stackId = input.stackId ? String(input.stackId) : "";
      if (!path || !stackId) {
        return JSON.stringify({ error: "path and stackId are required" });
      }
      try {
        const result = await config.hostingManager.addStack(path, stackId);
        return JSON.stringify({ ok: true, stack: result });
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    }

    if (action === "remove") {
      if (!config.hostingManager) {
        return JSON.stringify({ error: "Hosting manager not available" });
      }
      const path = input.path ? String(input.path) : "";
      const stackId = input.stackId ? String(input.stackId) : "";
      if (!path || !stackId) {
        return JSON.stringify({ error: "path and stackId are required" });
      }
      try {
        await config.hostingManager.removeStack(path, stackId);
        return JSON.stringify({ ok: true });
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    }

    if (action === "project_stacks") {
      if (!config.hostingManager) {
        return JSON.stringify({ error: "Hosting manager not available" });
      }
      const path = input.path ? String(input.path) : "";
      if (!path) {
        return JSON.stringify({ error: "path is required" });
      }
      const stacks = config.hostingManager.getProjectStacks(path);
      return JSON.stringify({ stacks });
    }

    return JSON.stringify({
      error: `Unknown action: ${action}. Use "list", "get", "add", "remove", or "project_stacks".`,
    });
  };
}

export const MANAGE_STACKS_MANIFEST = {
  name: "manage_stacks",
  description:
    "Manage technology stacks. Actions: list (all available stacks, optional category filter), get (stack details by ID), " +
    "add (add stack to a hosted project), remove (remove stack from project), project_stacks (list stacks on a project).",
  requiresState: ["ONLINE" as const],
  requiresTier: ["verified" as const, "sealed" as const],
};

export const MANAGE_STACKS_INPUT_SCHEMA = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["list", "get", "add", "remove", "project_stacks"],
      description: "Stack operation to perform",
    },
    stackId: {
      type: "string",
      description: "Stack ID (for get/add/remove)",
    },
    path: {
      type: "string",
      description: "Project path (for add/remove/project_stacks)",
    },
    category: {
      type: "string",
      description: "Filter by project category (for list)",
    },
    stackCategory: {
      type: "string",
      description: "Filter by stack category: framework, database, cache, tool (for list)",
    },
  },
  required: ["action"],
};

// ---------------------------------------------------------------------------
// manage_system
// ---------------------------------------------------------------------------

export function createManageSystemHandler(config: AgentToolsConfig): ToolHandler {
  return async (input: Record<string, unknown>): Promise<string> => {
    const action = String(input.action ?? "");

    if (action === "status") {
      const loadAvg = os.loadavg() as [number, number, number];
      const cores = os.cpus().length;
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const usedMem = totalMem - freeMem;
      const memPercent = Math.round((usedMem / totalMem) * 100);

      let diskTotal = 0;
      let diskUsed = 0;
      let diskFree = 0;
      let diskPercent = 0;
      try {
        const dfOut = execSync("df -B1 /", { timeout: 5000 }).toString();
        const lines = dfOut.trim().split("\n");
        if (lines.length >= 2) {
          const parts = lines[1]!.split(/\s+/);
          diskTotal = parseInt(parts[1] ?? "0", 10);
          diskUsed = parseInt(parts[2] ?? "0", 10);
          diskFree = parseInt(parts[3] ?? "0", 10);
          diskPercent = diskTotal > 0 ? Math.round((diskUsed / diskTotal) * 100) : 0;
        }
      } catch { /* disk stats unavailable */ }

      return JSON.stringify({
        cpu: { loadAvg, cores },
        memory: {
          total: totalMem,
          free: freeMem,
          used: usedMem,
          percent: memPercent,
        },
        disk: {
          total: diskTotal,
          used: diskUsed,
          free: diskFree,
          percent: diskPercent,
        },
        uptime: os.uptime(),
        hostname: os.hostname(),
        nodeVersion: process.version,
        platform: process.platform,
      });
    }

    if (action === "upgrade") {
      if (!config.selfRepoPath) {
        return JSON.stringify({ error: "selfRepo not configured — cannot trigger upgrade" });
      }
      const scriptPath = join(config.selfRepoPath, "scripts/upgrade.sh");
      try {
        // Fire-and-forget: spawn upgrade.sh in the background
        const child = spawn("bash", [scriptPath], {
          cwd: config.selfRepoPath,
          stdio: "ignore",
          detached: true,
        });
        child.unref();
        return JSON.stringify({
          ok: true,
          message: "Upgrade triggered. The system will pull updates, rebuild, and restart if needed. Monitor progress in the dashboard.",
        });
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    }

    return JSON.stringify({
      error: `Unknown action: ${action}. Use "status" or "upgrade".`,
    });
  };
}

export const MANAGE_SYSTEM_MANIFEST = {
  name: "manage_system",
  description:
    "System operations. Actions: status (CPU, memory, disk usage, uptime, hostname), " +
    "upgrade (trigger upgrade.sh to pull updates, rebuild, and restart).",
  requiresState: ["ONLINE" as const],
  requiresTier: ["verified" as const, "sealed" as const],
};

export const MANAGE_SYSTEM_INPUT_SCHEMA = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["status", "upgrade"],
      description: "System operation to perform",
    },
  },
  required: ["action"],
};

// ---------------------------------------------------------------------------
// manage_hosting
// ---------------------------------------------------------------------------

export function createManageHostingHandler(config: AgentToolsConfig): ToolHandler {
  return async (input: Record<string, unknown>): Promise<string> => {
    const hm = config.hostingManager;
    if (!hm) {
      return JSON.stringify({ error: "Hosting manager not available" });
    }

    const action = String(input.action ?? "");

    if (action === "status") {
      const status = hm.getStatus();
      return JSON.stringify(status);
    }

    if (action === "enable") {
      const path = input.path ? String(input.path) : "";
      if (!path) {
        return JSON.stringify({ error: "path is required" });
      }
      try {
        const meta: ProjectHostingMeta = {
          enabled: true,
          type: input.type ? String(input.type) : "node",
          hostname: input.hostname ? String(input.hostname) : "",
          docRoot: input.docRoot ? String(input.docRoot) : null,
          startCommand: input.startCommand ? String(input.startCommand) : null,
          port: null,
          mode: input.mode === "development" ? "development" : "production",
          internalPort: input.internalPort ? Number(input.internalPort) : null,
          runtimeId: input.runtimeId ? String(input.runtimeId) : null,
        };

        const result = await hm.enableProject(path, meta);
        return JSON.stringify({ ok: true, project: result });
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    }

    if (action === "disable") {
      const path = input.path ? String(input.path) : "";
      if (!path) {
        return JSON.stringify({ error: "path is required" });
      }
      try {
        await hm.disableProject(path);
        return JSON.stringify({ ok: true });
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    }

    if (action === "restart") {
      const path = input.path ? String(input.path) : "";
      if (!path) {
        return JSON.stringify({ error: "path is required" });
      }
      try {
        // Restart = disable then re-enable with existing meta
        const existingMeta = hm.readHostingMeta(path);
        if (!existingMeta) {
          return JSON.stringify({ error: "Project is not hosted — nothing to restart" });
        }
        await hm.disableProject(path);
        const result = await hm.enableProject(path, existingMeta);
        return JSON.stringify({ ok: true, project: result });
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    }

    if (action === "info") {
      const path = input.path ? String(input.path) : "";
      if (!path) {
        return JSON.stringify({ error: "path is required" });
      }
      const info = hm.getProjectHostingInfo(path);
      return JSON.stringify(info);
    }

    if (action === "tunnel_enable") {
      const path = input.path ? String(input.path) : "";
      if (!path) {
        return JSON.stringify({ error: "path is required" });
      }
      try {
        const result = await hm.enableTunnel(path);
        return JSON.stringify({ ok: true, ...result });
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    }

    return JSON.stringify({
      error: `Unknown action: ${action}. Use "status", "enable", "disable", "restart", "info", or "tunnel_enable".`,
    });
  };
}

export const MANAGE_HOSTING_MANIFEST = {
  name: "manage_hosting",
  description:
    "Manage project hosting infrastructure. Actions: status (infrastructure readiness + hosted projects), " +
    "enable (start hosting a project with optional type/hostname/mode), disable (stop hosting), " +
    "restart (restart a hosted project), info (detailed hosting info for a project), " +
    "tunnel_enable (start Cloudflare quick tunnel for external access).",
  requiresState: ["ONLINE" as const],
  requiresTier: ["verified" as const, "sealed" as const],
};

export const MANAGE_HOSTING_INPUT_SCHEMA = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["status", "enable", "disable", "restart", "info", "tunnel_enable"],
      description: "Hosting operation to perform",
    },
    path: {
      type: "string",
      description: "Absolute project path (for enable/disable/restart/info/tunnel_enable)",
    },
    type: {
      type: "string",
      description: "Project type e.g. 'node', 'php', 'static' (for enable)",
    },
    hostname: {
      type: "string",
      description: "Custom hostname (for enable)",
    },
    docRoot: {
      type: "string",
      description: "Document root relative to project (for enable, PHP/static)",
    },
    startCommand: {
      type: "string",
      description: "Custom start command (for enable)",
    },
    mode: {
      type: "string",
      description: "Hosting mode: 'container' or 'process' (for enable)",
    },
    internalPort: {
      type: "number",
      description: "Internal port the app listens on (for enable)",
    },
    runtimeId: {
      type: "string",
      description: "Runtime ID to use (for enable)",
    },
  },
  required: ["action"],
};
