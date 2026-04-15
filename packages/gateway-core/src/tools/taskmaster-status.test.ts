/**
 * taskmaster_status tool — zero-config default path + per-project isolation.
 * Aion working in project A must never see project B's jobs via status.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createWorkerDispatchHandler } from "./worker-dispatch.js";
import { createWorkerStatusHandler, WORKER_STATUS_MANIFEST } from "./worker-status.js";

const PROJECT_A = "/home/test/proj-a";
const PROJECT_B = "/home/test/proj-b";

function parse(raw: string): Record<string, unknown> {
  return JSON.parse(raw) as Record<string, unknown>;
}

describe("taskmaster_status handler", () => {
  let tmpHome: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "tm-status-"));
    originalHome = process.env.HOME;
    process.env.HOME = tmpHome;
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    rmSync(tmpHome, { recursive: true, force: true });
  });

  describe("manifest contract", () => {
    it("is named taskmaster_status", () => {
      expect(WORKER_STATUS_MANIFEST.name).toBe("taskmaster_status");
    });

    it("drops the stale requiresState gate", () => {
      expect(WORKER_STATUS_MANIFEST.requiresState).toEqual([]);
    });
  });

  describe("input validation", () => {
    it("rejects when projectPath is missing", async () => {
      const res = parse(await createWorkerStatusHandler({})({}));
      expect(res.error).toMatch(/projectPath is required/);
    });
  });

  describe("empty state", () => {
    it("returns an empty array when the project has no jobs dir yet", async () => {
      const res = parse(await createWorkerStatusHandler({})({ projectPath: PROJECT_A }));
      expect(res.exitCode).toBe(0);
      expect(res.jobs).toEqual([]);
      expect(res.total).toBe(0);
    });
  });

  describe("listing jobs (per-project isolation)", () => {
    it("only returns jobs belonging to the requested project", async () => {
      const dispatch = createWorkerDispatchHandler({});
      await dispatch({ projectPath: PROJECT_A, description: "a1" });
      await dispatch({ projectPath: PROJECT_A, description: "a2" });
      await dispatch({ projectPath: PROJECT_B, description: "b1" });

      const listA = parse(await createWorkerStatusHandler({})({ projectPath: PROJECT_A }));
      const listB = parse(await createWorkerStatusHandler({})({ projectPath: PROJECT_B }));

      expect(listA.total).toBe(2);
      expect(listB.total).toBe(1);
      const aDescriptions = (listA.jobs as Array<{ description: string }>).map((j) => j.description).sort();
      expect(aDescriptions).toEqual(["a1", "a2"]);
      expect((listB.jobs as Array<{ description: string }>)[0]!.description).toBe("b1");
    });
  });

  describe("single-job lookup", () => {
    it("returns the job by id when it exists under the project", async () => {
      const created = parse(await createWorkerDispatchHandler({})({
        projectPath: PROJECT_A,
        description: "look me up",
      }));
      const jobId = created.jobId as string;

      const res = parse(await createWorkerStatusHandler({})({ projectPath: PROJECT_A, jobId }));
      expect(res.exitCode).toBe(0);
      expect((res.job as { description: string }).description).toBe("look me up");
    });

    it("returns 'Job not found' when the id exists under a different project", async () => {
      const created = parse(await createWorkerDispatchHandler({})({
        projectPath: PROJECT_A,
        description: "only in A",
      }));
      const jobId = created.jobId as string;

      // Asking project B for project A's job id → not found, as expected.
      const res = parse(await createWorkerStatusHandler({})({ projectPath: PROJECT_B, jobId }));
      expect(res.error).toMatch(/Job not found/);
    });
  });
});
