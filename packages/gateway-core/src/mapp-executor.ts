/**
 * MApp Executor — processes form submissions and runs MApp workflows.
 *
 * Form submission flow:
 * 1. Collect field values (A-column)
 * 2. Calculate formulas (B-column) from inputs + constants (C-column)
 * 3. If output.processingPrompt exists, send to agent for AI processing
 * 4. Return result
 *
 * Workflow execution flow:
 * 1. Resolve step dependencies (topological order)
 * 2. For each step, dispatch to the appropriate handler
 * 3. For `model-inference` steps, proxy the request through InferenceGateway
 * 4. Return aggregated step outputs
 */

import type { MAppDefinition, MAppModelInferenceConfig } from "@agi/sdk";
import type { InferenceGateway } from "@agi/model-runtime";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MAppExecutionResult {
  values: Record<string, unknown>;
  formulas: Record<string, number | string>;
  aiResult?: string;
  error?: string;
}

export interface MAppExecutionContext {
  mappId: string;
  instanceId: string;
  projectPath: string;
  values: Record<string, unknown>;
}

export interface WorkflowStepResult {
  stepId: string;
  status: "ok" | "error" | "skipped";
  output?: unknown;
  error?: string;
}

export interface WorkflowRunResult {
  workflowId: string;
  status: "ok" | "partial" | "error";
  steps: WorkflowStepResult[];
  /** Accumulated workflow context after all steps complete. */
  context: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Formula evaluator
// ---------------------------------------------------------------------------

function evaluateFormulas(
  definition: MAppDefinition,
  values: Record<string, unknown>,
): Record<string, number | string> {
  const cells: Record<string, number> = {};

  // Map A-cells from field values
  const allFields = (definition.pages ?? []).flatMap((p) => p.fields ?? []);
  for (const f of allFields) {
    const v = values[f.key];
    cells[f.cell] = typeof v === "number" ? v : parseFloat(String(v)) || 0;
  }

  // Map C-cells from constants
  for (const c of (definition.constants ?? [])) {
    cells[c.cell] = typeof c.value === "number" ? c.value : parseFloat(String(c.value)) || 0;
  }

  // Calculate B-cells from formulas
  const results: Record<string, number | string> = {};
  const allFormulas = (definition.pages ?? []).flatMap((p) => p.formulas ?? []);

  for (const formula of allFormulas) {
    try {
      let expr = formula.expression;
      const refs = expr.match(/[ABC]\d+/g) ?? [];
      for (const ref of refs) {
        expr = expr.replace(new RegExp(`\\b${ref}\\b`, "g"), String(cells[ref] ?? 0));
      }
      const result = new Function(`"use strict"; return (${expr})`)() as number;
      cells[formula.cell] = isNaN(result) ? 0 : result;
      results[formula.cell] = isNaN(result) ? 0 : result;
    } catch {
      results[formula.cell] = 0;
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Template interpolation for model-inference inputTemplate
// ---------------------------------------------------------------------------

/**
 * Recursively replace {{key}} placeholders in a value with entries from ctx.
 * Handles strings, arrays, and plain objects. Non-string scalars are returned as-is.
 */
function interpolate(value: unknown, ctx: Record<string, unknown>): unknown {
  if (typeof value === "string") {
    return value.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
      const v = ctx[key];
      return v !== undefined ? String(v) : `{{${key}}}`;
    });
  }
  if (Array.isArray(value)) {
    return value.map((item) => interpolate(item, ctx));
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = interpolate(v, ctx);
    }
    return result;
  }
  return value;
}

// ---------------------------------------------------------------------------
// model-inference step handler
// ---------------------------------------------------------------------------

async function runModelInferenceStep(
  config: MAppModelInferenceConfig,
  workflowCtx: Record<string, unknown>,
  inferenceGateway: InferenceGateway,
): Promise<unknown> {
  const method = config.method ?? "POST";
  const body = config.inputTemplate
    ? interpolate(config.inputTemplate, workflowCtx)
    : undefined;

  return inferenceGateway.proxyRequest(
    config.modelId,
    config.endpoint,
    method === "GET" ? undefined : body,
    method,
  );
}

// ---------------------------------------------------------------------------
// Workflow runner
// ---------------------------------------------------------------------------

/**
 * Run a named workflow from a MApp definition.
 *
 * Steps are executed in dependency order. If a step fails and subsequent
 * steps depend on it, they are skipped. Steps with no `dependsOn` run
 * immediately; their outputs are stored in the shared workflow context so
 * later steps can reference them via {{outputKey}} interpolation.
 *
 * @param definition  The MApp definition containing the workflow.
 * @param workflowId  ID of the workflow to run.
 * @param initialCtx  Initial context values (e.g. user inputs).
 * @param inferenceGateway  InferenceGateway instance for model-inference steps.
 * @param agentProcess  Optional callback for agent step handling.
 */
export async function runWorkflow(
  definition: MAppDefinition,
  workflowId: string,
  initialCtx: Record<string, unknown>,
  inferenceGateway?: InferenceGateway,
  agentProcess?: (prompt: string, data: string) => Promise<string>,
): Promise<WorkflowRunResult> {
  const workflow = (definition.workflows ?? []).find((w) => w.id === workflowId);
  if (!workflow) {
    return {
      workflowId,
      status: "error",
      steps: [],
      context: initialCtx,
    };
  }

  const workflowCtx: Record<string, unknown> = { ...initialCtx };
  const stepResults: WorkflowStepResult[] = [];
  const completedIds = new Set<string>();
  const failedIds = new Set<string>();

  // Iterate steps — simple sequential execution with dependency checks.
  // Steps with dependsOn that include a failed step are skipped.
  for (const step of workflow.steps) {
    const deps = step.dependsOn ?? [];

    // Check if any dependency failed
    const blockedBy = deps.find((d) => failedIds.has(d));
    if (blockedBy) {
      stepResults.push({
        stepId: step.id,
        status: "skipped",
        error: `Skipped: dependency "${blockedBy}" failed.`,
      });
      failedIds.add(step.id);
      continue;
    }

    // Check if all dependencies have completed
    const missingDep = deps.find((d) => !completedIds.has(d));
    if (missingDep) {
      stepResults.push({
        stepId: step.id,
        status: "skipped",
        error: `Skipped: dependency "${missingDep}" has not run.`,
      });
      failedIds.add(step.id);
      continue;
    }

    try {
      let output: unknown;

      switch (step.type) {
        case "model-inference": {
          if (!inferenceGateway) {
            throw new Error("model-inference step requires an InferenceGateway — HF Marketplace may not be enabled.");
          }
          const cfg = step.config as unknown as MAppModelInferenceConfig;
          output = await runModelInferenceStep(cfg, workflowCtx, inferenceGateway);
          // Store result under the declared outputKey
          if (cfg.outputKey) {
            workflowCtx[cfg.outputKey] = output;
          }
          break;
        }

        case "agent": {
          const prompt = String(step.config.prompt ?? "");
          const data = JSON.stringify(workflowCtx);
          if (agentProcess && prompt) {
            output = await agentProcess(prompt, data);
            const outputKey = String(step.config.outputKey ?? step.id);
            workflowCtx[outputKey] = output;
          }
          break;
        }

        // shell, api, file-transform are not yet implemented in the executor.
        // They are surfaced as skipped so existing MApps don't break.
        default: {
          output = null;
          stepResults.push({
            stepId: step.id,
            status: "skipped",
            error: `Step type "${step.type}" is not yet handled by the workflow runner.`,
          });
          completedIds.add(step.id);
          continue;
        }
      }

      stepResults.push({ stepId: step.id, status: "ok", output });
      completedIds.add(step.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      stepResults.push({ stepId: step.id, status: "error", error: message });
      failedIds.add(step.id);
    }
  }

  const anyError = stepResults.some((s) => s.status === "error");
  const anySkipped = stepResults.some((s) => s.status === "skipped");

  return {
    workflowId,
    status: anyError ? (anySkipped ? "partial" : "error") : "ok",
    steps: stepResults,
    context: workflowCtx,
  };
}

// ---------------------------------------------------------------------------
// Form executor (unchanged behavior)
// ---------------------------------------------------------------------------

/**
 * Execute a MApp form submission.
 *
 * @param definition — the MApp definition
 * @param ctx — execution context (values, project path)
 * @param agentProcess — optional function to run the processingPrompt through an agent
 */
export async function executeMApp(
  definition: MAppDefinition,
  ctx: MAppExecutionContext,
  agentProcess?: (prompt: string, data: string) => Promise<string>,
): Promise<MAppExecutionResult> {
  // 1. Calculate formulas
  const formulas = evaluateFormulas(definition, ctx.values);

  // 2. If no processing prompt, return raw results
  if (!definition.output?.processingPrompt) {
    return { values: ctx.values, formulas };
  }

  // 3. Build data summary for AI
  const allFields = (definition.pages ?? []).flatMap((p) => p.fields ?? []);
  const lines: string[] = [];

  lines.push("## Collected Inputs");
  for (const field of allFields) {
    const val = ctx.values[field.key];
    if (val !== undefined && val !== "") {
      lines.push(`- **${field.label}** (${field.type}): ${String(val)}`);
    }
  }

  if (Object.keys(formulas).length > 0) {
    lines.push("\n## Calculated Values");
    const allFormulas = (definition.pages ?? []).flatMap((p) => p.formulas ?? []);
    for (const f of allFormulas) {
      if (f.visible && formulas[f.cell] !== undefined) {
        lines.push(`- **${f.label}**: ${String(formulas[f.cell])}`);
      }
    }
  }

  const dataSummary = lines.join("\n");

  // 4. Send to agent
  if (!agentProcess) {
    return { values: ctx.values, formulas, error: "No agent processor available" };
  }

  try {
    const aiResult = await agentProcess(definition.output.processingPrompt, dataSummary);
    return { values: ctx.values, formulas, aiResult };
  } catch (err) {
    return { values: ctx.values, formulas, error: err instanceof Error ? err.message : String(err) };
  }
}
