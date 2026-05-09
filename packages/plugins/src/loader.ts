/**
 * Plugin loader — validate, import, and activate plugins.
 * Adapted from OpenClaw's loader.ts.
 */

import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { createComponentLogger } from "@agi/gateway-core";
import { scanPluginSource } from "./scanner.js";
import type { Logger, ComponentLogger, ProjectTypeRegistry, ProjectTypeDefinition, ProjectTypeTool, CircuitBreakerTracker } from "@agi/gateway-core";
import type { AionimaChannelPlugin } from "@agi/channel-sdk";
import type { DiscoveredPlugin } from "./discovery.js";
import { HookBus } from "./hooks.js";
import { PluginRegistry } from "./registry.js";
import type {
  AionimaPlugin, AionimaPluginAPI, AionimaHookMap, DashboardTabDef, RouteHandler,
  RuntimeDefinition, RuntimeInstaller, ServiceDefinition, HostingExtension,
  ActionDefinition, ProjectPanelDefinition, SettingsSectionDefinition,
  SkillRegistration, KnowledgeNamespace, SystemServiceDefinition,
  ThemeDefinition, AgentToolDefinition, SidebarSectionDefinition,
  ScheduledTaskDefinition, WorkflowDefinition,
  SettingsPageDefinition, DashboardInterfacePageDefinition, DashboardInterfaceDomainDefinition,
  SubdomainRouteDefinition, LLMProviderDefinition, PmProviderDefinition, McpServerTemplate, WorkerDefinition,
} from "./types.js";
import type { StackDefinition } from "@agi/gateway-core";
import type { ScanProviderDefinition } from "@agi/security";

export interface PluginLoaderDeps {
  pluginRegistry: PluginRegistry;
  hookBus: HookBus;
  projectTypeRegistry: ProjectTypeRegistry;
  config: Record<string, unknown>;
  logger?: Logger;
  workspaceRoot?: string;
  projectDirs?: string[];
  /** Per-plugin priority overrides (plugin id -> priority number). */
  pluginPriorities?: Record<string, number>;
  channelRegistry?: { register(plugin: AionimaChannelPlugin): void };
  channelConfigs?: Array<{ id: string; enabled: boolean; config?: Record<string, unknown> }>;
  /** Read a project config (for plugin getProjectConfig API). */
  projectConfigReader?: (projectPath: string) => Record<string, unknown> | null;
  /** Read project stacks (for plugin getProjectStacks API). */
  projectStacksReader?: (projectPath: string) => Array<{ stackId: string; addedAt: string }>;
  /**
   * Optional circuit-breaker. When wired (s143 t569), each plugin load runs
   * through `shouldSkip(plugin:<id>)` first; failed activations are recorded
   * so a chronically broken plugin won't burn boot time forever. Without
   * this, plugin loads fall back to the bare try/catch behavior unchanged.
   */
  circuitBreaker?: CircuitBreakerTracker;
}

export interface LoadResult {
  loaded: string[];
  failed: { id: string; error: string }[];
}

export async function loadPlugins(
  discovered: DiscoveredPlugin[],
  deps: PluginLoaderDeps,
  options?: { bustCache?: boolean },
): Promise<LoadResult> {
  const log = createComponentLogger(deps.logger, "plugin-loader");
  const loaded: string[] = [];
  const failed: { id: string; error: string }[] = [];

  for (const plugin of discovered) {
    const { manifest, entryPath, basePath } = plugin;

    if (deps.pluginRegistry.has(manifest.id)) {
      log.warn(`plugin "${manifest.id}" already loaded — skipping duplicate`);
      continue;
    }

    // s143 t569 — circuit-breaker gate. If a plugin has tripped the breaker
    // on previous boots, skip the dynamic-import + activate() entirely so a
    // chronically broken plugin (bad entry, throws on activate, missing
    // peer dep) can't burn budget every restart. Failed loads still record
    // through the catch block below regardless of whether the breaker is
    // wired — falling back to bare try/catch when not.
    const serviceId = `plugin:${manifest.id}`;
    if (deps.circuitBreaker) {
      const decision = deps.circuitBreaker.shouldSkip(serviceId);
      if (decision.skip) {
        const reason = decision.reason ?? "circuit open";
        log.warn(`[${manifest.id}] circuit-open — skipping plugin load (${reason})`);
        failed.push({ id: manifest.id, error: reason });
        continue;
      }
      if (decision.transitionedTo) {
        log.info(`[${manifest.id}] breaker transitioned to ${decision.transitionedTo} — attempting load`);
      }
    }

    // Scan plugin source for suspicious patterns (warn-only)
    const scanResult = scanPluginSource(plugin.entryPath, manifest.permissions ?? []);
    if (!scanResult.safe) {
      for (const w of scanResult.warnings) {
        log.warn(`[security] ${manifest.id}: ${w.pattern} at ${w.file}:${w.line}`);
      }
    }

    try {
      const instance = await loadSinglePlugin(
        manifest.id,
        entryPath,
        basePath,
        deps,
        log,
        options?.bustCache,
      );

      deps.pluginRegistry.add({ manifest, instance, basePath });

      // Auto-register plugin-provided docs. Most plugins ship a `docs/` folder
      // with overview.md (and sometimes more topics) but forget to call
      // api.registerKnowledge() during activate. Without explicit registration
      // nothing surfaces in the dashboard Docs page, so only 3/57 plugins ever
      // showed their docs. Auto-register when (1) a docs/ dir exists and
      // (2) the plugin has not already registered its own knowledge namespace.
      try {
        const alreadyRegistered = deps.pluginRegistry
          .getKnowledge()
          .some((k) => k.pluginId === manifest.id);
        if (!alreadyRegistered) {
          const docsDir = join(basePath, "docs");
          if (existsSync(docsDir) && statSync(docsDir).isDirectory()) {
            deps.pluginRegistry.addKnowledge(manifest.id, {
              id: manifest.id,
              label: manifest.name,
              description: manifest.description,
              contentDir: docsDir,
              // Empty topics triggers directory-scan mode in the docs API
              // (see server-runtime-state.ts plugin-docs folder build).
              topics: [],
            });
            log.info(`auto-registered docs for ${manifest.id} at ${docsDir}`);
          }
        }
      } catch (err) {
        log.warn(
          `docs auto-register skipped for ${manifest.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      loaded.push(manifest.id);
      deps.circuitBreaker?.recordSuccess(serviceId);
      log.info(`loaded plugin: ${manifest.name} v${manifest.version}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failed.push({ id: manifest.id, error: message });
      deps.circuitBreaker?.recordFailure(serviceId, err);
      log.error(`failed to load plugin "${manifest.id}": ${message}`);
    }
  }

  return { loaded, failed };
}

async function loadSinglePlugin(
  pluginId: string,
  entryPath: string,
  basePath: string,
  deps: PluginLoaderDeps,
  log: ComponentLogger,
  bustCache?: boolean,
): Promise<AionimaPlugin> {
  // Dynamic import of plugin entry
  const importPath = bustCache ? `${entryPath}?v=${Date.now()}` : entryPath;
  const mod = await (import(/* @vite-ignore */ importPath) as Promise<Record<string, unknown>>);

  // Plugin must export a default AionimaPlugin or an activate function
  let instance: AionimaPlugin;
  if (typeof mod.default === "object" && mod.default !== null && "activate" in (mod.default as object)) {
    instance = mod.default as AionimaPlugin;
  } else if (typeof mod.activate === "function") {
    instance = { activate: mod.activate as AionimaPlugin["activate"] };
  } else {
    throw new Error("Plugin must export a default AionimaPlugin object or an activate function");
  }

  // Create scoped API for this plugin
  const api = createPluginAPI(pluginId, basePath, deps, log);

  // Activate the plugin
  await instance.activate(api);

  return instance;
}

function createPluginAPI(
  pluginId: string,
  _basePath: string,
  deps: PluginLoaderDeps,
  parentLog: ComponentLogger,
): AionimaPluginAPI {
  const pluginLog = createComponentLogger(parentLog as unknown as Logger, `plugin:${pluginId}`);

  return {
    registerProjectType(def: ProjectTypeDefinition): void {
      deps.projectTypeRegistry.register(def);
      deps.pluginRegistry.trackProjectType(pluginId, def.id);
    },

    registerTool(projectType: string, tool: ProjectTypeTool): void {
      const existing = deps.projectTypeRegistry.get(projectType);
      if (existing) {
        existing.tools.push(tool);
      }
    },

    registerHook<K extends keyof AionimaHookMap>(hook: K, handler: AionimaHookMap[K]): void {
      deps.hookBus.register(hook, handler, pluginId);
    },

    registerHttpRoute(method: string, path: string, handler: RouteHandler, options?: { raw?: boolean }): void {
      // Auto-prefix plugin routes unless raw mode is requested
      const prefixedPath = options?.raw ? path : `/api/plugins/${pluginId}${path.startsWith("/") ? path : `/${path}`}`;
      const priority = deps.pluginPriorities?.[pluginId] ?? 0;
      deps.pluginRegistry.addRoute({ pluginId, method, path: prefixedPath, handler }, priority);
    },

    registerDashboardTab(projectType: string, tab: DashboardTabDef): void {
      deps.pluginRegistry.addTab({ pluginId, projectType, tab });
    },

    registerRuntime(def: RuntimeDefinition): void {
      deps.pluginRegistry.addRuntime(pluginId, def);
    },

    registerService(def: ServiceDefinition): void {
      deps.pluginRegistry.addService(pluginId, def);
    },

    registerRuntimeInstaller(installer: RuntimeInstaller): void {
      deps.pluginRegistry.addRuntimeInstaller(pluginId, installer);
    },

    registerHostingExtension(extension: HostingExtension): void {
      deps.pluginRegistry.addHostingExtension({ ...extension, pluginId });
    },

    registerStack(def: StackDefinition): void {
      deps.pluginRegistry.addStack(pluginId, def);
    },

    registerChannel(plugin: AionimaChannelPlugin): void {
      deps.channelRegistry?.register(plugin);
      deps.pluginRegistry.addChannel(pluginId, plugin.id as string);
    },

    registerProvider(def: LLMProviderDefinition): void {
      deps.pluginRegistry.addProvider(pluginId, def);
    },

    registerPmProvider(def: PmProviderDefinition): void {
      deps.pluginRegistry.addPmProvider(pluginId, def);
    },

    registerMcpServerTemplate(def: McpServerTemplate): void {
      deps.pluginRegistry.addMcpServerTemplate(pluginId, def);
    },

    registerAction(def: ActionDefinition): void {
      deps.pluginRegistry.addAction(pluginId, def);
    },

    registerProjectPanel(def: ProjectPanelDefinition): void {
      deps.pluginRegistry.addPanel(pluginId, def);
    },

    registerSettingsSection(def: SettingsSectionDefinition): void {
      deps.pluginRegistry.addSettingsSection(pluginId, def);
    },

    registerSkill(def: SkillRegistration): void {
      deps.pluginRegistry.addSkill(pluginId, def);
    },

    registerKnowledge(def: KnowledgeNamespace): void {
      deps.pluginRegistry.addKnowledge(pluginId, def);
    },

    registerSystemService(def: SystemServiceDefinition): void {
      deps.pluginRegistry.addSystemService(pluginId, def);
    },

    registerTheme(def: ThemeDefinition): void {
      deps.pluginRegistry.addTheme(pluginId, def);
    },

    registerAgentTool(def: AgentToolDefinition): void {
      deps.pluginRegistry.addAgentTool(pluginId, def);
    },

    registerSidebarSection(def: SidebarSectionDefinition): void {
      deps.pluginRegistry.addSidebarSection(pluginId, def);
    },

    registerScheduledTask(def: ScheduledTaskDefinition): void {
      deps.pluginRegistry.addScheduledTask(pluginId, def);
    },

    registerWorkflow(def: WorkflowDefinition): void {
      deps.pluginRegistry.addWorkflow(pluginId, def);
    },

    registerSettingsPage(def: SettingsPageDefinition): void {
      deps.pluginRegistry.addSettingsPage(pluginId, def);
    },

    registerDashboardPage(def: DashboardInterfacePageDefinition): void {
      deps.pluginRegistry.addDashboardPage(pluginId, def);
    },

    registerDashboardDomain(def: DashboardInterfaceDomainDefinition): void {
      deps.pluginRegistry.addDashboardDomain(pluginId, def);
    },

    registerSubdomainRoute(def: SubdomainRouteDefinition): void {
      deps.pluginRegistry.addSubdomainRoute(pluginId, def);
    },

    registerScanProvider(def: ScanProviderDefinition): void {
      deps.pluginRegistry.addScanProvider(pluginId, def);
    },

    registerWorker(def: WorkerDefinition): void {
      deps.pluginRegistry.addWorker(pluginId, def);
    },

    getChannelConfig(channelId: string): { enabled: boolean; config: Record<string, unknown> } | undefined {
      const entry = deps.channelConfigs?.find(c => c.id === channelId);
      if (!entry) return undefined;
      return { enabled: entry.enabled, config: entry.config ?? {} };
    },

    getConfig(): Record<string, unknown> {
      return { ...deps.config };
    },

    getLogger(): ComponentLogger {
      return pluginLog;
    },

    getWorkspaceRoot(): string {
      return deps.workspaceRoot ?? "/";
    },

    getProjectDirs(): string[] {
      return [...(deps.projectDirs ?? [])];
    },

    getProjectConfig(projectPath: string): Record<string, unknown> | null {
      return deps.projectConfigReader?.(projectPath) ?? null;
    },

    getProjectStacks(projectPath: string): Array<{ stackId: string; addedAt: string }> {
      return deps.projectStacksReader?.(projectPath) ?? [];
    },
  };
}
