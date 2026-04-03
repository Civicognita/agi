/**
 * Plan Types — data model for the plan workflow.
 *
 * Plans are stored as markdown files with YAML frontmatter
 * at ~/.ai/plans/{projectSlug}/{planId}.md
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
}

/** Input shape for a single step when creating a plan. */
export type PlanStepInput = CreatePlanInput["steps"][number];

/** Input shape for updating a single step's status. */
export interface PlanStepUpdate {
  id: string;
  status: PlanStepStatus;
}
