/**
 * MApp Executor — processes form submissions from MApp pages.
 *
 * Flow:
 * 1. Collect field values (A-column)
 * 2. Calculate formulas (B-column) from inputs + constants (C-column)
 * 3. If output.processingPrompt exists, send to agent for AI processing
 * 4. Return result
 */

import type { MAppDefinition } from "@aionima/sdk";

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
// Execute
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
