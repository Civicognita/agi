import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  findBySymptomHash,
  issuesDir,
  listIssues,
  logIssue,
  nextIssueId,
  parseIssueFile,
  readIndex,
  readIssue,
  updateIssueStatus,
} from "./store.js";

let project: string;

beforeEach(() => {
  project = join(tmpdir(), `issues-test-${String(Date.now())}-${String(Math.random()).slice(2, 8)}`);
  mkdirSync(project, { recursive: true });
});

afterEach(() => {
  rmSync(project, { recursive: true, force: true });
});

describe("issuesDir (Wish #21)", () => {
  it("returns <project>/k/issues", () => {
    expect(issuesDir("/foo/bar")).toBe("/foo/bar/k/issues");
  });
});

describe("logIssue create + index (Wish #21)", () => {
  it("creates a new issue file + index entry on first call", () => {
    const r = logIssue(project, {
      title: "Plaid webhook 401",
      symptom: "401 Unauthorized from POST /v1/webhook",
      tool: "fetch",
      exit_code: 401,
      tags: ["plaid", "auth"],
    });
    expect(r.outcome).toBe("created");
    expect(r.id).toBe("i-001");
    expect(r.occurrences).toBe(1);
    expect(existsSync(join(issuesDir(project), "i-001.md"))).toBe(true);
    expect(existsSync(join(issuesDir(project), "index.json"))).toBe(true);

    const idx = readIndex(project);
    expect(idx).toHaveLength(1);
    expect(idx[0]?.id).toBe("i-001");
    expect(idx[0]?.tags).toEqual(["plaid", "auth"]);
  });

  it("ids advance i-001 → i-002 → i-003", () => {
    const a = logIssue(project, { title: "A", symptom: "alpha" });
    const b = logIssue(project, { title: "B", symptom: "beta" });
    const c = logIssue(project, { title: "C", symptom: "gamma" });
    expect(a.id).toBe("i-001");
    expect(b.id).toBe("i-002");
    expect(c.id).toBe("i-003");
  });

  it("nextIssueId still advances when only files exist (no index)", () => {
    logIssue(project, { title: "first", symptom: "noise" });
    rmSync(join(issuesDir(project), "index.json"));
    expect(nextIssueId(project)).toBe("i-002");
  });
});

describe("logIssue dedup (Wish #21)", () => {
  it("appends occurrence when same symptom recurs", () => {
    const a = logIssue(project, {
      title: "ENOENT cache",
      symptom: "ENOENT: /tmp/abc/cache.json @ 2026-05-09T18:30:09Z",
      tool: "fs.readFileSync",
      exit_code: 1,
    });
    const b = logIssue(project, {
      title: "ENOENT cache (different paths)",
      symptom: "ENOENT: /tmp/xyz/cache.json @ 2025-01-01T00:00:00Z",
      tool: "fs.readFileSync",
      exit_code: 1,
    });
    expect(a.outcome).toBe("created");
    expect(b.outcome).toBe("appended");
    expect(b.id).toBe(a.id);
    expect(b.occurrences).toBe(2);

    const idx = readIndex(project);
    expect(idx).toHaveLength(1);
    expect(idx[0]?.occurrences).toBe(2);
  });

  it("differentiates issues by tool", () => {
    const a = logIssue(project, { title: "X", symptom: "same", tool: "tool-a", exit_code: 1 });
    const b = logIssue(project, { title: "Y", symptom: "same", tool: "tool-b", exit_code: 1 });
    expect(a.id).toBe("i-001");
    expect(b.id).toBe("i-002");
  });

  it("appendOccurrence adds an Investigation log entry to the body", () => {
    logIssue(project, { title: "X", symptom: "same", tool: "t", exit_code: 1 }, new Date("2026-01-01T00:00:00Z"));
    logIssue(project, { title: "X", symptom: "same", tool: "t", exit_code: 1 }, new Date("2026-02-02T00:00:00Z"));
    const issue = readIssue(project, "i-001");
    expect(issue?.body).toContain("recurred");
    expect(issue?.body).toContain("2026-02-02");
  });
});

describe("readIssue + parseIssueFile (Wish #21)", () => {
  it("round-trips frontmatter through write → read", () => {
    logIssue(project, {
      title: "Round trip",
      symptom: "boom",
      tool: "x",
      exit_code: 7,
      tags: ["a", "b"],
    });
    const issue = readIssue(project, "i-001");
    expect(issue).not.toBeNull();
    expect(issue?.title).toBe("Round trip");
    expect(issue?.tool).toBe("x");
    expect(issue?.exit_code).toBe(7);
    expect(issue?.tags).toEqual(["a", "b"]);
    expect(issue?.status).toBe("open");
    expect(issue?.occurrences).toBe(1);
  });

  it("handles titles with quotes correctly", () => {
    logIssue(project, { title: 'Has "quoted" word', symptom: "x" });
    const issue = readIssue(project, "i-001");
    expect(issue?.title).toBe('Has "quoted" word');
  });

  it("returns null for unknown id", () => {
    expect(readIssue(project, "i-999")).toBeNull();
  });

  it("parseIssueFile throws on missing fence", () => {
    expect(() => parseIssueFile("no frontmatter at all")).toThrow();
  });
});

describe("listIssues + findBySymptomHash (Wish #21)", () => {
  it("listIssues returns empty array when no issues", () => {
    expect(listIssues(project)).toEqual([]);
  });

  it("findBySymptomHash returns the matching index entry", () => {
    const r = logIssue(project, { title: "X", symptom: "abc", tool: "t", exit_code: 1 });
    const entry = findBySymptomHash(project, r.symptom_hash);
    expect(entry?.id).toBe(r.id);
  });

  it("findBySymptomHash returns null on miss", () => {
    expect(findBySymptomHash(project, "0".repeat(40))).toBeNull();
  });
});

describe("updateIssueStatus (Wish #21)", () => {
  it("flips status + appends resolution", () => {
    logIssue(project, { title: "X", symptom: "y" });
    const updated = updateIssueStatus(project, "i-001", "fixed", "Reverted PR #99");
    expect(updated?.status).toBe("fixed");
    expect(updated?.body).toContain("Reverted PR #99");

    const idx = readIndex(project);
    expect(idx[0]?.status).toBe("fixed");
  });

  it("returns null for unknown id", () => {
    expect(updateIssueStatus(project, "i-404", "fixed")).toBeNull();
  });
});

describe("on-disk format sanity (Wish #21)", () => {
  it("issue file has frontmatter fences and a body", () => {
    logIssue(project, { title: "Disk format", symptom: "ok" });
    const text = readFileSync(join(issuesDir(project), "i-001.md"), "utf-8");
    expect(text.startsWith("---\n")).toBe(true);
    expect(text).toContain("\n---\n");
    expect(text).toContain("## Symptom");
  });

  it("index.json is valid JSON array", () => {
    logIssue(project, { title: "JSON test", symptom: "ok" });
    const raw = readFileSync(join(issuesDir(project), "index.json"), "utf-8");
    const parsed: unknown = JSON.parse(raw);
    expect(Array.isArray(parsed)).toBe(true);
  });
});
