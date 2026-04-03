/**
 * BOTS API — management endpoints for job control.
 *
 * Endpoints:
 *   POST /api/bots/approve/:jobId — approve a checkpoint
 *   POST /api/bots/reject/:jobId  — reject with reason
 *   GET  /api/bots/jobs            — list all jobs (from taskmaster state)
 *   GET  /api/bots/jobs/:jobId     — job detail
 */

import type { FastifyInstance } from "fastify";
import type { BotsRuntime, TaskmasterJob } from "./bots-runtime.js";

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

function toSummary(job: TaskmasterJob): JobSummary {
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

export function registerBotsApi(
  app: FastifyInstance,
  runtime: BotsRuntime,
): void {
  app.post<{ Params: { jobId: string } }>("/api/bots/approve/:jobId", async (request) => {
    await runtime.approveCheckpoint(request.params.jobId);
    return { ok: true };
  });

  app.post<{ Params: { jobId: string } }>("/api/bots/reject/:jobId", async (request) => {
    const body = request.body as { reason?: string } | undefined;
    await runtime.rejectCheckpoint(request.params.jobId, body?.reason ?? "Rejected by user");
    return { ok: true };
  });

  // Returns bare array matching BotsJobSummary[] — frontend calls .map() on this.
  app.get("/api/bots/jobs", async () => {
    const jobs = await runtime.listAllJobs();
    return jobs.map(toSummary);
  });

  app.get<{ Params: { jobId: string } }>("/api/bots/jobs/:jobId", async (request) => {
    const job = await runtime.getJob(request.params.jobId);
    if (!job) {
      return { id: request.params.jobId, status: "not_found" };
    }
    return toSummary(job);
  });
}
