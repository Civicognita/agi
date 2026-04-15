/**
 * PlanStore — .mdc + YAML frontmatter + legacy .md migration tests.
 *
 * These tests exercise PlanStore against a temp HOME to avoid touching the
 * operator's actual ~/.agi/ directory. We set HOME before constructing the
 * store so the default path resolution lands in the temp dir.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PlanStore, isAcceptedStatus } from "./plan-store.js";
import type { PlanStatus } from "./plan-types.js";

const PROJECT_PATH = "/home/test/myproject";

describe("PlanStore — .mdc + YAML", () => {
  let tmpHome: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "plan-store-"));
    originalHome = process.env.HOME;
    process.env.HOME = tmpHome;
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it("creates plans as .mdc files with readable YAML frontmatter", () => {
    const store = new PlanStore();
    const plan = store.create({
      title: "Test plan",
      projectPath: PROJECT_PATH,
      steps: [{ title: "Plan", type: "plan" }, { title: "Implement", type: "implement" }],
      body: "# Test\n\nBody content.",
    });

    const plansDir = join(tmpHome, ".agi", "home-test-myproject", "plans");
    const mdcPath = join(plansDir, `${plan.id}.mdc`);
    expect(existsSync(mdcPath)).toBe(true);

    const raw = readFileSync(mdcPath, "utf-8");
    // YAML frontmatter — human-readable, no JSON braces at the top level.
    expect(raw).toMatch(/^---\n/);
    expect(raw).toContain(`id: ${plan.id}`);
    expect(raw).toContain(`title: Test plan`);
    expect(raw).toContain(`status: draft`);
    expect(raw).toContain(`projectPath: ${PROJECT_PATH}`);
    expect(raw).not.toContain('"id":');  // legacy JSON shape would have quotes
    // Body follows closing fence.
    expect(raw).toMatch(/---\n\n# Test/);
  });

  it("round-trips YAML frontmatter back to a structurally identical plan", () => {
    const store = new PlanStore();
    const created = store.create({
      title: "Round-trip",
      projectPath: PROJECT_PATH,
      steps: [{ title: "One", type: "plan" }],
      body: "Body with\nnewlines and *markdown*.",
    });
    const reread = store.get(PROJECT_PATH, created.id);
    expect(reread).not.toBeNull();
    expect(reread).toEqual(created);
  });

  it("migrates legacy .md plans to .mdc on first read", () => {
    // Hand-write a legacy .md plan with JSON frontmatter.
    const plansDir = join(tmpHome, ".agi", "home-test-myproject", "plans");
    mkdirSync(plansDir, { recursive: true });
    const planId = "plan_01ABC";
    const legacyPath = join(plansDir, `${planId}.md`);
    const legacyContent = `---\n${JSON.stringify({
      id: planId,
      title: "Legacy plan",
      status: "draft",
      projectPath: PROJECT_PATH,
      chatSessionId: null,
      createdAt: "2026-04-15T00:00:00Z",
      updatedAt: "2026-04-15T00:00:00Z",
      tynnRefs: { versionId: null, storyIds: [], taskIds: [] },
      steps: [{ id: "step_01", title: "Do", type: "plan", status: "pending" }],
    }, null, 2)}\n---\n\nLegacy body.`;
    writeFileSync(legacyPath, legacyContent, "utf-8");

    const store = new PlanStore();
    const plan = store.get(PROJECT_PATH, planId);

    expect(plan).not.toBeNull();
    expect(plan?.title).toBe("Legacy plan");
    expect(plan?.body).toBe("Legacy body.");

    // Migration: .mdc exists and .md is gone.
    expect(existsSync(join(plansDir, `${planId}.mdc`))).toBe(true);
    expect(existsSync(legacyPath)).toBe(false);

    // Re-read should still work (idempotent).
    const reread = store.get(PROJECT_PATH, planId);
    expect(reread?.title).toBe("Legacy plan");
  });

  it("list() returns both .mdc and legacy .md entries without duplicates", () => {
    const plansDir = join(tmpHome, ".agi", "home-test-myproject", "plans");
    mkdirSync(plansDir, { recursive: true });

    // One legacy .md
    writeFileSync(join(plansDir, "plan_LEGACY01.md"), `---\n${JSON.stringify({
      id: "plan_LEGACY01",
      title: "Legacy",
      status: "draft",
      projectPath: PROJECT_PATH,
      chatSessionId: null,
      createdAt: "2026-04-14T00:00:00Z",
      updatedAt: "2026-04-14T00:00:00Z",
      tynnRefs: { versionId: null, storyIds: [], taskIds: [] },
      steps: [],
    })}\n---\n\nLegacy.`, "utf-8");

    const store = new PlanStore();
    // One fresh .mdc
    store.create({
      title: "New",
      projectPath: PROJECT_PATH,
      steps: [],
      body: "New body.",
    });

    const plans = store.list(PROJECT_PATH);
    expect(plans).toHaveLength(2);
    expect(plans.some((p) => p.title === "Legacy")).toBe(true);
    expect(plans.some((p) => p.title === "New")).toBe(true);
  });

  it("isAcceptedStatus() returns true for approved and later, false for draft/reviewing", () => {
    const draftStatuses: PlanStatus[] = ["draft", "reviewing"];
    const acceptedStatuses: PlanStatus[] = ["approved", "executing", "testing", "complete", "failed"];
    for (const s of draftStatuses) expect(isAcceptedStatus(s)).toBe(false);
    for (const s of acceptedStatuses) expect(isAcceptedStatus(s)).toBe(true);
  });

  it("update() respects body/title/steps changes and regenerates YAML cleanly", () => {
    const store = new PlanStore();
    const plan = store.create({
      title: "Original",
      projectPath: PROJECT_PATH,
      steps: [{ title: "Old", type: "plan" }],
      body: "Original body.",
    });

    const updated = store.update(PROJECT_PATH, plan.id, {
      title: "New title",
      body: "Edited body.",
    });
    expect(updated?.title).toBe("New title");
    expect(updated?.body).toBe("Edited body.");

    // File on disk reflects the change.
    const plansDir = join(tmpHome, ".agi", "home-test-myproject", "plans");
    const raw = readFileSync(join(plansDir, `${plan.id}.mdc`), "utf-8");
    expect(raw).toContain("title: New title");
    expect(raw).toContain("Edited body.");
  });

  it("delete() removes both .mdc and legacy .md", () => {
    const plansDir = join(tmpHome, ".agi", "home-test-myproject", "plans");
    mkdirSync(plansDir, { recursive: true });
    writeFileSync(join(plansDir, "plan_DUAL01.mdc"), "---\nid: plan_DUAL01\ntitle: x\nstatus: draft\nprojectPath: /foo\nchatSessionId: null\ncreatedAt: 0\nupdatedAt: 0\ntynnRefs: {versionId: null, storyIds: [], taskIds: []}\nsteps: []\n---\n\nbody", "utf-8");
    writeFileSync(join(plansDir, "plan_DUAL01.md"), "legacy", "utf-8");

    const store = new PlanStore();
    const result = store.delete(PROJECT_PATH, "plan_DUAL01");
    expect(result).toBe(true);
    expect(existsSync(join(plansDir, "plan_DUAL01.mdc"))).toBe(false);
    expect(existsSync(join(plansDir, "plan_DUAL01.md"))).toBe(false);
  });
});
