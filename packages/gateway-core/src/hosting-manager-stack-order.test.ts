/**
 * Wish #15 (s150 follow-up) — `orderStacksLatestFirst` correctness.
 *
 * The prior FIRST-wins ordering in `resolveStackContainerConfig` caused
 * stale stacks to mask newly-added ones. Owner case 2026-05-08:
 * blackorchid_web had `[stack-static-hosting (May 1), stack-nextjs (May 8)]`;
 * legacy ordering returned static-hosting → mounted /dist read-only →
 * ENOENT for dev-mode projects with no build output.
 *
 * The fix: iterate stacks LATEST-FIRST by `addedAt`. This spec pins the
 * sort behavior so a future refactor can't silently regress.
 */

import { describe, expect, it } from "vitest";
import { orderStacksLatestFirst } from "./hosting-manager.js";
import type { ProjectStackInstance } from "./stack-types.js";

function instance(stackId: string, addedAt: string | undefined): ProjectStackInstance {
  // ProjectStackInstance has only stackId, addedAt, optional db fields.
  // The test cares about ordering — addedAt is the only field that matters.
  return { stackId, addedAt: addedAt ?? "" } as unknown as ProjectStackInstance;
}

describe("orderStacksLatestFirst", () => {
  it("returns stacks sorted by addedAt descending", () => {
    const out = orderStacksLatestFirst([
      instance("stack-static-hosting", "2026-05-01T05:16:58.137Z"),
      instance("stack-nextjs", "2026-05-08T02:27:52.813Z"),
    ]);
    expect(out.map((s) => s.stackId)).toEqual(["stack-nextjs", "stack-static-hosting"]);
  });

  it("does not mutate the input array", () => {
    const input = [
      instance("a", "2026-01-01T00:00:00Z"),
      instance("b", "2026-02-01T00:00:00Z"),
    ];
    const snapshot = input.map((s) => s.stackId).join(",");
    orderStacksLatestFirst(input);
    expect(input.map((s) => s.stackId).join(",")).toBe(snapshot);
  });

  it("handles three+ stacks with mixed ordering", () => {
    const out = orderStacksLatestFirst([
      instance("middle", "2026-03-15T00:00:00Z"),
      instance("oldest", "2026-01-01T00:00:00Z"),
      instance("newest", "2026-06-30T00:00:00Z"),
    ]);
    expect(out.map((s) => s.stackId)).toEqual(["newest", "middle", "oldest"]);
  });

  it("treats missing addedAt as oldest (sorts to the end)", () => {
    const out = orderStacksLatestFirst([
      instance("with-ts", "2026-05-01T00:00:00Z"),
      instance("no-ts", undefined),
      instance("newer-ts", "2026-06-01T00:00:00Z"),
    ]);
    expect(out[0]?.stackId).toBe("newer-ts");
    expect(out[1]?.stackId).toBe("with-ts");
    expect(out[2]?.stackId).toBe("no-ts");
  });

  it("returns an empty array for an empty input", () => {
    expect(orderStacksLatestFirst([])).toEqual([]);
  });

  it("identical timestamps remain in input order (stable-sort signal)", () => {
    // Node's Array.prototype.sort is stable since v12. We rely on that for
    // deterministic ordering when two stacks were added at the same instant
    // (rare but possible during scripted setup).
    const out = orderStacksLatestFirst([
      instance("a", "2026-05-01T00:00:00Z"),
      instance("b", "2026-05-01T00:00:00Z"),
      instance("c", "2026-05-01T00:00:00Z"),
    ]);
    expect(out.map((s) => s.stackId)).toEqual(["a", "b", "c"]);
  });
});
