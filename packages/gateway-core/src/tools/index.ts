/**
 * Tool Registration Barrel
 *
 * Registers all tools (dev tools, git tools, canvas) into a ToolRegistry.
 * Called during server boot Step 5b.
 */

import type { ToolRegistry, ToolHandler } from "../tool-registry.js";
import type { ToolManifestEntry } from "../system-prompt.js";

// Dev tools
import { createShellExecHandler, SHELL_EXEC_MANIFEST, SHELL_EXEC_INPUT_SCHEMA } from "./shell-exec.js";
import { createFileReadHandler, FILE_READ_MANIFEST, FILE_READ_INPUT_SCHEMA } from "./file-read.js";
import { createFileWriteHandler, FILE_WRITE_MANIFEST, FILE_WRITE_INPUT_SCHEMA } from "./file-write.js";
import { createDirListHandler, DIR_LIST_MANIFEST, DIR_LIST_INPUT_SCHEMA } from "./dir-list.js";
import { createGrepSearchHandler, GREP_SEARCH_MANIFEST, GREP_SEARCH_INPUT_SCHEMA } from "./grep-search.js";

// Git tools
import {
  createGitStatusHandler, GIT_STATUS_MANIFEST, GIT_STATUS_INPUT_SCHEMA,
  createGitDiffHandler, GIT_DIFF_MANIFEST, GIT_DIFF_INPUT_SCHEMA,
  createGitAddHandler, GIT_ADD_MANIFEST, GIT_ADD_INPUT_SCHEMA,
  createGitCommitHandler, GIT_COMMIT_MANIFEST, GIT_COMMIT_INPUT_SCHEMA,
  createGitBranchHandler, GIT_BRANCH_MANIFEST, GIT_BRANCH_INPUT_SCHEMA,
} from "./git-tools.js";

// Canvas tool
import {
  createCanvasToolHandler,
  CANVAS_TOOL_MANIFEST,
  CANVAS_TOOL_INPUT_SCHEMA,
} from "../canvas-tool.js";
import type { CanvasEmitHandler } from "../canvas-tool.js";

// Worker tools
import {
  createWorkerDispatchHandler,
  WORKER_DISPATCH_MANIFEST,
  WORKER_DISPATCH_INPUT_SCHEMA,
} from "./worker-dispatch.js";
import {
  createWorkerStatusHandler,
  WORKER_STATUS_MANIFEST,
  WORKER_STATUS_INPUT_SCHEMA,
} from "./worker-status.js";

// GitHub CLI tool
import {
  createGhCliHandler,
  GH_CLI_MANIFEST,
  GH_CLI_INPUT_SCHEMA,
} from "./gh-cli.js";

// User context tool
import {
  createUpdateUserContextHandler,
  UPDATE_USER_CONTEXT_MANIFEST,
  UPDATE_USER_CONTEXT_INPUT_SCHEMA,
} from "./update-user-context.js";
import type { UserContextStore } from "../user-context-store.js";

// PRIME knowledge tools
import {
  createSearchPrimeHandler,
  SEARCH_PRIME_MANIFEST,
  SEARCH_PRIME_INPUT_SCHEMA,
} from "./search-prime.js";
import {
  createLookupKnowledgeHandler,
  LOOKUP_KNOWLEDGE_MANIFEST,
  LOOKUP_KNOWLEDGE_INPUT_SCHEMA,
} from "./lookup-knowledge.js";
import type { PrimeLoader } from "../prime-loader.js";

// Plan tools
import {
  createCreatePlanHandler,
  CREATE_PLAN_MANIFEST,
  CREATE_PLAN_INPUT_SCHEMA,
} from "./create-plan.js";
import {
  createUpdatePlanHandler,
  UPDATE_PLAN_MANIFEST,
  UPDATE_PLAN_INPUT_SCHEMA,
} from "./update-plan.js";

// Project tools
import {
  createManageProjectHandler,
  MANAGE_PROJECT_MANIFEST,
  MANAGE_PROJECT_INPUT_SCHEMA,
} from "./project-tools.js";

// Agent tools (marketplace, system — kept from original)
import {
  createManageMarketplaceHandler,
  MANAGE_MARKETPLACE_MANIFEST,
  MANAGE_MARKETPLACE_INPUT_SCHEMA,
  createManageSystemHandler,
  MANAGE_SYSTEM_MANIFEST,
  MANAGE_SYSTEM_INPUT_SCHEMA,
} from "./agent-tools.js";
export type { AgentToolsConfig } from "./agent-tools.js";

// Consolidated tools (replacing manage_config + manage_plugins)
import {
  createManageSettingsHandler,
  MANAGE_SETTINGS_MANIFEST,
  MANAGE_SETTINGS_INPUT_SCHEMA,
} from "./settings-tools.js";

// Plugin tool proxy (replacing N individual plugin_* tool registrations)
import {
  createInvokePluginToolHandler,
  INVOKE_PLUGIN_TOOL_MANIFEST,
  INVOKE_PLUGIN_TOOL_INPUT_SCHEMA,
  buildPluginToolDescription,
} from "./plugin-tool-proxy.js";

// Plugin resource discovery
import {
  createQueryPluginResourcesHandler,
  QUERY_PLUGIN_RESOURCES_MANIFEST,
  QUERY_PLUGIN_RESOURCES_INPUT_SCHEMA,
} from "./plugin-resource-tools.js";


// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface ToolRegistrationConfig {
  workspaceRoot: string;
  /** Entity ID for canvas tool attribution. */
  resourceEntityId: string;
  /** Handler called when a canvas document is emitted. */
  onCanvasEmit: CanvasEmitHandler;
  /** Optional per-entity relationship context store (USER.md files). */
  userContextStore?: UserContextStore;
  /** Optional PRIME knowledge loader — enables search_prime and lookup_knowledge tools. */
  primeLoader?: PrimeLoader;
  /** Optional project path — enables create_plan and update_plan tools. */
  projectPath?: string;
  /** Workspace project directories — enables manage_project tool. */
  projectDirs?: string[];
  /** ProjectConfigManager for validated project config I/O. */
  projectConfigManager?: import("../project-config-manager.js").ProjectConfigManager;
  /** Resolved BOTS directory path. */
  botsDir?: string;
  /** Callback fired when worker_dispatch creates a job. */
  onJobCreated?: (jobId: string, coaReqId: string) => void;
  /** COA request ID for the current invocation context. */
  coaReqId?: string;
}

// ---------------------------------------------------------------------------
// Adapter: canvas manifest uses singular requiredState/requiredTier
// ---------------------------------------------------------------------------

function adaptCanvasManifest(): ToolManifestEntry {
  return {
    name: CANVAS_TOOL_MANIFEST.name,
    description: CANVAS_TOOL_MANIFEST.description,
    requiresState: [CANVAS_TOOL_MANIFEST.requiredState],
    requiresTier: [CANVAS_TOOL_MANIFEST.requiredTier],
  };
}

// ---------------------------------------------------------------------------
// registerAllTools
// ---------------------------------------------------------------------------

/**
 * Register all built-in tools into the given ToolRegistry.
 *
 * @returns Number of tools registered.
 */
export function registerAllTools(
  registry: ToolRegistry,
  config: ToolRegistrationConfig,
): number {
  const toolConfig = { workspaceRoot: config.workspaceRoot, botsDir: config.botsDir };
  let count = 0;

  const register = (
    manifest: ToolManifestEntry,
    handler: ReturnType<typeof createShellExecHandler>,
    inputSchema: Record<string, unknown>,
  ) => {
    registry.register(manifest, handler, inputSchema);
    count++;
  };

  // Dev tools
  register(SHELL_EXEC_MANIFEST as ToolManifestEntry, createShellExecHandler(toolConfig), SHELL_EXEC_INPUT_SCHEMA);
  register(FILE_READ_MANIFEST as ToolManifestEntry, createFileReadHandler(toolConfig), FILE_READ_INPUT_SCHEMA);
  register(FILE_WRITE_MANIFEST as ToolManifestEntry, createFileWriteHandler(toolConfig), FILE_WRITE_INPUT_SCHEMA);
  register(DIR_LIST_MANIFEST as ToolManifestEntry, createDirListHandler(toolConfig), DIR_LIST_INPUT_SCHEMA);
  register(GREP_SEARCH_MANIFEST as ToolManifestEntry, createGrepSearchHandler(toolConfig), GREP_SEARCH_INPUT_SCHEMA);

  // Git tools
  register(GIT_STATUS_MANIFEST as ToolManifestEntry, createGitStatusHandler(toolConfig), GIT_STATUS_INPUT_SCHEMA);
  register(GIT_DIFF_MANIFEST as ToolManifestEntry, createGitDiffHandler(toolConfig), GIT_DIFF_INPUT_SCHEMA);
  register(GIT_ADD_MANIFEST as ToolManifestEntry, createGitAddHandler(toolConfig), GIT_ADD_INPUT_SCHEMA);
  register(GIT_COMMIT_MANIFEST as ToolManifestEntry, createGitCommitHandler(toolConfig), GIT_COMMIT_INPUT_SCHEMA);
  register(GIT_BRANCH_MANIFEST as ToolManifestEntry, createGitBranchHandler(toolConfig), GIT_BRANCH_INPUT_SCHEMA);

  // Canvas tool (adapted manifest)
  register(
    adaptCanvasManifest(),
    createCanvasToolHandler(config.resourceEntityId, config.onCanvasEmit),
    CANVAS_TOOL_INPUT_SCHEMA,
  );

  // Worker tools
  register(
    WORKER_DISPATCH_MANIFEST as ToolManifestEntry,
    createWorkerDispatchHandler({
      ...toolConfig,
      onJobCreated: config.onJobCreated,
      coaReqId: config.coaReqId,
    }),
    WORKER_DISPATCH_INPUT_SCHEMA,
  );
  register(
    WORKER_STATUS_MANIFEST as ToolManifestEntry,
    createWorkerStatusHandler(toolConfig),
    WORKER_STATUS_INPUT_SCHEMA,
  );

  // GitHub CLI tool
  register(
    GH_CLI_MANIFEST as ToolManifestEntry,
    createGhCliHandler(toolConfig),
    GH_CLI_INPUT_SCHEMA,
  );

  // User context tool (only registered if store is provided)
  if (config.userContextStore !== undefined) {
    register(
      UPDATE_USER_CONTEXT_MANIFEST as ToolManifestEntry,
      createUpdateUserContextHandler({ userContextStore: config.userContextStore }),
      UPDATE_USER_CONTEXT_INPUT_SCHEMA,
    );
  }

  // PRIME knowledge tools (only registered if primeLoader is provided)
  if (config.primeLoader !== undefined) {
    register(
      SEARCH_PRIME_MANIFEST as ToolManifestEntry,
      createSearchPrimeHandler({ primeLoader: config.primeLoader }),
      SEARCH_PRIME_INPUT_SCHEMA,
    );
    register(
      LOOKUP_KNOWLEDGE_MANIFEST as ToolManifestEntry,
      createLookupKnowledgeHandler({ primeLoader: config.primeLoader }),
      LOOKUP_KNOWLEDGE_INPUT_SCHEMA,
    );
  }

  // Plan tools (only registered if projectPath is provided)
  if (config.projectPath !== undefined) {
    const planConfig = { projectPath: config.projectPath };
    register(
      CREATE_PLAN_MANIFEST as ToolManifestEntry,
      createCreatePlanHandler(planConfig),
      CREATE_PLAN_INPUT_SCHEMA,
    );
    register(
      UPDATE_PLAN_MANIFEST as ToolManifestEntry,
      createUpdatePlanHandler(planConfig),
      UPDATE_PLAN_INPUT_SCHEMA,
    );
  }

  // Project tools (only registered if projectDirs configured)
  if (config.projectDirs !== undefined && config.projectDirs.length > 0) {
    register(
      MANAGE_PROJECT_MANIFEST as ToolManifestEntry,
      createManageProjectHandler({ projectDirs: config.projectDirs, projectConfigManager: config.projectConfigManager }),
      MANAGE_PROJECT_INPUT_SCHEMA,
    );
  }

  return count;
}

// ---------------------------------------------------------------------------
// registerAgentTools
// ---------------------------------------------------------------------------

/**
 * Register agent management tools (marketplace, plugins, config, stacks,
 * system, hosting) into the given ToolRegistry.
 *
 * Called separately from registerAllTools because these tools depend on
 * services created later in the boot sequence (MarketplaceManager,
 * HostingManager, StackRegistry, etc.).
 *
 * @returns Number of tools registered.
 */
export function registerAgentTools(
  registry: ToolRegistry,
  config: import("./agent-tools.js").AgentToolsConfig,
): number {
  let count = 0;

  const register = (
    manifest: ToolManifestEntry,
    handler: ToolHandler,
    inputSchema: Record<string, unknown>,
  ) => {
    registry.register(manifest, handler, inputSchema);
    count++;
  };

  // Marketplace tools (only if marketplace manager is available)
  if (config.marketplaceManager !== undefined) {
    register(
      MANAGE_MARKETPLACE_MANIFEST as ToolManifestEntry,
      createManageMarketplaceHandler(config),
      MANAGE_MARKETPLACE_INPUT_SCHEMA,
    );
  }

  // Settings tools (consolidated config + plugins — replaces manage_config + manage_plugins)
  if (config.systemConfigService !== undefined) {
    register(
      MANAGE_SETTINGS_MANIFEST as ToolManifestEntry,
      createManageSettingsHandler({
        systemConfigService: config.systemConfigService,
        pluginRegistry: config.pluginRegistry,
        pluginPrefs: config.pluginPrefs,
        discoveredPlugins: config.discoveredPlugins,
      }),
      MANAGE_SETTINGS_INPUT_SCHEMA,
    );
  }

  // System tools (always available)
  register(
    MANAGE_SYSTEM_MANIFEST as ToolManifestEntry,
    createManageSystemHandler(config),
    MANAGE_SYSTEM_INPUT_SCHEMA,
  );

  // Plugin tool proxy (single tool routes to any plugin-provided agent tool)
  if (config.pluginRegistry !== undefined) {
    const proxyManifest = {
      ...INVOKE_PLUGIN_TOOL_MANIFEST,
      description: buildPluginToolDescription(config.pluginRegistry),
    };
    register(
      proxyManifest as ToolManifestEntry,
      createInvokePluginToolHandler({ pluginRegistry: config.pluginRegistry }),
      INVOKE_PLUGIN_TOOL_INPUT_SCHEMA,
    );

    // Plugin resource discovery (read-only catalog queries)
    register(
      QUERY_PLUGIN_RESOURCES_MANIFEST as ToolManifestEntry,
      createQueryPluginResourcesHandler({
        pluginRegistry: config.pluginRegistry,
        stackRegistry: config.stackRegistry,
        projectTypeRegistry: config.hostingManager?.getProjectTypeRegistry() ?? undefined,
      }),
      QUERY_PLUGIN_RESOURCES_INPUT_SCHEMA,
    );
  }

  return count;
}
