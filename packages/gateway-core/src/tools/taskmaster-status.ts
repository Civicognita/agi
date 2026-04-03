/**
 * taskmaster_status tool — read BOTS job status from .bots/jobs/ directory.
 *
 * Requires state ONLINE, tier unverified (read-only).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ToolHandler } from "../tool-registry.js";

export interface TaskmasterStatusConfig {
  workspaceRoot: string;
  botsDir?: string;
}

export function createTaskmasterStatusHandler(
  config: TaskmasterStatusConfig,
): ToolHandler {
  return async (input: Record<string, unknown>): Promise<string> => {
    const jobId = input.jobId !== undefined ? String(input.jobId).trim() : undefined;
    const jobsDir = resolve(config.botsDir ?? join(config.workspaceRoot, ".bots"), "jobs");

    if (jobId !== undefined && jobId.length > 0) {
      // Single job lookup
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

    // List all jobs
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

export const TASKMASTER_STATUS_MANIFEST = {
  name: "taskmaster_status",
  description:
    "Read BOTS job status from .bots/jobs/. " +
    "If jobId is provided, returns details for that job. " +
    "Otherwise lists all jobs and their statuses.",
  requiresState: ["ONLINE" as const],
  requiresTier: ["unverified" as const, "verified" as const, "sealed" as const],
};

export const TASKMASTER_STATUS_INPUT_SCHEMA = {
  type: "object",
  properties: {
    jobId: {
      type: "string",
      description: "Optional job ID to look up. If omitted, lists all jobs.",
    },
  },
  required: [] as string[],
};
