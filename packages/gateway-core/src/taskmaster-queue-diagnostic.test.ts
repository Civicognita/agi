/**
 * taskmaster-queue-diagnostic pure-logic tests (s159 t689).
 *
 * Covers idempotency-key derivation, duplicate-group detection,
 * and queue summarization. No I/O — every test builds in-memory
 * DispatchJobLike fixtures.
 */

import { describe, it, expect } from "vitest";
import {
  detectDuplicateGroups,
  idempotencyKey,
  summarizeQueue,
  type DispatchJobLike,
} from "./taskmaster-queue-diagnostic.js";

function job(overrides: Partial<DispatchJobLike> & { id: string }): DispatchJobLike {
  return {
    description: "do thing",
    status: "pending",
    projectPath: "/proj/a",
    createdAt: "2026-05-10T00:00:00.000Z",
    ...overrides,
  };
}

describe("idempotencyKey (s159 t689)", () => {
  it("returns plan:<id>:<step> when planRef is present", () => {
    expect(idempotencyKey({ id: "j1", planRef: { planId: "p1", stepId: "s2" } })).toBe("plan:p1:s2");
  });

  it("falls back to desc:<sha1-12> when planRef missing", () => {
    const k = idempotencyKey({ id: "j2", description: "hello world" });
    expect(k).toMatch(/^desc:[0-9a-f]{12}$/);
  });

  it("same description yields same desc-key (stable hashing)", () => {
    const a = idempotencyKey({ id: "j1", description: "alpha" });
    const b = idempotencyKey({ id: "j2", description: "alpha" });
    expect(a).toBe(b);
  });

  it("different descriptions yield different desc-keys", () => {
    const a = idempotencyKey({ id: "j1", description: "alpha" });
    const b = idempotencyKey({ id: "j2", description: "beta" });
    expect(a).not.toBe(b);
  });

  it("empty description gives a stable empty-string sha1 prefix", () => {
    expect(idempotencyKey({ id: "j1", description: "" })).toMatch(/^desc:[0-9a-f]{12}$/);
  });

  it("planRef with only planId (no stepId) falls back to desc key", () => {
    const k = idempotencyKey({ id: "j1", description: "x", planRef: { planId: "p1" } });
    expect(k).toMatch(/^desc:/);
  });
});

describe("detectDuplicateGroups (s159 t689)", () => {
  it("returns empty for empty input", () => {
    expect(detectDuplicateGroups([])).toEqual([]);
  });

  it("returns empty when no duplicates", () => {
    const jobs = [
      job({ id: "j1", description: "a" }),
      job({ id: "j2", description: "b" }),
    ];
    expect(detectDuplicateGroups(jobs)).toEqual([]);
  });

  it("groups two same-description pending jobs", () => {
    const jobs = [
      job({ id: "j1", description: "ship that thing", createdAt: "2026-05-10T01:00:00.000Z" }),
      job({ id: "j2", description: "ship that thing", createdAt: "2026-05-10T00:00:00.000Z" }),
    ];
    const groups = detectDuplicateGroups(jobs);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.count).toBe(2);
    expect(groups[0]?.jobIds).toEqual(["j1", "j2"]);
    expect(groups[0]?.earliest).toBe("2026-05-10T00:00:00.000Z");
  });

  it("groups by planRef when both jobs share it", () => {
    const jobs = [
      job({ id: "j1", description: "diff text 1", planRef: { planId: "p", stepId: "s" } }),
      job({ id: "j2", description: "diff text 2", planRef: { planId: "p", stepId: "s" } }),
    ];
    const groups = detectDuplicateGroups(jobs);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.key).toBe("plan:p:s");
  });

  it("ignores terminal-status jobs (completed/error/cancelled/failed)", () => {
    const jobs = [
      job({ id: "j1", description: "x", status: "completed" }),
      job({ id: "j2", description: "x", status: "error" }),
      job({ id: "j3", description: "x", status: "cancelled" }),
      job({ id: "j4", description: "x", status: "failed" }),
      job({ id: "j5", description: "x", status: "pending" }),
    ];
    expect(detectDuplicateGroups(jobs)).toEqual([]);
  });

  it("sorts groups by count descending", () => {
    const jobs = [
      job({ id: "a1", description: "alpha" }),
      job({ id: "a2", description: "alpha" }),
      job({ id: "b1", description: "beta" }),
      job({ id: "b2", description: "beta" }),
      job({ id: "b3", description: "beta" }),
    ];
    const groups = detectDuplicateGroups(jobs);
    expect(groups[0]?.count).toBe(3);
    expect(groups[1]?.count).toBe(2);
  });
});

describe("summarizeQueue (s159 t689)", () => {
  it("counts by status", () => {
    const jobs = [
      job({ id: "j1", status: "pending" }),
      job({ id: "j2", status: "running" }),
      job({ id: "j3", status: "running" }),
      job({ id: "j4", status: "completed" }),
    ];
    const s = summarizeQueue(jobs);
    expect(s.total).toBe(4);
    expect(s.byStatus).toEqual({ pending: 1, running: 2, completed: 1 });
  });

  it("oldestActiveAt skips terminal jobs", () => {
    const jobs = [
      job({ id: "j1", status: "completed", createdAt: "2026-05-10T00:00:00.000Z" }),
      job({ id: "j2", status: "pending", createdAt: "2026-05-10T02:00:00.000Z" }),
      job({ id: "j3", status: "running", createdAt: "2026-05-10T03:00:00.000Z" }),
    ];
    expect(summarizeQueue(jobs).oldestActiveAt).toBe("2026-05-10T02:00:00.000Z");
  });

  it("oldestActiveAt is null when no active jobs", () => {
    const jobs = [
      job({ id: "j1", status: "completed" }),
      job({ id: "j2", status: "error" }),
    ];
    expect(summarizeQueue(jobs).oldestActiveAt).toBeNull();
  });

  it("exposes duplicate groups through summary", () => {
    const jobs = [
      job({ id: "j1", description: "x" }),
      job({ id: "j2", description: "x" }),
    ];
    expect(summarizeQueue(jobs).duplicates).toHaveLength(1);
  });
});
