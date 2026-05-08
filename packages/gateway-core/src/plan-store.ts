/**
 * Plan Store — file-based CRUD for `<projectPath>/k/plans/{planId}.mdc`
 *
 * Each plan is stored as a `.mdc` file (markdown + YAML frontmatter) at
 *
 *     <projectPath>/k/plans/{planId}.mdc        (s130/s140 canonical, Wish #16 2026-05-08)
 *     ~/.agi/{projectSlug}/plans/{planId}.mdc   (legacy pre-s130 location)
 *     ~/.agi/{projectSlug}/plans/{planId}.md    (legacy-legacy: JSON-in-YAML)
 *
 * Frontmatter sits between YAML `---` fences and carries all plan metadata
 * (id, title, status, projectPath, steps, tynnRefs, timestamps). The body
 * after the closing fence is the plan's free-form markdown content.
 *
 * **Dual-location semantics (Wish #16):** plans live with their project at
 * `<projectPath>/k/plans/` per the s130 universal-monorepo model. Reads
 * prefer the per-project location and copy-forward any plan still at the
 * legacy `~/.agi/{slug}/plans/` location on first access. Writes (create /
 * update / delete) go through the per-project location only. The legacy
 * file is preserved as a backup until a follow-up sweep removes it once
 * stable across upgrades.
 *
 * Legacy `.md` (JSON frontmatter) plans are upgraded to `.mdc` (YAML
 * frontmatter) at the new location on first read. Idempotent.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, unlinkSync, copyFileSync } from "node:fs";
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
  /** Canonical per-project plans dir (Wish #16, 2026-05-08). */
  private plansDir(projectPath: string): string {
    return join(projectPath, "k", "plans");
  }

  /**
   * Legacy global plans dir at `~/.agi/{slug}/plans/`. Read-only fallback;
   * writes always go to the per-project location. The migration helper +
   * lazy copy-forward in `readAndMigrate` move plans from here to the
   * canonical location idempotently.
   */
  private legacyPlansDir(projectPath: string): string {
    return join(homedir(), ".agi", projectSlug(projectPath), "plans");
  }

  private planPath(projectPath: string, planId: string): string {
    return join(this.plansDir(projectPath), `${planId}.mdc`);
  }

  /** Legacy `.md` file at the canonical (NEW) location — JSON-in-YAML frontmatter. */
  private legacyMdAtNewPath(projectPath: string, planId: string): string {
    return join(this.plansDir(projectPath), `${planId}.md`);
  }

  /** Legacy `.mdc` at the OLD per-slug location. */
  private legacyMdcAtOldPath(projectPath: string, planId: string): string {
    return join(this.legacyPlansDir(projectPath), `${planId}.mdc`);
  }

  /** Legacy `.md` at the OLD per-slug location. */
  private legacyMdAtOldPath(projectPath: string, planId: string): string {
    return join(this.legacyPlansDir(projectPath), `${planId}.md`);
  }

  private ensureDir(projectPath: string): void {
    const dir = this.plansDir(projectPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Read a plan from disk, looking in this order:
   *   1. `<projectPath>/k/plans/{id}.mdc`               — canonical, YAML
   *   2. `<projectPath>/k/plans/{id}.md`                — old YAML at new path
   *   3. `~/.agi/{slug}/plans/{id}.mdc`                 — legacy YAML at old path
   *   4. `~/.agi/{slug}/plans/{id}.md`                  — legacy JSON at old path
   *
   * On hit at a non-canonical location, the plan is rewritten at the
   * canonical path so the migration runs exactly once per plan. The legacy
   * file is preserved (not deleted) — a follow-up sweep removes the
   * old-location backups once stable across upgrades.
   */
  private readAndMigrate(projectPath: string, planId: string): Plan | null {
    const canonicalMdc = this.planPath(projectPath, planId);
    if (existsSync(canonicalMdc)) {
      const parsed = parseFrontmatter(readFileSync(canonicalMdc, "utf-8"));
      return parsed ? metaToPlan(parsed.meta, parsed.body) : null;
    }

    const candidates: string[] = [
      this.legacyMdAtNewPath(projectPath, planId),
      this.legacyMdcAtOldPath(projectPath, planId),
      this.legacyMdAtOldPath(projectPath, planId),
    ];

    for (const candidate of candidates) {
      if (!existsSync(candidate)) continue;
      const parsed = parseFrontmatter(readFileSync(candidate, "utf-8"));
      if (!parsed) continue;
      const plan = metaToPlan(parsed.meta, parsed.body);
      try {
        this.ensureDir(projectPath);
        writeFileSync(canonicalMdc, serializeFrontmatter(plan), "utf-8");
      } catch {
        // If the canonical rewrite fails (permissions, disk full), still
        // return the parsed plan so callers aren't blocked; migration
        // retries on next read.
      }
      return plan;
    }
    return null;
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
    const seen = new Set<string>();
    const plans: Plan[] = [];

    // Wish #16 — walk BOTH the canonical per-project dir and the legacy
    // ~/.agi/{slug}/plans/ dir. readAndMigrate copies legacy → canonical
    // on first hit per plan id; subsequent list() calls find the plan at
    // the canonical location and skip the legacy walk for it.
    const dirs = [this.plansDir(projectPath), this.legacyPlansDir(projectPath)];

    for (const dir of dirs) {
      if (!existsSync(dir)) continue;
      let files: string[];
      try {
        files = readdirSync(dir);
      } catch {
        continue;
      }
      for (const file of files) {
        const m = /^(plan_[^.]+)\.(?:mdc|md)$/.exec(file);
        if (!m) continue;
        const planId = m[1]!;
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
    // Sweep all four possible locations so a delete can't leave a ghost
    // behind that a subsequent readAndMigrate would resurrect.
    const candidates = [
      this.planPath(projectPath, planId),
      this.legacyMdAtNewPath(projectPath, planId),
      this.legacyMdcAtOldPath(projectPath, planId),
      this.legacyMdAtOldPath(projectPath, planId),
    ];
    for (const p of candidates) {
      if (existsSync(p)) {
        try { unlinkSync(p); removed = true; } catch { /* ignore */ }
      }
    }
    return removed;
  }
}

// ---------------------------------------------------------------------------
// Wish #16 (s150 follow-up) — bulk migration helper
// ---------------------------------------------------------------------------

export interface PlanMigrationResult {
  /** How many plans were copied this call. */
  migrated: number;
  /** How many were already at the canonical location and skipped. */
  skipped: number;
  /** Plan ids that were copied. */
  migratedIds: string[];
  /** Errors encountered (per-file; non-fatal). */
  errors: Array<{ file: string; reason: string }>;
}

/**
 * Idempotently move every plan at `~/.agi/{slug}/plans/` into the canonical
 * `<projectPath>/k/plans/` location. Safe to re-run; plans already present
 * at the canonical path are skipped, not re-copied. Legacy files are
 * preserved as backup; a future sweep removes them once stable.
 */
export function migrateProjectPlans(projectPath: string): PlanMigrationResult {
  const result: PlanMigrationResult = { migrated: 0, skipped: 0, migratedIds: [], errors: [] };

  const legacyDir = join(homedir(), ".agi", projectSlug(projectPath), "plans");
  if (!existsSync(legacyDir)) return result;

  const canonicalDir = join(projectPath, "k", "plans");

  let entries: string[];
  try {
    entries = readdirSync(legacyDir);
  } catch (e) {
    result.errors.push({ file: legacyDir, reason: e instanceof Error ? e.message : String(e) });
    return result;
  }

  for (const file of entries) {
    const m = /^(plan_[^.]+)\.(mdc|md)$/.exec(file);
    if (!m) continue;
    const planId = m[1]!;
    const ext = m[2]!;
    const sourcePath = join(legacyDir, file);

    // Always land at .mdc on the canonical side (the .md → .mdc upgrade
    // happens on the first per-plan read via readAndMigrate; here we just
    // copy the bytes and let that path normalize them). Skip if any
    // canonical entry for this plan id already exists.
    const canonicalMdc = join(canonicalDir, `${planId}.mdc`);
    const canonicalMd = join(canonicalDir, `${planId}.md`);
    if (existsSync(canonicalMdc) || existsSync(canonicalMd)) {
      result.skipped++;
      continue;
    }

    try {
      if (!existsSync(canonicalDir)) mkdirSync(canonicalDir, { recursive: true });
      const targetPath = join(canonicalDir, `${planId}.${ext}`);
      copyFileSync(sourcePath, targetPath);
      result.migrated++;
      result.migratedIds.push(planId);
    } catch (e) {
      result.errors.push({ file: sourcePath, reason: e instanceof Error ? e.message : String(e) });
    }
  }

  return result;
}
