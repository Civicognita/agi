/**
 * Plan Store — file-based CRUD for ~/.agi/{projectSlug}/plans/{planId}.md
 *
 * Each plan is stored as a markdown file with YAML frontmatter.
 * The frontmatter contains the plan metadata, and the body is the
 * full markdown plan content.
 *
 * Plans are stored centrally in the owner's home directory, NOT inside
 * project directories. This prevents writing runtime data into deployed
 * codebases or user repos.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { ulid } from "ulid";
import type { Plan, PlanStep, CreatePlanInput, UpdatePlanInput, PlanStatus, PlanStepStatus, PlanTynnRefs } from "./plan-types.js";

// ---------------------------------------------------------------------------
// YAML frontmatter helpers (minimal — no external dependency)
// ---------------------------------------------------------------------------

function serializeFrontmatter(plan: Plan): string {
  const fm: Record<string, unknown> = {
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
  // Simple YAML serialization (JSON-compatible subset)
  const yaml = JSON.stringify(fm, null, 2);
  return `---\n${yaml}\n---\n\n${plan.body}`;
}

function parseFrontmatter(raw: string): { meta: Record<string, unknown>; body: string } | null {
  const match = /^---\n([\s\S]*?)\n---\n\n?([\s\S]*)$/.exec(raw);
  if (!match) return null;
  try {
    const meta = JSON.parse(match[1]!) as Record<string, unknown>;
    return { meta, body: match[2]! };
  } catch {
    return null;
  }
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
  /** Convert a project path to a filesystem-safe slug for directory naming. */
  private projectSlug(projectPath: string): string {
    return projectPath.replace(/^\//, "").replace(/\//g, "-").replace(/[^a-zA-Z0-9._-]/g, "_") || "general";
  }

  private plansDir(projectPath: string): string {
    return join(homedir(), ".agi", this.projectSlug(projectPath), "plans");
  }

  private planPath(projectPath: string, planId: string): string {
    return join(this.plansDir(projectPath), `${planId}.md`);
  }

  private ensureDir(projectPath: string): void {
    const dir = this.plansDir(projectPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
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
    const path = this.planPath(projectPath, planId);
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, "utf-8");
    const parsed = parseFrontmatter(raw);
    if (!parsed) return null;
    return metaToPlan(parsed.meta, parsed.body);
  }

  list(projectPath: string): Plan[] {
    const dir = this.plansDir(projectPath);
    if (!existsSync(dir)) return [];
    const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
    const plans: Plan[] = [];
    for (const file of files) {
      const raw = readFileSync(join(dir, file), "utf-8");
      const parsed = parseFrontmatter(raw);
      if (parsed) {
        plans.push(metaToPlan(parsed.meta, parsed.body));
      }
    }
    return plans.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

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
    const path = this.planPath(projectPath, planId);
    if (!existsSync(path)) return false;
    unlinkSync(path);
    return true;
  }
}
