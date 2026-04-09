/**
 * PluginRegistry — central store for loaded plugins.
 */

import type {
  AionimaPlugin, AionimaPluginManifest, DashboardTabDef, RouteHandler,
  RuntimeDefinition, RuntimeInstaller, ServiceDefinition, HostingExtension,
  ActionDefinition, ProjectPanelDefinition, SettingsSectionDefinition,
  SkillRegistration, KnowledgeNamespace, SystemServiceDefinition,
  ThemeDefinition, AgentToolDefinition, SidebarSectionDefinition,
  ScheduledTaskDefinition, WorkflowDefinition,
  SettingsPageDefinition, DashboardInterfacePageDefinition, DashboardInterfaceDomainDefinition,
  SubdomainRouteDefinition, LLMProviderDefinition, ProvidesLabel, WorkerDefinition,
} from "./types.js";
import type { StackDefinition } from "@aionima/gateway-core";
import type { ScanProviderDefinition } from "@aionima/security";

export interface LoadedPlugin {
  manifest: AionimaPluginManifest;
  instance: AionimaPlugin;
  basePath: string;
}

export interface RegisteredRoute {
  pluginId: string;
  method: string;
  path: string;
  handler: RouteHandler;
}

export interface RegisteredTab {
  pluginId: string;
  projectType: string;
  tab: DashboardTabDef;
}

export interface RegisteredAction {
  pluginId: string;
  action: ActionDefinition;
}

export interface RegisteredPanel {
  pluginId: string;
  panel: ProjectPanelDefinition;
}

export interface RegisteredSettingsSection {
  pluginId: string;
  section: SettingsSectionDefinition;
}

export interface RegisteredSkill {
  pluginId: string;
  skill: SkillRegistration;
}

export interface RegisteredKnowledge {
  pluginId: string;
  namespace: KnowledgeNamespace;
}

export interface RegisteredSystemService {
  pluginId: string;
  service: SystemServiceDefinition;
}

export interface RegisteredTheme {
  pluginId: string;
  theme: ThemeDefinition;
}

export interface RegisteredAgentTool {
  pluginId: string;
  tool: AgentToolDefinition;
}

export interface RegisteredSidebarSection {
  pluginId: string;
  section: SidebarSectionDefinition;
}

export interface RegisteredScheduledTask {
  pluginId: string;
  task: ScheduledTaskDefinition;
}

export interface RegisteredWorkflow {
  pluginId: string;
  workflow: WorkflowDefinition;
}

export interface RegisteredSettingsPage {
  pluginId: string;
  page: SettingsPageDefinition;
}

export interface RegisteredDashboardPage {
  pluginId: string;
  page: DashboardInterfacePageDefinition;
}

export interface RegisteredDashboardDomain {
  pluginId: string;
  domain: DashboardInterfaceDomainDefinition;
}

export interface RegisteredSubdomainRoute {
  pluginId: string;
  route: SubdomainRouteDefinition;
}

export interface RegisteredStack {
  pluginId: string;
  stack: StackDefinition;
}

export interface RegisteredChannel {
  pluginId: string;
  channelId: string;
}

export interface RegisteredProvider {
  pluginId: string;
  provider: LLMProviderDefinition;
}

export interface RegisteredScanProvider {
  pluginId: string;
  scanProvider: ScanProviderDefinition;
}

export interface RegisteredWorker {
  pluginId: string;
  worker: WorkerDefinition;
}

export interface RegisteredRuntime {
  pluginId: string;
  runtime: RuntimeDefinition;
}

export interface RegisteredService {
  pluginId: string;
  service: ServiceDefinition;
}

export interface RegisteredRuntimeInstaller {
  pluginId: string;
  installer: RuntimeInstaller;
}

/** Remove entries from an array in-place, returning the count removed. */
function filterInPlace<T>(arr: T[], keep: (item: T) => boolean): number {
  let removed = 0;
  for (let i = arr.length - 1; i >= 0; i--) {
    if (!keep(arr[i]!)) {
      arr.splice(i, 1);
      removed++;
    }
  }
  return removed;
}

export class PluginRegistry {
  private readonly plugins = new Map<string, LoadedPlugin>();
  private readonly routes: RegisteredRoute[] = [];
  private readonly routePriorities = new Map<string, number>();
  private readonly tabs: RegisteredTab[] = [];
  private readonly runtimes: RegisteredRuntime[] = [];
  private readonly services: RegisteredService[] = [];
  private readonly hostingExtensions: HostingExtension[] = [];
  private readonly runtimeInstallers: RegisteredRuntimeInstaller[] = [];
  private readonly actions: RegisteredAction[] = [];
  private readonly panels: RegisteredPanel[] = [];
  private readonly settingsSections: RegisteredSettingsSection[] = [];
  private readonly skills: RegisteredSkill[] = [];
  private readonly knowledgeNamespaces: RegisteredKnowledge[] = [];
  private readonly systemServices: RegisteredSystemService[] = [];
  private readonly themes: RegisteredTheme[] = [];
  private readonly agentTools: RegisteredAgentTool[] = [];
  private readonly sidebarSections: RegisteredSidebarSection[] = [];
  private readonly scheduledTasks: RegisteredScheduledTask[] = [];
  private readonly workflows: RegisteredWorkflow[] = [];
  private readonly settingsPages: RegisteredSettingsPage[] = [];
  private readonly dashboardPages: RegisteredDashboardPage[] = [];
  private readonly dashboardDomains: RegisteredDashboardDomain[] = [];
  private readonly subdomainRoutes: RegisteredSubdomainRoute[] = [];
  private readonly stacks: RegisteredStack[] = [];
  private readonly channels: RegisteredChannel[] = [];
  private readonly providers: RegisteredProvider[] = [];
  private readonly scanProviders: RegisteredScanProvider[] = [];
  private readonly workers: RegisteredWorker[] = [];
  private readonly projectTypesByPlugin = new Map<string, string[]>();

  add(loaded: LoadedPlugin): void {
    this.plugins.set(loaded.manifest.id, loaded);
  }

  get(id: string): LoadedPlugin | undefined {
    return this.plugins.get(id);
  }

  has(id: string): boolean {
    return this.plugins.has(id);
  }

  getAll(): LoadedPlugin[] {
    return Array.from(this.plugins.values());
  }

  trackProjectType(pluginId: string, typeId: string): void {
    const ids = this.projectTypesByPlugin.get(pluginId) ?? [];
    ids.push(typeId);
    this.projectTypesByPlugin.set(pluginId, ids);
  }

  getProjectTypeIds(pluginId: string): string[] {
    return this.projectTypesByPlugin.get(pluginId) ?? [];
  }

  addRoute(route: RegisteredRoute, priority = 0): { replaced: string | null } {
    const key = `${route.method.toUpperCase()}:${route.path}`;
    const existingIdx = this.routes.findIndex(r => `${r.method.toUpperCase()}:${r.path}` === key);
    if (existingIdx >= 0) {
      const old = this.routes[existingIdx]!;
      if (priority >= (this.routePriorities.get(key) ?? 0)) {
        console.warn(`[plugin-registry] route collision: ${key} — "${route.pluginId}" replaces "${old.pluginId}" (higher priority)`);
        this.routes[existingIdx] = route;
        this.routePriorities.set(key, priority);
        return { replaced: old.pluginId };
      }
      console.warn(`[plugin-registry] route collision: ${key} — "${route.pluginId}" ignored (lower priority than "${old.pluginId}")`);
      return { replaced: null };
    }
    this.routes.push(route);
    this.routePriorities.set(key, priority);
    return { replaced: null };
  }

  getRoutes(): RegisteredRoute[] {
    return [...this.routes];
  }

  addTab(tab: RegisteredTab): void {
    this.tabs.push(tab);
  }

  getTabs(projectType?: string): RegisteredTab[] {
    if (projectType) {
      return this.tabs.filter((t) => t.projectType === projectType);
    }
    return [...this.tabs];
  }

  // -------------------------------------------------------------------------
  // Runtimes
  // -------------------------------------------------------------------------

  addRuntime(pluginId: string, def: RuntimeDefinition): void {
    this.runtimes.push({ pluginId, runtime: def });
  }

  getRuntimes(): RuntimeDefinition[] {
    return this.runtimes.map(r => r.runtime);
  }

  getRuntimesForType(projectType: string): RuntimeDefinition[] {
    return this.runtimes.filter(r => r.runtime.projectTypes.includes(projectType)).map(r => r.runtime);
  }

  // -------------------------------------------------------------------------
  // Runtime Installers
  // -------------------------------------------------------------------------

  addRuntimeInstaller(pluginId: string, installer: RuntimeInstaller): void {
    this.runtimeInstallers.push({ pluginId, installer });
  }

  getRuntimeInstallers(): RuntimeInstaller[] {
    return this.runtimeInstallers.map(r => r.installer);
  }

  getRuntimeInstaller(language: string): RuntimeInstaller | undefined {
    return this.runtimeInstallers.find(i => i.installer.language === language)?.installer;
  }

  // -------------------------------------------------------------------------
  // Services
  // -------------------------------------------------------------------------

  addService(pluginId: string, def: ServiceDefinition): void {
    this.services.push({ pluginId, service: def });
  }

  getServices(): ServiceDefinition[] {
    return this.services.map(r => r.service);
  }

  // -------------------------------------------------------------------------
  // Hosting Extensions
  // -------------------------------------------------------------------------

  addHostingExtension(ext: HostingExtension): void {
    this.hostingExtensions.push(ext);
  }

  getHostingExtensions(): HostingExtension[] {
    return [...this.hostingExtensions];
  }

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  addAction(pluginId: string, action: ActionDefinition): void {
    // Deduplicate by action ID — first-registered wins
    const existing = this.actions.find((a) => a.action.id === action.id);
    if (existing) {
      console.warn(`[plugin-registry] action collision: "${action.id}" — "${pluginId}" ignored (already registered by "${existing.pluginId}")`);
      return;
    }
    this.actions.push({ pluginId, action });
  }

  getActions(scope?: { type: string; projectType?: string }): RegisteredAction[] {
    if (!scope) return [...this.actions];
    return this.actions.filter(a => {
      if (a.action.scope.type !== scope.type) return false;
      if (scope.type === "project" && scope.projectType && a.action.scope.type === "project") {
        const pts = a.action.scope.projectTypes;
        if (pts && pts.length > 0 && !pts.includes(scope.projectType!)) return false;
      }
      return true;
    });
  }

  // -------------------------------------------------------------------------
  // Project Panels
  // -------------------------------------------------------------------------

  addPanel(pluginId: string, panel: ProjectPanelDefinition): void {
    this.panels.push({ pluginId, panel });
  }

  getPanels(projectType?: string): RegisteredPanel[] {
    if (!projectType) return [...this.panels];
    return this.panels.filter(p => p.panel.projectTypes.includes(projectType));
  }

  // -------------------------------------------------------------------------
  // Settings Sections
  // -------------------------------------------------------------------------

  addSettingsSection(pluginId: string, section: SettingsSectionDefinition): void {
    this.settingsSections.push({ pluginId, section });
  }

  getSettingsSections(): RegisteredSettingsSection[] {
    return [...this.settingsSections].sort(
      (a, b) => (a.section.position ?? 100) - (b.section.position ?? 100),
    );
  }

  // -------------------------------------------------------------------------
  // Skills
  // -------------------------------------------------------------------------

  addSkill(pluginId: string, skill: SkillRegistration): void {
    this.skills.push({ pluginId, skill });
  }

  getSkills(): RegisteredSkill[] {
    return [...this.skills];
  }

  // -------------------------------------------------------------------------
  // Knowledge Namespaces
  // -------------------------------------------------------------------------

  addKnowledge(pluginId: string, namespace: KnowledgeNamespace): void {
    this.knowledgeNamespaces.push({ pluginId, namespace });
  }

  getKnowledge(): RegisteredKnowledge[] {
    return [...this.knowledgeNamespaces];
  }

  // -------------------------------------------------------------------------
  // System Services
  // -------------------------------------------------------------------------

  addSystemService(pluginId: string, service: SystemServiceDefinition): void {
    this.systemServices.push({ pluginId, service });
  }

  getSystemServices(): RegisteredSystemService[] {
    return [...this.systemServices];
  }

  // -------------------------------------------------------------------------
  // Themes
  // -------------------------------------------------------------------------

  addTheme(pluginId: string, theme: ThemeDefinition): void {
    this.themes.push({ pluginId, theme });
  }

  getThemes(): RegisteredTheme[] {
    return [...this.themes];
  }

  // -------------------------------------------------------------------------
  // Agent Tools
  // -------------------------------------------------------------------------

  addAgentTool(pluginId: string, tool: AgentToolDefinition): void {
    this.agentTools.push({ pluginId, tool });
  }

  getAgentTools(): RegisteredAgentTool[] {
    return [...this.agentTools];
  }

  // -------------------------------------------------------------------------
  // Sidebar Sections
  // -------------------------------------------------------------------------

  addSidebarSection(pluginId: string, section: SidebarSectionDefinition): void {
    this.sidebarSections.push({ pluginId, section });
  }

  getSidebarSections(): RegisteredSidebarSection[] {
    return [...this.sidebarSections].sort(
      (a, b) => (a.section.position ?? 100) - (b.section.position ?? 100),
    );
  }

  // -------------------------------------------------------------------------
  // Scheduled Tasks
  // -------------------------------------------------------------------------

  addScheduledTask(pluginId: string, task: ScheduledTaskDefinition): void {
    this.scheduledTasks.push({ pluginId, task });
  }

  getScheduledTasks(): RegisteredScheduledTask[] {
    return [...this.scheduledTasks];
  }

  // -------------------------------------------------------------------------
  // Workflows
  // -------------------------------------------------------------------------

  addWorkflow(pluginId: string, workflow: WorkflowDefinition): void {
    this.workflows.push({ pluginId, workflow });
  }

  getWorkflows(): RegisteredWorkflow[] {
    return [...this.workflows];
  }

  // -------------------------------------------------------------------------
  // Settings Pages
  // -------------------------------------------------------------------------

  addSettingsPage(pluginId: string, page: SettingsPageDefinition): void {
    this.settingsPages.push({ pluginId, page });
  }

  getSettingsPages(): RegisteredSettingsPage[] {
    return [...this.settingsPages].sort(
      (a, b) => (a.page.position ?? 100) - (b.page.position ?? 100),
    );
  }

  // -------------------------------------------------------------------------
  // Dashboard Pages (plugin pages in existing domains)
  // -------------------------------------------------------------------------

  addDashboardPage(pluginId: string, page: DashboardInterfacePageDefinition): void {
    this.dashboardPages.push({ pluginId, page });
  }

  getDashboardPages(domain?: string): RegisteredDashboardPage[] {
    const pages = domain
      ? this.dashboardPages.filter(p => p.page.domain === domain)
      : [...this.dashboardPages];
    return pages.sort((a, b) => (a.page.position ?? 100) - (b.page.position ?? 100));
  }

  // -------------------------------------------------------------------------
  // Dashboard Domains (plugin-provided top-level sections)
  // -------------------------------------------------------------------------

  addDashboardDomain(pluginId: string, domain: DashboardInterfaceDomainDefinition): void {
    this.dashboardDomains.push({ pluginId, domain });
  }

  getDashboardDomains(): RegisteredDashboardDomain[] {
    return [...this.dashboardDomains].sort(
      (a, b) => (a.domain.position ?? 100) - (b.domain.position ?? 100),
    );
  }

  // -------------------------------------------------------------------------
  // Subdomain Routes
  // -------------------------------------------------------------------------

  addSubdomainRoute(pluginId: string, route: SubdomainRouteDefinition): void {
    this.subdomainRoutes.push({ pluginId, route });
  }

  getSubdomainRoutes(): RegisteredSubdomainRoute[] {
    return [...this.subdomainRoutes];
  }

  // -------------------------------------------------------------------------
  // Stacks
  // -------------------------------------------------------------------------

  addStack(pluginId: string, stack: StackDefinition): void {
    this.stacks.push({ pluginId, stack });
  }

  getStacks(): RegisteredStack[] {
    return [...this.stacks];
  }

  // -------------------------------------------------------------------------
  // Channels
  // -------------------------------------------------------------------------

  addChannel(pluginId: string, channelId: string): void {
    this.channels.push({ pluginId, channelId });
  }

  getChannels(): RegisteredChannel[] {
    return [...this.channels];
  }

  // -------------------------------------------------------------------------
  // LLM Providers
  // -------------------------------------------------------------------------

  addProvider(pluginId: string, provider: LLMProviderDefinition): void {
    // Deduplicate by provider ID — first-registered wins
    if (this.providers.some(p => p.provider.id === provider.id)) return;
    this.providers.push({ pluginId, provider });
  }

  getProviders(): RegisteredProvider[] {
    return [...this.providers];
  }

  getProvider(id: string): LLMProviderDefinition | undefined {
    return this.providers.find(p => p.provider.id === id)?.provider;
  }

  // -------------------------------------------------------------------------
  // Scan Providers
  // -------------------------------------------------------------------------

  addScanProvider(pluginId: string, scanProvider: ScanProviderDefinition): void {
    if (this.scanProviders.some(p => p.scanProvider.id === scanProvider.id)) return;
    this.scanProviders.push({ pluginId, scanProvider });
  }

  getScanProviders(): RegisteredScanProvider[] {
    return [...this.scanProviders];
  }

  // -------------------------------------------------------------------------
  // Workers
  // -------------------------------------------------------------------------

  addWorker(pluginId: string, worker: WorkerDefinition): void {
    if (this.workers.some(w => w.worker.id === worker.id)) return;
    this.workers.push({ pluginId, worker });
  }

  getWorkers(): RegisteredWorker[] {
    return [...this.workers];
  }

  getWorkersByDomain(domain: string): RegisteredWorker[] {
    return this.workers.filter(w => w.worker.domain === domain);
  }

  getWorker(id: string): WorkerDefinition | undefined {
    return this.workers.find(w => w.worker.id === id)?.worker;
  }

  // -------------------------------------------------------------------------
  // Provides introspection — derive capability labels from registrations
  // -------------------------------------------------------------------------

  getPluginProvides(pluginId: string): ProvidesLabel[] {
    const labels = new Set<ProvidesLabel>();

    for (const r of this.routes) { if (r.pluginId === pluginId) labels.add("ux"); }
    for (const t of this.tabs) { if (t.pluginId === pluginId) labels.add("ux"); }
    for (const r of this.runtimes) { if (r.pluginId === pluginId) labels.add("runtimes"); }
    for (const s of this.services) { if (s.pluginId === pluginId) labels.add("services"); }
    for (const i of this.runtimeInstallers) { if (i.pluginId === pluginId) labels.add("runtimes"); }
    for (const a of this.actions) { if (a.pluginId === pluginId) labels.add("ux"); }
    for (const p of this.panels) { if (p.pluginId === pluginId) labels.add("ux"); }
    for (const s of this.settingsSections) { if (s.pluginId === pluginId) labels.add("ux"); }
    for (const s of this.skills) { if (s.pluginId === pluginId) labels.add("skills"); }
    for (const k of this.knowledgeNamespaces) { if (k.pluginId === pluginId) labels.add("knowledge"); }
    for (const ss of this.systemServices) { if (ss.pluginId === pluginId) labels.add("system-services"); }
    for (const t of this.themes) { if (t.pluginId === pluginId) labels.add("themes"); }
    for (const at of this.agentTools) { if (at.pluginId === pluginId) labels.add("agent-tools"); }
    for (const sb of this.sidebarSections) { if (sb.pluginId === pluginId) labels.add("ux"); }
    for (const st of this.scheduledTasks) { if (st.pluginId === pluginId) labels.add("ux"); }
    for (const w of this.workflows) { if (w.pluginId === pluginId) labels.add("workflows"); }
    for (const sp of this.settingsPages) { if (sp.pluginId === pluginId) labels.add("ux"); }
    for (const dp of this.dashboardPages) { if (dp.pluginId === pluginId) labels.add("ux"); }
    for (const dd of this.dashboardDomains) { if (dd.pluginId === pluginId) labels.add("ux"); }
    for (const sr of this.subdomainRoutes) { if (sr.pluginId === pluginId) labels.add("ux"); }
    for (const s of this.stacks) { if (s.pluginId === pluginId) labels.add("stacks"); }
    for (const c of this.channels) { if (c.pluginId === pluginId) labels.add("channels"); }
    for (const p of this.providers) { if (p.pluginId === pluginId) labels.add("providers"); }
    for (const sp of this.scanProviders) { if (sp.pluginId === pluginId) labels.add("security"); }
    for (const w of this.workers) { if (w.pluginId === pluginId) labels.add("workers"); }

    return [...labels];
  }

  getAllPluginProvides(): Map<string, ProvidesLabel[]> {
    const result = new Map<string, ProvidesLabel[]>();
    for (const id of this.plugins.keys()) {
      result.set(id, this.getPluginProvides(id));
    }
    return result;
  }

  async deactivateSingle(pluginId: string): Promise<{ deactivated: boolean; removedCounts: Record<string, number> }> {
    const loaded = this.plugins.get(pluginId);
    if (!loaded) return { deactivated: false, removedCounts: {} };

    try {
      await loaded.instance.deactivate?.();
    } catch {
      // Best-effort deactivation — continue with cleanup
    }

    this.plugins.delete(pluginId);
    this.projectTypesByPlugin.delete(pluginId);

    const keep = (entry: { pluginId: string }) => entry.pluginId !== pluginId;
    const removedCounts: Record<string, number> = {};

    removedCounts.routes = filterInPlace(this.routes, keep);
    removedCounts.tabs = filterInPlace(this.tabs, keep);
    removedCounts.runtimes = filterInPlace(this.runtimes, keep);
    removedCounts.services = filterInPlace(this.services, keep);
    removedCounts.hostingExtensions = filterInPlace(this.hostingExtensions, keep);
    removedCounts.runtimeInstallers = filterInPlace(this.runtimeInstallers, keep);
    removedCounts.actions = filterInPlace(this.actions, keep);
    removedCounts.panels = filterInPlace(this.panels, keep);
    removedCounts.settingsSections = filterInPlace(this.settingsSections, keep);
    removedCounts.skills = filterInPlace(this.skills, keep);
    removedCounts.knowledgeNamespaces = filterInPlace(this.knowledgeNamespaces, keep);
    removedCounts.systemServices = filterInPlace(this.systemServices, keep);
    removedCounts.themes = filterInPlace(this.themes, keep);
    removedCounts.agentTools = filterInPlace(this.agentTools, keep);
    removedCounts.sidebarSections = filterInPlace(this.sidebarSections, keep);
    removedCounts.scheduledTasks = filterInPlace(this.scheduledTasks, keep);
    removedCounts.workflows = filterInPlace(this.workflows, keep);
    removedCounts.settingsPages = filterInPlace(this.settingsPages, keep);
    removedCounts.dashboardPages = filterInPlace(this.dashboardPages, keep);
    removedCounts.dashboardDomains = filterInPlace(this.dashboardDomains, keep);
    removedCounts.subdomainRoutes = filterInPlace(this.subdomainRoutes, keep);
    removedCounts.stacks = filterInPlace(this.stacks, keep);
    removedCounts.channels = filterInPlace(this.channels, keep);
    removedCounts.providers = filterInPlace(this.providers, keep);
    removedCounts.scanProviders = filterInPlace(this.scanProviders, keep);
    removedCounts.workers = filterInPlace(this.workers, keep);

    // Clean up route priorities for removed routes
    for (const [key] of this.routePriorities) {
      if (!this.routes.some(r => `${r.method.toUpperCase()}:${r.path}` === key)) {
        this.routePriorities.delete(key);
      }
    }

    return { deactivated: true, removedCounts };
  }

  async deactivateAll(onError?: (pluginId: string, error: unknown) => void): Promise<void> {
    for (const loaded of this.plugins.values()) {
      try {
        await loaded.instance.deactivate?.();
      } catch (err) {
        onError?.(loaded.manifest.id, err);
      }
    }
    this.plugins.clear();
    this.projectTypesByPlugin.clear();
    this.routes.length = 0;
    this.routePriorities.clear();
    this.tabs.length = 0;
    this.runtimes.length = 0;
    this.services.length = 0;
    this.hostingExtensions.length = 0;
    this.runtimeInstallers.length = 0;
    this.actions.length = 0;
    this.panels.length = 0;
    this.settingsSections.length = 0;
    this.skills.length = 0;
    this.knowledgeNamespaces.length = 0;
    this.systemServices.length = 0;
    this.themes.length = 0;
    this.agentTools.length = 0;
    this.sidebarSections.length = 0;
    this.scheduledTasks.length = 0;
    this.workflows.length = 0;
    this.settingsPages.length = 0;
    this.dashboardPages.length = 0;
    this.dashboardDomains.length = 0;
    this.subdomainRoutes.length = 0;
    this.stacks.length = 0;
    this.channels.length = 0;
    this.providers.length = 0;
    this.scanProviders.length = 0;
    this.workers.length = 0;
  }
}
