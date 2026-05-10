/**
 * Conflict-detection tests (s155 t672 Phase 4).
 */

import { describe, it, expect } from "vitest";
import {
  detectConflicts,
  isHardStatusConflict,
  lwwWinner,
  TRACKED_FIELDS,
} from "./conflict-detection.js";
import type { TaskFieldTimestamps } from "./tynn-lite-provider.js";

const FLOOR = "2026-01-01T00:00:00Z";
const NEWER = "2026-05-01T00:00:00Z";
const NEWEST = "2026-05-09T00:00:00Z";

function timestamps(overrides: Partial<TaskFieldTimestamps> = {}): TaskFieldTimestamps {
  return {
    title: FLOOR,
    description: FLOOR,
    status: FLOOR,
    codeArea: FLOOR,
    verificationSteps: FLOOR,
    ...overrides,
  };
}

describe("isHardStatusConflict (s155 t672 Phase 4)", () => {
  it("identical statuses are never hard-conflict", () => {
    expect(isHardStatusConflict("doing", "doing")).toBe(false);
    expect(isHardStatusConflict("backlog", "backlog")).toBe(false);
  });

  it("terminal vs not-started is hard", () => {
    expect(isHardStatusConflict("finished", "backlog")).toBe(true);
    expect(isHardStatusConflict("archived", "backlog")).toBe(true);
    expect(isHardStatusConflict("backlog", "finished")).toBe(true);
  });

  it("blocked vs live state is hard", () => {
    expect(isHardStatusConflict("blocked", "doing")).toBe(true);
    expect(isHardStatusConflict("blocked", "testing")).toBe(true);
    expect(isHardStatusConflict("doing", "blocked")).toBe(true);
  });

  it("normal forward transitions are NOT hard", () => {
    // backlog → doing, doing → testing, testing → finished — all soft
    expect(isHardStatusConflict("backlog", "doing")).toBe(false);
    expect(isHardStatusConflict("doing", "testing")).toBe(false);
    expect(isHardStatusConflict("testing", "finished")).toBe(false);
  });

  it("backwards transitions within active states are soft", () => {
    expect(isHardStatusConflict("doing", "backlog")).toBe(false); // backlog isn't terminal
    expect(isHardStatusConflict("testing", "doing")).toBe(false);
  });
});

describe("detectConflicts (s155 t672 Phase 4)", () => {
  const baseInput = {
    projectPath: "/p",
    entityType: "task" as const,
    entityId: "t-1",
  };

  it("returns empty array when records agree", () => {
    const conflicts = detectConflicts({
      ...baseInput,
      primary: { title: "T", description: "D", status: "doing" },
      lite: { title: "T", description: "D", status: "doing" },
      liteTimestamps: timestamps(),
    });
    expect(conflicts).toEqual([]);
  });

  it("emits one descriptor per diverged field", () => {
    const conflicts = detectConflicts({
      ...baseInput,
      primary: { title: "Primary", description: "Primary D", status: "doing" },
      lite: { title: "Lite", description: "Lite D", status: "doing" },
      liteTimestamps: timestamps({ title: NEWER, description: NEWER }),
    });
    expect(conflicts).toHaveLength(2);
    const fields = conflicts.map((c) => c.field).sort();
    expect(fields).toEqual(["description", "title"]);
  });

  it("threads projectPath / entityType / entityId into every descriptor", () => {
    const conflicts = detectConflicts({
      ...baseInput,
      primary: { title: "A" },
      lite: { title: "B" },
      liteTimestamps: timestamps({ title: NEWER }),
    });
    expect(conflicts[0]?.projectPath).toBe("/p");
    expect(conflicts[0]?.entityType).toBe("task");
    expect(conflicts[0]?.entityId).toBe("t-1");
  });

  it("captures both primary + lite values + timestamps", () => {
    const conflicts = detectConflicts({
      ...baseInput,
      primary: { title: "Primary" },
      lite: { title: "Lite" },
      liteTimestamps: timestamps({ title: NEWER }),
      primaryTimestamps: { title: NEWEST },
    });
    expect(conflicts[0]?.primaryValue).toBe("Primary");
    expect(conflicts[0]?.liteValue).toBe("Lite");
    expect(conflicts[0]?.primaryUpdatedAt).toBe(NEWEST);
    expect(conflicts[0]?.liteUpdatedAt).toBe(NEWER);
  });

  it("flags status divergence as hard when transition is invalid", () => {
    const conflicts = detectConflicts({
      ...baseInput,
      primary: { status: "finished" },
      lite: { status: "backlog" },
      liteTimestamps: timestamps({ status: NEWER }),
    });
    expect(conflicts[0]?.field).toBe("status");
    expect(conflicts[0]?.hard).toBe(true);
  });

  it("status divergence within soft states is NOT hard", () => {
    const conflicts = detectConflicts({
      ...baseInput,
      primary: { status: "testing" },
      lite: { status: "doing" },
      liteTimestamps: timestamps({ status: NEWER }),
    });
    expect(conflicts[0]?.hard).toBe(false);
  });

  it("non-status fields are never hard-conflict", () => {
    const conflicts = detectConflicts({
      ...baseInput,
      primary: { title: "wildly different", description: "as is desc" },
      lite: { title: "lite version", description: "lite desc" },
      liteTimestamps: timestamps({ title: NEWER, description: NEWER }),
    });
    for (const c of conflicts) {
      expect(c.hard).toBe(false);
    }
  });

  it("array fields use element-wise equality", () => {
    const conflicts1 = detectConflicts({
      ...baseInput,
      primary: { verificationSteps: ["a", "b"] },
      lite: { verificationSteps: ["a", "b"] },
      liteTimestamps: timestamps(),
    });
    expect(conflicts1).toEqual([]);

    const conflicts2 = detectConflicts({
      ...baseInput,
      primary: { verificationSteps: ["a", "b"] },
      lite: { verificationSteps: ["a", "c"] },
      liteTimestamps: timestamps({ verificationSteps: NEWER }),
    });
    expect(conflicts2).toHaveLength(1);
    expect(conflicts2[0]?.field).toBe("verificationSteps");
  });

  it("undefined vs undefined is not a divergence", () => {
    const conflicts = detectConflicts({
      ...baseInput,
      primary: {},
      lite: {},
      liteTimestamps: timestamps(),
    });
    expect(conflicts).toEqual([]);
  });

  it("undefined vs defined IS a divergence", () => {
    const conflicts = detectConflicts({
      ...baseInput,
      primary: {},
      lite: { codeArea: "src/foo.ts" },
      liteTimestamps: timestamps({ codeArea: NEWER }),
    });
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.field).toBe("codeArea");
  });
});

describe("lwwWinner (s155 t672 Phase 4)", () => {
  const make = (overrides: Partial<{
    primaryUpdatedAt: string;
    liteUpdatedAt: string;
  }> = {}) => ({
    projectPath: "/p",
    entityType: "task",
    entityId: "t-1",
    field: "title",
    primaryValue: "P",
    liteValue: "L",
    hard: false,
    ...overrides,
  });

  it("primary wins when primaryUpdatedAt > liteUpdatedAt", () => {
    expect(lwwWinner(make({ primaryUpdatedAt: NEWEST, liteUpdatedAt: NEWER }))).toBe("primary");
  });

  it("lite wins when liteUpdatedAt > primaryUpdatedAt", () => {
    expect(lwwWinner(make({ primaryUpdatedAt: NEWER, liteUpdatedAt: NEWEST }))).toBe("lite");
  });

  it("lite wins when primary timestamp is missing (ADR floor stance)", () => {
    expect(lwwWinner(make({ liteUpdatedAt: NEWER }))).toBe("lite");
  });

  it("primary wins when only lite timestamp is missing", () => {
    expect(lwwWinner(make({ primaryUpdatedAt: NEWER }))).toBe("primary");
  });

  it("ties resolved as lite (gte beats lite-newer-or-equal)", () => {
    expect(lwwWinner(make({ primaryUpdatedAt: NEWER, liteUpdatedAt: NEWER }))).toBe("lite");
  });
});

describe("TRACKED_FIELDS (s155 t672 Phase 4)", () => {
  it("matches the keys in TaskFieldTimestamps", () => {
    expect([...TRACKED_FIELDS].sort()).toEqual(
      ["codeArea", "description", "status", "title", "verificationSteps"].sort(),
    );
  });
});
