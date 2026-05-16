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
import { createDirCreateHandler, DIR_CREATE_MANIFEST, DIR_CREATE_INPUT_SCHEMA } from "./dir-create.js";
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
import {
  createTaskmasterHandoffHandler,
  TASKMASTER_HANDOFF_MANIFEST,
  TASKMASTER_HANDOFF_INPUT_SCHEMA,
} from "./taskmaster-handoff.js";
import {
  createTaskmasterCancelHandler,
  TASKMASTER_CANCEL_MANIFEST,
  TASKMASTER_CANCEL_INPUT_SCHEMA,
} from "./taskmaster-cancel.js";

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

// Plan tools — handlers/manifests retired (plans now via pm tool Wish #17)

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

// Builder tools (MagicApp creation/editing)
import { BUILDER_TOOLS } from "./builder-tools.js";

// Web page tool
import { createGetWebPageHandler, GET_WEB_PAGE_MANIFEST, GET_WEB_PAGE_INPUT_SCHEMA } from "./web-page.js";

// Browser session tool (replaces visual-inspect with full Playwright session)
import { createBrowserSessionHandler, BROWSER_SESSION_MANIFEST, BROWSER_SESSION_INPUT_SCHEMA } from "./browser-session.js";


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
  /** Workspace project directories — enables manage_project tool. */
  projectDirs?: string[];
  /** ProjectConfigManager for validated project config I/O. */
  projectConfigManager?: import("../project-config-manager.js").ProjectConfigManager;
  /** Optional override for the TaskMaster dispatch base dir. Production leaves this unset (defaults to ~/.agi/{projectSlug}/dispatch/). Tests use it to redirect dispatch writes. */
  dispatchDirOverride?: string;
  /** Callback fired when taskmaster_dispatch creates a job. */
  onJobCreated?: (args: {
    jobId: string;
    coaReqId: string;
    projectPath: string;
    sessionKey?: string;
    chatSessionId?: string;
    planRef?: { planId: string; stepId: string };
  }) => void;
  /** Callback fired when a worker calls taskmaster_handoff. Wired to WorkerRuntime runtime:event. */
  onHandoff?: (args: { jobId: string; question: string; projectPath: string; coaReqId?: string }) => void;
  /** Callback fired when Aion calls taskmaster_cancel. Wired to WorkerRuntime.cancelJob. */
  onCancel?: (args: { jobId: string; projectPath: string; reason: string }) => void;
  /** COA request ID for the current invocation context. */
  coaReqId?: string;
  /** Image blob store for screenshot storage (visual-inspect tool). */
  imageBlobStore?: import("../image-blob-store.js").ImageBlobStore;
  /** Late-bound hosting manager ref — populated after boot. */
  hostingManagerRef?: { current: unknown | null };
  /** Late-bound stack registry ref — populated after boot. */
  stackRegistryRef?: { current: unknown | null };
  /** Late-bound MApp registry ref — populated after boot. */
  mappRegistryRef?: { current: unknown | null };
  /**
   * s130 t515 slice 6b (cycle 114) — cage production wire-up.
   *
   * Per-invocation cage provider for path-touching tools (shell_exec,
   * file_read, file_write, dir_list, grep_search). When set, the
   * tool registry threads this through to each handler's config; the
   * handler calls it on each invocation to get the caller's current
   * Cage and gates path access via isPathInCage.
   *
   * When undefined (today's default), tools fall back to the legacy
   * workspaceRoot.startsWith check — preserves today's behavior.
   *
   * Slice 6b-ii (next slice) implements the actual session-context-
   * derived provider in server.ts. This slice (6b-i) just adds the
   * plumbing — registerAllTools accepts the field and passes it
   * through.
   */
  cageProvider?: () => import("../agent-cage.js").Cage | null;
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
  // s130 t515 slice 6b — thread cageProvider through to all path-touching
  // tools. file-read/write/dir-list/grep-search use it via their shared
  // PathGateConfig (cycle 96 cage-gate.ts); shell-exec uses it inline
  // (cycle 95 slice 6a). When undefined, tools preserve legacy
  // workspaceRoot.startsWith behavior.
  const toolConfig = {
    workspaceRoot: config.workspaceRoot,
    dispatchDirOverride: config.dispatchDirOverride,
    cageProvider: config.cageProvider,
  };
  const tmToolConfig = { dispatchDirOverride: config.dispatchDirOverride };
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
  register(DIR_CREATE_MANIFEST as ToolManifestEntry, createDirCreateHandler(toolConfig), DIR_CREATE_INPUT_SCHEMA);
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

  // TaskMaster tools — per-project dispatch dir, no workspaceRoot dependency.
  register(
    WORKER_DISPATCH_MANIFEST as ToolManifestEntry,
    createWorkerDispatchHandler({
      ...tmToolConfig,
      onJobCreated: config.onJobCreated,
      coaReqId: config.coaReqId,
    }),
    WORKER_DISPATCH_INPUT_SCHEMA,
  );
  register(
    WORKER_STATUS_MANIFEST as ToolManifestEntry,
    createWorkerStatusHandler(tmToolConfig),
    WORKER_STATUS_INPUT_SCHEMA,
  );
  register(
    TASKMASTER_HANDOFF_MANIFEST as ToolManifestEntry,
    createTaskmasterHandoffHandler({
      ...tmToolConfig,
      onHandoff: config.onHandoff,
    }),
    TASKMASTER_HANDOFF_INPUT_SCHEMA,
  );
  register(
    TASKMASTER_CANCEL_MANIFEST as ToolManifestEntry,
    createTaskmasterCancelHandler({
      ...tmToolConfig,
      onCancel: config.onCancel,
    }),
    TASKMASTER_CANCEL_INPUT_SCHEMA,
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

  // Plan tools — RETIRED. Plans are now part of the `pm` tool (Wish #17,
  // 2026-05-08): use pm(action: "plan-create") / "plan-update" / "plan-list"
  // / "plan-get". The standalone create_plan / update_plan tools are no
  // longer registered; Aion reaches for `pm` because its description marks
  // it as the single PM entryway. Files (plan-store.ts, create-plan.ts,
  // update-plan.ts) kept for PlanStore import; manifests unused.

  // Project tools (only registered if projectDirs configured)
  if (config.projectDirs !== undefined && config.projectDirs.length > 0) {
    // Late-bound refs: resolve at tool call time, not registration time.
    // HostingManager, StackRegistry, MAppRegistry boot after tool registration.
    const hostingRef = config.hostingManagerRef;
    const stackRef = config.stackRegistryRef;
    const mappRef = config.mappRegistryRef;
    register(
      MANAGE_PROJECT_MANIFEST as ToolManifestEntry,
      createManageProjectHandler({
        projectDirs: config.projectDirs,
        projectConfigManager: config.projectConfigManager,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- late-bound ref
        hostingManager: hostingRef ? (() => {
          const mgr = () => hostingRef.current as any;
          return {
            getProjectHostingInfo: (p: string) => mgr()?.getProjectHostingInfo(p),
            getProjectDevCommands: (p: string) => (mgr()?.getProjectDevCommands(p) ?? {}) as Record<string, string>,
            detectProjectDefaults: (p: string) => mgr()?.detectProjectDefaults(p) as { projectType: string; docRoot: string; startCommand: string | null },
            enableProject: (p: string, m: unknown) => mgr()?.enableProject(p, m) as Promise<void>,
            disableProject: (p: string) => mgr()?.disableProject(p) as Promise<void>,
            restartProject: (p: string) => mgr()?.restartProject(p) as { ok: boolean; error?: string },
            regenerateCaddyfile: () => mgr()?.regenerateCaddyfile(),
          };
        })() : undefined,
        stackRegistry: stackRef ? { get: (id: string) => (stackRef.current as { get(id: string): unknown } | null)?.get(id) as { id: string; label: string; description: string; category: string } | undefined } : undefined,
        mappRegistry: mappRef ? { get: (id: string) => (mappRef.current as { get(id: string): unknown } | null)?.get(id) as { id: string; name: string; description: string; category: string; version: string } | undefined } : undefined,
      }),
      MANAGE_PROJECT_INPUT_SCHEMA,
    );
  }

  // Web page tool — fetch and sanitize web content
  register(GET_WEB_PAGE_MANIFEST as ToolManifestEntry, createGetWebPageHandler(), GET_WEB_PAGE_INPUT_SCHEMA);

  // Browser session tool — full Playwright interaction (requires imageBlobStore)
  if (config.imageBlobStore !== undefined) {
    register(
      BROWSER_SESSION_MANIFEST as ToolManifestEntry,
      createBrowserSessionHandler({ imageBlobStore: config.imageBlobStore }),
      BROWSER_SESSION_INPUT_SCHEMA,
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

    // Builder tools (MApp creation/editing via BuilderChat)
    for (const tool of BUILDER_TOOLS) {
      register(
        tool.manifest as ToolManifestEntry,
        tool.createHandler({ mappRegistry: config.mappRegistry }),
        tool.schema,
      );
    }
  }

  return count;
}
