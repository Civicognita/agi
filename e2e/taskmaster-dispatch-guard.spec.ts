/**
 * Taskmaster dispatch anti-loop guard — Playwright e2e (s159 t699).
 *
 * Verifies the three guard modes in worker-dispatch.ts by seeding synthetic
 * job files via the test-VM-only endpoint, then calling the dispatch handler
 * and asserting the correct refusal response.
 *
 *   (1) In-flight guard:  same key already pending/running → duplicate refused
 *   (2) Cooldown guard:   same key completed within 60 s → cooldown refused
 *   (3) Circuit breaker:  ≥3 failures of same key in 5 min → breaker opened
 *   (4) Happy path:       no matching history → dispatch succeeds
 *
 * Both test endpoints are gated on AIONIMA_TEST_VM=1; tests skip gracefully
 * when run against a non-test gateway.
 *
 * Run: `agi test --e2e taskmaster-dispatch-guard`
 */

import { test, expect } from "@playwright/test";

/** Unique base for this run so parallel test runs can't collide. */
const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const PROJECT_PATH = `/home/ubuntu/e2e-guard-project-${RUN_ID}`;

interface SeedJob {
  id: string;
  description?: string;
  status: string;
  planRef?: { planId: string; stepId: string };
  createdAt?: string;
  completedAt?: string;
}

async function seedJobs(
  request: import("@playwright/test").APIRequestContext,
  projectPath: string,
  jobs: SeedJob[],
): Promise<boolean> {
  const res = await request.post("/api/taskmaster/test/seed-jobs", {
    data: { projectPath, jobs },
    headers: { "Content-Type": "application/json" },
  });
  if (res.status() === 404) return false; // endpoint not available
  expect(res.status(), "seed-jobs should return 2xx").toBeLessThan(300);
  return true;
}

async function dispatchJob(
  request: import("@playwright/test").APIRequestContext,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await request.post("/api/taskmaster/test/dispatch", {
    data: input,
    headers: { "Content-Type": "application/json" },
  });
  expect(res.status(), "dispatch should return 2xx").toBeLessThan(300);
  return res.json() as Promise<Record<string, unknown>>;
}

test.describe("Taskmaster dispatch anti-loop guard (s159 t699)", () => {
  // (1) In-flight guard ---------------------------------------------------
  test("in-flight guard: refuses same description key while job is pending", async ({ request }) => {
    const description = `guard-inflight-${RUN_ID}`;
    const seeded = await seedJobs(request, PROJECT_PATH, [
      {
        id: `job-inflight-${RUN_ID}`,
        description,
        status: "pending",
        createdAt: new Date().toISOString(),
      },
    ]);
    if (!seeded) {
      test.skip(true, "test-VM-only endpoint unavailable — set AIONIMA_TEST_VM=1");
      return;
    }

    const result = await dispatchJob(request, { projectPath: PROJECT_PATH, description });
    expect(result["exitCode"]).toBe(-1);
    expect(result["duplicate"]).toBe(true);
    expect(typeof result["existingJobId"]).toBe("string");
  });

  // (1b) In-flight guard via planRef key ----------------------------------
  test("in-flight guard: refuses same planRef key regardless of description", async ({ request }) => {
    const planRef = { planId: `plan-e2e-${RUN_ID}`, stepId: "step-1" };
    const seeded = await seedJobs(request, PROJECT_PATH, [
      {
        id: `job-plan-inflight-${RUN_ID}`,
        description: "original description",
        planRef,
        status: "running",
        createdAt: new Date().toISOString(),
      },
    ]);
    if (!seeded) {
      test.skip(true, "test-VM-only endpoint unavailable — set AIONIMA_TEST_VM=1");
      return;
    }

    const result = await dispatchJob(request, {
      projectPath: PROJECT_PATH,
      description: "completely different description",
      planRef,
    });
    expect(result["exitCode"]).toBe(-1);
    expect(result["duplicate"]).toBe(true);
  });

  // (2) Cooldown guard ----------------------------------------------------
  test("cooldown guard: refuses re-dispatch within 60 s of last completion", async ({ request }) => {
    const description = `guard-cooldown-${RUN_ID}`;
    const recentTime = new Date(Date.now() - 10_000).toISOString(); // 10 s ago
    const seeded = await seedJobs(request, PROJECT_PATH, [
      {
        id: `job-cooldown-${RUN_ID}`,
        description,
        status: "complete",
        createdAt: recentTime,
        completedAt: recentTime,
      },
    ]);
    if (!seeded) {
      test.skip(true, "test-VM-only endpoint unavailable — set AIONIMA_TEST_VM=1");
      return;
    }

    const result = await dispatchJob(request, { projectPath: PROJECT_PATH, description });
    expect(result["exitCode"]).toBe(-1);
    expect(result["cooldown"]).toBe(true);
    expect(typeof result["cooldownRemainingSeconds"]).toBe("number");
    expect(result["cooldownRemainingSeconds"] as number).toBeGreaterThan(0);
  });

  // (3) Circuit breaker ---------------------------------------------------
  test("circuit breaker: opens after 3 failures of the same key in 5 min", async ({ request }) => {
    const description = `guard-breaker-${RUN_ID}`;
    const recentBase = Date.now() - 120_000; // 2 min ago
    const seeded = await seedJobs(
      request,
      PROJECT_PATH,
      [0, 1, 2].map((i) => {
        const ts = new Date(recentBase + i * 10_000).toISOString();
        return {
          id: `job-breaker-${i}-${RUN_ID}`,
          description,
          status: "failed",
          createdAt: ts,
          completedAt: ts,
        };
      }),
    );
    if (!seeded) {
      test.skip(true, "test-VM-only endpoint unavailable — set AIONIMA_TEST_VM=1");
      return;
    }

    const result = await dispatchJob(request, { projectPath: PROJECT_PATH, description });
    expect(result["exitCode"]).toBe(-1);
    expect(result["circuitBreaker"]).toBe(true);
    expect(result["failureCount"] as number).toBeGreaterThanOrEqual(3);
  });

  // (4) Happy path --------------------------------------------------------
  test("happy path: succeeds when no matching history exists", async ({ request }) => {
    const description = `guard-happy-path-${RUN_ID}-${Math.random().toString(36).slice(2)}`;

    // Check endpoint is available first (seed with empty — just tests reachability)
    const probe = await request.post("/api/taskmaster/test/dispatch", {
      data: { projectPath: PROJECT_PATH, description },
      headers: { "Content-Type": "application/json" },
    });
    if (probe.status() === 404) {
      test.skip(true, "test-VM-only endpoint unavailable — set AIONIMA_TEST_VM=1");
      return;
    }

    const result = await probe.json() as Record<string, unknown>;
    expect(result["exitCode"]).toBe(0);
    expect(typeof result["jobId"]).toBe("string");
    expect(typeof result["jobFile"]).toBe("string");
  });
});
