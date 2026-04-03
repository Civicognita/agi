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

/** Shape the dashboard expects (matches BotsJobSummary in ui/dashboard/src/types.ts). */
interface JobSummary {
  id: string;
  description: string;
  status: "pending" | "running" | "checkpoint" | "complete" | "failed";
  currentPhase: string | null;
  workers: string[];
  gate: "auto" | "checkpoint" | "terminal";
  createdAt: string;
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
  };
}

export function registerWorkerApi(
  app: FastifyInstance,
  runtime: WorkerRuntime,
): void {
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
  app.get("/api/taskmaster/jobs", async () => {
    const jobs = await runtime.listAllJobs();
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
