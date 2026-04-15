/**
 * taskmaster_status tool — read TaskMaster job status from a project's
 * dispatch dir.
 *
 * Reads from `~/.agi/{projectSlug}/dispatch/jobs/` so Aion only sees jobs
 * belonging to the project it's contextualized on. Tier-permissive (any
 * tier, read-only).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ToolHandler } from "../tool-registry.js";
import { dispatchJobsDir } from "../dispatch-paths.js";

export interface WorkerStatusConfig {
  /** Override the dispatch base dir. Tests use this; production leaves it unset. */
  botsDir?: string;
}

export function createWorkerStatusHandler(
  config: WorkerStatusConfig,
): ToolHandler {
  return async (input: Record<string, unknown>): Promise<string> => {
    const projectPath = String(input.projectPath ?? "").trim();
    if (projectPath.length === 0) {
      return JSON.stringify({
        error: "projectPath is required — pass the absolute path of the project whose jobs to list (visible in your Project Context section).",
      });
    }

    const jobId = input.jobId !== undefined ? String(input.jobId).trim() : undefined;
    const jobsDir = config.botsDir !== undefined
      ? join(config.botsDir, "jobs")
      : dispatchJobsDir(projectPath);

    if (jobId !== undefined && jobId.length > 0) {
      const jobFile = join(jobsDir, `${jobId}.json`);
      try {
        const raw = readFileSync(jobFile, "utf-8");
        const job = JSON.parse(raw) as unknown;
        return JSON.stringify({ exitCode: 0, job });
      } catch (err) {
        const isNotFound =
          err instanceof Error &&
          (err as NodeJS.ErrnoException).code === "ENOENT";
        return JSON.stringify({
          exitCode: isNotFound ? 0 : -1,
          error: isNotFound
            ? `Job not found: ${jobId}`
            : `Failed to read job: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    let files: string[];
    try {
      files = readdirSync(jobsDir).filter((f) => f.endsWith(".json"));
    } catch (err) {
      const isNotFound =
        err instanceof Error &&
        (err as NodeJS.ErrnoException).code === "ENOENT";
      if (isNotFound) {
        return JSON.stringify({ exitCode: 0, jobs: [], total: 0 });
      }
      return JSON.stringify({
        exitCode: -1,
        error: `Failed to read jobs directory: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    const jobs: unknown[] = [];
    for (const file of files.sort()) {
      try {
        const raw = readFileSync(join(jobsDir, file), "utf-8");
        jobs.push(JSON.parse(raw) as unknown);
      } catch {
        // Skip unreadable job files
      }
    }

    return JSON.stringify({ exitCode: 0, jobs, total: jobs.length });
  };
}

export const WORKER_STATUS_MANIFEST = {
  name: "taskmaster_status",
  description:
    "Check TaskMaster job status for the current project. " +
    "If jobId is provided, returns details for that job. " +
    "Otherwise lists all jobs for the project. Scoped to the projectPath — " +
    "never returns jobs from other projects.",
  requiresState: [],
  requiresTier: ["unverified" as const, "verified" as const, "sealed" as const],
};

export const WORKER_STATUS_INPUT_SCHEMA = {
  type: "object",
  properties: {
    projectPath: {
      type: "string",
      description:
        "Absolute path of the project whose jobs to list. Read from your Project Context section. Required.",
    },
    jobId: {
      type: "string",
      description: "Optional job ID to look up. If omitted, lists all jobs for the project.",
    },
  },
  required: ["projectPath"],
};
