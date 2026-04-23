/**
 * taskmaster_dispatch tool — zero-config default path is the critical regression
 * guard. If this test breaks, Aion loses the "just works" property on the
 * tool and tends to fall back to shell commands to recover.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createWorkerDispatchHandler, WORKER_DISPATCH_MANIFEST } from "./worker-dispatch.js";

const PROJECT_PATH = "/home/test/myproject";

function parse(raw: string): Record<string, unknown> {
  return JSON.parse(raw) as Record<string, unknown>;
}

describe("taskmaster_dispatch handler", () => {
  let tmpHome: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "tm-dispatch-"));
    originalHome = process.env.HOME;
    process.env.HOME = tmpHome;
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    rmSync(tmpHome, { recursive: true, force: true });
  });

  describe("manifest contract", () => {
    it("is named taskmaster_dispatch", () => {
      expect(WORKER_DISPATCH_MANIFEST.name).toBe("taskmaster_dispatch");
    });

    it("drops the stale requiresState: [\"ONLINE\"] gate (state is audit-only)", () => {
      expect(WORKER_DISPATCH_MANIFEST.requiresState).toEqual([]);
    });

    it("remains tier-gated to verified/sealed", () => {
      expect(WORKER_DISPATCH_MANIFEST.requiresTier).toEqual(["verified", "sealed"]);
    });
  });

  describe("input validation", () => {
    it("rejects when projectPath is missing", async () => {
      const res = parse(await createWorkerDispatchHandler({})({ description: "x" }));
      expect(res.error).toMatch(/projectPath is required/);
    });

    it("rejects when description is missing", async () => {
      const res = parse(await createWorkerDispatchHandler({})({ projectPath: PROJECT_PATH }));
      expect(res.error).toMatch(/description is required/);
    });

    it("rejects an invalid priority", async () => {
      const res = parse(await createWorkerDispatchHandler({})({
        projectPath: PROJECT_PATH,
        description: "x",
        priority: "yesterday",
      }));
      expect(res.error).toMatch(/Invalid priority/);
    });
  });

  describe("zero-config default path", () => {
    it("writes to ~/.agi/{projectSlug}/dispatch/jobs/ with no dispatchDirOverride configured", async () => {
      const res = parse(await createWorkerDispatchHandler({})({
        projectPath: PROJECT_PATH,
        description: "summarize README",
      }));
      expect(res.exitCode).toBe(0);
      const jobFile = res.jobFile as string;
      expect(jobFile).toContain(join(tmpHome, ".agi", "home-test-myproject", "dispatch", "jobs"));
      expect(existsSync(jobFile)).toBe(true);
    });

    it("isolates jobs by project (A and B never share a dir)", async () => {
      const a = parse(await createWorkerDispatchHandler({})({
        projectPath: "/home/test/proj-a",
        description: "task a",
      }));
      const b = parse(await createWorkerDispatchHandler({})({
        projectPath: "/home/test/proj-b",
        description: "task b",
      }));
      expect(a.jobFile as string).toContain("home-test-proj-a");
      expect(b.jobFile as string).toContain("home-test-proj-b");
      expect(a.jobFile).not.toBe(b.jobFile);
    });

    it("falls back to 'general' slug when projectPath is '/'", async () => {
      const res = parse(await createWorkerDispatchHandler({})({
        projectPath: "/",
        description: "x",
      }));
      expect(res.exitCode).toBe(0);
      expect(res.jobFile as string).toContain(join(".agi", "general", "dispatch", "jobs"));
    });
  });

  describe("job file contents", () => {
    it("captures projectPath + description + coaReqId + timestamps", async () => {
      const res = parse(await createWorkerDispatchHandler({ coaReqId: "coa-abc" })({
        projectPath: PROJECT_PATH,
        description: "hello",
        priority: "high",
      }));
      const job = JSON.parse(readFileSync(res.jobFile as string, "utf-8")) as Record<string, unknown>;
      expect(job.projectPath).toBe(PROJECT_PATH);
      expect(job.description).toBe("hello");
      expect(job.priority).toBe("high");
      expect(job.coaReqId).toBe("coa-abc");
      expect(job.status).toBe("pending");
      expect(typeof job.createdAt).toBe("string");
    });
  });

  describe("onJobCreated callback", () => {
    it("fires with {jobId, coaReqId, projectPath, sessionKey?, chatSessionId?}", async () => {
      const calls: Array<Record<string, unknown>> = [];
      const res = parse(await createWorkerDispatchHandler({
        coaReqId: "coa-xyz",
        onJobCreated: (args) => calls.push(args as unknown as Record<string, unknown>),
      })({ projectPath: PROJECT_PATH, description: "x" }));
      expect(res.exitCode).toBe(0);
      expect(calls).toHaveLength(1);
      expect(calls[0]!.jobId).toBe(res.jobId);
      expect(calls[0]!.coaReqId).toBe("coa-xyz");
      expect(calls[0]!.projectPath).toBe(PROJECT_PATH);
    });

    it("carries sessionKey + chatSessionId from ToolExecutionContext when provided", async () => {
      const calls: Array<Record<string, unknown>> = [];
      const handler = createWorkerDispatchHandler({
        onJobCreated: (args) => calls.push(args as unknown as Record<string, unknown>),
      });
      await handler(
        { projectPath: PROJECT_PATH, description: "task" },
        {
          state: "ONLINE",
          tier: "verified",
          entityId: "#E0",
          entityAlias: "Test",
          coaChainBase: "coa-live-123",
          resourceId: "aionima",
          nodeId: "local",
          sessionKey: "#E0",
          chatSessionId: "chat-abc",
        },
      );
      expect(calls).toHaveLength(1);
      expect(calls[0]!.coaReqId).toBe("coa-live-123");
      expect(calls[0]!.sessionKey).toBe("#E0");
      expect(calls[0]!.chatSessionId).toBe("chat-abc");
    });
  });
});
