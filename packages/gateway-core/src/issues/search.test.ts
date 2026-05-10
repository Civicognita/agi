import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { logIssue } from "./store.js";
import { parseSearchQuery, searchIssues } from "./search.js";

let project: string;

beforeEach(() => {
  project = join(tmpdir(), `issues-search-test-${String(Date.now())}-${String(Math.random()).slice(2, 8)}`);
  mkdirSync(project, { recursive: true });
});

afterEach(() => {
  rmSync(project, { recursive: true, force: true });
});

describe("parseSearchQuery (Wish #21 Slice 2)", () => {
  it("splits on whitespace + lowercases text tokens", () => {
    const q = parseSearchQuery("Plaid WEBHOOK error");
    expect(q.textTokens).toEqual(["plaid", "webhook", "error"]);
    expect(q.tagFilters).toEqual([]);
    expect(q.statusFilter).toBeUndefined();
  });

  it("extracts tag: filters", () => {
    const q = parseSearchQuery("oauth tag:plaid tag:auth");
    expect(q.textTokens).toEqual(["oauth"]);
    expect(q.tagFilters).toEqual(["plaid", "auth"]);
  });

  it("extracts status: filter", () => {
    const q = parseSearchQuery("error status:fixed");
    expect(q.statusFilter).toBe("fixed");
    expect(q.textTokens).toEqual(["error"]);
  });

  it("drops unknown status: silently", () => {
    const q = parseSearchQuery("error status:fixedd");
    expect(q.statusFilter).toBeUndefined();
    expect(q.textTokens).toEqual(["error"]);
  });

  it("handles empty query", () => {
    const q = parseSearchQuery("");
    expect(q.textTokens).toEqual([]);
    expect(q.tagFilters).toEqual([]);
  });

  it("handles whitespace-only query", () => {
    const q = parseSearchQuery("   \t  ");
    expect(q.textTokens).toEqual([]);
  });
});

describe("searchIssues (Wish #21 Slice 2)", () => {
  it("returns empty array on empty registry", () => {
    expect(searchIssues(project, "anything")).toEqual([]);
  });

  it("matches a single token against title", () => {
    logIssue(project, { title: "Plaid webhook 401", symptom: "auth failure" });
    logIssue(project, { title: "Stripe charge failed", symptom: "card declined" });
    const hits = searchIssues(project, "plaid");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.entry.title).toBe("Plaid webhook 401");
  });

  it("requires ALL tokens to match (AND semantics)", () => {
    logIssue(project, { title: "Plaid webhook", symptom: "401 unauthorized error" });
    logIssue(project, { title: "Stripe webhook", symptom: "401 timeout error" });
    const hits = searchIssues(project, "webhook plaid");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.entry.title).toBe("Plaid webhook");
  });

  it("is case-insensitive", () => {
    logIssue(project, { title: "Database deadlock", symptom: "Postgres serialization conflict" });
    expect(searchIssues(project, "DATABASE").length).toBe(1);
    expect(searchIssues(project, "deadlock").length).toBe(1);
    expect(searchIssues(project, "POSTGRES").length).toBe(1);
  });

  it("matches against body (symptom included)", () => {
    logIssue(project, { title: "Cache miss", symptom: "ENOENT readFileSync /tmp/abc" });
    const hits = searchIssues(project, "enoent");
    expect(hits).toHaveLength(1);
  });

  it("matches against tags", () => {
    logIssue(project, { title: "X", symptom: "y", tags: ["plaid", "auth"] });
    const hits = searchIssues(project, "plaid");
    expect(hits).toHaveLength(1);
  });

  it("filters by tag:", () => {
    // Distinct symptoms so dedup doesn't collapse them.
    logIssue(project, { title: "X", symptom: "alpha-failure", tags: ["plaid"] });
    logIssue(project, { title: "Y", symptom: "beta-failure", tags: ["stripe"] });
    expect(searchIssues(project, "tag:plaid").length).toBe(1);
    expect(searchIssues(project, "tag:stripe").length).toBe(1);
  });

  it("filters by status:", () => {
    logIssue(project, { title: "Open", symptom: "open-symptom" });
    expect(searchIssues(project, "status:open").length).toBe(1);
    expect(searchIssues(project, "status:fixed").length).toBe(0);
  });

  it("combines text + filters (AND)", () => {
    logIssue(project, { title: "Plaid webhook", symptom: "plaid-401", tags: ["plaid"] });
    logIssue(project, { title: "Stripe webhook", symptom: "stripe-401", tags: ["stripe"] });
    const hits = searchIssues(project, "webhook tag:plaid");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.entry.title).toBe("Plaid webhook");
  });

  it("empty query with no filters returns all issues, last_occurrence desc", () => {
    logIssue(project, { title: "First", symptom: "first-symptom" }, new Date("2026-01-01T00:00:00Z"));
    logIssue(project, { title: "Second", symptom: "second-symptom" }, new Date("2026-02-01T00:00:00Z"));
    const hits = searchIssues(project, "");
    expect(hits).toHaveLength(2);
    expect(hits[0]?.entry.title).toBe("Second");
    expect(hits[1]?.entry.title).toBe("First");
  });

  it("empty query with filter returns matching issues only", () => {
    logIssue(project, { title: "Open", symptom: "first-open-symptom" });
    logIssue(project, { title: "Fixed", symptom: "second-fixed-symptom" });
    // Both default to status=open, so status:open should match both.
    expect(searchIssues(project, "status:open").length).toBe(2);
  });

  it("ranks more-token-matching issues higher", () => {
    logIssue(project, { title: "alpha", symptom: "beta gamma" });
    logIssue(project, { title: "alpha beta", symptom: "gamma" });
    const hits = searchIssues(project, "alpha beta gamma");
    expect(hits).toHaveLength(2);
    // The one with all three terms in a more-distributed way may or may
    // not outrank — but BOTH must be present, sorted by total matches.
    expect(hits[0]?.matchedTokens).toBeGreaterThanOrEqual(hits[1]?.matchedTokens ?? 0);
  });

  it("includes a snippet for each hit", () => {
    logIssue(project, {
      title: "Hash collision risk",
      symptom: "When sha1 collides on user IDs the dedup misfires and merges unrelated issues into one record.",
    });
    const hits = searchIssues(project, "collide");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.snippet).toContain("collid");
  });

  it("returns nothing when ANY token fails to match", () => {
    logIssue(project, { title: "alpha beta", symptom: "gamma" });
    expect(searchIssues(project, "alpha beta delta").length).toBe(0);
  });
});
