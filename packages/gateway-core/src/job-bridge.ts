/**
 * JobBridge — manages taskmaster job state across dispatch files and the
 * global state index.
 *
 * State file: ~/.agi/state/taskmaster.json (runtime data, not in repo).
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import type { WorkPhase } from "./taskmaster-orchestrator.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TaskmasterState {
  version: string;
  wip: {
    jobs: Record<string, TaskmasterJob>;
    next_frame: string | null;
    job_counter: number;
  };
}

export interface TaskmasterJob {
  id: string;
  queueText: string;
  route: string | null;
  entryWorker: string;
  worktree: string;
  branch: string;
  phases: TaskmasterPhase[];
  currentPhase: number;
  status: "pending" | "running" | "checkpoint" | "complete" | "failed";
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  /** Project this job runs in — persisted so a checkpoint-paused job can be
   *  resumed (approveCheckpoint) without the caller having to re-supply
   *  context that only existed on the original dispatch call. */
  projectPath?: string;
}

export interface TaskmasterPhase {
  id: string;
  name: string;
  domain: string;
  role: string;
  description: string;
  workers: string[];
  gate: "auto" | "checkpoint" | "terminal";
  status: "pending" | "running" | "complete" | "failed";
  /** This phase's final worker output. Persisted (not just held in memory)
   *  so a checkpoint-paused job can hand the right context to the next
   *  phase's fresh Genie agent after an owner approves, even across a
   *  process restart. */
  output?: string;
}

interface DispatchJob {
  id: string;
  description: string;
  priority: string;
  status: string;
  coaReqId: string;
  createdAt: string;
  // Legacy fields (pre-redesign dispatch files may still have these)
  domain?: string;
  worker?: string;
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
   * Create a job with phases from the orchestrator's decomposition.
   * Called after TaskMaster decomposes the work description.
   */
  ensureJobWithPhases(
    jobId: string,
    dispatchFilePath: string,
    phases: WorkPhase[],
    projectPath?: string,
  ): string {
    let dispatch: DispatchJob;
    try {
      dispatch = JSON.parse(readFileSync(dispatchFilePath, "utf-8")) as DispatchJob;
    } catch {
      throw new Error(`Failed to read dispatch file: ${dispatchFilePath}`);
    }

    const state = this.loadState();

    if (state.wip.jobs[jobId]) {
      return jobId;
    }

    const tmPhases: TaskmasterPhase[] = phases.map((p, i) => ({
      id: `phase-${String(i + 1)}`,
      name: `${p.domain}/${p.role}`,
      domain: p.domain,
      role: p.role,
      description: p.phaseDescription,
      workers: [`$W.${p.domain}.${p.role}`],
      gate: i === phases.length - 1 ? "terminal" as const : p.gate,
      status: "pending" as const,
    }));

    const firstPhase = tmPhases[0];
    const job: TaskmasterJob = {
      id: jobId,
      queueText: dispatch.description,
      route: firstPhase ? `${firstPhase.domain}.${firstPhase.role}` : null,
      entryWorker: firstPhase ? `$W.${firstPhase.domain}.${firstPhase.role}` : "$W.unknown",
      worktree: ".",
      branch: "dev",
      phases: tmPhases,
      currentPhase: 0,
      status: "pending",
      createdAt: dispatch.createdAt,
      projectPath,
    };

    state.wip.jobs[jobId] = job;
    state.wip.job_counter += 1;

    this.saveState(state);
    return jobId;
  }

  /**
   * Legacy: create a single-phase job from old-style dispatch files
   * that still have domain/worker fields.
   */
  ensureJob(jobId: string, dispatchFilePath: string, projectPath?: string): string {
    let dispatch: DispatchJob;
    try {
      dispatch = JSON.parse(readFileSync(dispatchFilePath, "utf-8")) as DispatchJob;
    } catch {
      throw new Error(`Failed to read dispatch file: ${dispatchFilePath}`);
    }

    const state = this.loadState();
    if (state.wip.jobs[jobId]) return jobId;

    const domain = dispatch.domain ?? "code";
    const worker = dispatch.worker ?? "engineer";
    const workerSpec = `$W.${domain}.${worker}`;

    const phase: TaskmasterPhase = {
      id: "phase-1",
      name: `${domain}/${worker}`,
      domain,
      role: worker,
      description: dispatch.description,
      workers: [workerSpec],
      gate: "terminal",
      status: "pending",
    };

    const job: TaskmasterJob = {
      id: jobId,
      queueText: dispatch.description,
      route: `${domain}.${worker}`,
      entryWorker: workerSpec,
      worktree: ".",
      branch: "dev",
      phases: [phase],
      currentPhase: 0,
      status: "pending",
      createdAt: dispatch.createdAt,
      projectPath,
    };

    state.wip.jobs[jobId] = job;
    state.wip.job_counter += 1;
    this.saveState(state);
    return jobId;
  }

  /**
   * Update job-level status. "checkpoint" is a genuine pause (worker
   * finished its phase; awaiting owner approve/reject before the next
   * phase starts) — distinct from "running" so listers can tell the two
   * apart.
   */
  updateJobStatus(
    jobId: string,
    status: "running" | "checkpoint" | "complete" | "failed",
    error?: string,
  ): void {
    const state = this.loadState();
    const job = state.wip.jobs[jobId];
    if (!job) return;

    job.status = status;
    if (status === "running") job.startedAt = new Date().toISOString();
    if (status === "complete" || status === "failed")
      job.completedAt = new Date().toISOString();
    if (error) job.error = error;

    this.saveState(state);
  }

  /**
   * Advance to the next phase. Returns the new phase index, or -1 if done.
   * `output` is the completing phase's final worker text — persisted onto
   * that phase so a later checkpoint-resume can rebuild the "previous phase
   * output" context without needing it passed back in by the caller.
   */
  advancePhase(jobId: string, output?: string): number {
    const state = this.loadState();
    const job = state.wip.jobs[jobId];
    if (!job) return -1;

    const current = job.phases[job.currentPhase];
    if (current) {
      current.status = "complete";
      if (output !== undefined) current.output = output;
    }

    const next = job.currentPhase + 1;
    if (next >= job.phases.length) {
      job.status = "complete";
      job.completedAt = new Date().toISOString();
      this.saveState(state);
      return -1;
    }

    job.currentPhase = next;
    const nextPhase = job.phases[next];
    if (nextPhase) nextPhase.status = "running";
    this.saveState(state);
    return next;
  }

  /**
   * Mark the current phase as running.
   */
  markPhaseRunning(jobId: string): void {
    const state = this.loadState();
    const job = state.wip.jobs[jobId];
    if (!job) return;

    const phase = job.phases[job.currentPhase];
    if (phase) phase.status = "running";
    this.saveState(state);
  }

  /**
   * Mark the current phase as failed and fail the job.
   */
  markPhaseFailed(jobId: string, error: string): void {
    const state = this.loadState();
    const job = state.wip.jobs[jobId];
    if (!job) return;

    const phase = job.phases[job.currentPhase];
    if (phase) phase.status = "failed";
    job.status = "failed";
    job.error = error;
    job.completedAt = new Date().toISOString();
    this.saveState(state);
  }

  /**
   * Get the current phase for a job.
   */
  getCurrentPhase(jobId: string): TaskmasterPhase | null {
    const state = this.loadState();
    const job = state.wip.jobs[jobId];
    if (!job) return null;
    return job.phases[job.currentPhase] ?? null;
  }

  /**
   * Get the full job state.
   */
  getJob(jobId: string): TaskmasterJob | null {
    const state = this.loadState();
    return state.wip.jobs[jobId] ?? null;
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
