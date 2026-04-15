/**
 * create_plan tool — handler validation + write integration.
 *
 * Post-865bc6a the handler reads `projectPath` from input (not from a
 * registration-bound config). These tests exercise the input schema
 * gate, the required-field errors, and the integration with PlanStore
 * via a temp HOME.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCreatePlanHandler } from "./create-plan.js";

const PROJECT_PATH = "/home/test/myproject";

function parseOk(raw: string): { ok: true; plan: Record<string, unknown> } {
  const result = JSON.parse(raw) as { ok: true; plan: Record<string, unknown> };
  return result;
}

function parseErr(raw: string): string {
  const result = JSON.parse(raw) as { error: string };
  return result.error;
}

describe("create_plan handler — input validation", () => {
  let tmpHome: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "create-plan-tool-"));
    originalHome = process.env.HOME;
    process.env.HOME = tmpHome;
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it("rejects when projectPath is missing", async () => {
    const handler = createCreatePlanHandler();
    const res = await handler({
      title: "T",
      body: "B",
      steps: [{ title: "s", type: "plan" }],
    });
    expect(parseErr(res)).toMatch(/projectPath is required/);
  });

  it("rejects when projectPath is an empty string", async () => {
    const handler = createCreatePlanHandler();
    const res = await handler({
      projectPath: "   ",
      title: "T",
      body: "B",
      steps: [{ title: "s", type: "plan" }],
    });
    expect(parseErr(res)).toMatch(/projectPath is required/);
  });

  it("rejects when title is missing", async () => {
    const handler = createCreatePlanHandler();
    const res = await handler({
      projectPath: PROJECT_PATH,
      body: "B",
      steps: [{ title: "s", type: "plan" }],
    });
    expect(parseErr(res)).toMatch(/title is required/);
  });

  it("rejects when body is missing", async () => {
    const handler = createCreatePlanHandler();
    const res = await handler({
      projectPath: PROJECT_PATH,
      title: "T",
      steps: [{ title: "s", type: "plan" }],
    });
    expect(parseErr(res)).toMatch(/body is required/);
  });

  it("rejects when steps array is empty", async () => {
    const handler = createCreatePlanHandler();
    const res = await handler({
      projectPath: PROJECT_PATH,
      title: "T",
      body: "B",
      steps: [],
    });
    expect(parseErr(res)).toMatch(/steps must be a non-empty array/);
  });

  it("rejects a step with an invalid type", async () => {
    const handler = createCreatePlanHandler();
    const res = await handler({
      projectPath: PROJECT_PATH,
      title: "T",
      body: "B",
      steps: [{ title: "s", type: "not-a-real-type" }],
    });
    expect(parseErr(res)).toMatch(/invalid type/);
  });

  it("rejects a step missing a title", async () => {
    const handler = createCreatePlanHandler();
    const res = await handler({
      projectPath: PROJECT_PATH,
      title: "T",
      body: "B",
      steps: [{ type: "plan" }],
    });
    expect(parseErr(res)).toMatch(/missing a title/);
  });

  it("writes a plan to ~/.agi/{slug}/plans when valid", async () => {
    const handler = createCreatePlanHandler();
    const res = await handler({
      projectPath: PROJECT_PATH,
      title: "Integration",
      body: "# Body\n\nsome markdown",
      steps: [
        { title: "Design", type: "plan" },
        { title: "Build", type: "implement" },
      ],
    });
    const ok = parseOk(res);
    expect(ok.ok).toBe(true);
    expect(ok.plan.title).toBe("Integration");
    expect(ok.plan.status).toBe("draft");
    // Steps get auto-assigned ids step_01, step_02
    const steps = ok.plan.steps as Array<{ id: string; title: string }>;
    expect(steps).toHaveLength(2);
    expect(steps[0]!.id).toBe("step_01");
    expect(steps[1]!.id).toBe("step_02");

    // File landed in the expected slug directory.
    const slugDir = join(tmpHome, ".agi", "home-test-myproject", "plans");
    expect(existsSync(slugDir)).toBe(true);
    const files = readdirSync(slugDir);
    expect(files).toHaveLength(1);
    expect(files[0]!.endsWith(".mdc")).toBe(true);
  });

  it("preserves dependsOn arrays through to the stored plan", async () => {
    const handler = createCreatePlanHandler();
    const res = await handler({
      projectPath: PROJECT_PATH,
      title: "Deps",
      body: "b",
      steps: [
        { title: "First", type: "plan" },
        { title: "Second", type: "implement", dependsOn: ["step_01"] },
      ],
    });
    const ok = parseOk(res);
    const steps = ok.plan.steps as Array<{ id: string; dependsOn?: string[] }>;
    expect(steps[1]!.dependsOn).toEqual(["step_01"]);
  });
});
