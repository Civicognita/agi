/**
 * PM API — Settings/Project → Plans REST surface (s155 t671 / Wish #17).
 *
 * Owner directive 2026-05-08: "there should always be the PM-lite workflow
 * and UI that is always available and file based … project management
 * should have one entryway but many functions, so reading/writing/updating
 * plans should be part of the pm agent tool and our tools should layer
 * operations."
 *
 * The agent already has the `pm` tool (server.ts) wired through
 * LayeredPmProvider. This file is the dashboard-facing twin: same
 * pmProvider + planStore consumed via REST so the PM-Lite UI panel can
 * surface DONE/CURRENT/NEXT views regardless of remote PM provider
 * availability.
 *
 * Naming note: the dashboard refers to this surface as "PM-Lite" (the
 * file-based floor; the always-available view). The provider behind the
 * REST endpoints may be tynn-lite, tynn (remote), or any plugin-registered
 * provider — the LayeredPmProvider hides that decision from the UI. From
 * the user's POV, "PM" / "Plans" is one surface that always works.
 */

import type { FastifyInstance } from "fastify";
import type { PmProvider, PmStatus } from "@agi/sdk";
import type { PlanStore } from "./plan-store.js";
import {
  readSyncConflicts,
  readSyncConflictsForProject,
  readSyncQueue,
  readSyncQueueForProject,
  resolveSyncConflict,
} from "./pm/sync-queue.js";

export interface PmApiDeps {
  pmProvider: PmProvider;
  planStore: PlanStore;
  /** Workspace project paths — used to validate `projectPath` query params
   *  belong to a configured workspace. Mirrors the pattern used by
   *  /api/projects routes. */
  workspaceProjects: string[];
}

/**
 * View → status filter mapping for DONE/CURRENT/NEXT.
 *
 * Owner clarified DONE/CURRENT/NEXT are VIEWS, not kanban status/state —
 * the kanban states (backlog/starting/doing/testing/finished/blocked) feed
 * into these views per a fixed shape:
 *   - DONE    = anything finished (completed work)
 *   - CURRENT = in-flight (starting, doing, testing)
 *   - NEXT    = upcoming (backlog) PLUS currently-blocked items so they
 *               surface where the owner expects to see "what should we work on"
 *
 * Archived tasks are out of every view by default.
 */
export const PM_VIEW_STATUSES: Record<"done" | "current" | "next", PmStatus[]> = Object.freeze({
  done: ["finished"],
  current: ["starting", "doing", "testing"],
  next: ["backlog", "blocked"],
});

export type PmView = keyof typeof PM_VIEW_STATUSES;

function isPmView(value: string): value is PmView {
  return value === "done" || value === "current" || value === "next";
}

export function registerPmRoutes(app: FastifyInstance, deps: PmApiDeps): void {
  /**
   * GET /api/pm/next
   *
   * The current "what should we work on" tuple — active version + top story
   * + active tasks. Mirror of the agent tool's `pm action=next`. Used by
   * the dashboard's PM-Lite shelf header.
   */
  app.get("/api/pm/next", async () => {
    const result = await deps.pmProvider.getNext();
    return {
      ...result,
      providerId: deps.pmProvider.providerId,
    };
  });

  /**
   * GET /api/pm/find-tasks?storyId=...&status=...&limit=...
   *
   * Filtered task list. Both string and array statuses are accepted via
   * repeated `?status=` params. Powers DONE/CURRENT/NEXT view tabs by
   * passing the matching `PM_VIEW_STATUSES[view]` array.
   */
  app.get("/api/pm/find-tasks", async (request) => {
    const query = request.query as { storyId?: string; status?: string | string[]; limit?: string };
    const filter: { storyId?: string; status?: PmStatus | PmStatus[]; limit?: number } = {};
    if (typeof query.storyId === "string" && query.storyId.length > 0) {
      filter.storyId = query.storyId;
    }
    if (Array.isArray(query.status)) {
      filter.status = query.status as PmStatus[];
    } else if (typeof query.status === "string" && query.status.length > 0) {
      filter.status = query.status as PmStatus;
    }
    if (typeof query.limit === "string" && query.limit.length > 0) {
      const n = Number(query.limit);
      if (Number.isFinite(n) && n > 0) filter.limit = Math.floor(n);
    }
    const tasks = await deps.pmProvider.findTasks(filter);
    return { tasks, providerId: deps.pmProvider.providerId };
  });

  /**
   * GET /api/pm/view?view=done|current|next&storyId=...
   *
   * Convenience wrapper around find-tasks for the three canonical views.
   * Single round-trip from the dashboard; same pmProvider + same response
   * shape as find-tasks but with the view label echoed for the UI tab.
   */
  app.get("/api/pm/view", async (request, reply) => {
    const query = request.query as { view?: string; storyId?: string; limit?: string };
    const viewParam = String(query.view ?? "current");
    if (!isPmView(viewParam)) {
      return reply.code(400).send({
        error: `unknown view: ${viewParam}. Valid: done, current, next`,
      });
    }
    const filter: { storyId?: string; status: PmStatus[]; limit?: number } = {
      status: [...PM_VIEW_STATUSES[viewParam]],
    };
    if (typeof query.storyId === "string" && query.storyId.length > 0) {
      filter.storyId = query.storyId;
    }
    if (typeof query.limit === "string" && query.limit.length > 0) {
      const n = Number(query.limit);
      if (Number.isFinite(n) && n > 0) filter.limit = Math.floor(n);
    }
    const tasks = await deps.pmProvider.findTasks(filter);
    return { view: viewParam, tasks, providerId: deps.pmProvider.providerId };
  });

  /**
   * GET /api/pm/plans?projectPath=/abs/path
   *
   * Per-project plan list straight from PlanStore (file-based, always
   * available regardless of remote PM provider). projectPath must match
   * one of the configured workspace.projects roots.
   */
  app.get("/api/pm/plans", async (request, reply) => {
    const query = request.query as { projectPath?: string };
    const projectPath = String(query.projectPath ?? "");
    if (projectPath.length === 0) {
      return reply.code(400).send({ error: "projectPath query param is required" });
    }
    if (!isInsideWorkspace(projectPath, deps.workspaceProjects)) {
      return reply.code(403).send({ error: "projectPath is not inside a configured workspace.projects directory" });
    }
    const plans = deps.planStore.list(projectPath);
    return { plans, projectPath };
  });

  /**
   * GET /api/pm/plans/:planId?projectPath=/abs/path
   *
   * Single plan lookup. Same projectPath validation as the list endpoint.
   */
  app.get<{ Params: { planId: string } }>("/api/pm/plans/:planId", async (request, reply) => {
    const { planId } = request.params;
    const query = request.query as { projectPath?: string };
    const projectPath = String(query.projectPath ?? "");
    if (projectPath.length === 0) {
      return reply.code(400).send({ error: "projectPath query param is required" });
    }
    if (!isInsideWorkspace(projectPath, deps.workspaceProjects)) {
      return reply.code(403).send({ error: "projectPath is not inside a configured workspace.projects directory" });
    }
    const plan = deps.planStore.get(projectPath, planId);
    if (plan === null) {
      return reply.code(404).send({ error: `plan ${planId} not found in ${projectPath}` });
    }
    return plan;
  });

  // -------------------------------------------------------------------------
  // s155 t672 Phase 5a — sync queue + conflicts REST surface
  //
  // Read-only view of the layered-write retry queue + soft-conflict log
  // populated by the SyncReplayWorker. POST .../resolve removes a conflict
  // entry (owner has triaged it). The dashboard "⚠ Conflicts" panel
  // (Phase 5b, follow-on UI cycle) consumes these.
  // -------------------------------------------------------------------------

  app.get("/api/pm/sync-queue", async (request) => {
    const query = request.query as { projectPath?: string };
    const projectPath = typeof query.projectPath === "string" ? query.projectPath : "";
    if (projectPath.length === 0) {
      return { entries: readSyncQueue() };
    }
    return { entries: readSyncQueueForProject(projectPath) };
  });

  app.get("/api/pm/sync-conflicts", async (request) => {
    const query = request.query as { projectPath?: string };
    const projectPath = typeof query.projectPath === "string" ? query.projectPath : "";
    if (projectPath.length === 0) {
      return { conflicts: readSyncConflicts() };
    }
    return { conflicts: readSyncConflictsForProject(projectPath) };
  });

  app.post<{ Params: { id: string } }>("/api/pm/sync-conflicts/:id/resolve", async (request, reply) => {
    const { id } = request.params;
    if (!resolveSyncConflict(id)) {
      return reply.code(404).send({ error: `sync conflict ${id} not found` });
    }
    return { resolved: id };
  });
}

function isInsideWorkspace(projectPath: string, workspaceProjects: readonly string[]): boolean {
  const normalize = (p: string): string => (p.endsWith("/") ? p : `${p}/`);
  const targetPrefix = normalize(projectPath);
  for (const ws of workspaceProjects) {
    const wsPrefix = normalize(ws);
    if (targetPrefix === wsPrefix) return false; // workspace root itself is not a project
    if (projectPath.startsWith(wsPrefix)) return true;
  }
  return false;
}
