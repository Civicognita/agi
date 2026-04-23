/**
 * taskmaster_cancel tool — Aion-initiated cancellation of a queued or
 * in-flight Taskmaster job.
 *
 * Pending jobs (no worker started yet): the dispatch file is removed and the
 * state index flips to "failed" with the cancel reason. Running jobs: the
 * state index flips to "failed" with the reason — the LLM loop will finish
 * its current tool call before noticing, so the abort is best-effort (full
 * mid-run AbortController is a follow-up).
 *
 * Requeue semantics: Aion cancels then calls `taskmaster_dispatch` again with
 * the new description. There is no "edit in place" path.
 */
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { ToolHandler } from "../tool-registry.js";
import { dispatchJobsDir } from "../dispatch-paths.js";

export interface TaskmasterCancelConfig {
  /** Test-only override. Production leaves this unset and uses dispatchJobsDir. */
  dispatchDirOverride?: string;
  /**
   * Called after the dispatch file has been removed (if any). The runtime
   * listener flips state index → "failed" with the cancel reason and, for
   * in-flight jobs, drops them from activeJobs.
   */
  onCancel?: (args: { jobId: string; projectPath: string; reason: string }) => void;
}

export function createTaskmasterCancelHandler(config: TaskmasterCancelConfig): ToolHandler {
  return async (input: Record<string, unknown>): Promise<string> => {
    const projectPath = String(input.projectPath ?? "").trim();
    if (projectPath.length === 0) {
      return JSON.stringify({ error: "projectPath is required" });
    }
    const jobId = String(input.jobId ?? "").trim();
    if (jobId.length === 0) {
      return JSON.stringify({ error: "jobId is required" });
    }
    const reason = String(input.reason ?? "Cancelled by Aion").trim() || "Cancelled by Aion";

    const jobsDir = config.dispatchDirOverride !== undefined
      ? join(config.dispatchDirOverride, "jobs")
      : dispatchJobsDir(projectPath);
    const jobFile = join(jobsDir, `${jobId}.json`);

    let removedDispatchFile = false;
    try {
      if (existsSync(jobFile)) {
        unlinkSync(jobFile);
        removedDispatchFile = true;
      }
    } catch (err) {
      return JSON.stringify({
        error: `Failed to remove dispatch file: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    if (config.onCancel) {
      try {
        config.onCancel({ jobId, projectPath, reason });
      } catch {
        // Non-fatal — we've already removed the dispatch file.
      }
    }

    return JSON.stringify({
      ok: true,
      jobId,
      removedDispatchFile,
      reason,
      note: removedDispatchFile
        ? "Dispatch file removed and state flipped to failed. If the worker was already in flight it will finish its current tool call before stopping; any output written so far remains on disk."
        : "No dispatch file found (may have completed or been cancelled previously). State flipped to failed if the job existed in the state index.",
    });
  };
}

export const TASKMASTER_CANCEL_MANIFEST = {
  name: "taskmaster_cancel",
  description:
    "Cancel a queued or in-flight Taskmaster job and mark it failed with the given reason. " +
    "Pending jobs are fully cleaned (dispatch file removed). Running jobs are best-effort: " +
    "the state flips to failed immediately, but an already-running worker finishes its current " +
    "tool call before stopping. To requeue after cancel, call taskmaster_dispatch again. " +
    "Use when the owner changes their mind, the job is clearly stuck, or the scope needs to be edited.",
  requiresState: [],
  requiresTier: ["verified" as const, "sealed" as const],
  agentOnly: true as const,
};

export const TASKMASTER_CANCEL_INPUT_SCHEMA = {
  type: "object",
  properties: {
    projectPath: {
      type: "string",
      description: "Absolute path of the project the job belongs to.",
    },
    jobId: {
      type: "string",
      description: "The job id returned by taskmaster_dispatch.",
    },
    reason: {
      type: "string",
      description: "Short explanation for the cancellation. Defaults to 'Cancelled by Aion'.",
    },
  },
  required: ["projectPath", "jobId"],
};
