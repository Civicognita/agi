/**
 * taskmaster_handoff tool — a worker raises a mid-run checkpoint question
 * for Aion (or the owner) to answer.
 *
 * MVP semantics: the tool emits a `worker_handoff` runtime event that the
 * server routes to the Work Queue + chat transcript. The question surfaces as
 * a "checkpoint" row in the drawer tab for that project. The worker finishes
 * its current turn; the caller can re-dispatch with clarification if needed.
 * A full resume-on-response flow is a planned follow-up.
 *
 * Tier-gated (verified/sealed) — same surface as taskmaster_dispatch, since
 * only real workers should raise handoffs.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ToolHandler } from "../tool-registry.js";
import { dispatchJobsDir } from "../dispatch-paths.js";

export interface TaskmasterHandoffConfig {
  /** Called when a handoff is raised. Wired by server.ts to re-emit as a runtime event. */
  onHandoff?: (args: { jobId: string; question: string; projectPath: string; coaReqId?: string }) => void;
  /** Optional override for the dispatch base dir. Tests use this. */
  botsDir?: string;
}

export function createTaskmasterHandoffHandler(config: TaskmasterHandoffConfig): ToolHandler {
  return async (input: Record<string, unknown>): Promise<string> => {
    const projectPath = String(input.projectPath ?? "").trim();
    if (projectPath.length === 0) {
      return JSON.stringify({ error: "projectPath is required" });
    }

    const jobId = String(input.jobId ?? "").trim();
    if (jobId.length === 0) {
      return JSON.stringify({ error: "jobId is required — pass the id of the job you were dispatched as." });
    }

    const question = String(input.question ?? "").trim();
    if (question.length === 0) {
      return JSON.stringify({ error: "question is required — tell Aion specifically what decision you need." });
    }

    // Stamp the question onto the dispatch file so the UI can surface it on
    // reload even if the WS frame is missed.
    const jobsDir = config.botsDir !== undefined
      ? join(config.botsDir, "jobs")
      : dispatchJobsDir(projectPath);
    const jobFile = join(jobsDir, `${jobId}.json`);
    let coaReqId: string | undefined;
    try {
      if (existsSync(jobFile)) {
        const raw = readFileSync(jobFile, "utf-8");
        const job = JSON.parse(raw) as Record<string, unknown>;
        coaReqId = typeof job.coaReqId === "string" ? job.coaReqId : undefined;
        job.status = "checkpoint";
        const handoffs = Array.isArray(job.handoffs) ? (job.handoffs as Array<Record<string, unknown>>) : [];
        handoffs.push({ question, askedAt: new Date().toISOString() });
        job.handoffs = handoffs;
        writeFileSync(jobFile, JSON.stringify(job, null, 2), "utf-8");
      }
    } catch {
      // Non-fatal — the event emission below is the primary channel.
    }

    if (config.onHandoff) {
      try {
        config.onHandoff({ jobId, question, projectPath, coaReqId });
      } catch {
        // Don't fail the tool if the callback throws.
      }
    }

    return JSON.stringify({
      ok: true,
      jobId,
      acknowledged: "Handoff registered. Finish your turn with a summary of what you accomplished so far — Aion will respond and can re-dispatch with clarification.",
    });
  };
}

export const TASKMASTER_HANDOFF_MANIFEST = {
  name: "taskmaster_handoff",
  description:
    "Raise a checkpoint question mid-run for Aion (or the owner) to answer. " +
    "Use when you need a decision that you can't make yourself — a design choice, " +
    "a config change a worker can't make, a clarification on ambiguous scope. " +
    "The question surfaces as a checkpoint in the Work Queue and the chat transcript. " +
    "After calling this, finish your current turn with a summary of progress so far; " +
    "you will not be resumed automatically — Aion re-dispatches with clarification if needed.",
  requiresState: [],
  requiresTier: ["verified" as const, "sealed" as const],
};

export const TASKMASTER_HANDOFF_INPUT_SCHEMA = {
  type: "object",
  properties: {
    projectPath: {
      type: "string",
      description: "Absolute path of the project the job belongs to.",
    },
    jobId: {
      type: "string",
      description: "Your assigned jobId (provided in the dispatch message).",
    },
    question: {
      type: "string",
      description: "The specific decision you need Aion to make. Be concrete: state what you'd do in each branch.",
    },
  },
  required: ["projectPath", "jobId", "question"],
};
