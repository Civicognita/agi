/**
 * PlanStore — .mdc + YAML frontmatter + legacy migration tests.
 *
 * Wish #16 (2026-05-08) — plans now live at `<projectPath>/k/plans/` per
 * the s130/s140 universal-monorepo model. The legacy `~/.agi/{slug}/plans/`
 * location is read on miss and copy-forwarded to the canonical location.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateProjectPlans, PlanStore, isAcceptedStatus } from "./plan-store.js";
import type { PlanStatus } from "./plan-types.js";
import { projectSlug } from "./dispatch-paths.js";

describe("PlanStore — .mdc + YAML", () => {
  let tmpHome: string;
  let projectPath: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    // Single tmp root. Both the project and the legacy ~/.agi tree live
    // under this dir so we never write outside tmp.
    tmpHome = mkdtempSync(join(tmpdir(), "plan-store-"));
    projectPath = join(tmpHome, "_projects", "myproject");
    mkdirSync(projectPath, { recursive: true });
    originalHome = process.env.HOME;
    process.env.HOME = tmpHome;
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    rmSync(tmpHome, { recursive: true, force: true });
  });

  function canonicalPlansDir(): string {
    return join(projectPath, "k", "plans");
  }

  function legacyPlansDir(): string {
    return join(tmpHome, ".agi", projectSlug(projectPath), "plans");
  }

  it("creates plans as .mdc files with readable YAML frontmatter at <projectPath>/k/plans/", () => {
    const store = new PlanStore();
    const plan = store.create({
      title: "Test plan",
      projectPath,
      steps: [{ title: "Plan", type: "plan" }, { title: "Implement", type: "implement" }],
      body: "# Test\n\nBody content.",
    });

    const mdcPath = join(canonicalPlansDir(), `${plan.id}.mdc`);
    expect(existsSync(mdcPath)).toBe(true);

    const raw = readFileSync(mdcPath, "utf-8");
    expect(raw).toMatch(/^---\n/);
    expect(raw).toContain(`id: ${plan.id}`);
    expect(raw).toContain(`title: Test plan`);
    expect(raw).toContain(`status: draft`);
    expect(raw).toContain(`projectPath: ${projectPath}`);
    expect(raw).not.toContain('"id":');
    expect(raw).toMatch(/---\n\n# Test/);
  });

  it("round-trips YAML frontmatter back to a structurally identical plan", () => {
    const store = new PlanStore();
    const created = store.create({
      title: "Round-trip",
      projectPath,
      steps: [{ title: "One", type: "plan" }],
      body: "Body with\nnewlines and *markdown*.",
    });
    const reread = store.get(projectPath, created.id);
    expect(reread).not.toBeNull();
    expect(reread).toEqual(created);
  });

  it("copies forward a legacy `.md` plan from the OLD ~/.agi/{slug}/plans/ location", () => {
    const planId = "plan_01ABC";
    const legacyDir = legacyPlansDir();
    mkdirSync(legacyDir, { recursive: true });
    const legacyPath = join(legacyDir, `${planId}.md`);
    const legacyContent = `---\n${JSON.stringify({
      id: planId,
      title: "Legacy plan",
      status: "draft",
      projectPath,
      chatSessionId: null,
      createdAt: "2026-04-15T00:00:00Z",
      updatedAt: "2026-04-15T00:00:00Z",
      tynnRefs: { versionId: null, storyIds: [], taskIds: [] },
      steps: [{ id: "step_01", title: "Do", type: "plan", status: "pending" }],
    }, null, 2)}\n---\n\nLegacy body.`;
    writeFileSync(legacyPath, legacyContent, "utf-8");

    const store = new PlanStore();
    const plan = store.get(projectPath, planId);

    expect(plan).not.toBeNull();
    expect(plan?.title).toBe("Legacy plan");
    expect(plan?.body).toBe("Legacy body.");

    // Wish #16: copy-forward landed at the canonical path. Legacy file
    // preserved as backup (NOT deleted on read; a future sweep removes it).
    expect(existsSync(join(canonicalPlansDir(), `${planId}.mdc`))).toBe(true);
    expect(existsSync(legacyPath)).toBe(true);

    // Idempotent re-read goes through the canonical path now.
    const reread = store.get(projectPath, planId);
    expect(reread?.title).toBe("Legacy plan");
  });

  it("list() merges plans from canonical + legacy locations, dedup by planId", () => {
    // Legacy-only plan with proper YAML frontmatter (the older JSON-in-YAML
    // shape is exercised by the .md migration test above).
    const dir = legacyPlansDir();
    mkdirSync(dir, { recursive: true });
    // Timestamps + projectPath QUOTED to keep YAML parsing them as strings;
    // unquoted ISO timestamps decode to Date objects, which trips the
    // metaToPlan string cast and the plan returns null.
    const legacyYaml = `---\nid: "plan_LEGACY01"\ntitle: "Legacy"\nstatus: "draft"\nprojectPath: "${projectPath}"\nchatSessionId: null\ncreatedAt: "2026-04-14T00:00:00.000Z"\nupdatedAt: "2026-04-14T00:00:00.000Z"\ntynnRefs:\n  versionId: null\n  storyIds: []\n  taskIds: []\nsteps: []\n---\n\nLegacy.\n`;
    writeFileSync(join(dir, "plan_LEGACY01.mdc"), legacyYaml, "utf-8");

    const store = new PlanStore();
    // Canonical-only plan via create
    store.create({
      title: "New",
      projectPath,
      steps: [],
      body: "New body.",
    });

    const plans = store.list(projectPath);
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

  it("update() respects body/title/steps changes and regenerates YAML cleanly at canonical path", () => {
    const store = new PlanStore();
    const plan = store.create({
      title: "Original",
      projectPath,
      steps: [{ title: "Old", type: "plan" }],
      body: "Original body.",
    });

    const updated = store.update(projectPath, plan.id, {
      title: "New title",
      body: "Edited body.",
    });
    expect(updated?.title).toBe("New title");
    expect(updated?.body).toBe("Edited body.");

    const raw = readFileSync(join(canonicalPlansDir(), `${plan.id}.mdc`), "utf-8");
    expect(raw).toContain("title: New title");
    expect(raw).toContain("Edited body.");
  });

  it("delete() sweeps all four possible locations", () => {
    const canonicalDir = canonicalPlansDir();
    const legacyDir = legacyPlansDir();
    mkdirSync(canonicalDir, { recursive: true });
    mkdirSync(legacyDir, { recursive: true });

    // Drop sentinel files at every possible location for the same plan id.
    writeFileSync(join(canonicalDir, "plan_DUAL01.mdc"), "canonical-mdc", "utf-8");
    writeFileSync(join(canonicalDir, "plan_DUAL01.md"), "canonical-md", "utf-8");
    writeFileSync(join(legacyDir, "plan_DUAL01.mdc"), "legacy-mdc", "utf-8");
    writeFileSync(join(legacyDir, "plan_DUAL01.md"), "legacy-md", "utf-8");

    const store = new PlanStore();
    const result = store.delete(projectPath, "plan_DUAL01");
    expect(result).toBe(true);
    expect(existsSync(join(canonicalDir, "plan_DUAL01.mdc"))).toBe(false);
    expect(existsSync(join(canonicalDir, "plan_DUAL01.md"))).toBe(false);
    expect(existsSync(join(legacyDir, "plan_DUAL01.mdc"))).toBe(false);
    expect(existsSync(join(legacyDir, "plan_DUAL01.md"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Wish #16 — migrateProjectPlans bulk migration helper
// ---------------------------------------------------------------------------

describe("migrateProjectPlans (Wish #16)", () => {
  let tmpHome: string;
  let projectPath: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "plan-mig-"));
    projectPath = join(tmpHome, "_projects", "myproject");
    mkdirSync(projectPath, { recursive: true });
    originalHome = process.env.HOME;
    process.env.HOME = tmpHome;
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    rmSync(tmpHome, { recursive: true, force: true });
  });

  function legacyDir(): string {
    return join(tmpHome, ".agi", projectSlug(projectPath), "plans");
  }

  function writeLegacy(planId: string, ext: "mdc" | "md", title: string): void {
    const dir = legacyDir();
    mkdirSync(dir, { recursive: true });
    const yaml = `---\nid: ${planId}\ntitle: ${title}\nstatus: draft\nprojectPath: ${projectPath}\nchatSessionId: null\ncreatedAt: 2026-04-15T00:00:00Z\nupdatedAt: 2026-04-15T00:00:00Z\ntynnRefs:\n  versionId: null\n  storyIds: []\n  taskIds: []\nsteps: []\n---\n\nbody for ${planId}\n`;
    writeFileSync(join(dir, `${planId}.${ext}`), yaml, "utf-8");
  }

  it("copies every legacy plan to the canonical per-project dir", () => {
    writeLegacy("plan_alpha", "mdc", "Alpha");
    writeLegacy("plan_beta", "mdc", "Beta");

    const r = migrateProjectPlans(projectPath);

    expect(r.migrated).toBe(2);
    expect(r.skipped).toBe(0);
    expect(new Set(r.migratedIds)).toEqual(new Set(["plan_alpha", "plan_beta"]));
    expect(existsSync(join(projectPath, "k", "plans", "plan_alpha.mdc"))).toBe(true);
    expect(existsSync(join(projectPath, "k", "plans", "plan_beta.mdc"))).toBe(true);
    // Legacy preserved as backup.
    expect(existsSync(join(legacyDir(), "plan_alpha.mdc"))).toBe(true);
  });

  it("is idempotent — second call skips already-migrated plans without clobbering owner edits", () => {
    writeLegacy("plan_alpha", "mdc", "Alpha");
    const first = migrateProjectPlans(projectPath);
    expect(first.migrated).toBe(1);

    const canonicalAlpha = join(projectPath, "k", "plans", "plan_alpha.mdc");
    writeFileSync(canonicalAlpha, "owner edit", "utf-8");

    const second = migrateProjectPlans(projectPath);
    expect(second.migrated).toBe(0);
    expect(second.skipped).toBe(1);
    expect(readFileSync(canonicalAlpha, "utf-8")).toBe("owner edit");
  });

  it("returns a no-op when the legacy plans dir does not exist", () => {
    const r = migrateProjectPlans(projectPath);
    expect(r).toEqual({ migrated: 0, skipped: 0, migratedIds: [], errors: [] });
  });

  it("preserves the file extension (.md stays .md)", () => {
    writeLegacy("plan_legacy_ext", "md", "Legacy");
    const r = migrateProjectPlans(projectPath);
    expect(r.migrated).toBe(1);
    expect(existsSync(join(projectPath, "k", "plans", "plan_legacy_ext.md"))).toBe(true);
    expect(existsSync(join(projectPath, "k", "plans", "plan_legacy_ext.mdc"))).toBe(false);
  });

  it("ignores non-plan files in the legacy dir", () => {
    writeLegacy("plan_alpha", "mdc", "Alpha");
    const dir = legacyDir();
    writeFileSync(join(dir, "README.md"), "not a plan", "utf-8");

    const r = migrateProjectPlans(projectPath);
    expect(r.migrated).toBe(1);
    expect(r.migratedIds).toEqual(["plan_alpha"]);
  });
});
