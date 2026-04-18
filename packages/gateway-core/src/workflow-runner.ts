/**
 * WorkflowRunner — executes plugin-registered multi-step workflows.
 * Steps run in dependency order (topological sort).
 */

import { execFile } from "node:child_process";
import type { PluginRegistry } from "@agi/plugins";
import type { Logger } from "./logger.js";
import { createComponentLogger } from "./logger.js";

interface WorkflowStep {
  type: string;
  id: string;
  label: string;
  dependsOn?: string[];
  command?: string;
  cwd?: string;
  method?: string;
  endpoint?: string;
  body?: Record<string, unknown>;
  prompt?: string;
  message?: string;
}

export interface WorkflowStepResult {
  stepId: string;
  status: "completed" | "failed" | "waiting_approval";
  output?: string;
  error?: string;
}

export interface WorkflowRunResult {
  workflowId: string;
  status: "completed" | "failed" | "waiting_approval";
  steps: WorkflowStepResult[];
}

export class WorkflowRunner {
  private readonly log;

  constructor(private readonly deps: { pluginRegistry: PluginRegistry; logger?: Logger }) {
    this.log = createComponentLogger(deps.logger, "workflow-runner");
  }

  /** Execute a workflow by ID. */
  async run(workflowId: string, context?: Record<string, unknown>): Promise<WorkflowRunResult> {
    const registered = this.deps.pluginRegistry.getWorkflows().find((w) => w.workflow.id === workflowId);
    if (!registered) {
      return { workflowId, status: "failed", steps: [{ stepId: "init", status: "failed", error: `Workflow not found: ${workflowId}` }] };
    }

    const steps = registered.workflow.steps as WorkflowStep[];
    const sorted = this.topoSort(steps);
    const results: WorkflowStepResult[] = [];
    const completed = new Set<string>();

    for (const step of sorted) {
      // Check dependencies
      if (step.dependsOn?.some((dep) => !completed.has(dep))) {
        results.push({ stepId: step.id, status: "failed", error: "Dependency not met" });
        return { workflowId, status: "failed", steps: results };
      }

      const result = await this.executeStep(step, context);
      results.push(result);

      if (result.status === "waiting_approval") {
        return { workflowId, status: "waiting_approval", steps: results };
      }
      if (result.status === "failed") {
        return { workflowId, status: "failed", steps: results };
      }

      completed.add(step.id);
    }

    this.log.info(`workflow "${workflowId}" completed (${String(results.length)} steps)`);
    return { workflowId, status: "completed", steps: results };
  }

  private async executeStep(step: WorkflowStep, _context?: Record<string, unknown>): Promise<WorkflowStepResult> {
    switch (step.type) {
      case "shell": {
        return new Promise((resolve) => {
          execFile("bash", ["-c", step.command!], { cwd: step.cwd, timeout: 120_000 }, (err, stdout, stderr) => {
            if (err) {
              resolve({ stepId: step.id, status: "failed", output: stdout, error: stderr || err.message });
            } else {
              resolve({ stepId: step.id, status: "completed", output: stdout });
            }
          });
        });
      }

      case "api": {
        try {
          const method = step.method ?? "GET";
          const url = step.endpoint!.startsWith("http")
            ? step.endpoint!
            : `http://127.0.0.1:${process.env.PORT ?? 3124}${step.endpoint}`;
          const init: RequestInit = { method };
          if (step.body) {
            init.headers = { "Content-Type": "application/json" };
            init.body = JSON.stringify(step.body);
          }
          const res = await fetch(url, init);
          const text = await res.text();
          return { stepId: step.id, status: res.ok ? "completed" : "failed", output: text };
        } catch (err) {
          return { stepId: step.id, status: "failed", error: err instanceof Error ? err.message : String(err) };
        }
      }

      case "agent": {
        // Agent steps are stubs — they log the prompt for manual execution
        this.log.info(`workflow agent step "${step.id}": ${step.prompt ?? "(no prompt)"}`);
        return { stepId: step.id, status: "completed", output: `Agent prompt: ${step.prompt}` };
      }

      case "approval": {
        return { stepId: step.id, status: "waiting_approval", output: step.message };
      }

      default:
        return { stepId: step.id, status: "failed", error: `Unknown step type: ${step.type}` };
    }
  }

  /** Topological sort of workflow steps by their dependsOn references. */
  private topoSort(steps: WorkflowStep[]): WorkflowStep[] {
    const byId = new Map(steps.map((s) => [s.id, s]));
    const visited = new Set<string>();
    const sorted: WorkflowStep[] = [];

    const visit = (step: WorkflowStep) => {
      if (visited.has(step.id)) return;
      visited.add(step.id);
      for (const dep of step.dependsOn ?? []) {
        const depStep = byId.get(dep);
        if (depStep) visit(depStep);
      }
      sorted.push(step);
    };

    for (const step of steps) visit(step);
    return sorted;
  }
}
