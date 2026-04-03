/**
 * create_plan tool — create a structured plan with steps for a multi-step task.
 *
 * The plan is saved to <projectPath>/.ai/plans/ and presented to the user
 * for review before execution begins.
 */
import type { ToolHandler } from "../tool-registry.js";
import { PlanStore } from "../plan-store.js";
import type { PlanStepInput, PlanStepType } from "../plan-types.js";

export interface CreatePlanConfig {
  projectPath: string;
}

const VALID_STEP_TYPES: PlanStepType[] = ["plan", "implement", "test", "review", "deploy"];

export function createCreatePlanHandler(config: CreatePlanConfig): ToolHandler {
  return async (input: Record<string, unknown>): Promise<string> => {
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
        projectPath: config.projectPath,
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
  requiresState: ["ONLINE" as const],
  requiresTier: ["verified" as const, "sealed" as const],
};

export const CREATE_PLAN_INPUT_SCHEMA = {
  type: "object",
  properties: {
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
  required: ["title", "steps", "body"],
};
