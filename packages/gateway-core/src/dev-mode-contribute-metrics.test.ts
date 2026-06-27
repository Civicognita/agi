import { describe, it, expect, afterEach, vi } from "vitest";
import { computeContributeMetrics } from "./dev-mode-contribute.js";

/** Wave 2b — contribution metrics counting (merged/open/total, owner-filtered). */
describe("computeContributeMetrics", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("counts merged/open/total per repo (owner-filtered) with rolled-up totals", async () => {
    const pulls = [
      { user: { login: "wishborn" }, state: "closed", merged_at: "2026-01-01T00:00:00Z" }, // merged
      { user: { login: "wishborn" }, state: "open", merged_at: null }, // open
      { user: { login: "someone-else" }, state: "open", merged_at: null }, // ignored (not owner)
      { user: { login: "wishborn" }, state: "closed", merged_at: null }, // closed-unmerged (total only)
    ];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(pulls), { status: 200 })));

    const m = await computeContributeMetrics("wishborn", "tok");
    expect(m.ownerLogin).toBe("wishborn");
    expect(m.repos.length).toBeGreaterThan(0);
    for (const r of m.repos) {
      expect(r.merged).toBe(1);
      expect(r.open).toBe(1);
      expect(r.total).toBe(3);
    }
    expect(m.totals.merged).toBe(m.repos.length);
    expect(m.totals.open).toBe(m.repos.length);
    expect(m.totals.total).toBe(m.repos.length * 3);
  });

  it("returns zeros and makes no GitHub calls without an owner login", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const m = await computeContributeMetrics(null, null);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(m.totals).toEqual({ merged: 0, open: 0, total: 0 });
    expect(m.repos.every((r) => r.merged === 0 && r.open === 0 && r.total === 0)).toBe(true);
  });

  it("degrades to zeros on a GitHub error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    const m = await computeContributeMetrics("wishborn", "tok");
    expect(m.totals).toEqual({ merged: 0, open: 0, total: 0 });
  });
});
