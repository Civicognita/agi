/**
 * taskmaster_dispatch tool — delegate work to TaskMaster.
 *
 * Aion describes WHAT needs to be done. TaskMaster decomposes the work
 * into a sequence of workers and executes them. No domain/worker selection
 * by Aion — TaskMaster handles orchestration.
 *
 * Dispatch files land under `~/.agi/{projectSlug}/dispatch/jobs/{jobId}.json`.
 */
import { writeFileSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ToolHandler } from "../tool-registry.js";
import { dispatchJobsDir, loadLiveJobOverlay } from "../dispatch-paths.js";
import { idempotencyKey } from "../taskmaster-queue-diagnostic.js";

// ---------------------------------------------------------------------------
// Anti-loop guard constants (s159 t695/t696/t697)
// ---------------------------------------------------------------------------

/** Refuse re-dispatch of the same key within this many ms of last completion. */
const COOLDOWN_MS = 60_000;

/** Max consecutive failures of the same key within BREAKER_WINDOW_MS before opening the breaker. */
const BREAKER_THRESHOLD = 3;

/** Rolling window for failure counting (5 min). */
const BREAKER_WINDOW_MS = 5 * 60_000;

const TERMINAL_STATUSES = new Set(["complete", "failed", "completed", "error", "cancelled"]);
const ACTIVE_STATUSES = new Set(["pending", "running", "checkpoint"]);

export interface WorkerDispatchConfig {
  /** Test-only override for the dispatch base dir. Production leaves this unset and uses dispatchJobsDir(projectPath). */
  dispatchDirOverride?: string;
  onJobCreated?: (args: {
    jobId: string;
    coaReqId: string;
    projectPath: string;
    sessionKey?: string;
    chatSessionId?: string;
    planRef?: { planId: string; stepId: string };
  }) => void;
  coaReqId?: string;
}

interface PlanRef {
  planId: string;
  stepId: string;
}

export function createWorkerDispatchHandler(
  config: WorkerDispatchConfig,
): ToolHandler {
  return async (input: Record<string, unknown>, ctx): Promise<string> => {
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

    const priority = String(input.priority ?? "normal");

    let planRef: PlanRef | undefined;
    if (input.planRef !== undefined && input.planRef !== null) {
      const pr = input.planRef as Record<string, unknown>;
      const planId = String(pr.planId ?? "").trim();
      const stepId = String(pr.stepId ?? "").trim();
      if (planId.length === 0 || stepId.length === 0) {
        return JSON.stringify({
          error: "planRef requires both planId and stepId when provided.",
          exitCode: -1,
        });
      }
      planRef = { planId, stepId };
    }

    const validPriorities = ["low", "normal", "high", "critical"];
    if (!validPriorities.includes(priority)) {
      return JSON.stringify({
        error: `Invalid priority: ${priority}. Must be one of: ${validPriorities.join(", ")}`,
        exitCode: -1,
      });
    }

    const jobsDir = config.dispatchDirOverride !== undefined
      ? join(config.dispatchDirOverride, "jobs")
      : dispatchJobsDir(projectPath);

    try {
      mkdirSync(jobsDir, { recursive: true });
    } catch (err) {
      return JSON.stringify({
        error: `Failed to create jobs directory: ${err instanceof Error ? err.message : String(err)}`,
        exitCode: -1,
      });
    }

    // -------------------------------------------------------------------------
    // Anti-loop guard: idempotency key + cooldown + circuit breaker (s159)
    //
    // Scans the project's jobs directory for existing jobs with the same
    // idempotency key (hash of planRef or description). Three checks:
    //
    //   (1) In-flight: refuse if same key is pending/running/checkpoint
    //   (2) Cooldown: refuse if same key completed/failed within COOLDOWN_MS
    //   (3) Circuit breaker: refuse if same key has >= BREAKER_THRESHOLD
    //       failures within BREAKER_WINDOW_MS
    //
    // Non-fatal: if the scan fails (e.g. FS error), the dispatch proceeds.
    // -------------------------------------------------------------------------
    try {
      const candidateKey = idempotencyKey({ id: "", description, planRef });
      const liveOverlay = loadLiveJobOverlay();
      let recentFailureCount = 0;

      for (const fname of readdirSync(jobsDir)) {
        if (!fname.endsWith(".json")) continue;
        let existing: Record<string, unknown>;
        try {
          existing = JSON.parse(readFileSync(join(jobsDir, fname), "utf-8")) as Record<string, unknown>;
        } catch {
          continue;
        }

        const existingId = typeof existing.id === "string" ? existing.id : "";
        if (idempotencyKey({
          id: existingId,
          description: typeof existing.description === "string" ? existing.description : undefined,
          planRef: (existing.planRef as { planId?: string; stepId?: string } | null | undefined) ?? undefined,
        }) !== candidateKey) {
          continue;
        }

        // Merge live overlay status onto dispatch file status
        const live = liveOverlay.get(existingId);
        const fileStatus = typeof existing.status === "string" ? existing.status : "pending";
        const effectiveStatus = live?.status ?? fileStatus;

        // (1) In-flight guard
        if (ACTIVE_STATUSES.has(effectiveStatus)) {
          return JSON.stringify({
            error: `Duplicate dispatch refused: job ${existingId} with the same key is already ${effectiveStatus}. Use taskmaster_status to check its progress.`,
            exitCode: -1,
            duplicate: true,
            existingJobId: existingId,
          });
        }

        if (TERMINAL_STATUSES.has(effectiveStatus)) {
          const refTime = live?.completedAt
            ?? (typeof existing.completedAt === "string" ? existing.completedAt : undefined)
            ?? (typeof existing.createdAt === "string" ? existing.createdAt : undefined);

          if (typeof refTime === "string") {
            const ageMs = Date.now() - new Date(refTime).getTime();

            // (2) Cooldown guard
            if (ageMs < COOLDOWN_MS) {
              return JSON.stringify({
                error: `Cooldown: job ${existingId} with the same key ${effectiveStatus} ${Math.round(ageMs / 1000)}s ago. Wait ${Math.ceil((COOLDOWN_MS - ageMs) / 1000)}s before re-dispatching.`,
                exitCode: -1,
                cooldown: true,
                existingJobId: existingId,
                cooldownRemainingSeconds: Math.ceil((COOLDOWN_MS - ageMs) / 1000),
              });
            }

            // (3) Circuit breaker: count recent failures
            if ((effectiveStatus === "failed" || effectiveStatus === "error") && ageMs < BREAKER_WINDOW_MS) {
              recentFailureCount++;
            }
          }
        }
      }

      // Circuit breaker open check (evaluated after full scan)
      if (recentFailureCount >= BREAKER_THRESHOLD) {
        return JSON.stringify({
          error: `Circuit breaker: ${String(recentFailureCount)} failures of the same job key in the last 5 minutes. Investigate the root cause before re-dispatching — check GET /api/taskmaster/queue and recent logs.`,
          exitCode: -1,
          circuitBreaker: true,
          failureCount: recentFailureCount,
        });
      }
    } catch {
      // Non-fatal — proceed with dispatch if the guard scan fails
    }

    const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const jobFile = join(jobsDir, `${jobId}.json`);

    const coaReqId = ctx?.coaChainBase ?? config.coaReqId ?? `unknown-${Date.now()}`;
    const sessionKey = ctx?.sessionKey;
    const chatSessionId = ctx?.chatSessionId;

    const job = {
      id: jobId,
      description,
      priority,
      status: "pending",
      coaReqId,
      projectPath,
      sessionKey,
      chatSessionId,
      planRef,
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
        config.onJobCreated({ jobId, coaReqId, projectPath, sessionKey, chatSessionId, planRef });
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
  name: "taskmaster_dispatch",
  description:
    "Delegate work to TaskMaster, the background orchestrator. Describe WHAT " +
    "needs to be done — TaskMaster selects the right workers and execution " +
    "sequence automatically. Use when: (a) the task spans multiple files or " +
    "concerns, (b) it benefits from specialist work (code review, testing, " +
    "documentation), (c) the user asks for research, design, or implementation " +
    "work, (d) subtasks can be decomposed into phases, or (e) the user says " +
    "'dispatch', 'queue', 'delegate', or 'task'. Jobs appear live in the Work " +
    "Queue. After TaskMaster reports completion, verify the result before " +
    "responding to the user.",
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
      description: "Human-readable description of the work to be done. Describe WHAT, not which worker to use.",
    },
    priority: {
      type: "string",
      enum: ["low", "normal", "high", "critical"],
      description: 'Task priority level. Defaults to "normal".',
    },
    planRef: {
      type: "object",
      description:
        "Optional. Link this job to a specific step of an approved plan so " +
        "the server auto-marks the step running on dispatch, complete on " +
        "success, or failed on failure.",
      properties: {
        planId: { type: "string", description: "The plan id from create_plan." },
        stepId: { type: "string", description: "The step id inside that plan." },
      },
      required: ["planId", "stepId"],
    },
  },
  required: ["projectPath", "description"],
};
