/**
 * taskmaster_handoff tool — worker raises a mid-run checkpoint question.
 * Covers input validation, callback wiring, and dispatch-file side-effects.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createWorkerDispatchHandler } from "./worker-dispatch.js";
import { createTaskmasterHandoffHandler, TASKMASTER_HANDOFF_MANIFEST } from "./taskmaster-handoff.js";

const PROJECT_PATH = "/home/test/proj-handoff";

function parse(raw: string): Record<string, unknown> {
  return JSON.parse(raw) as Record<string, unknown>;
}

describe("taskmaster_handoff handler", () => {
  let tmpHome: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "tm-handoff-"));
    originalHome = process.env.HOME;
    process.env.HOME = tmpHome;
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it("manifest is tier-gated to verified/sealed with no state gate", () => {
    expect(TASKMASTER_HANDOFF_MANIFEST.name).toBe("taskmaster_handoff");
    expect(TASKMASTER_HANDOFF_MANIFEST.requiresTier).toEqual(["verified", "sealed"]);
    expect(TASKMASTER_HANDOFF_MANIFEST.requiresState).toEqual([]);
  });

  it("rejects missing projectPath / jobId / question", async () => {
    const h = createTaskmasterHandoffHandler({});
    expect(parse(await h({})).error).toMatch(/projectPath is required/);
    expect(parse(await h({ projectPath: PROJECT_PATH })).error).toMatch(/jobId is required/);
    expect(parse(await h({ projectPath: PROJECT_PATH, jobId: "job-x" })).error).toMatch(/question is required/);
  });

  it("fires the onHandoff callback with jobId + question + projectPath + coaReqId", async () => {
    // Seed a dispatched job so the handoff has something to stamp.
    const created = parse(await createWorkerDispatchHandler({ coaReqId: "coa-handoff" })({
      projectPath: PROJECT_PATH,
      description: "seed",
    }));
    const jobId = created.jobId as string;

    const received: Array<Record<string, unknown>> = [];
    const h = createTaskmasterHandoffHandler({
      onHandoff: (args) => received.push(args as unknown as Record<string, unknown>),
    });

    const res = parse(await h({
      projectPath: PROJECT_PATH,
      jobId,
      question: "Should I use Redis or in-memory caching?",
    }));

    expect(res.ok).toBe(true);
    expect(received).toHaveLength(1);
    expect(received[0]!.jobId).toBe(jobId);
    expect(received[0]!.question).toBe("Should I use Redis or in-memory caching?");
    expect(received[0]!.projectPath).toBe(PROJECT_PATH);
    expect(received[0]!.coaReqId).toBe("coa-handoff");
  });

  it("stamps the handoff onto the dispatch file so the UI can surface it on reload", async () => {
    const created = parse(await createWorkerDispatchHandler({})({
      projectPath: PROJECT_PATH,
      description: "seed",
    }));
    const jobId = created.jobId as string;
    const jobFile = created.jobFile as string;

    await createTaskmasterHandoffHandler({})({
      projectPath: PROJECT_PATH,
      jobId,
      question: "Pick a strategy",
    });

    const job = JSON.parse(readFileSync(jobFile, "utf-8")) as Record<string, unknown>;
    expect(job.status).toBe("checkpoint");
    const handoffs = job.handoffs as Array<Record<string, unknown>>;
    expect(handoffs).toHaveLength(1);
    expect(handoffs[0]!.question).toBe("Pick a strategy");
    expect(typeof handoffs[0]!.askedAt).toBe("string");
  });
});
