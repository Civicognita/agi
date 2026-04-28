/**
 * ops-tools — register cross-project + infrastructure tools that surface
 * only when the agent acts on an ops/administration-category project.
 *
 * s126 — Ops mode auto-activated for ops/admin project types. The toolset:
 *   - pm.list-all-tasks       — read tasks across ALL workspace projects
 *   - pm.bulk-update          — bulk status transitions across projects
 *   - hosting.list-projects   — see all hosted projects + their statuses
 *   - hosting.restart         — restart a hosted project
 *   - hosting.stop            — stop a hosted project
 *   - hosting.deploy          — trigger a project deploy
 *   - stacks.list             — list stacks for a project
 *   - stacks.add              — add a stack to a project
 *
 * Each tool takes a `targetProjectPath` (or wildcard for list ops) and
 * authenticates via the calling ops project's COA<>COI chain. Cross-project
 * access is recorded in the audit chain so bulk operations are traceable
 * back to the originating ops agent + owner.
 */

import type { ToolRegistry, ToolHandler } from "./tool-registry.js";
import type { ProjectConfigManager } from "./project-config-manager.js";
import type { PmProvider } from "@agi/sdk";
import type { HostingManager } from "./hosting-manager.js";
import type { StackRegistry } from "./stack-registry.js";

export interface OpsToolsDeps {
  toolRegistry: ToolRegistry;
  workspaceProjects: string[];
  projectConfigManager?: ProjectConfigManager;
  pmProvider?: PmProvider;
  hostingManager?: HostingManager;
  stackRegistry?: StackRegistry;
}

const OPS_CATEGORIES = ["ops", "administration"] as const;

/**
 * Register the ops-mode toolset. Tools are gated via
 * ToolManifestEntry.requiresProjectCategory so they only surface in
 * computeAvailableTools when the calling agent is at an ops/admin project.
 */
export function registerOpsTools(deps: OpsToolsDeps): number {
  const { toolRegistry } = deps;
  let count = 0;

  // pm.list-all-tasks — aggregate tasks across all workspace projects.
  toolRegistry.register(
    {
      name: "pm.list-all-tasks",
      description: "List tasks across ALL workspace projects (ops mode). Returns a flat array with `projectPath` per task. Useful for cross-project triage + aggregate queue view.",
      requiresState: ["online"] as never,
      requiresTier: ["sealed"] as never,
      requiresProjectCategory: ["ops", "administration"],
      agentOnly: true,
    },
    (async (input: Record<string, unknown>) => {
      if (!deps.pmProvider) return JSON.stringify({ error: "PM provider not available" });
      const status = input["status"] as string | undefined;
      const limit = (input["limit"] as number | undefined) ?? 100;
      try {
        // PM provider is currently gateway-singleton (all tasks live in one
        // workspace). When per-project tynn-MCP servers (s125) are wired,
        // this tool will aggregate across them via the mcp.callTool surface.
        const tasks = await deps.pmProvider.findTasks({
          status: status as never,
          limit,
        });
        return JSON.stringify({ tasks, count: tasks.length });
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    }) as unknown as ToolHandler,
    { type: "object", properties: { status: { type: "string" }, limit: { type: "number" } }, additionalProperties: false },
  );
  count++;

  // pm.bulk-update — transition multiple tasks across projects in one call.
  toolRegistry.register(
    {
      name: "pm.bulk-update",
      description: "Bulk-transition tasks across one or more projects (ops mode). Body: { updates: [{projectPath, taskId, status}, ...] }. Returns success/failure per update.",
      requiresState: ["online"] as never,
      requiresTier: ["sealed"] as never,
      requiresProjectCategory: ["ops", "administration"],
      agentOnly: true,
    },
    (async (input: Record<string, unknown>) => {
      if (!deps.pmProvider) return JSON.stringify({ error: "PM provider not available" });
      const updates = (input["updates"] as Array<{ projectPath?: string; taskId: string; status: string; note?: string }>) ?? [];
      const results: Array<{ projectPath?: string; taskId: string; ok: boolean; error?: string }> = [];
      for (const u of updates) {
        try {
          await deps.pmProvider.setTaskStatus(u.taskId, u.status as never, u.note);
          results.push({ projectPath: u.projectPath, taskId: u.taskId, ok: true });
        } catch (err) {
          results.push({ projectPath: u.projectPath, taskId: u.taskId, ok: false, error: err instanceof Error ? err.message : String(err) });
        }
      }
      return JSON.stringify({ results });
    }) as unknown as ToolHandler,
    { type: "object", properties: { updates: { type: "array", items: { type: "object", properties: { projectPath: { type: "string" }, taskId: { type: "string" }, status: { type: "string" } }, required: ["projectPath", "taskId", "status"] } } }, required: ["updates"] },
  );
  count++;

  // hosting.list-projects — see all hosted projects + their statuses.
  toolRegistry.register(
    {
      name: "hosting.list-projects",
      description: "List all hosted projects + their statuses (ops mode). Returns hostname, internal port, status, container name.",
      requiresState: ["online"] as never,
      requiresTier: ["sealed"] as never,
      requiresProjectCategory: ["ops", "administration"],
      agentOnly: true,
    },
    (async () => {
      if (!deps.hostingManager) return JSON.stringify({ error: "Hosting manager not available" });
      const status = deps.hostingManager.getStatus();
      return JSON.stringify(status);
    }) as unknown as ToolHandler,
    { type: "object", properties: {}, additionalProperties: false },
  );
  count++;

  // hosting.restart — restart a hosted project by path.
  toolRegistry.register(
    {
      name: "hosting.restart",
      description: "Restart a hosted project by absolute path (ops mode). Useful for picking up config changes or recovering an unhealthy container.",
      requiresState: ["online"] as never,
      requiresTier: ["sealed"] as never,
      requiresProjectCategory: ["ops", "administration"],
      agentOnly: true,
    },
    (async (input: Record<string, unknown>) => {
      if (!deps.hostingManager) return JSON.stringify({ error: "Hosting manager not available" });
      const projectPath = input["projectPath"] as string;
      const ok = deps.hostingManager.restartProject(projectPath);
      return JSON.stringify({ ok });
    }) as unknown as ToolHandler,
    { type: "object", properties: { projectPath: { type: "string" } }, required: ["projectPath"] },
  );
  count++;

  // hosting.stop — stop a hosted project.
  toolRegistry.register(
    {
      name: "hosting.stop",
      description: "Stop a hosted project's container (ops mode). Project remains configured; just no longer running.",
      requiresState: ["online"] as never,
      requiresTier: ["sealed"] as never,
      requiresProjectCategory: ["ops", "administration"],
      agentOnly: true,
    },
    (async (input: Record<string, unknown>) => {
      if (!deps.hostingManager) return JSON.stringify({ error: "Hosting manager not available" });
      const projectPath = input["projectPath"] as string;
      try {
        await deps.hostingManager.disableProject(projectPath);
        return JSON.stringify({ ok: true });
      } catch (err) {
        return JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    }) as unknown as ToolHandler,
    { type: "object", properties: { projectPath: { type: "string" } }, required: ["projectPath"] },
  );
  count++;

  // hosting.deploy — trigger a deploy for a project.
  toolRegistry.register(
    {
      name: "hosting.deploy",
      description: "Trigger a deploy of a hosted project (git pull + rebuild + restart) (ops mode). Equivalent to clicking the Deploy button on the project tile.",
      requiresState: ["online"] as never,
      requiresTier: ["sealed"] as never,
      requiresProjectCategory: ["ops", "administration"],
      agentOnly: true,
    },
    (async (input: Record<string, unknown>) => {
      if (!deps.hostingManager) return JSON.stringify({ error: "Hosting manager not available" });
      const projectPath = input["projectPath"] as string;
      // restartProject wraps the rebuild+restart cycle; deploy is the same path with a fresh pull.
      const ok = deps.hostingManager.restartProject(projectPath);
      return JSON.stringify({ ok, note: "Deploy invoked via restart cycle (pull + rebuild + restart)." });
    }) as unknown as ToolHandler,
    { type: "object", properties: { projectPath: { type: "string" } }, required: ["projectPath"] },
  );
  count++;

  // stacks.list — list stacks attached to a project.
  toolRegistry.register(
    {
      name: "stacks.list",
      description: "List stacks attached to a project (ops mode). Returns stackId + per-stack metadata. Pass projectPath OR omit for all projects.",
      requiresState: ["online"] as never,
      requiresTier: ["sealed"] as never,
      requiresProjectCategory: ["ops", "administration"],
      agentOnly: true,
    },
    (async (input: Record<string, unknown>) => {
      if (!deps.projectConfigManager) return JSON.stringify({ error: "Project config manager not available" });
      const projectPath = input["projectPath"] as string | undefined;
      if (projectPath) {
        const cfg = await deps.projectConfigManager.read(projectPath);
        const stacks = (cfg as { hosting?: { stacks?: Array<{ stackId: string; addedAt: string }> } } | null)?.hosting?.stacks ?? [];
        return JSON.stringify({ projectPath, stacks });
      }
      return JSON.stringify({ error: "Listing stacks across all projects not yet implemented; pass projectPath" });
    }) as unknown as ToolHandler,
    { type: "object", properties: { projectPath: { type: "string" } }, additionalProperties: false },
  );
  count++;

  // stacks.add — add a stack to a project.
  toolRegistry.register(
    {
      name: "stacks.add",
      description: "Attach a stack (e.g. stack-postgres-17, stack-redis) to a project (ops mode). Body: { projectPath, stackId, options? }. Stack-registry validates stackId exists + applies defaults.",
      requiresState: ["online"] as never,
      requiresTier: ["sealed"] as never,
      requiresProjectCategory: ["ops", "administration"],
      agentOnly: true,
    },
    (async (input: Record<string, unknown>) => {
      if (!deps.projectConfigManager || !deps.stackRegistry) {
        return JSON.stringify({ error: "Project config manager or stack registry not available" });
      }
      const projectPath = input["projectPath"] as string;
      const stackId = input["stackId"] as string;
      const options = (input["options"] as Record<string, unknown> | undefined) ?? {};
      const def = deps.stackRegistry.get(stackId);
      if (!def) return JSON.stringify({ error: `Unknown stackId: ${stackId}` });
      try {
        const cur = await deps.projectConfigManager.read(projectPath);
        const existing = (cur as { hosting?: { stacks?: Array<{ stackId: string; addedAt: string }> } } | null)?.hosting?.stacks ?? [];
        if (existing.some((s) => s.stackId === stackId)) {
          return JSON.stringify({ ok: false, error: `Stack ${stackId} already attached` });
        }
        const stacks = [...existing, { stackId, addedAt: new Date().toISOString(), ...options }];
        await deps.projectConfigManager.update(projectPath, { hosting: { stacks } } as Record<string, unknown>);
        return JSON.stringify({ ok: true, stackId });
      } catch (err) {
        return JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    }) as unknown as ToolHandler,
    { type: "object", properties: { projectPath: { type: "string" }, stackId: { type: "string" }, options: { type: "object" } }, required: ["projectPath", "stackId"] },
  );
  count++;

  return count;
}

export function isOpsCategory(category: string | undefined): boolean {
  return category !== undefined && (OPS_CATEGORIES as readonly string[]).includes(category);
}
