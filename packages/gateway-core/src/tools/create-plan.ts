/**
 * create_plan tool — create a structured plan with steps for a multi-step task.
 *
 * The plan is saved to ~/.agi/{projectSlug}/plans/ and presented to the user
 * for review before execution begins.
 */
import type { ToolHandler } from "../tool-registry.js";
import { PlanStore } from "../plan-store.js";
import type { PlanStepInput, PlanStepType } from "../plan-types.js";

const VALID_STEP_TYPES: PlanStepType[] = ["plan", "implement", "test", "review", "deploy"];

/**
 * Create-plan handler.
 *
 * The `projectPath` comes from the tool INPUT (not a bound-at-registration
 * config). That way the tool can be registered once at server boot and is
 * always available to the agent — regardless of whether the current chat
 * session has a project context baked in. The agent reads its project path
 * from the system prompt's project-context section and passes it on each
 * call. Sessions without a project context simply won't invoke this tool
 * (there's nothing to plan against).
 */
export function createCreatePlanHandler(): ToolHandler {
  return async (input: Record<string, unknown>): Promise<string> => {
    const projectPath = String(input.projectPath ?? "").trim();
    if (projectPath.length === 0) {
      return JSON.stringify({
        error: "projectPath is required — pass the absolute path of the project you are planning against (visible in your Project Context section).",
      });
    }

    const title = String(input.title ?? "").trim();
    if (title.length === 0) {
      return JSON.stringify({ error: "title is required" });
    }

    const body = String(input.body ?? "").trim();
    if (body.length === 0) {
      return JSON.stringify({ error: "body is required" });
    }

    const rawSteps = input.steps;
    if (!Array.isArray(rawSteps) || rawSteps.length === 0) {
      return JSON.stringify({ error: "steps must be a non-empty array" });
    }

    // Validate and coerce each step
    const steps: PlanStepInput[] = [];
    for (let i = 0; i < rawSteps.length; i++) {
      const raw = rawSteps[i] as Record<string, unknown>;

      const stepTitle = String(raw.title ?? "").trim();
      if (stepTitle.length === 0) {
        return JSON.stringify({ error: `Step ${i + 1} is missing a title` });
      }

      const stepType = String(raw.type ?? "") as PlanStepType;
      if (!VALID_STEP_TYPES.includes(stepType)) {
        return JSON.stringify({
          error: `Step ${i + 1} has invalid type "${stepType}". Must be one of: ${VALID_STEP_TYPES.join(", ")}`,
        });
      }

      const dependsOn = Array.isArray(raw.dependsOn)
        ? (raw.dependsOn as unknown[]).map(String)
        : [];

      steps.push({ title: stepTitle, type: stepType, dependsOn });
    }

    try {
      const store = new PlanStore();
      const plan = store.create({
        title,
        projectPath,
        steps,
        body,
      });
      return JSON.stringify({ ok: true, plan });
    } catch (err) {
      return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
    }
  };
}

export const CREATE_PLAN_MANIFEST = {
  name: "create_plan",
  description:
    "Create a structured plan with steps for a multi-step task. The plan will be saved and presented to the user for review before execution.",
  // State is audit metadata, not a permission gate (see
  // docs/agents/state-machine.md). Empty array = no state filter.
  requiresState: [],
  requiresTier: ["verified" as const, "sealed" as const],
};

export const CREATE_PLAN_INPUT_SCHEMA = {
  type: "object",
  properties: {
    projectPath: {
      type: "string",
      description:
        "Absolute path of the project this plan is for. Read it from your Project Context section of the system prompt (e.g. /home/user/_projects/myapp). Required.",
    },
    title: {
      type: "string",
      description: "Short, descriptive plan title",
    },
    steps: {
      type: "array",
      description: "Ordered list of steps to execute",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "Step title" },
          type: {
            type: "string",
            enum: ["plan", "implement", "test", "review", "deploy"],
            description: "Step type",
          },
          dependsOn: {
            type: "array",
            items: { type: "string" },
            description: "IDs of steps this step depends on (e.g. [\"step-1\"])",
          },
        },
        required: ["title", "type"],
      },
    },
    body: {
      type: "string",
      description: "Full markdown plan body with context, rationale, and details",
    },
  },
  required: ["projectPath", "title", "steps", "body"],
};
