/**
 * bash-log-promotion tests (Wish #21 Slice 6).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  buildCandidatePayload,
  findPromotionCandidates,
  listBashLogFiles,
  type BashAuditEntry,
} from "./bash-log-promotion.js";

let tmp: string;
let originalHome: string | undefined;

function entry(overrides: Partial<BashAuditEntry>): BashAuditEntry {
  return {
    ts: "2026-05-09T18:00:00Z",
    caller: "claude-code",
    cwd: "/home/wishborn/temp_core",
    cmd_hash: "abc123",
    exit_code: 0,
    duration_ms: 1,
    stdout_bytes: 0,
    stderr_bytes: 0,
    blocked: false,
    denial_reason: "",
    audit_note: "",
    ...overrides,
  };
}

function writeJsonlFile(date: string, entries: BashAuditEntry[]): void {
  const dir = join(tmp, "home", ".agi", "logs");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `agi-bash-${date}.jsonl`);
  writeFileSync(file, entries.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf-8");
}

beforeEach(() => {
  tmp = join(tmpdir(), `bash-log-test-${String(Date.now())}-${String(Math.random()).slice(2, 8)}`);
  mkdirSync(tmp, { recursive: true });
  originalHome = process.env["HOME"];
  process.env["HOME"] = join(tmp, "home");
  mkdirSync(process.env["HOME"], { recursive: true });
});

afterEach(() => {
  if (originalHome === undefined) delete process.env["HOME"];
  else process.env["HOME"] = originalHome;
  rmSync(tmp, { recursive: true, force: true });
});

describe("listBashLogFiles (Wish #21 Slice 6)", () => {
  it("returns empty when log dir doesn't exist", () => {
    expect(listBashLogFiles(7)).toEqual([]);
  });

  it("returns files for the requested day window", () => {
    writeJsonlFile("2026-05-09", [entry({})]);
    writeJsonlFile("2026-05-08", [entry({})]);
    writeJsonlFile("2026-05-01", [entry({})]); // out of 3-day window
    const now = new Date("2026-05-09T18:00:00Z");
    const files = listBashLogFiles(3, now);
    expect(files.map((f) => f.split("/").pop())).toEqual([
      "agi-bash-2026-05-07.jsonl",
      "agi-bash-2026-05-08.jsonl",
      "agi-bash-2026-05-09.jsonl",
    ].filter((f) => f === "agi-bash-2026-05-08.jsonl" || f === "agi-bash-2026-05-09.jsonl"));
  });
});

describe("findPromotionCandidates (Wish #21 Slice 6)", () => {
  it("returns no candidates when all entries succeeded", () => {
    writeJsonlFile("2026-05-09", [entry({}), entry({})]);
    expect(findPromotionCandidates(3, new Date("2026-05-09T18:00:00Z"))).toEqual([]);
  });

  it("captures blocked entries", () => {
    writeJsonlFile("2026-05-09", [
      entry({ blocked: true, denial_reason: "reset --hard not allowed", cmd_hash: "h1" }),
      entry({}), // success — ignored
    ]);
    const candidates = findPromotionCandidates(3, new Date("2026-05-09T18:00:00Z"));
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.blocked).toBe(true);
    expect(candidates[0]?.denial_reason).toBe("reset --hard not allowed");
  });

  it("captures non-zero-exit entries", () => {
    writeJsonlFile("2026-05-09", [entry({ exit_code: 1, cmd_hash: "h2" })]);
    const candidates = findPromotionCandidates(3, new Date("2026-05-09T18:00:00Z"));
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.exit_code).toBe(1);
  });

  it("groups identical (cmd_hash, blocked, exit, reason) tuples and counts", () => {
    writeJsonlFile("2026-05-09", [
      entry({ blocked: true, denial_reason: "X", cmd_hash: "h1", ts: "2026-05-09T10:00:00Z" }),
      entry({ blocked: true, denial_reason: "X", cmd_hash: "h1", ts: "2026-05-09T11:00:00Z" }),
      entry({ blocked: true, denial_reason: "X", cmd_hash: "h1", ts: "2026-05-09T12:00:00Z" }),
    ]);
    const candidates = findPromotionCandidates(3, new Date("2026-05-09T18:00:00Z"));
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.count).toBe(3);
    expect(candidates[0]?.first_ts).toBe("2026-05-09T10:00:00Z");
    expect(candidates[0]?.last_ts).toBe("2026-05-09T12:00:00Z");
  });

  it("differentiates groups by reason", () => {
    writeJsonlFile("2026-05-09", [
      entry({ blocked: true, denial_reason: "A", cmd_hash: "h1" }),
      entry({ blocked: true, denial_reason: "B", cmd_hash: "h1" }),
    ]);
    const candidates = findPromotionCandidates(3, new Date("2026-05-09T18:00:00Z"));
    expect(candidates).toHaveLength(2);
  });

  it("orders candidates by count desc", () => {
    writeJsonlFile("2026-05-09", [
      entry({ blocked: true, denial_reason: "rare", cmd_hash: "h1" }),
      entry({ blocked: true, denial_reason: "common", cmd_hash: "h2" }),
      entry({ blocked: true, denial_reason: "common", cmd_hash: "h2" }),
      entry({ blocked: true, denial_reason: "common", cmd_hash: "h2" }),
    ]);
    const candidates = findPromotionCandidates(3, new Date("2026-05-09T18:00:00Z"));
    expect(candidates[0]?.denial_reason).toBe("common");
    expect(candidates[0]?.count).toBe(3);
    expect(candidates[1]?.denial_reason).toBe("rare");
  });

  it("tolerates malformed JSONL lines", () => {
    const dir = join(tmp, "home", ".agi", "logs");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "agi-bash-2026-05-09.jsonl");
    writeFileSync(
      file,
      [
        JSON.stringify(entry({ blocked: true, denial_reason: "X", cmd_hash: "h1" })),
        "{ malformed json",
        "",
        JSON.stringify(entry({ blocked: true, denial_reason: "Y", cmd_hash: "h2" })),
      ].join("\n"),
      "utf-8",
    );
    const candidates = findPromotionCandidates(3, new Date("2026-05-09T18:00:00Z"));
    expect(candidates).toHaveLength(2);
  });
});

describe("buildCandidatePayload (Wish #21 Slice 6)", () => {
  it("blocked candidate produces 'Bash policy blocked' title + bash-blocked tag", () => {
    const p = buildCandidatePayload({
      cmd_hash: "h1",
      blocked: true,
      exit_code: 0,
      denial_reason: "git reset --hard blocked",
      count: 5,
      first_ts: "2026-05-09T10:00:00Z",
      last_ts: "2026-05-09T15:00:00Z",
      example_caller: "claude-code",
      example_cwd: "/tmp/p",
    });
    expect(p.title).toBe("Bash policy blocked: git reset --hard blocked");
    expect(p.tags).toContain("bash-blocked");
    expect(p.tags).toContain("audit-promoted");
    expect(p.body).toContain("5 times");
    expect(p.body).toContain("h1");
  });

  it("failed-exit candidate produces 'Bash command failed' title + bash-failed tag", () => {
    const p = buildCandidatePayload({
      cmd_hash: "h2",
      blocked: false,
      exit_code: 127,
      denial_reason: "",
      count: 2,
      first_ts: "2026-05-09T10:00:00Z",
      last_ts: "2026-05-09T11:00:00Z",
      example_caller: "claude-code",
      example_cwd: "/tmp/p",
    });
    expect(p.title).toContain("Bash command failed");
    expect(p.tags).toContain("bash-failed");
    expect(p.exit_code).toBe(127);
  });

  it("symptom strings collapse different timestamps to the same hash", () => {
    const a = buildCandidatePayload({
      cmd_hash: "h", blocked: true, exit_code: 0, denial_reason: "X", count: 1,
      first_ts: "2026-05-09T10:00:00Z", last_ts: "2026-05-09T10:00:00Z",
      example_caller: "c", example_cwd: "/p",
    });
    const b = buildCandidatePayload({
      cmd_hash: "h", blocked: true, exit_code: 0, denial_reason: "X", count: 5,
      first_ts: "2026-05-08T00:00:00Z", last_ts: "2026-05-09T20:00:00Z",
      example_caller: "c", example_cwd: "/p",
    });
    // The symptom strings (used as logIssue dedup input) are equal — count
    // and timestamps don't affect dedup, only the body.
    expect(a.symptom).toBe(b.symptom);
  });
});
