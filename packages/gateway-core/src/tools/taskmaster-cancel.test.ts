/**
 * taskmaster_cancel tool — input validation, dispatch-file cleanup, callback
 * wiring, and manifest contract.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createWorkerDispatchHandler } from "./worker-dispatch.js";
import { createTaskmasterCancelHandler, TASKMASTER_CANCEL_MANIFEST } from "./taskmaster-cancel.js";

const PROJECT_PATH = "/home/test/proj-cancel";

function parse(raw: string): Record<string, unknown> {
  return JSON.parse(raw) as Record<string, unknown>;
}

describe("taskmaster_cancel handler", () => {
  let tmpHome: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "tm-cancel-"));
    originalHome = process.env.HOME;
    process.env.HOME = tmpHome;
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    rmSync(tmpHome, { recursive: true, force: true });
  });

  describe("manifest contract", () => {
    it("is named taskmaster_cancel", () => {
      expect(TASKMASTER_CANCEL_MANIFEST.name).toBe("taskmaster_cancel");
    });

    it("is tier-gated to verified/sealed and flagged agentOnly", () => {
      expect(TASKMASTER_CANCEL_MANIFEST.requiresTier).toEqual(["verified", "sealed"]);
      expect(TASKMASTER_CANCEL_MANIFEST.agentOnly).toBe(true);
    });
  });

  describe("input validation", () => {
    it("rejects missing projectPath / jobId", async () => {
      const h = createTaskmasterCancelHandler({});
      expect(parse(await h({})).error).toMatch(/projectPath is required/);
      expect(parse(await h({ projectPath: PROJECT_PATH })).error).toMatch(/jobId is required/);
    });
  });

  describe("side-effects", () => {
    it("removes the dispatch file when it exists and reports removedDispatchFile: true", async () => {
      const created = parse(await createWorkerDispatchHandler({})({
        projectPath: PROJECT_PATH,
        description: "will be cancelled",
      }));
      const jobFile = created.jobFile as string;
      expect(existsSync(jobFile)).toBe(true);

      const res = parse(await createTaskmasterCancelHandler({})({
        projectPath: PROJECT_PATH,
        jobId: created.jobId as string,
        reason: "Owner changed their mind",
      }));

      expect(res.ok).toBe(true);
      expect(res.removedDispatchFile).toBe(true);
      expect(existsSync(jobFile)).toBe(false);
    });

    it("returns removedDispatchFile: false for an unknown jobId (but still signals the callback)", async () => {
      const calls: Array<Record<string, unknown>> = [];
      const res = parse(await createTaskmasterCancelHandler({
        onCancel: (args) => calls.push(args as unknown as Record<string, unknown>),
      })({
        projectPath: PROJECT_PATH,
        jobId: "job-nonexistent",
      }));

      expect(res.ok).toBe(true);
      expect(res.removedDispatchFile).toBe(false);
      expect(calls).toHaveLength(1);
      expect(calls[0]!.jobId).toBe("job-nonexistent");
    });

    it("fires onCancel with jobId, projectPath, and reason (defaults to 'Cancelled by Aion')", async () => {
      const calls: Array<Record<string, unknown>> = [];
      const created = parse(await createWorkerDispatchHandler({})({
        projectPath: PROJECT_PATH,
        description: "x",
      }));
      const h = createTaskmasterCancelHandler({
        onCancel: (args) => calls.push(args as unknown as Record<string, unknown>),
      });

      await h({ projectPath: PROJECT_PATH, jobId: created.jobId as string });

      expect(calls).toHaveLength(1);
      expect(calls[0]!.projectPath).toBe(PROJECT_PATH);
      expect(calls[0]!.reason).toBe("Cancelled by Aion");
    });
  });
});
