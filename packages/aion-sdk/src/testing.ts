/**
 * Testing utilities — mock API and test harness for plugin development.
 */

import type {
  AionimaPlugin,
  AionimaPluginAPI,
  AionimaHookMap,
  ActionDefinition,
  ProjectPanelDefinition,
  SettingsSectionDefinition,
  SettingsPageDefinition,
  DashboardInterfacePageDefinition,
  DashboardInterfaceDomainDefinition,
  SkillRegistration,
  KnowledgeNamespace,
  SystemServiceDefinition,
  ThemeDefinition,
  AgentToolDefinition,
  SidebarSectionDefinition,
  ScheduledTaskDefinition,
  WorkflowDefinition,
  DashboardTabDef,
  RuntimeDefinition,
  ServiceDefinition,
  LLMProviderDefinition,
} from "@agi/plugins";
import type { ProjectTypeDefinition, ProjectTypeTool, StackDefinition } from "@agi/gateway-core";
import type { AionimaChannelPlugin } from "@agi/channel-sdk";
import type { ScanProviderDefinition } from "@agi/security";
import type { WorkerDefinition } from "@agi/plugins";

export interface MockRegistrations {
  actions: ActionDefinition[];
  panels: ProjectPanelDefinition[];
  settingsSections: SettingsSectionDefinition[];
  settingsPages: SettingsPageDefinition[];
  dashboardPages: DashboardInterfacePageDefinition[];
  dashboardDomains: DashboardInterfaceDomainDefinition[];
  skills: SkillRegistration[];
  knowledge: KnowledgeNamespace[];
  systemServices: SystemServiceDefinition[];
  themes: ThemeDefinition[];
  agentTools: AgentToolDefinition[];
  sidebarSections: SidebarSectionDefinition[];
  scheduledTasks: ScheduledTaskDefinition[];
  workflows: WorkflowDefinition[];
  httpRoutes: { method: string; path: string }[];
  runtimes: RuntimeDefinition[];
  services: ServiceDefinition[];
  stacks: StackDefinition[];
  channels: string[];
  providers: LLMProviderDefinition[];
  pmProviders: { id: string; name: string }[];
  mcpServerTemplates: { id: string; name: string }[];
  scanProviders: ScanProviderDefinition[];
  workers: WorkerDefinition[];
  hooks: { hook: string; handler: unknown }[];
}

export interface MockAPIOptions {
  config?: Record<string, unknown>;
  workspaceRoot?: string;
  projectDirs?: string[];
}

export function createMockAPI(options: MockAPIOptions = {}): { api: AionimaPluginAPI; registrations: MockRegistrations } {
  const registrations: MockRegistrations = {
    actions: [],
    panels: [],
    settingsSections: [],
    settingsPages: [],
    dashboardPages: [],
    dashboardDomains: [],
    skills: [],
    knowledge: [],
    systemServices: [],
    themes: [],
    agentTools: [],
    sidebarSections: [],
    scheduledTasks: [],
    workflows: [],
    httpRoutes: [],
    runtimes: [],
    services: [],
    stacks: [],
    channels: [],
    providers: [],
    pmProviders: [],
    mcpServerTemplates: [],
    scanProviders: [],
    workers: [],
    hooks: [],
  };

  const api: AionimaPluginAPI = {
    registerProjectType(_def: ProjectTypeDefinition): void { /* mock */ },
    registerTool(_projectType: string, _tool: ProjectTypeTool): void { /* mock */ },
    registerHook<K extends keyof AionimaHookMap>(hook: K, handler: AionimaHookMap[K]): void {
      registrations.hooks.push({ hook, handler });
    },
    registerHttpRoute(method: string, path: string): void {
      registrations.httpRoutes.push({ method, path });
    },
    registerDashboardTab(_projectType: string, _tab: DashboardTabDef): void { /* mock */ },
    registerRuntime(def: RuntimeDefinition): void { registrations.runtimes.push(def); },
    registerService(def: ServiceDefinition): void { registrations.services.push(def); },
    registerHostingExtension(): void { /* mock */ },
    registerStack(def: StackDefinition): void { registrations.stacks.push(def); },
    registerRuntimeInstaller(): void { /* mock */ },
    registerChannel(_plugin: AionimaChannelPlugin): void { registrations.channels.push(_plugin.id as string); },
    registerChannelV2(_def: { id: string }): void { /* mock; CHN-B s163 slice 2 */ },
    registerProvider(def: LLMProviderDefinition): void { registrations.providers.push(def); },
    registerPmProvider(def: { id: string; name: string }): void { registrations.pmProviders.push({ id: def.id, name: def.name }); },
    registerMcpServerTemplate(def: { id: string; name: string }): void { registrations.mcpServerTemplates.push({ id: def.id, name: def.name }); },
    registerAction(def: ActionDefinition): void { registrations.actions.push(def); },
    registerProjectPanel(def: ProjectPanelDefinition): void { registrations.panels.push(def); },
    registerSettingsSection(def: SettingsSectionDefinition): void { registrations.settingsSections.push(def); },
    registerSkill(def: SkillRegistration): void { registrations.skills.push(def); },
    registerKnowledge(def: KnowledgeNamespace): void { registrations.knowledge.push(def); },
    registerSystemService(def: SystemServiceDefinition): void { registrations.systemServices.push(def); },
    registerTheme(def: ThemeDefinition): void { registrations.themes.push(def); },
    registerAgentTool(def: AgentToolDefinition): void { registrations.agentTools.push(def); },
    registerSidebarSection(def: SidebarSectionDefinition): void { registrations.sidebarSections.push(def); },
    registerScheduledTask(def: ScheduledTaskDefinition): void { registrations.scheduledTasks.push(def); },
    registerWorkflow(def: WorkflowDefinition): void { registrations.workflows.push(def); },
    registerSettingsPage(def: SettingsPageDefinition): void { registrations.settingsPages.push(def); },
    registerDashboardPage(def: DashboardInterfacePageDefinition): void { registrations.dashboardPages.push(def); },
    registerDashboardDomain(def: DashboardInterfaceDomainDefinition): void { registrations.dashboardDomains.push(def); },
    registerSubdomainRoute(): void {},
    registerScanProvider(def: ScanProviderDefinition): void { registrations.scanProviders.push(def); },
    registerWorker(def: WorkerDefinition): void { registrations.workers.push(def); },
    getChannelConfig(): undefined { return undefined; },
    getConfig(): Record<string, unknown> { return { ...options.config }; },
    getLogger() { return { debug() {}, info() {}, warn() {}, error() {} }; },
    getWorkspaceRoot(): string { return options.workspaceRoot ?? "/tmp/test"; },
    getProjectDirs(): string[] { return [...(options.projectDirs ?? [])]; },
    getProjectConfig(): null { return null; },
    getProjectStacks(): Array<{ stackId: string; addedAt: string }> { return []; },
  };

  return { api, registrations };
}

export async function testActivate(plugin: AionimaPlugin, options: MockAPIOptions = {}): Promise<MockRegistrations> {
  const { api, registrations } = createMockAPI(options);
  await plugin.activate(api);
  return registrations;
}
