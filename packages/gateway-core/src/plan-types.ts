/**
 * Plan Types — data model for the plan workflow.
 *
 * Plans are stored as markdown files with YAML frontmatter
 * at ~/.agi/{projectSlug}/plans/{planId}.md
 */

export type PlanStatus = "draft" | "reviewing" | "approved" | "executing" | "testing" | "complete" | "failed";
export type PlanStepType = "plan" | "implement" | "test" | "review" | "deploy";
export type PlanStepStatus = "pending" | "running" | "complete" | "failed" | "skipped";

export interface PlanStep {
  id: string;
  title: string;
  type: PlanStepType;
  status: PlanStepStatus;
  dependsOn?: string[];
}

export interface PlanTynnRefs {
  versionId: string | null;
  storyIds: string[];
  taskIds: string[];
}

export interface Plan {
  id: string;
  title: string;
  status: PlanStatus;
  projectPath: string;
  chatSessionId: string | null;
  createdAt: string;
  updatedAt: string;
  tynnRefs: PlanTynnRefs;
  steps: PlanStep[];
  body: string;
}

export interface CreatePlanInput {
  title: string;
  projectPath: string;
  chatSessionId?: string;
  steps: Array<{ title: string; type: PlanStepType; dependsOn?: string[] }>;
  body: string;
}

export interface UpdatePlanInput {
  status?: PlanStatus;
  stepUpdates?: PlanStepUpdate[];
  tynnRefs?: Partial<PlanTynnRefs>;
  /** New plan body (user-editable pre-acceptance; rejected by tool guard after). */
  body?: string;
  /** New plan title (user-editable pre-acceptance; rejected by tool guard after). */
  title?: string;
  /** Replace the full step list (user-editable pre-acceptance; rejected by tool guard after). */
  steps?: PlanStep[];
}

/**
 * UI-facing status view. The internal 7-status enum (PlanStatus) maps
 * onto these four lanes:
 *
 *   draft | reviewing    -> proposed    (editable; shown in Plans tab)
 *   approved             -> accepted    (locked body; shown; step status still advances)
 *   executing | testing  -> in-progress (locked body; shown; step status advances live)
 *   complete | failed    -> done        (hidden from default Plans-tab list)
 */
export type PlanView = "proposed" | "accepted" | "in-progress" | "done";

export function planViewFromStatus(status: PlanStatus): PlanView {
  switch (status) {
    case "draft":
    case "reviewing":
      return "proposed";
    case "approved":
      return "accepted";
    case "executing":
    case "testing":
      return "in-progress";
    case "complete":
    case "failed":
      return "done";
  }
}

/** Input shape for a single step when creating a plan. */
export type PlanStepInput = CreatePlanInput["steps"][number];

/** Input shape for updating a single step's status. */
export interface PlanStepUpdate {
  id: string;
  status: PlanStepStatus;
}
