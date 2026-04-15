/**
 * taskmaster_queue tool — queue a TaskMaster job by writing a dispatch file
 * to the project's dispatch dir and notifying the worker runtime.
 *
 * Dispatch files land under `~/.agi/{projectSlug}/dispatch/jobs/{jobId}.json`.
 * Per-project scoping prevents Aion (in one project's chat) from ever picking
 * up a job dispatched from another project.
 *
 * Tier-gated (verified/sealed). State is audit metadata only — see
 * compute-available-tools.ts + its test: `requiresState` is preserved on
 * manifests for logging/UI dimming but never filters availability.
 *
 * Orchestration note (2026-04-15): TaskMaster is currently single-phase
 * single-worker. Phase decomposition + enforced chain auto-dispatch are
 * documented in `prompts/taskmaster.md` and listed as follow-ups in
 * `docs/agents/taskmaster.md`; this tool queues one worker at a time.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import type { ToolHandler } from "../tool-registry.js";
import { dispatchJobsDir } from "../dispatch-paths.js";
import { join } from "node:path";

export interface WorkerDispatchConfig {
  /** Override the dispatch base dir. Tests use this; production leaves it unset. */
  botsDir?: string;
  /** Callback fired after a job file is written. Used by WorkerRuntime to pick up jobs. */
  onJobCreated?: (jobId: string, coaReqId: string, projectPath: string) => void;
  /** COA request ID from the invocation context. */
  coaReqId?: string;
}

export function createWorkerDispatchHandler(
  config: WorkerDispatchConfig,
): ToolHandler {
  return async (input: Record<string, unknown>): Promise<string> => {
    const projectPath = String(input.projectPath ?? "").trim();
    if (projectPath.length === 0) {
      return JSON.stringify({
        error: "projectPath is required — pass the absolute path of the project the task belongs to (visible in your Project Context section).",
        exitCode: -1,
      });
    }

    const description = String(input.description ?? "").trim();
    if (description.length === 0) {
      return JSON.stringify({ error: "description is required", exitCode: -1 });
    }

    const domain = String(input.domain ?? "code");
    const worker = String(input.worker ?? "engineer");
    const priority = String(input.priority ?? "normal");

    const validPriorities = ["low", "normal", "high", "critical"];
    if (!validPriorities.includes(priority)) {
      return JSON.stringify({
        error: `Invalid priority: ${priority}. Must be one of: ${validPriorities.join(", ")}`,
        exitCode: -1,
      });
    }

    const jobsDir = config.botsDir !== undefined
      ? join(config.botsDir, "jobs")
      : dispatchJobsDir(projectPath);

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
      projectPath,
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

    if (config.onJobCreated) {
      try {
        config.onJobCreated(jobId, coaReqId, projectPath);
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
  name: "taskmaster_queue",
  description:
    "Queue a task with TaskMaster, the background worker orchestrator. " +
    "TaskMaster picks up the job from the project's dispatch dir and runs the " +
    "specified worker (a specialist agent with access to Aion's full tool registry). " +
    "Use when: (a) the task spans >2 files or multiple concerns, (b) it benefits " +
    "from specialist review (code review, policy editing, compliance audit), " +
    "(c) the user asks for research, documentation, or design work, (d) subtasks " +
    "can run in parallel, or (e) the user explicitly says 'dispatch', 'queue', " +
    "'delegate', 'worker', or 'task'. Jobs appear live in the owner's Work Queue " +
    "drawer tab scoped to this project. Inputs: projectPath (required, absolute), " +
    "description (required), domain, worker, priority. Returns jobId. Call this " +
    "tool multiple times in one turn to fan out parallel work.",
  requiresState: [],
  requiresTier: ["verified" as const, "sealed" as const],
};

export const WORKER_DISPATCH_INPUT_SCHEMA = {
  type: "object",
  properties: {
    projectPath: {
      type: "string",
      description:
        "Absolute path of the project the task belongs to. Read it from your Project Context section of the system prompt. Required.",
    },
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
  required: ["projectPath", "description"],
};
