/**
 * worker-dispatch anti-loop guard tests (s159 t695/t696/t697).
 *
 * Verifies: in-flight deduplication, cooldown window, and circuit breaker.
 * Uses a temp home dir so every test gets an isolated dispatch/jobs/ tree.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createWorkerDispatchHandler } from "./worker-dispatch.js";
import { dispatchJobsDir } from "../dispatch-paths.js";

const PROJECT_PATH = "/home/test/proj-dispatch";

function parse(raw: string): Record<string, unknown> {
  return JSON.parse(raw) as Record<string, unknown>;
}

/** Write a synthetic job file directly into the jobs dir. */
function writeJobFile(
  jobsDir: string,
  jobId: string,
  fields: Record<string, unknown>,
): void {
  mkdirSync(jobsDir, { recursive: true });
  writeFileSync(join(jobsDir, `${jobId}.json`), JSON.stringify(fields, null, 2), "utf-8");
}

describe("worker-dispatch anti-loop guard (s159 t695/t696/t697)", () => {
  let tmpHome: string;
  let originalHome: string | undefined;
  let jobsDir: string;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "tm-dispatch-guard-"));
    originalHome = process.env.HOME;
    process.env.HOME = tmpHome;
    // Derive the jobs dir exactly as the handler does.
    jobsDir = dispatchJobsDir(PROJECT_PATH);
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    rmSync(tmpHome, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------
  // (1) In-flight guard (t695)
  // ---------------------------------------------------------------------------
  describe("(1) in-flight guard — t695", () => {
    it("refuses a second dispatch when the same description key is 'pending'", async () => {
      const h = createWorkerDispatchHandler({});

      // First dispatch succeeds.
      const first = parse(await h({ projectPath: PROJECT_PATH, description: "do the thing" }));
      expect(first.exitCode).toBe(0);

      // Second dispatch with same description → in-flight refuse.
      const second = parse(await h({ projectPath: PROJECT_PATH, description: "do the thing" }));
      expect(second.exitCode).toBe(-1);
      expect(second.duplicate).toBe(true);
      expect(typeof second.existingJobId).toBe("string");
    });

    it("refuses when an existing job file has status 'running'", async () => {
      writeJobFile(jobsDir, "job-existing-run", {
        id: "job-existing-run",
        description: "running task",
        status: "running",
        projectPath: PROJECT_PATH,
        createdAt: new Date().toISOString(),
      });

      const h = createWorkerDispatchHandler({});
      const res = parse(await h({ projectPath: PROJECT_PATH, description: "running task" }));
      expect(res.exitCode).toBe(-1);
      expect(res.duplicate).toBe(true);
      expect(res.existingJobId).toBe("job-existing-run");
    });

    it("refuses when an existing job file has status 'checkpoint'", async () => {
      writeJobFile(jobsDir, "job-chk", {
        id: "job-chk",
        description: "checkpoint task",
        status: "checkpoint",
        projectPath: PROJECT_PATH,
        createdAt: new Date().toISOString(),
      });

      const h = createWorkerDispatchHandler({});
      const res = parse(await h({ projectPath: PROJECT_PATH, description: "checkpoint task" }));
      expect(res.exitCode).toBe(-1);
      expect(res.duplicate).toBe(true);
    });

    it("refuses by planRef key regardless of description text", async () => {
      writeJobFile(jobsDir, "job-plan-inflight", {
        id: "job-plan-inflight",
        description: "any text",
        planRef: { planId: "p1", stepId: "s1" },
        status: "running",
        projectPath: PROJECT_PATH,
        createdAt: new Date().toISOString(),
      });

      const h = createWorkerDispatchHandler({});
      const res = parse(await h({
        projectPath: PROJECT_PATH,
        description: "completely different text",
        planRef: { planId: "p1", stepId: "s1" },
      }));
      expect(res.exitCode).toBe(-1);
      expect(res.duplicate).toBe(true);
    });

    it("allows dispatch once the in-flight job is in a terminal state and outside cooldown", async () => {
      const oldTime = new Date(Date.now() - 120_000).toISOString(); // 2 min ago
      writeJobFile(jobsDir, "job-old-complete", {
        id: "job-old-complete",
        description: "retryable task",
        status: "complete",
        projectPath: PROJECT_PATH,
        createdAt: oldTime,
        completedAt: oldTime,
      });

      const h = createWorkerDispatchHandler({});
      const res = parse(await h({ projectPath: PROJECT_PATH, description: "retryable task" }));
      expect(res.exitCode).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // (2) Cooldown guard (t696)
  // ---------------------------------------------------------------------------
  describe("(2) cooldown guard — t696", () => {
    it("refuses when the same key completed within the last 60 s", async () => {
      const recentTime = new Date(Date.now() - 10_000).toISOString(); // 10 s ago
      writeJobFile(jobsDir, "job-recent-complete", {
        id: "job-recent-complete",
        description: "fresh complete",
        status: "complete",
        projectPath: PROJECT_PATH,
        createdAt: recentTime,
        completedAt: recentTime,
      });

      const h = createWorkerDispatchHandler({});
      const res = parse(await h({ projectPath: PROJECT_PATH, description: "fresh complete" }));
      expect(res.exitCode).toBe(-1);
      expect(res.cooldown).toBe(true);
      expect(typeof res.cooldownRemainingSeconds).toBe("number");
      expect((res.cooldownRemainingSeconds as number)).toBeGreaterThan(0);
    });

    it("refuses when the same key failed within the last 60 s", async () => {
      const recentTime = new Date(Date.now() - 5_000).toISOString();
      writeJobFile(jobsDir, "job-recent-fail", {
        id: "job-recent-fail",
        description: "fresh fail",
        status: "failed",
        projectPath: PROJECT_PATH,
        createdAt: recentTime,
        completedAt: recentTime,
      });

      const h = createWorkerDispatchHandler({});
      const res = parse(await h({ projectPath: PROJECT_PATH, description: "fresh fail" }));
      expect(res.exitCode).toBe(-1);
      expect(res.cooldown).toBe(true);
    });

    it("falls back to createdAt when completedAt is absent (cool-down still applies)", async () => {
      const recentTime = new Date(Date.now() - 20_000).toISOString();
      writeJobFile(jobsDir, "job-no-completed-at", {
        id: "job-no-completed-at",
        description: "no completedAt field",
        status: "complete",
        projectPath: PROJECT_PATH,
        createdAt: recentTime,
        // no completedAt
      });

      const h = createWorkerDispatchHandler({});
      const res = parse(await h({ projectPath: PROJECT_PATH, description: "no completedAt field" }));
      expect(res.exitCode).toBe(-1);
      expect(res.cooldown).toBe(true);
    });

    it("allows re-dispatch after the 60 s cooldown has elapsed", async () => {
      const oldTime = new Date(Date.now() - 90_000).toISOString(); // 90 s ago
      writeJobFile(jobsDir, "job-old-fail", {
        id: "job-old-fail",
        description: "old fail",
        status: "failed",
        projectPath: PROJECT_PATH,
        createdAt: oldTime,
        completedAt: oldTime,
      });

      const h = createWorkerDispatchHandler({});
      const res = parse(await h({ projectPath: PROJECT_PATH, description: "old fail" }));
      expect(res.exitCode).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // (3) Circuit breaker (t697)
  // ---------------------------------------------------------------------------
  describe("(3) circuit breaker — t697", () => {
    it("opens after 3 failures within 5 minutes", async () => {
      const recentBase = Date.now() - 120_000; // 2 min ago
      for (let i = 0; i < 3; i++) {
        const ts = new Date(recentBase + i * 10_000).toISOString();
        writeJobFile(jobsDir, `job-fail-${i}`, {
          id: `job-fail-${i}`,
          description: "repeated fail",
          status: "failed",
          projectPath: PROJECT_PATH,
          createdAt: ts,
          completedAt: ts,
        });
      }

      const h = createWorkerDispatchHandler({});
      const res = parse(await h({ projectPath: PROJECT_PATH, description: "repeated fail" }));
      expect(res.exitCode).toBe(-1);
      expect(res.circuitBreaker).toBe(true);
      expect((res.failureCount as number)).toBeGreaterThanOrEqual(3);
    });

    it("does NOT open with only 2 failures in 5 minutes (below threshold)", async () => {
      const recentBase = Date.now() - 120_000;
      for (let i = 0; i < 2; i++) {
        const ts = new Date(recentBase + i * 10_000).toISOString();
        writeJobFile(jobsDir, `job-fail2-${i}`, {
          id: `job-fail2-${i}`,
          description: "below threshold",
          status: "failed",
          projectPath: PROJECT_PATH,
          createdAt: ts,
          completedAt: ts,
        });
      }

      const h = createWorkerDispatchHandler({});
      const res = parse(await h({ projectPath: PROJECT_PATH, description: "below threshold" }));
      // Below threshold: expect success (not tripped by circuit breaker or cooldown for the oldest one)
      expect(res.circuitBreaker).toBeUndefined();
    });

    it("ignores failures older than 5 minutes for the circuit breaker count", async () => {
      // 2 old failures (outside breaker window) + 2 recent failures (inside)
      const oldTs = new Date(Date.now() - 10 * 60_000).toISOString(); // 10 min ago
      const recentTs = new Date(Date.now() - 60_000).toISOString(); // 1 min ago
      for (let i = 0; i < 2; i++) {
        writeJobFile(jobsDir, `job-old-${i}`, {
          id: `job-old-${i}`,
          description: "mixed window",
          status: "failed",
          projectPath: PROJECT_PATH,
          createdAt: oldTs,
          completedAt: oldTs,
        });
      }
      for (let i = 0; i < 2; i++) {
        writeJobFile(jobsDir, `job-new-${i}`, {
          id: `job-new-${i}`,
          description: "mixed window",
          status: "failed",
          projectPath: PROJECT_PATH,
          createdAt: recentTs,
          completedAt: recentTs,
        });
      }

      const h = createWorkerDispatchHandler({});
      const res = parse(await h({ projectPath: PROJECT_PATH, description: "mixed window" }));
      // Only 2 recent failures → circuit breaker stays closed
      expect(res.circuitBreaker).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Input validation (existing behaviour, not guard-specific)
  // ---------------------------------------------------------------------------
  describe("input validation", () => {
    it("rejects missing projectPath", async () => {
      const h = createWorkerDispatchHandler({});
      expect(parse(await h({ description: "x" })).error).toMatch(/projectPath is required/);
    });

    it("rejects missing description", async () => {
      const h = createWorkerDispatchHandler({});
      expect(parse(await h({ projectPath: PROJECT_PATH })).error).toMatch(/description is required/);
    });

    it("rejects invalid priority", async () => {
      const h = createWorkerDispatchHandler({});
      const res = parse(await h({ projectPath: PROJECT_PATH, description: "x", priority: "urgent" }));
      expect(res.error).toMatch(/Invalid priority/);
    });

    it("rejects planRef with missing stepId", async () => {
      const h = createWorkerDispatchHandler({});
      const res = parse(await h({
        projectPath: PROJECT_PATH,
        description: "x",
        planRef: { planId: "p1" },
      }));
      expect(res.error).toMatch(/planRef requires both/);
    });
  });

  // ---------------------------------------------------------------------------
  // Happy path
  // ---------------------------------------------------------------------------
  describe("happy path", () => {
    it("creates a job file and returns jobId on success", async () => {
      const calls: string[] = [];
      const h = createWorkerDispatchHandler({
        onJobCreated: ({ jobId }) => calls.push(jobId),
      });

      const res = parse(await h({ projectPath: PROJECT_PATH, description: "do the thing", priority: "high" }));
      expect(res.exitCode).toBe(0);
      expect(typeof res.jobId).toBe("string");
      expect(typeof res.jobFile).toBe("string");
      expect(calls).toHaveLength(1);
      expect(calls[0]).toBe(res.jobId);
    });

    it("fires onJobCreated with planRef when provided", async () => {
      const calls: Array<{ planRef?: unknown }> = [];
      const h = createWorkerDispatchHandler({ onJobCreated: (a) => calls.push(a) });

      await h({
        projectPath: PROJECT_PATH,
        description: "plan step",
        planRef: { planId: "plan-1", stepId: "step-2" },
      });

      expect(calls[0]?.planRef).toEqual({ planId: "plan-1", stepId: "step-2" });
    });
  });
});
