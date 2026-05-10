/**
 * raw-capture tests (Wish #21 Slice 5).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  _resetRawCaptureSeqForTest,
  clearRawCaptures,
  listRawCaptures,
  promoteRawCapture,
  rawCapturePath,
  recordRawCapture,
} from "./raw-capture.js";
import { listIssues } from "./store.js";

let project: string;

beforeEach(() => {
  project = join(tmpdir(), `raw-capture-test-${String(Date.now())}-${String(Math.random()).slice(2, 8)}`);
  mkdirSync(project, { recursive: true });
  _resetRawCaptureSeqForTest();
});

afterEach(() => {
  rmSync(project, { recursive: true, force: true });
});

describe("rawCapturePath (Wish #21 Slice 5)", () => {
  it("resolves to <project>/k/issues/raw.jsonl", () => {
    expect(rawCapturePath("/foo/bar")).toBe("/foo/bar/k/issues/raw.jsonl");
  });
});

describe("recordRawCapture (Wish #21 Slice 5)", () => {
  it("creates k/issues/ and appends a line", () => {
    const e = recordRawCapture(project, { source: "fetch", summary: "ECONNREFUSED" });
    expect(e.source).toBe("fetch");
    expect(e.summary).toBe("ECONNREFUSED");
    expect(e.id).toMatch(/^r-/);
    const stat = statSync(rawCapturePath(project));
    expect(stat.size).toBeGreaterThan(0);
  });

  it("preserves order across multiple appends", () => {
    recordRawCapture(project, { source: "a", summary: "1" });
    recordRawCapture(project, { source: "b", summary: "2" });
    recordRawCapture(project, { source: "c", summary: "3" });
    const all = listRawCaptures(project);
    expect(all.map((e) => e.summary)).toEqual(["1", "2", "3"]);
  });

  it("preserves details payload", () => {
    recordRawCapture(project, {
      source: "tool-x",
      summary: "boom",
      details: { exitCode: 1, stderr: "oops" },
    });
    const all = listRawCaptures(project);
    expect(all[0]?.details).toEqual({ exitCode: 1, stderr: "oops" });
  });

  it("never throws on filesystem failure (side-channel discipline)", () => {
    // Simulate a non-existent path — the function should swallow the error.
    expect(() => recordRawCapture("/nonexistent/path-that-cannot-be-created/zz", {
      source: "x", summary: "y",
    })).not.toThrow();
  });
});

describe("listRawCaptures (Wish #21 Slice 5)", () => {
  it("returns empty array when raw.jsonl doesn't exist", () => {
    expect(listRawCaptures(project)).toEqual([]);
  });

  it("tolerates malformed JSONL lines", () => {
    recordRawCapture(project, { source: "ok", summary: "good" });
    // Manually corrupt with an invalid line
    const path = rawCapturePath(project);
    const raw = readFileSync(path, "utf-8");
    require("node:fs").writeFileSync(path, raw + "{ bad json\n", "utf-8");

    const all = listRawCaptures(project);
    expect(all).toHaveLength(1);
    expect(all[0]?.summary).toBe("good");
  });
});

describe("promoteRawCapture (Wish #21 Slice 5)", () => {
  it("promotes a raw entry to a curated issue + removes from raw log", () => {
    const e = recordRawCapture(project, {
      source: "fetch",
      summary: "ECONNREFUSED on POST /webhook",
      details: { exitCode: 1 },
    });
    const result = promoteRawCapture(project, e.id);
    expect(result?.outcome).toBe("created");
    expect(result?.id).toBe("i-001");

    expect(listRawCaptures(project)).toHaveLength(0);
    const issues = listIssues(project);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.tags).toContain("auto-captured");
    expect(issues[0]?.tags).toContain("fetch");
  });

  it("returns null for unknown raw id", () => {
    expect(promoteRawCapture(project, "r-bogus-001")).toBeNull();
  });

  it("dedups via symptom-hash on promotion", () => {
    // Two raw captures with identical (source, summary) — dedup hash matches
    const e1 = recordRawCapture(project, { source: "fetch", summary: "ECONNREFUSED" });
    const e2 = recordRawCapture(project, { source: "fetch", summary: "ECONNREFUSED" });

    const r1 = promoteRawCapture(project, e1.id);
    expect(r1?.outcome).toBe("created");
    expect(r1?.occurrences).toBe(1);

    const r2 = promoteRawCapture(project, e2.id);
    expect(r2?.outcome).toBe("appended");
    expect(r2?.occurrences).toBe(2);

    const issues = listIssues(project);
    expect(issues).toHaveLength(1);
  });

  it("override.title + override.tags applied at promotion", () => {
    const e = recordRawCapture(project, { source: "fetch", summary: "boom" });
    const result = promoteRawCapture(project, e.id, {
      title: "Custom title",
      tags: ["custom", "operator-curated"],
    });
    expect(result?.outcome).toBe("created");
    const issues = listIssues(project);
    expect(issues[0]?.title).toBe("Custom title");
    expect(issues[0]?.tags).toEqual(["custom", "operator-curated"]);
  });

  it("only the promoted entry is removed (others remain)", () => {
    const e1 = recordRawCapture(project, { source: "a", summary: "1" });
    recordRawCapture(project, { source: "b", summary: "2" });
    recordRawCapture(project, { source: "c", summary: "3" });
    promoteRawCapture(project, e1.id);
    const remaining = listRawCaptures(project);
    expect(remaining).toHaveLength(2);
    expect(remaining.map((e) => e.summary)).toEqual(["2", "3"]);
  });
});

describe("clearRawCaptures (Wish #21 Slice 5)", () => {
  it("removes all entries + returns count", () => {
    recordRawCapture(project, { source: "a", summary: "1" });
    recordRawCapture(project, { source: "b", summary: "2" });
    expect(clearRawCaptures(project)).toBe(2);
    expect(listRawCaptures(project)).toEqual([]);
  });

  it("safe to call when no captures exist", () => {
    expect(clearRawCaptures(project)).toBe(0);
  });
});
