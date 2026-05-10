/**
 * SyncReplayWorker tests (s155 t672 Phase 6).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { SyncReplayWorker } from "./sync-replay-worker.js";
import {
  _resetSyncSeqForTest,
  clearSyncConflicts,
  clearSyncQueue,
  enqueueSync,
  readSyncConflicts,
  readSyncQueue,
} from "./sync-queue.js";
import { TynnLitePmProvider } from "./tynn-lite-provider.js";
import type { PmProvider, PmTask, PmStatus, PmComment, PmCreateTaskInput, PmIWishInput } from "@agi/sdk";

let tmp: string;
let originalHome: string | undefined;
let projectRoot: string;
let lite: TynnLitePmProvider;

function makeMockPrimary(overrides: Partial<PmProvider> = {}): PmProvider {
  const stubTask = (taskId: string): PmTask => ({
    id: taskId, number: 1, storyId: "s1", title: `task-${taskId}`, status: "doing",
  });
  return {
    providerId: "mock-primary",
    getProject: vi.fn(async () => ({ id: "p", name: "p" })),
    getNext: vi.fn(async () => ({ version: null, topStory: null, tasks: [] })),
    getTask: vi.fn(async (idOrNumber: string | number) => stubTask(`${String(idOrNumber)}`)),
    getStory: vi.fn(async () => null),
    findTasks: vi.fn(async () => []),
    getComments: vi.fn(async () => []),
    setTaskStatus: vi.fn(async (taskId: string, _status: PmStatus) => stubTask(taskId)),
    addComment: vi.fn(async (_etype, _eid, body: string): Promise<PmComment> => ({ id: "c1", body, createdAt: "2026-05-08T00:00:00Z" })),
    updateTask: vi.fn(async (taskId: string) => stubTask(taskId)),
    createTask: vi.fn(async (input: PmCreateTaskInput) => ({ ...stubTask("new"), title: input.title })),
    iWish: vi.fn(async (input: PmIWishInput) => ({ id: "w1", title: input.title })),
    ...overrides,
  };
}

beforeEach(() => {
  tmp = join(tmpdir(), `srw-test-${String(Date.now())}-${String(Math.random()).slice(2, 8)}`);
  mkdirSync(tmp, { recursive: true });
  originalHome = process.env["HOME"];
  process.env["HOME"] = join(tmp, "home");
  mkdirSync(process.env["HOME"], { recursive: true });
  _resetSyncSeqForTest();
  clearSyncQueue();
  clearSyncConflicts();
  projectRoot = join(tmp, "proj");
  mkdirSync(projectRoot, { recursive: true });
  lite = new TynnLitePmProvider({ projectRoot, projectName: "test-project" });
});

afterEach(() => {
  if (originalHome === undefined) delete process.env["HOME"];
  else process.env["HOME"] = originalHome;
  rmSync(tmp, { recursive: true, force: true });
});

describe("SyncReplayWorker — start/stop lifecycle (s155 t672 Phase 6)", () => {
  it("disabled worker: start() is no-op", () => {
    const worker = new SyncReplayWorker({ primary: makeMockPrimary(), lite, enabled: false });
    worker.start();
    // No interval scheduled → stop() is also no-op
    expect(() => worker.stop()).not.toThrow();
  });

  it("enabled worker: start() schedules interval; stop() clears it", () => {
    vi.useFakeTimers();
    const worker = new SyncReplayWorker({ primary: makeMockPrimary(), lite, enabled: true, tickIntervalMs: 1000 });
    worker.start();
    // Idempotent — second start is no-op
    worker.start();
    worker.stop();
    worker.stop(); // also no-op
    vi.useRealTimers();
  });
});

describe("SyncReplayWorker.tick — replay (s155 t672 Phase 6)", () => {
  it("empty queue: returns zero counts", async () => {
    const worker = new SyncReplayWorker({ primary: makeMockPrimary(), lite, enabled: true });
    const result = await worker.tick();
    expect(result).toEqual({ scanned: 0, succeeded: 0, failed: 0, conflicts: 0 });
  });

  it("successful replay drains entry from queue", async () => {
    enqueueSync({ method: "setTaskStatus", args: ["t-1", "doing"], projectPath: projectRoot });
    expect(readSyncQueue()).toHaveLength(1);

    const primary = makeMockPrimary();
    const worker = new SyncReplayWorker({ primary, lite, enabled: true, enableReadBackDiff: false });
    const result = await worker.tick();

    expect(result.scanned).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);
    expect(readSyncQueue()).toEqual([]);
    expect(primary.setTaskStatus).toHaveBeenCalledWith("t-1", "doing", undefined);
  });

  it("failed replay bumps attempts; entry stays queued", async () => {
    enqueueSync({ method: "setTaskStatus", args: ["t-1", "doing"], projectPath: projectRoot });

    const primary = makeMockPrimary({
      setTaskStatus: vi.fn(async () => { throw new Error("still offline"); }),
    });
    const worker = new SyncReplayWorker({ primary, lite, enabled: true, enableReadBackDiff: false });
    const result = await worker.tick();

    expect(result.scanned).toBe(1);
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(1);
    const remaining = readSyncQueue();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.attempts).toBe(1);
  });

  it("mixed success/fail: only succeeded entries drain", async () => {
    enqueueSync({ method: "setTaskStatus", args: ["t-1", "doing"], projectPath: projectRoot });
    enqueueSync({ method: "setTaskStatus", args: ["t-2", "doing"], projectPath: projectRoot });

    const primary = makeMockPrimary({
      setTaskStatus: vi.fn(async (taskId: string) => {
        if (taskId === "t-2") throw new Error("offline for t-2");
        return { id: taskId, number: 1, storyId: "s", title: "ok", status: "doing" } as PmTask;
      }),
    });
    const worker = new SyncReplayWorker({ primary, lite, enabled: true, enableReadBackDiff: false });
    const result = await worker.tick();

    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(1);
    const remaining = readSyncQueue();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.args).toEqual(["t-2", "doing"]);
  });

  it("dispatches all 5 write methods", async () => {
    enqueueSync({ method: "setTaskStatus", args: ["t", "doing"], projectPath: projectRoot });
    enqueueSync({ method: "addComment", args: ["task", "t", "hi"], projectPath: projectRoot });
    enqueueSync({ method: "updateTask", args: ["t", { title: "x" }], projectPath: projectRoot });
    enqueueSync({ method: "createTask", args: [{ storyId: "s", title: "n", description: "" }], projectPath: projectRoot });
    enqueueSync({ method: "iWish", args: [{ title: "wish" }], projectPath: projectRoot });

    const primary = makeMockPrimary();
    const worker = new SyncReplayWorker({ primary, lite, enabled: true, enableReadBackDiff: false });
    const result = await worker.tick();

    expect(result.succeeded).toBe(5);
    expect(primary.setTaskStatus).toHaveBeenCalled();
    expect(primary.addComment).toHaveBeenCalled();
    expect(primary.updateTask).toHaveBeenCalled();
    expect(primary.createTask).toHaveBeenCalled();
    expect(primary.iWish).toHaveBeenCalled();
  });

  it("unknown method: marks failed + bumps attempts", async () => {
    enqueueSync({ method: "unknownMethod", args: [], projectPath: projectRoot });
    const worker = new SyncReplayWorker({ primary: makeMockPrimary(), lite, enabled: true, enableReadBackDiff: false });
    const result = await worker.tick();
    expect(result.failed).toBe(1);
    expect(result.succeeded).toBe(0);
    expect(readSyncQueue()[0]?.attempts).toBe(1);
  });
});

describe("SyncReplayWorker.tick — read-back diff (s155 t672 Phase 6)", () => {
  it("records conflicts when primary's read-back diverges from lite", async () => {
    // Seed lite with a task; primary will return DIFFERENT title on read-back.
    const liteTask = await lite.createTask({ storyId: "s1", title: "Lite version", description: "D" });
    enqueueSync({ method: "setTaskStatus", args: [liteTask.id, "doing"], projectPath: projectRoot });

    const primary = makeMockPrimary({
      setTaskStatus: vi.fn(async (taskId: string) => ({
        id: taskId, number: 1, storyId: "s1", title: "Primary version different",
        description: "D", status: "doing",
      } as PmTask)),
    });

    const worker = new SyncReplayWorker({ primary, lite, enabled: true, enableReadBackDiff: true });
    const result = await worker.tick();

    expect(result.succeeded).toBe(1);
    expect(result.conflicts).toBeGreaterThan(0);
    const conflicts = readSyncConflicts();
    expect(conflicts.find((c) => c.field === "title")).toBeDefined();
  });

  it("no conflicts when records agree", async () => {
    // Pre-set lite-side to 'doing' so lite + primary read-back agree on
    // every tracked field (title, description, status). createTask
    // defaults to backlog; setTaskStatus moves it to doing.
    const liteTask = await lite.createTask({ storyId: "s1", title: "Same title", description: "D" });
    await lite.setTaskStatus(liteTask.id, "doing");
    enqueueSync({ method: "setTaskStatus", args: [liteTask.id, "doing"], projectPath: projectRoot });

    const primary = makeMockPrimary({
      setTaskStatus: vi.fn(async (taskId: string) => ({
        id: taskId, number: 1, storyId: "s1", title: "Same title",
        description: "D", status: "doing",
      } as PmTask)),
    });

    const worker = new SyncReplayWorker({ primary, lite, enabled: true, enableReadBackDiff: true });
    const result = await worker.tick();

    expect(result.succeeded).toBe(1);
    expect(result.conflicts).toBe(0);
    expect(readSyncConflicts()).toEqual([]);
  });

  it("comments / wishes don't trigger read-back diff", async () => {
    enqueueSync({ method: "addComment", args: ["task", "t-1", "note"], projectPath: projectRoot });
    enqueueSync({ method: "iWish", args: [{ title: "wish" }], projectPath: projectRoot });

    const worker = new SyncReplayWorker({ primary: makeMockPrimary(), lite, enabled: true, enableReadBackDiff: true });
    const result = await worker.tick();

    expect(result.succeeded).toBe(2);
    expect(result.conflicts).toBe(0);
  });

  it("disabled read-back diff: no conflicts even when records differ", async () => {
    const liteTask = await lite.createTask({ storyId: "s1", title: "Lite", description: "" });
    enqueueSync({ method: "setTaskStatus", args: [liteTask.id, "doing"], projectPath: projectRoot });

    const primary = makeMockPrimary({
      setTaskStatus: vi.fn(async (taskId: string) => ({
        id: taskId, number: 1, storyId: "s1", title: "Primary diff",
        description: "", status: "doing",
      } as PmTask)),
    });

    const worker = new SyncReplayWorker({ primary, lite, enabled: true, enableReadBackDiff: false });
    const result = await worker.tick();

    expect(result.conflicts).toBe(0);
    expect(readSyncConflicts()).toEqual([]);
  });
});
