/**
 * JobBridge — translates taskmaster_queue job files into taskmaster state.
 *
 * The taskmaster_queue tool writes flat JSON to
 * ~/.agi/{projectSlug}/dispatch/jobs/{id}.json (per-project), and this bridge
 * ensures each such job is represented in the global state index at
 * ~/.agi/state/taskmaster.json so WorkerRuntime can execute it.
 *
 * State file location: ~/.agi/state/taskmaster.json (runtime data, not in repo).
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

// ---------------------------------------------------------------------------
// Types (mirrors .bots/lib/job-manager.ts — minimal subset)
// ---------------------------------------------------------------------------

interface TaskmasterState {
  version: string;
  wip: {
    jobs: Record<string, TaskmasterJob>;
    next_frame: string | null;
    job_counter: number;
  };
}

interface TaskmasterJob {
  id: string;
  queueText: string;
  route: string | null;
  entryWorker: string;
  worktree: string;
  branch: string;
  phases: TaskmasterPhase[];
  currentPhase: string | null;
  status: "pending" | "running" | "checkpoint" | "complete" | "failed";
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

interface TaskmasterPhase {
  id: string;
  name: string;
  workers: string[];
  gate: "auto" | "checkpoint" | "terminal";
  status: "pending" | "running" | "complete" | "failed";
}

interface DispatchJob {
  id: string;
  description: string;
  domain: string;
  worker: string;
  priority: string;
  status: string;
  coaReqId: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// JobBridge
// ---------------------------------------------------------------------------

export class JobBridge {
  private readonly stateDir: string;

  constructor(stateDir?: string) {
    this.stateDir = stateDir ?? join(homedir(), ".agi", "state");
  }

  /**
   * Ensure a dispatched job exists in the taskmaster state.
   * Reads the dispatch file from .bots/jobs/, creates/updates the
   * corresponding entry in taskmaster.json.
   *
   * Returns the taskmaster job ID (same as the dispatch job ID).
   */
  ensureJob(jobId: string, dispatchFilePath: string): string {
    // Read the dispatch file
    let dispatch: DispatchJob;
    try {
      dispatch = JSON.parse(readFileSync(dispatchFilePath, "utf-8")) as DispatchJob;
    } catch {
      throw new Error(`Failed to read dispatch file: ${dispatchFilePath}`);
    }

    // Load or create taskmaster state
    const state = this.loadState();

    // Skip if job already exists in state
    if (state.wip.jobs[jobId]) {
      return jobId;
    }

    // Map domain/worker to $W format
    const workerSpec = `$W.${dispatch.domain}.${dispatch.worker}`;

    // Create a single-phase job (the worker handles everything)
    const phase: TaskmasterPhase = {
      id: "phase-1",
      name: `${dispatch.domain}/${dispatch.worker}`,
      workers: [workerSpec],
      gate: "terminal",
      status: "pending",
    };

    const job: TaskmasterJob = {
      id: jobId,
      queueText: dispatch.description,
      route: `${dispatch.domain}.${dispatch.worker}`,
      entryWorker: workerSpec,
      worktree: ".",
      branch: "dev",
      phases: [phase],
      currentPhase: "phase-1",
      status: "pending",
      createdAt: dispatch.createdAt,
    };

    state.wip.jobs[jobId] = job;
    state.wip.job_counter += 1;

    this.saveState(state);
    return jobId;
  }

  /**
   * Update a job's status in the taskmaster state.
   */
  updateJobStatus(jobId: string, status: "running" | "complete" | "failed", error?: string): void {
    const state = this.loadState();
    const job = state.wip.jobs[jobId];
    if (!job) return;

    job.status = status;
    if (status === "running") job.startedAt = new Date().toISOString();
    if (status === "complete" || status === "failed") job.completedAt = new Date().toISOString();
    if (error) job.error = error;

    this.saveState(state);
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private getStatePath(): string {
    return join(this.stateDir, "taskmaster.json");
  }

  private loadState(): TaskmasterState {
    const path = this.getStatePath();
    if (existsSync(path)) {
      try {
        return JSON.parse(readFileSync(path, "utf-8")) as TaskmasterState;
      } catch {
        // Corrupt state — recreate
      }
    }
    return this.createEmptyState();
  }

  private saveState(state: TaskmasterState): void {
    const path = this.getStatePath();
    const dir = dirname(path);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(path, JSON.stringify(state, null, 2), "utf-8");
  }

  private createEmptyState(): TaskmasterState {
    return {
      version: "1.0",
      wip: { jobs: {}, next_frame: null, job_counter: 0 },
    };
  }
}
