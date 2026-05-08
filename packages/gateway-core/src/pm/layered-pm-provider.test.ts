/**
 * Wish #17 — LayeredPmProvider read-fallback semantics.
 *
 * Pins the contract: the layered provider always tries `primary` first,
 * falls through to `fallback` on throws OR error-shaped payloads, and
 * passes through normal results unchanged. When primary === fallback
 * (single-provider config) the layering is invisible.
 */

import { describe, expect, it, vi } from "vitest";
import { LayeredPmProvider } from "./layered-pm-provider.js";
import type {
  PmProvider,
  PmTask,
  PmCreateTaskInput,
  PmIWishInput,
  PmStatus,
  PmComment,
} from "@agi/sdk";

function makeMockProvider(id: string, overrides: Partial<PmProvider> = {}): PmProvider {
  const stubTask = (taskId: string): PmTask => ({
    id: taskId,
    number: 0,
    storyId: "story-1",
    title: `task ${taskId} from ${id}`,
    status: "backlog",
  });
  const base: PmProvider = {
    providerId: id,
    getProject: vi.fn(async () => ({ id: `${id}-project`, name: id })),
    getNext: vi.fn(async () => ({ version: null, topStory: null, tasks: [stubTask(`${id}-next`)] })),
    getTask: vi.fn(async (idOrNumber: string | number) => stubTask(`${id}-${String(idOrNumber)}`)),
    getStory: vi.fn(async () => null),
    findTasks: vi.fn(async () => [stubTask(`${id}-find`)]),
    getComments: vi.fn(async () => []),
    setTaskStatus: vi.fn(async (taskId: string, _status: PmStatus) => stubTask(taskId)),
    addComment: vi.fn(async (_etype, _eid, body: string): Promise<PmComment> => ({ id: "c1", body, createdAt: "2026-05-08T00:00:00Z" })),
    updateTask: vi.fn(async (taskId: string) => stubTask(taskId)),
    createTask: vi.fn(async (input: PmCreateTaskInput) => ({ ...stubTask("new"), title: input.title })),
    iWish: vi.fn(async (input: PmIWishInput) => ({ id: "w1", title: input.title })),
    ...overrides,
  };
  return base;
}

describe("LayeredPmProvider", () => {
  it("reads from primary when primary succeeds", async () => {
    const primary = makeMockProvider("primary");
    const fallback = makeMockProvider("fallback");
    const layered = new LayeredPmProvider({ primary, fallback });

    const next = await layered.getNext();
    expect(next.tasks[0]?.id).toBe("primary-next");
    expect(primary.getNext).toHaveBeenCalledOnce();
    expect(fallback.getNext).not.toHaveBeenCalled();
  });

  it("falls through to fallback when primary throws", async () => {
    const primary = makeMockProvider("primary", {
      getNext: vi.fn(async () => { throw new Error("tynn not configured"); }),
    });
    const fallback = makeMockProvider("fallback");
    const layered = new LayeredPmProvider({ primary, fallback });

    const next = await layered.getNext();
    expect(next.tasks[0]?.id).toBe("fallback-next");
    expect(primary.getNext).toHaveBeenCalledOnce();
    expect(fallback.getNext).toHaveBeenCalledOnce();
  });

  it("falls through to fallback when primary returns an error-shaped payload", async () => {
    const primary = makeMockProvider("primary", {
      // Some PmProvider impls (the tynn MCP wrapper) return JSON-stringified
      // error payloads instead of throwing.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getTask: vi.fn(async () => ({ error: "tool unavailable" } as any)),
    });
    const fallback = makeMockProvider("fallback");
    const layered = new LayeredPmProvider({ primary, fallback });

    const got = await layered.getTask("any");
    expect(got?.id).toBe("fallback-any");
  });

  it("passes through findTasks results from primary unchanged", async () => {
    const primary = makeMockProvider("primary");
    const fallback = makeMockProvider("fallback");
    const layered = new LayeredPmProvider({ primary, fallback });

    const tasks = await layered.findTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.id).toBe("primary-find");
  });

  it("write paths fall through too — setTaskStatus on primary failure goes to fallback", async () => {
    const primary = makeMockProvider("primary", {
      setTaskStatus: vi.fn(async () => { throw new Error("offline"); }),
    });
    const fallback = makeMockProvider("fallback");
    const layered = new LayeredPmProvider({ primary, fallback });

    const result = await layered.setTaskStatus("t1", "doing");
    expect(result.title).toContain("from fallback");
    expect(fallback.setTaskStatus).toHaveBeenCalledWith("t1", "doing", undefined);
  });

  it("createTask + iWish + addComment + updateTask all fall through on primary throw", async () => {
    const primary = makeMockProvider("primary", {
      createTask: vi.fn(async () => { throw new Error("offline"); }),
      iWish: vi.fn(async () => { throw new Error("offline"); }),
      addComment: vi.fn(async () => { throw new Error("offline"); }),
      updateTask: vi.fn(async () => { throw new Error("offline"); }),
    });
    const fallback = makeMockProvider("fallback");
    const layered = new LayeredPmProvider({ primary, fallback });

    await layered.createTask({ storyId: "s1", title: "x", description: "" });
    await layered.iWish({ title: "wish" });
    await layered.addComment("task", "t1", "note");
    await layered.updateTask("t1", { title: "renamed" });

    expect(fallback.createTask).toHaveBeenCalled();
    expect(fallback.iWish).toHaveBeenCalled();
    expect(fallback.addComment).toHaveBeenCalled();
    expect(fallback.updateTask).toHaveBeenCalled();
  });

  it("getActiveFocusProgress prefers primary when available, falls back when primary throws", async () => {
    const primary = makeMockProvider("primary");
    primary.getActiveFocusProgress = vi.fn(async () => { throw new Error("offline"); });
    const fallback = makeMockProvider("fallback");
    fallback.getActiveFocusProgress = vi.fn(async () => ({
      totalTasks: 5, doneTasks: 2, qaTasks: 1, doingTasks: 1, backlogTasks: 1, blockedTasks: 0, inProgressTasks: 2,
    }));
    const layered = new LayeredPmProvider({ primary, fallback });

    const progress = await layered.getActiveFocusProgress();
    expect(progress.totalTasks).toBe(5);
    expect(fallback.getActiveFocusProgress).toHaveBeenCalled();
  });

  it("when primary === fallback (single-provider config), layering is invisible", async () => {
    const single = makeMockProvider("only");
    const layered = new LayeredPmProvider({ primary: single, fallback: single });

    const next = await layered.getNext();
    expect(next.tasks[0]?.id).toBe("only-next");
    expect(single.getNext).toHaveBeenCalledOnce();
  });

  it("exposes the underlying layers for diagnostic surfaces", () => {
    const primary = makeMockProvider("primary");
    const fallback = makeMockProvider("fallback");
    const layered = new LayeredPmProvider({ primary, fallback });

    expect(layered.layers.primary).toBe(primary);
    expect(layered.layers.fallback).toBe(fallback);
  });

  it("invokes the optional logger when fallback fires", async () => {
    const primary = makeMockProvider("primary", {
      getNext: vi.fn(async () => { throw new Error("offline"); }),
    });
    const fallback = makeMockProvider("fallback");
    const info = vi.fn();
    const warn = vi.fn();
    const layered = new LayeredPmProvider({ primary, fallback, logger: { info, warn } });

    await layered.getNext();
    expect(info).toHaveBeenCalledWith(expect.stringContaining("primary threw for getNext"));
  });
});
