/**
 * update_plan tool — update the status of a plan or its individual steps.
 *
 * Loads the plan from <projectPath>/.ai/plans/, applies updates, and persists.
 */
import type { ToolHandler } from "../tool-registry.js";
import { PlanStore } from "../plan-store.js";
import type { PlanStatus, PlanStepStatus, PlanStepUpdate } from "../plan-types.js";

export interface UpdatePlanConfig {
  projectPath: string;
}

const VALID_PLAN_STATUSES: PlanStatus[] = [
  "draft",
  "reviewing",
  "approved",
  "executing",
  "testing",
  "complete",
  "failed",
];

const VALID_STEP_STATUSES: PlanStepStatus[] = [
  "pending",
  "running",
  "complete",
  "failed",
  "skipped",
];

export function createUpdatePlanHandler(config: UpdatePlanConfig): ToolHandler {
  return async (input: Record<string, unknown>): Promise<string> => {
    const planId = String(input.planId ?? "").trim();
    if (planId.length === 0) {
      return JSON.stringify({ error: "planId is required" });
    }

    // Validate plan status if provided
    let planStatus: PlanStatus | undefined;
    if (input.status !== undefined) {
      const raw = String(input.status) as PlanStatus;
      if (!VALID_PLAN_STATUSES.includes(raw)) {
        return JSON.stringify({
          error: `Invalid status "${raw}". Must be one of: ${VALID_PLAN_STATUSES.join(", ")}`,
        });
      }
      planStatus = raw;
    }

    // Validate step updates if provided
    const stepUpdates: PlanStepUpdate[] = [];
    if (Array.isArray(input.stepUpdates)) {
      for (let i = 0; i < input.stepUpdates.length; i++) {
        const raw = input.stepUpdates[i] as Record<string, unknown>;

        const stepId = String(raw.id ?? "").trim();
        if (stepId.length === 0) {
          return JSON.stringify({ error: `Step update ${i + 1} is missing an id` });
        }

        const stepStatus = String(raw.status ?? "") as PlanStepStatus;
        if (!VALID_STEP_STATUSES.includes(stepStatus)) {
          return JSON.stringify({
            error: `Step update ${i + 1} has invalid status "${stepStatus}". Must be one of: ${VALID_STEP_STATUSES.join(", ")}`,
          });
        }

        stepUpdates.push({ id: stepId, status: stepStatus });
      }
    }

    if (planStatus === undefined && stepUpdates.length === 0) {
      return JSON.stringify({ error: "At least one of status or stepUpdates must be provided" });
    }

    try {
      const store = new PlanStore();
      const plan = store.update(config.projectPath, planId, { status: planStatus, stepUpdates });
      if (!plan) {
        return JSON.stringify({ error: `Plan "${planId}" not found` });
      }
      return JSON.stringify({ ok: true, plan });
    } catch (err) {
      return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
    }
  };
}

export const UPDATE_PLAN_MANIFEST = {
  name: "update_plan",
  description: "Update the status of a plan or its individual steps.",
  requiresState: ["ONLINE" as const],
  requiresTier: ["verified" as const, "sealed" as const],
};

export const UPDATE_PLAN_INPUT_SCHEMA = {
  type: "object",
  properties: {
    planId: {
      type: "string",
      description: "The plan ID to update (e.g. \"plan-1234567890-abc123\")",
    },
    status: {
      type: "string",
      enum: ["draft", "reviewing", "approved", "executing", "testing", "complete", "failed"],
      description: "New overall plan status",
    },
    stepUpdates: {
      type: "array",
      description: "List of step status updates",
      items: {
        type: "object",
        properties: {
          id: { type: "string", description: "Step ID (e.g. \"step-1\")" },
          status: {
            type: "string",
            enum: ["pending", "running", "complete", "failed", "skipped"],
            description: "New step status",
          },
        },
        required: ["id", "status"],
      },
    },
  },
  required: ["planId"],
};
