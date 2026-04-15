/**
 * update_plan tool — handler validation + accept-lock.
 *
 * Covers:
 *   - projectPath input validation (new in 865bc6a)
 *   - planId / status / stepUpdates validation
 *   - Accept-lock — once a plan is approved (or later), regressing to
 *     draft/reviewing is rejected. Step-status advances still pass.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PlanStore } from "../plan-store.js";
import { createUpdatePlanHandler } from "./update-plan.js";

const PROJECT_PATH = "/home/test/myproject";

function parseErr(raw: string): string {
  const result = JSON.parse(raw) as { error: string };
  return result.error;
}

function parseOk(raw: string): { ok: true; plan: Record<string, unknown> } {
  return JSON.parse(raw) as { ok: true; plan: Record<string, unknown> };
}

describe("update_plan handler", () => {
  let tmpHome: string;
  let originalHome: string | undefined;
  let planId: string;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "update-plan-tool-"));
    originalHome = process.env.HOME;
    process.env.HOME = tmpHome;

    // Seed a draft plan to operate on.
    const store = new PlanStore();
    const plan = store.create({
      title: "Seed",
      projectPath: PROJECT_PATH,
      steps: [
        { title: "S1", type: "plan" },
        { title: "S2", type: "implement" },
      ],
      body: "body",
    });
    planId = plan.id;
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    rmSync(tmpHome, { recursive: true, force: true });
  });

  describe("input validation", () => {
    it("rejects when projectPath is missing", async () => {
      const res = await createUpdatePlanHandler()({ planId, status: "reviewing" });
      expect(parseErr(res)).toMatch(/projectPath is required/);
    });

    it("rejects when planId is missing", async () => {
      const res = await createUpdatePlanHandler()({ projectPath: PROJECT_PATH, status: "reviewing" });
      expect(parseErr(res)).toMatch(/planId is required/);
    });

    it("rejects when neither status nor stepUpdates are provided", async () => {
      const res = await createUpdatePlanHandler()({ projectPath: PROJECT_PATH, planId });
      expect(parseErr(res)).toMatch(/status or stepUpdates/);
    });

    it("rejects an invalid plan status", async () => {
      const res = await createUpdatePlanHandler()({ projectPath: PROJECT_PATH, planId, status: "nonsense" });
      expect(parseErr(res)).toMatch(/Invalid status/);
    });

    it("rejects an invalid step status", async () => {
      const res = await createUpdatePlanHandler()({
        projectPath: PROJECT_PATH,
        planId,
        stepUpdates: [{ id: "step_01", status: "halfway" }],
      });
      expect(parseErr(res)).toMatch(/invalid status/);
    });

    it("rejects a step update missing an id", async () => {
      const res = await createUpdatePlanHandler()({
        projectPath: PROJECT_PATH,
        planId,
        stepUpdates: [{ status: "complete" }],
      });
      expect(parseErr(res)).toMatch(/missing an id/);
    });

    it("rejects when the planId doesn't exist", async () => {
      const res = await createUpdatePlanHandler()({
        projectPath: PROJECT_PATH,
        planId: "plan_DOESNOTEXIST",
        status: "reviewing",
      });
      expect(parseErr(res)).toMatch(/not found/);
    });
  });

  describe("happy path", () => {
    it("advances plan status and returns the updated plan", async () => {
      const res = await createUpdatePlanHandler()({
        projectPath: PROJECT_PATH,
        planId,
        status: "reviewing",
      });
      const ok = parseOk(res);
      expect(ok.plan.status).toBe("reviewing");
    });

    it("advances a step status without touching the plan status", async () => {
      const res = await createUpdatePlanHandler()({
        projectPath: PROJECT_PATH,
        planId,
        stepUpdates: [{ id: "step_01", status: "running" }],
      });
      const ok = parseOk(res);
      const steps = ok.plan.steps as Array<{ id: string; status: string }>;
      expect(steps.find((s) => s.id === "step_01")!.status).toBe("running");
      expect(steps.find((s) => s.id === "step_02")!.status).toBe("pending");
    });
  });

  describe("accept-lock", () => {
    async function approve(): Promise<void> {
      const res = await createUpdatePlanHandler()({
        projectPath: PROJECT_PATH,
        planId,
        status: "approved",
      });
      parseOk(res);
    }

    it("rejects regression to draft after acceptance", async () => {
      await approve();
      const res = await createUpdatePlanHandler()({
        projectPath: PROJECT_PATH,
        planId,
        status: "draft",
      });
      expect(parseErr(res)).toMatch(/cannot regress/);
    });

    it("rejects regression to reviewing after acceptance", async () => {
      await approve();
      const res = await createUpdatePlanHandler()({
        projectPath: PROJECT_PATH,
        planId,
        status: "reviewing",
      });
      expect(parseErr(res)).toMatch(/cannot regress/);
    });

    it("still allows forward transitions after acceptance (approved → executing)", async () => {
      await approve();
      const res = await createUpdatePlanHandler()({
        projectPath: PROJECT_PATH,
        planId,
        status: "executing",
      });
      const ok = parseOk(res);
      expect(ok.plan.status).toBe("executing");
    });

    it("still allows step-status advances after acceptance", async () => {
      await approve();
      const res = await createUpdatePlanHandler()({
        projectPath: PROJECT_PATH,
        planId,
        stepUpdates: [{ id: "step_01", status: "complete" }],
      });
      const ok = parseOk(res);
      const steps = ok.plan.steps as Array<{ id: string; status: string }>;
      expect(steps.find((s) => s.id === "step_01")!.status).toBe("complete");
    });
  });
});
