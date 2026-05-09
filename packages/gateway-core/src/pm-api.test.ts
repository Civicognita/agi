/**
 * Wish #17 / s155 t671 — pm-api REST surface contract.
 *
 * Pins the view-tab semantics (DONE = finished; CURRENT = starting/doing/
 * testing; NEXT = backlog/blocked) and the projectPath-validation guard
 * on /api/pm/plans*. Uses Fastify's app.inject() pattern so the test
 * runs entirely in-process without a real HTTP socket.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";

import { PM_VIEW_STATUSES, registerPmRoutes } from "./pm-api.js";
import { PlanStore } from "./plan-store.js";
import type {
  PmProvider,
  PmStatus,
  PmTask,
  PmCreateTaskInput,
  PmIWishInput,
  PmComment,
} from "@agi/sdk";

function makeProvider(overrides: Partial<PmProvider> = {}): PmProvider {
  const stub = (id: string, status: PmStatus = "backlog"): PmTask => ({
    id, number: 0, storyId: "s1", title: id, status,
  });
  return {
    providerId: "test",
    getProject: async () => ({ id: "p", name: "Test Project" }),
    getNext: async () => ({ version: null, topStory: null, tasks: [stub("t-next")] }),
    getTask: async (idOrNumber) => stub(`t-${String(idOrNumber)}`),
    getStory: async () => null,
    findTasks: async (filter) => {
      // Echo back the status filter so the test can assert it was forwarded.
      const wanted = Array.isArray(filter?.status) ? filter.status : (filter?.status ? [filter.status] : []);
      if (wanted.length === 0) return [stub("t-all")];
      return wanted.map((s) => stub(`t-${s}`, s));
    },
    getComments: async () => [],
    setTaskStatus: async (id: string, s: PmStatus) => stub(id, s),
    addComment: async (_e, _id, body): Promise<PmComment> => ({ id: "c", body, createdAt: "2026-05-08T00:00:00Z" }),
    updateTask: async (id: string) => stub(id),
    createTask: async (i: PmCreateTaskInput) => ({ ...stub("new"), title: i.title }),
    iWish: async (i: PmIWishInput) => ({ id: "w", title: i.title }),
    ...overrides,
  };
}

describe("pm-api routes", () => {
  let app: FastifyInstance;
  let tmpRoot: string;
  let workspace: string;
  let projectPath: string;
  let originalHome: string | undefined;
  let planStore: PlanStore;

  beforeEach(async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), "pm-api-"));
    workspace = join(tmpRoot, "_projects");
    projectPath = join(workspace, "myproject");
    mkdirSync(projectPath, { recursive: true });
    originalHome = process.env.HOME;
    process.env.HOME = tmpRoot;
    planStore = new PlanStore();

    app = Fastify();
    registerPmRoutes(app, {
      pmProvider: makeProvider(),
      planStore,
      workspaceProjects: [workspace],
    });
    await app.ready();
  });

  afterEach(async () => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    await app.close();
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  describe("GET /api/pm/next", () => {
    it("returns the active version + top story + tasks tuple from pmProvider", async () => {
      const r = await app.inject({ method: "GET", url: "/api/pm/next" });
      expect(r.statusCode).toBe(200);
      const body = r.json() as { tasks: PmTask[]; providerId: string };
      expect(body.tasks).toHaveLength(1);
      expect(body.tasks[0]?.id).toBe("t-next");
      expect(body.providerId).toBe("test");
    });
  });

  describe("GET /api/pm/find-tasks", () => {
    it("forwards string status filter", async () => {
      const r = await app.inject({ method: "GET", url: "/api/pm/find-tasks?status=doing" });
      expect(r.statusCode).toBe(200);
      const { tasks } = r.json() as { tasks: PmTask[] };
      expect(tasks).toHaveLength(1);
      expect(tasks[0]?.status).toBe("doing");
    });

    it("forwards array status filter via repeated query params", async () => {
      const r = await app.inject({
        method: "GET",
        url: "/api/pm/find-tasks?status=doing&status=testing",
      });
      const { tasks } = r.json() as { tasks: PmTask[] };
      expect(tasks.map((t) => t.status).sort()).toEqual(["doing", "testing"]);
    });

    it("returns all when no filter is provided", async () => {
      const r = await app.inject({ method: "GET", url: "/api/pm/find-tasks" });
      const { tasks } = r.json() as { tasks: PmTask[] };
      expect(tasks[0]?.id).toBe("t-all");
    });

    it("forwards limit as a number", async () => {
      // Provider implementation here ignores limit; assert no crash + 200.
      const r = await app.inject({ method: "GET", url: "/api/pm/find-tasks?limit=5" });
      expect(r.statusCode).toBe(200);
    });
  });

  describe("GET /api/pm/view", () => {
    it("DONE view filters to finished status", async () => {
      const r = await app.inject({ method: "GET", url: "/api/pm/view?view=done" });
      expect(r.statusCode).toBe(200);
      const body = r.json() as { view: string; tasks: PmTask[] };
      expect(body.view).toBe("done");
      expect(body.tasks.map((t) => t.status)).toEqual(["finished"]);
    });

    it("CURRENT view filters to starting/doing/testing", async () => {
      const r = await app.inject({ method: "GET", url: "/api/pm/view?view=current" });
      const body = r.json() as { tasks: PmTask[] };
      expect(body.tasks.map((t) => t.status).sort()).toEqual(["doing", "starting", "testing"]);
    });

    it("NEXT view filters to backlog/blocked", async () => {
      const r = await app.inject({ method: "GET", url: "/api/pm/view?view=next" });
      const body = r.json() as { tasks: PmTask[] };
      expect(body.tasks.map((t) => t.status).sort()).toEqual(["backlog", "blocked"]);
    });

    it("rejects unknown views with 400", async () => {
      const r = await app.inject({ method: "GET", url: "/api/pm/view?view=nope" });
      expect(r.statusCode).toBe(400);
      const body = r.json() as { error: string };
      expect(body.error).toContain("unknown view");
    });

    it("PM_VIEW_STATUSES constant matches the route behavior", () => {
      expect(PM_VIEW_STATUSES.done).toContain("finished");
      expect(PM_VIEW_STATUSES.current).toEqual(expect.arrayContaining(["starting", "doing", "testing"]));
      expect(PM_VIEW_STATUSES.next).toEqual(expect.arrayContaining(["backlog", "blocked"]));
    });
  });

  describe("GET /api/pm/plans", () => {
    it("requires projectPath query param", async () => {
      const r = await app.inject({ method: "GET", url: "/api/pm/plans" });
      expect(r.statusCode).toBe(400);
    });

    it("returns 403 when projectPath is outside workspace", async () => {
      const r = await app.inject({
        method: "GET",
        url: `/api/pm/plans?projectPath=${encodeURIComponent("/etc/passwd")}`,
      });
      expect(r.statusCode).toBe(403);
    });

    it("returns 403 when projectPath EQUALS the workspace root (not a project)", async () => {
      const r = await app.inject({
        method: "GET",
        url: `/api/pm/plans?projectPath=${encodeURIComponent(workspace)}`,
      });
      expect(r.statusCode).toBe(403);
    });

    it("returns plans list for a valid project (empty when no plans exist)", async () => {
      const r = await app.inject({
        method: "GET",
        url: `/api/pm/plans?projectPath=${encodeURIComponent(projectPath)}`,
      });
      expect(r.statusCode).toBe(200);
      const body = r.json() as { plans: unknown[]; projectPath: string };
      expect(body.plans).toEqual([]);
      expect(body.projectPath).toBe(projectPath);
    });

    it("surfaces a plan after one is created via PlanStore", async () => {
      const created = planStore.create({
        title: "Sample plan",
        body: "Body",
        steps: [{ title: "do thing", type: "plan" }],
        projectPath,
      });
      const r = await app.inject({
        method: "GET",
        url: `/api/pm/plans?projectPath=${encodeURIComponent(projectPath)}`,
      });
      const body = r.json() as { plans: { id: string; title: string }[] };
      expect(body.plans.map((p) => p.id)).toContain(created.id);
    });
  });

  describe("GET /api/pm/plans/:planId", () => {
    it("returns 404 when the plan does not exist", async () => {
      const r = await app.inject({
        method: "GET",
        url: `/api/pm/plans/plan_nope?projectPath=${encodeURIComponent(projectPath)}`,
      });
      expect(r.statusCode).toBe(404);
    });

    it("returns the plan when it exists", async () => {
      const created = planStore.create({
        title: "Detail plan",
        body: "B",
        steps: [],
        projectPath,
      });
      const r = await app.inject({
        method: "GET",
        url: `/api/pm/plans/${created.id}?projectPath=${encodeURIComponent(projectPath)}`,
      });
      expect(r.statusCode).toBe(200);
      const body = r.json() as { id: string; title: string };
      expect(body.id).toBe(created.id);
      expect(body.title).toBe("Detail plan");
    });

    it("rejects projectPath outside workspace", async () => {
      const r = await app.inject({
        method: "GET",
        url: `/api/pm/plans/plan_x?projectPath=${encodeURIComponent("/elsewhere")}`,
      });
      expect(r.statusCode).toBe(403);
    });
  });
});
