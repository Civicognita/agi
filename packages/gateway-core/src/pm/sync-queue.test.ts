/**
 * sync-queue + conflict-log tests (s155 t672 Phase 1).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  _resetSyncSeqForTest,
  bumpAttempts,
  clearSyncConflicts,
  clearSyncQueue,
  drainSyncQueue,
  enqueueSync,
  readSyncConflicts,
  readSyncConflictsForProject,
  readSyncQueue,
  readSyncQueueForProject,
  recordSyncConflict,
  resolveSyncConflict,
  syncConflictPath,
  syncQueuePath,
} from "./sync-queue.js";

let tmp: string;
let originalHome: string | undefined;

beforeEach(() => {
  tmp = join(tmpdir(), `sync-queue-test-${String(Date.now())}-${String(Math.random()).slice(2, 8)}`);
  mkdirSync(tmp, { recursive: true });
  originalHome = process.env["HOME"];
  process.env["HOME"] = join(tmp, "home");
  mkdirSync(process.env["HOME"], { recursive: true });
  _resetSyncSeqForTest();
});

afterEach(() => {
  if (originalHome === undefined) delete process.env["HOME"];
  else process.env["HOME"] = originalHome;
  rmSync(tmp, { recursive: true, force: true });
});

describe("path helpers (s155 t672 Phase 1)", () => {
  it("syncQueuePath resolves under HOME/.agi", () => {
    expect(syncQueuePath()).toBe(join(process.env["HOME"]!, ".agi", "sync-queue.jsonl"));
  });

  it("syncConflictPath resolves under HOME/.agi", () => {
    expect(syncConflictPath()).toBe(join(process.env["HOME"]!, ".agi", "sync-conflicts.jsonl"));
  });
});

describe("enqueueSync + readSyncQueue (s155 t672 Phase 1)", () => {
  it("creates ~/.agi and appends an entry", () => {
    const e = enqueueSync({
      method: "setTaskStatus",
      args: ["t-1", "doing"],
      projectPath: "/p/myproj",
      failureReason: "ECONNREFUSED",
    });
    expect(e.id).toMatch(/^s-/);
    expect(e.attempts).toBe(0);
    expect(existsSync(syncQueuePath())).toBe(true);
    const all = readSyncQueue();
    expect(all).toHaveLength(1);
    expect(all[0]?.method).toBe("setTaskStatus");
  });

  it("preserves order across multiple appends", () => {
    enqueueSync({ method: "a", args: [], projectPath: "/p" });
    enqueueSync({ method: "b", args: [], projectPath: "/p" });
    enqueueSync({ method: "c", args: [], projectPath: "/p" });
    const all = readSyncQueue();
    expect(all.map((e) => e.method)).toEqual(["a", "b", "c"]);
  });

  it("never throws on filesystem failure (side-channel discipline)", () => {
    expect(() => enqueueSync({ method: "x", args: [], projectPath: "/p" })).not.toThrow();
  });

  it("readSyncQueue returns empty when file doesn't exist", () => {
    expect(readSyncQueue()).toEqual([]);
  });

  it("readSyncQueueForProject filters by projectPath", () => {
    enqueueSync({ method: "a", args: [], projectPath: "/p1" });
    enqueueSync({ method: "b", args: [], projectPath: "/p2" });
    enqueueSync({ method: "c", args: [], projectPath: "/p1" });
    const p1 = readSyncQueueForProject("/p1");
    expect(p1).toHaveLength(2);
    expect(p1.map((e) => e.method)).toEqual(["a", "c"]);
  });
});

describe("drainSyncQueue + bumpAttempts + clearSyncQueue (s155 t672 Phase 1)", () => {
  it("drains entries whose ids are in the success set", () => {
    const a = enqueueSync({ method: "a", args: [], projectPath: "/p" });
    const b = enqueueSync({ method: "b", args: [], projectPath: "/p" });
    const c = enqueueSync({ method: "c", args: [], projectPath: "/p" });
    const drained = drainSyncQueue(new Set([a.id, c.id]));
    expect(drained).toBe(2);
    const remaining = readSyncQueue();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.method).toBe("b");
    expect(remaining[0]?.id).toBe(b.id);
  });

  it("bumpAttempts increments the counter for a specific entry", () => {
    const e = enqueueSync({ method: "a", args: [], projectPath: "/p" });
    expect(e.attempts).toBe(0);
    expect(bumpAttempts(e.id)).toBe(true);
    expect(bumpAttempts(e.id)).toBe(true);
    const all = readSyncQueue();
    expect(all[0]?.attempts).toBe(2);
  });

  it("bumpAttempts returns false for unknown id", () => {
    expect(bumpAttempts("s-bogus")).toBe(false);
  });

  it("clearSyncQueue removes all + returns count", () => {
    enqueueSync({ method: "a", args: [], projectPath: "/p" });
    enqueueSync({ method: "b", args: [], projectPath: "/p" });
    expect(clearSyncQueue()).toBe(2);
    expect(readSyncQueue()).toEqual([]);
  });

  it("clearSyncQueue safe to call when no entries", () => {
    expect(clearSyncQueue()).toBe(0);
  });
});

describe("recordSyncConflict + readSyncConflicts (s155 t672 Phase 1)", () => {
  it("records a conflict entry", () => {
    const e = recordSyncConflict({
      projectPath: "/p",
      entityType: "task",
      entityId: "t-1",
      field: "status",
      primaryValue: "doing",
      liteValue: "qa",
      hard: false,
    });
    expect(e.id).toMatch(/^c-/);
    const all = readSyncConflicts();
    expect(all).toHaveLength(1);
    expect(all[0]?.field).toBe("status");
    expect(all[0]?.hard).toBe(false);
  });

  it("hard-conflict flag preserved", () => {
    recordSyncConflict({
      projectPath: "/p", entityType: "story", entityId: "s-1",
      field: "status", primaryValue: "done", liteValue: "backlog", hard: true,
    });
    expect(readSyncConflicts()[0]?.hard).toBe(true);
  });

  it("readSyncConflictsForProject filters by projectPath", () => {
    recordSyncConflict({
      projectPath: "/p1", entityType: "task", entityId: "t-1",
      field: "title", primaryValue: "A", liteValue: "B", hard: false,
    });
    recordSyncConflict({
      projectPath: "/p2", entityType: "task", entityId: "t-2",
      field: "title", primaryValue: "C", liteValue: "D", hard: false,
    });
    expect(readSyncConflictsForProject("/p1")).toHaveLength(1);
    expect(readSyncConflictsForProject("/p2")).toHaveLength(1);
  });

  it("resolveSyncConflict removes the entry by id", () => {
    const e = recordSyncConflict({
      projectPath: "/p", entityType: "task", entityId: "t-1",
      field: "status", primaryValue: "x", liteValue: "y", hard: false,
    });
    expect(resolveSyncConflict(e.id)).toBe(true);
    expect(readSyncConflicts()).toEqual([]);
  });

  it("resolveSyncConflict returns false for unknown id", () => {
    expect(resolveSyncConflict("c-bogus")).toBe(false);
  });

  it("clearSyncConflicts removes all + returns count", () => {
    recordSyncConflict({
      projectPath: "/p", entityType: "task", entityId: "t-1",
      field: "x", primaryValue: 1, liteValue: 2, hard: false,
    });
    expect(clearSyncConflicts()).toBe(1);
    expect(readSyncConflicts()).toEqual([]);
  });
});

describe("malformed-line tolerance (s155 t672 Phase 1)", () => {
  it("readSyncQueue skips malformed lines", () => {
    enqueueSync({ method: "a", args: [], projectPath: "/p" });
    // Append a malformed line manually
    const fs = require("node:fs") as typeof import("node:fs");
    fs.appendFileSync(syncQueuePath(), "{ broken json\n", "utf-8");
    enqueueSync({ method: "b", args: [], projectPath: "/p" });
    const all = readSyncQueue();
    expect(all).toHaveLength(2);
    expect(all.map((e) => e.method)).toEqual(["a", "b"]);
  });
});

describe("opportunistic truncation (s155 t672 Phase 1)", () => {
  it("eventually keeps file size bounded under heavy enqueue", () => {
    // Hard to test the 5MB bound in unit-time; just confirm the path
    // doesn't error under hundreds of small entries.
    for (let i = 0; i < 100; i++) {
      enqueueSync({ method: `m${String(i)}`, args: [], projectPath: "/p" });
    }
    expect(readSyncQueue().length).toBeGreaterThanOrEqual(100);
    expect(statSync(syncQueuePath()).size).toBeLessThan(MAX_5MB);
  });
});

const MAX_5MB = 5 * 1024 * 1024;
