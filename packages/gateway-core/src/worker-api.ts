/**
 * Taskmaster API — management endpoints for job control.
 *
 * Endpoints:
 *   POST /api/taskmaster/approve/:jobId — approve a checkpoint
 *   POST /api/taskmaster/reject/:jobId  — reject with reason
 *   GET  /api/taskmaster/jobs           — list all jobs
 *   GET  /api/taskmaster/jobs/:jobId    — job detail
 */

import type { FastifyInstance } from "fastify";
import type { WorkerRuntime, WorkerJob } from "./worker-runtime.js";
import type { WorkerPromptLoader } from "./worker-prompt-loader.js";

/** Shape the dashboard expects (matches WorkerJobSummary in ui/dashboard/src/types.ts). */
interface JobSummary {
  id: string;
  description: string;
  status: "pending" | "running" | "checkpoint" | "complete" | "failed";
  currentPhase: string | null;
  workers: string[];
  gate: "auto" | "checkpoint" | "terminal";
  createdAt: string;
  /** Terminal-state fields — populated after the worker finishes. Surfaced
   *  to the new Taskmaster project tab's expandable summary rows. */
  summary?: string;
  completedAt?: string;
  error?: string;
  tokens?: { input: number; output: number };
  toolCalls?: Array<{ name: string; ts: string }>;
}

function toSummary(job: WorkerJob): JobSummary {
  const activePhase = job.phases.find((p) => p.id === job.currentPhase) ?? job.phases[0];
  return {
    id: job.id,
    description: job.queueText,
    status: job.status,
    currentPhase: job.currentPhase,
    workers: activePhase?.workers ?? [],
    gate: activePhase?.gate ?? "auto",
    createdAt: job.createdAt,
    summary: job.summary,
    completedAt: job.completedAt,
    error: job.error,
    tokens: job.tokens,
    toolCalls: job.toolCalls,
  };
}

export function registerWorkerApi(
  app: FastifyInstance,
  runtime: WorkerRuntime,
  promptLoader?: WorkerPromptLoader,
): void {
  // GET /api/workers/catalog — dynamic worker prompt catalog
  if (promptLoader) {
    app.get("/api/workers/catalog", async () => {
      return promptLoader.discover().map((entry) => ({
        id: entry.id,
        title: entry.name,
        description: entry.description,
        domain: entry.domain,
        role: entry.role,
        model: entry.model,
        color: entry.color,
        filePath: entry.filePath,
      }));
    });
  }
  app.post<{ Params: { jobId: string } }>("/api/taskmaster/approve/:jobId", async (request) => {
    await runtime.approveCheckpoint(request.params.jobId);
    return { ok: true };
  });

  app.post<{ Params: { jobId: string } }>("/api/taskmaster/reject/:jobId", async (request) => {
    const body = request.body as { reason?: string } | undefined;
    await runtime.rejectCheckpoint(request.params.jobId, body?.reason ?? "Rejected by user");
    return { ok: true };
  });

  // Returns bare array — frontend calls .map() on this.
  // Supports ?projectPath= to scope the list to jobs dispatched from that
  // project (reads ~/.agi/{projectSlug}/dispatch/jobs/). Omit to list globally.
  app.get<{ Querystring: { projectPath?: string } }>("/api/taskmaster/jobs", async (request) => {
    const projectPath = request.query.projectPath;
    const jobs = projectPath !== undefined && projectPath.length > 0
      ? await runtime.listJobsForProject(projectPath)
      : await runtime.listAllJobs();
    return jobs.map(toSummary);
  });

  app.get<{ Params: { jobId: string } }>("/api/taskmaster/jobs/:jobId", async (request) => {
    const job = await runtime.getJob(request.params.jobId);
    if (!job) {
      return { id: request.params.jobId, status: "not_found" };
    }
    return toSummary(job);
  });
}
