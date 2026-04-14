/**
 * worker_dispatch tool — write a worker job file to the .dispatch/jobs/ directory.
 *
 * Requires state ONLINE, tier verified/sealed.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ToolHandler } from "../tool-registry.js";

export interface WorkerDispatchConfig {
  workspaceRoot: string;
  botsDir?: string;
  /** Callback fired after a job file is written. Used by WorkerRuntime to pick up jobs. */
  onJobCreated?: (jobId: string, coaReqId: string) => void;
  /** COA request ID from the invocation context. */
  coaReqId?: string;
}

export function createWorkerDispatchHandler(
  config: WorkerDispatchConfig,
): ToolHandler {
  return async (input: Record<string, unknown>): Promise<string> => {
    const description = String(input.description ?? "").trim();
    if (description.length === 0) {
      return JSON.stringify({ error: "description is required", exitCode: -1 });
    }

    const domain = String(input.domain ?? "code");
    const worker = String(input.worker ?? "engineer");
    const priority = String(input.priority ?? "normal");

    // Validate priority
    const validPriorities = ["low", "normal", "high", "critical"];
    if (!validPriorities.includes(priority)) {
      return JSON.stringify({
        error: `Invalid priority: ${priority}. Must be one of: ${validPriorities.join(", ")}`,
        exitCode: -1,
      });
    }

    const jobsDir = resolve(config.botsDir ?? join(config.workspaceRoot, ".dispatch"), "jobs");

    try {
      mkdirSync(jobsDir, { recursive: true });
    } catch (err) {
      return JSON.stringify({
        error: `Failed to create jobs directory: ${err instanceof Error ? err.message : String(err)}`,
        exitCode: -1,
      });
    }

    const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const jobFile = join(jobsDir, `${jobId}.json`);

    const coaReqId = config.coaReqId ?? `unknown-${Date.now()}`;

    const job = {
      id: jobId,
      description,
      domain,
      worker,
      priority,
      status: "pending",
      coaReqId,
      createdAt: new Date().toISOString(),
    };

    try {
      writeFileSync(jobFile, JSON.stringify(job, null, 2), "utf-8");
    } catch (err) {
      return JSON.stringify({
        error: `Failed to write job file: ${err instanceof Error ? err.message : String(err)}`,
        exitCode: -1,
      });
    }

    // Notify the runtime that a job was created
    if (config.onJobCreated) {
      try {
        config.onJobCreated(jobId, coaReqId);
      } catch {
        // Don't fail the tool if the callback throws
      }
    }

    return JSON.stringify({
      exitCode: 0,
      jobId,
      jobFile,
      job,
    });
  };
}

export const WORKER_DISPATCH_MANIFEST = {
  name: "worker_dispatch",
  description:
    "Queue a task with TaskMaster, the background worker orchestrator. " +
    "TaskMaster decomposes the description into phased worker assignments " +
    "(e.g. code.hacker\u2192code.tester, comm.writer.tech\u2192comm.editor) and runs " +
    "them in isolated worktrees. Use when: (a) the task spans >2 files or " +
    "multiple concerns, (b) it benefits from specialist review (code review, " +
    "policy editing, compliance audit), (c) the user asks for research, " +
    "documentation, or design work, (d) subtasks can run in parallel, or " +
    "(e) the user explicitly says 'dispatch', 'queue', 'delegate', 'worker', " +
    "or 'task'. Jobs appear live in the owner's WorkQueue dashboard tab. " +
    "Inputs: description (required), domain, worker, priority. Returns jobId. " +
    "Call this tool multiple times in one turn to fan out parallel work.",
  requiresState: ["ONLINE" as const],
  requiresTier: ["verified" as const, "sealed" as const],
};

export const WORKER_DISPATCH_INPUT_SCHEMA = {
  type: "object",
  properties: {
    description: {
      type: "string",
      description: "Human-readable description of the task to dispatch",
    },
    domain: {
      type: "string",
      description: 'Worker domain (e.g. "code", "k", "ux", "strat", "comm", "ops", "gov", "data")',
    },
    worker: {
      type: "string",
      description: 'Specific worker within the domain (e.g. "engineer", "hacker", "reviewer")',
    },
    priority: {
      type: "string",
      enum: ["low", "normal", "high", "critical"],
      description: 'Task priority level. Defaults to "normal".',
    },
  },
  required: ["description"],
};
