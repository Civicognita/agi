/**
 * Plan Store — file-based CRUD for ~/.agi/{projectSlug}/plans/{planId}.mdc
 *
 * Each plan is stored as a `.mdc` file (markdown + YAML frontmatter) at
 *
 *     ~/.agi/{projectSlug}/plans/{planId}.mdc
 *
 * Frontmatter sits between YAML `---` fences and carries all plan metadata
 * (id, title, status, projectPath, steps, tynnRefs, timestamps). The body
 * after the closing fence is the plan's free-form markdown content.
 *
 * Legacy: prior revisions used `.md` with JSON-in-YAML frontmatter. On read,
 * any legacy `.md` plan is parsed, rewritten as a proper `.mdc` file with
 * YAML frontmatter, and the original `.md` is removed. Idempotent.
 *
 * Plans live centrally under the operator's home directory, NEVER inside
 * project directories — that prevents writing runtime data into deployed
 * codebases or user repos.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { ulid } from "ulid";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";
import type { Plan, PlanStep, CreatePlanInput, UpdatePlanInput, PlanStatus, PlanStepStatus, PlanTynnRefs } from "./plan-types.js";
import { projectSlug } from "./dispatch-paths.js";

// ---------------------------------------------------------------------------
// Frontmatter helpers
// ---------------------------------------------------------------------------

/**
 * Plans are immutable after acceptance except for step-status advances. The
 * server-side guard lives in `update-plan.ts`; this flag is what that guard
 * checks. Kept alongside the persistence layer so the contract is obvious
 * at read-time.
 */
export function isAcceptedStatus(status: PlanStatus): boolean {
  return status === "approved" || status === "executing" || status === "testing" || status === "complete" || status === "failed";
}

function serializeFrontmatter(plan: Plan): string {
  const fm = {
    id: plan.id,
    title: plan.title,
    status: plan.status,
    projectPath: plan.projectPath,
    chatSessionId: plan.chatSessionId,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
    tynnRefs: plan.tynnRefs,
    steps: plan.steps,
  };
  const yaml = yamlStringify(fm, { indent: 2, lineWidth: 0 });
  return `---\n${yaml}---\n\n${plan.body}`;
}

type ParsedFrontmatter = { meta: Record<string, unknown>; body: string };

function parseYamlFrontmatter(raw: string): ParsedFrontmatter | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n\r?\n?([\s\S]*)$/.exec(raw);
  if (!match) return null;
  try {
    const meta = yamlParse(match[1]!) as Record<string, unknown>;
    if (meta === null || typeof meta !== "object") return null;
    return { meta, body: match[2]! };
  } catch {
    return null;
  }
}

function parseLegacyJsonFrontmatter(raw: string): ParsedFrontmatter | null {
  // Older plans used `JSON.stringify` inside the fences. YAML is a superset
  // of JSON so the YAML parser above usually handles them; this is a
  // belt-and-braces fallback for edge cases where yaml-parse rejects a
  // particular JSON quoting style.
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n\r?\n?([\s\S]*)$/.exec(raw);
  if (!match) return null;
  try {
    const meta = JSON.parse(match[1]!) as Record<string, unknown>;
    return { meta, body: match[2]! };
  } catch {
    return null;
  }
}

function parseFrontmatter(raw: string): ParsedFrontmatter | null {
  return parseYamlFrontmatter(raw) ?? parseLegacyJsonFrontmatter(raw);
}

function metaToPlan(meta: Record<string, unknown>, body: string): Plan {
  return {
    id: meta.id as string,
    title: meta.title as string,
    status: (meta.status as PlanStatus) ?? "draft",
    projectPath: meta.projectPath as string,
    chatSessionId: (meta.chatSessionId as string | null) ?? null,
    createdAt: meta.createdAt as string,
    updatedAt: meta.updatedAt as string,
    tynnRefs: (meta.tynnRefs as PlanTynnRefs) ?? { versionId: null, storyIds: [], taskIds: [] },
    steps: (meta.steps as PlanStep[]) ?? [],
    body,
  };
}

// ---------------------------------------------------------------------------
// PlanStore
// ---------------------------------------------------------------------------

export class PlanStore {
  private plansDir(projectPath: string): string {
    return join(homedir(), ".agi", projectSlug(projectPath), "plans");
  }

  private planPath(projectPath: string, planId: string): string {
    return join(this.plansDir(projectPath), `${planId}.mdc`);
  }

  private legacyPlanPath(projectPath: string, planId: string): string {
    return join(this.plansDir(projectPath), `${planId}.md`);
  }

  private ensureDir(projectPath: string): void {
    const dir = this.plansDir(projectPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Read a plan from disk, preferring `.mdc` and falling back to legacy
   * `.md`. When a legacy file is found, it's rewritten as `.mdc` with YAML
   * frontmatter and the old file is removed so the migration runs exactly
   * once per plan.
   */
  private readAndMigrate(projectPath: string, planId: string): Plan | null {
    const mdcPath = this.planPath(projectPath, planId);
    if (existsSync(mdcPath)) {
      const parsed = parseFrontmatter(readFileSync(mdcPath, "utf-8"));
      return parsed ? metaToPlan(parsed.meta, parsed.body) : null;
    }

    const mdPath = this.legacyPlanPath(projectPath, planId);
    if (!existsSync(mdPath)) return null;
    const parsed = parseFrontmatter(readFileSync(mdPath, "utf-8"));
    if (!parsed) return null;

    const plan = metaToPlan(parsed.meta, parsed.body);
    try {
      writeFileSync(mdcPath, serializeFrontmatter(plan), "utf-8");
      unlinkSync(mdPath);
    } catch {
      // If the rewrite fails (permissions, disk full), we still return the
      // parsed plan so the caller isn't blocked; the migration will retry
      // next read.
    }
    return plan;
  }

  create(input: CreatePlanInput): Plan {
    const now = new Date().toISOString();
    const planId = `plan_${ulid()}`;

    const steps: PlanStep[] = input.steps.map((s, i) => ({
      id: `step_${String(i + 1).padStart(2, "0")}`,
      title: s.title,
      type: s.type,
      status: "pending" as PlanStepStatus,
      dependsOn: s.dependsOn,
    }));

    const plan: Plan = {
      id: planId,
      title: input.title,
      status: "draft",
      projectPath: input.projectPath,
      chatSessionId: input.chatSessionId ?? null,
      createdAt: now,
      updatedAt: now,
      tynnRefs: { versionId: null, storyIds: [], taskIds: [] },
      steps,
      body: input.body,
    };

    this.ensureDir(input.projectPath);
    writeFileSync(this.planPath(input.projectPath, planId), serializeFrontmatter(plan), "utf-8");
    return plan;
  }

  get(projectPath: string, planId: string): Plan | null {
    return this.readAndMigrate(projectPath, planId);
  }

  list(projectPath: string): Plan[] {
    const dir = this.plansDir(projectPath);
    if (!existsSync(dir)) return [];
    const seen = new Set<string>();
    const plans: Plan[] = [];

    // Prefer `.mdc` entries; fall through to `.md` if no `.mdc` shadows it.
    const files = readdirSync(dir);
    for (const file of files) {
      const mdcMatch = /^(plan_[^.]+)\.mdc$/.exec(file);
      if (mdcMatch) {
        const planId = mdcMatch[1]!;
        if (seen.has(planId)) continue;
        const plan = this.readAndMigrate(projectPath, planId);
        if (plan) {
          plans.push(plan);
          seen.add(planId);
        }
      }
    }
    for (const file of files) {
      const mdMatch = /^(plan_[^.]+)\.md$/.exec(file);
      if (mdMatch) {
        const planId = mdMatch[1]!;
        if (seen.has(planId)) continue;
        const plan = this.readAndMigrate(projectPath, planId);
        if (plan) {
          plans.push(plan);
          seen.add(planId);
        }
      }
    }
    return plans.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /**
   * Update a plan. Callers that need to enforce the accept-lock (no body /
   * step-list edits after `approved`) should pass `lockAfterAccept: true`
   * — see update-plan.ts for the server-side tool guard.
   */
  update(projectPath: string, planId: string, input: UpdatePlanInput): Plan | null {
    const plan = this.get(projectPath, planId);
    if (!plan) return null;

    if (input.status !== undefined) {
      plan.status = input.status;
    }

    if (input.stepUpdates !== undefined) {
      for (const su of input.stepUpdates) {
        const step = plan.steps.find((s) => s.id === su.id);
        if (step) {
          step.status = su.status;
        }
      }
    }

    if (input.body !== undefined) {
      plan.body = input.body;
    }

    if (input.title !== undefined) {
      plan.title = input.title;
    }

    if (input.steps !== undefined) {
      plan.steps = input.steps;
    }

    if (input.tynnRefs !== undefined) {
      if (input.tynnRefs.versionId !== undefined) plan.tynnRefs.versionId = input.tynnRefs.versionId;
      if (input.tynnRefs.storyIds !== undefined) plan.tynnRefs.storyIds = input.tynnRefs.storyIds;
      if (input.tynnRefs.taskIds !== undefined) plan.tynnRefs.taskIds = input.tynnRefs.taskIds;
    }

    plan.updatedAt = new Date().toISOString();
    writeFileSync(this.planPath(projectPath, planId), serializeFrontmatter(plan), "utf-8");
    return plan;
  }

  delete(projectPath: string, planId: string): boolean {
    let removed = false;
    const mdcPath = this.planPath(projectPath, planId);
    if (existsSync(mdcPath)) { unlinkSync(mdcPath); removed = true; }
    const mdPath = this.legacyPlanPath(projectPath, planId);
    if (existsSync(mdPath)) { unlinkSync(mdPath); removed = true; }
    return removed;
  }
}
