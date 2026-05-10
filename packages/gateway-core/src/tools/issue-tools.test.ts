/**
 * issue tool tests (Wish #21 Slice 3).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createIssueHandler } from "./issue-tools.js";

let workspace: string;
let project: string;
let handler: (input: Record<string, unknown>) => Promise<string> | string;

beforeEach(() => {
  workspace = join(tmpdir(), `issue-tool-test-${String(Date.now())}-${String(Math.random()).slice(2, 8)}`);
  mkdirSync(workspace, { recursive: true });
  project = join(workspace, "myproj");
  mkdirSync(project, { recursive: true });
  handler = createIssueHandler({
    workspaceProjects: () => [workspace],
  });
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

async function call(input: Record<string, unknown>): Promise<unknown> {
  const out = await Promise.resolve(handler(input));
  return JSON.parse(out);
}

describe("issue tool — input validation (Wish #21 Slice 3)", () => {
  it("rejects unknown action", async () => {
    const r = await call({ action: "bogus", projectPath: project });
    expect((r as { error?: string }).error).toMatch(/action must be one of/);
  });

  it("rejects missing projectPath when no default configured", async () => {
    const r = await call({ action: "list" });
    expect((r as { error?: string }).error).toMatch(/projectPath is required/);
  });

  it("rejects projectPath outside workspace", async () => {
    const r = await call({ action: "list", projectPath: "/tmp/not-in-workspace" });
    expect((r as { error?: string }).error).toMatch(/not inside a configured workspace/);
  });

  // s161 path-A — defaultProjectPath fallback for project-less callers
  it("falls back to defaultProjectPath when projectPath omitted", async () => {
    const fallback = join(workspace, "_aionima");
    mkdirSync(fallback, { recursive: true });
    const handlerWithDefault = createIssueHandler({
      workspaceProjects: () => [workspace],
      defaultProjectPath: () => fallback,
    });
    const out = await Promise.resolve(handlerWithDefault({ action: "list" }));
    const r = JSON.parse(out) as { action?: string; issues?: unknown[]; error?: string };
    expect(r.error).toBeUndefined();
    expect(r.action).toBe("list");
    expect(Array.isArray(r.issues)).toBe(true);
  });

  it("rejects when defaultProjectPath returns null", async () => {
    const handlerWithNullDefault = createIssueHandler({
      workspaceProjects: () => [workspace],
      defaultProjectPath: () => null,
    });
    const out = await Promise.resolve(handlerWithNullDefault({ action: "list" }));
    const r = JSON.parse(out) as { error?: string };
    expect(r.error).toMatch(/projectPath is required/);
  });
});

describe("issue tool — log action (Wish #21 Slice 3)", () => {
  it("creates a new issue", async () => {
    const r = await call({
      action: "log",
      projectPath: project,
      title: "Plaid 401",
      symptom: "401 Unauthorized",
      tool: "fetch",
      exit_code: 401,
      tags: ["plaid"],
    });
    expect((r as { outcome?: string }).outcome).toBe("created");
    expect((r as { id?: string }).id).toBe("i-001");
    expect(existsSync(join(project, "k", "issues", "i-001.md"))).toBe(true);
  });

  it("rejects log without title or symptom", async () => {
    const r1 = await call({ action: "log", projectPath: project, title: "x" });
    expect((r1 as { error?: string }).error).toMatch(/title and symptom/);
    const r2 = await call({ action: "log", projectPath: project, symptom: "y" });
    expect((r2 as { error?: string }).error).toMatch(/title and symptom/);
  });

  it("dedup: same symptom appends occurrence", async () => {
    await call({ action: "log", projectPath: project, title: "X", symptom: "boom", tool: "t", exit_code: 1 });
    const r2 = await call({ action: "log", projectPath: project, title: "X again", symptom: "boom", tool: "t", exit_code: 1 });
    expect((r2 as { outcome?: string }).outcome).toBe("appended");
    expect((r2 as { occurrences?: number }).occurrences).toBe(2);
  });

  it("defaults agent to $A0 (Aion)", async () => {
    await call({ action: "log", projectPath: project, title: "agent-default", symptom: "x" });
    const showResult = await call({ action: "show", projectPath: project, id: "i-001" });
    expect((showResult as { issue?: { agent: string } }).issue?.agent).toBe("$A0");
  });

  it("respects explicit agent override", async () => {
    await call({
      action: "log",
      projectPath: project,
      title: "explicit",
      symptom: "y",
      agent: "claude-code",
    });
    const showResult = await call({ action: "show", projectPath: project, id: "i-001" });
    expect((showResult as { issue?: { agent: string } }).issue?.agent).toBe("claude-code");
  });
});

describe("issue tool — search action (Wish #21 Slice 3)", () => {
  beforeEach(async () => {
    await call({
      action: "log",
      projectPath: project,
      title: "Plaid webhook 401",
      symptom: "auth-fail-plaid",
      tags: ["plaid", "auth"],
    });
    await call({
      action: "log",
      projectPath: project,
      title: "Stripe charge",
      symptom: "card-decline",
      tags: ["stripe"],
    });
  });

  it("free-text search returns matching hits", async () => {
    const r = await call({ action: "search", projectPath: project, query: "plaid" });
    expect((r as { hits?: unknown[] }).hits).toHaveLength(1);
  });

  it("tag filter narrows results", async () => {
    const r = await call({ action: "search", projectPath: project, query: "tag:stripe" });
    expect((r as { hits?: unknown[] }).hits).toHaveLength(1);
  });

  it("status filter narrows results", async () => {
    const r = await call({ action: "search", projectPath: project, query: "status:open" });
    expect((r as { hits?: unknown[] }).hits).toHaveLength(2);
    const r2 = await call({ action: "search", projectPath: project, query: "status:fixed" });
    expect((r2 as { hits?: unknown[] }).hits).toHaveLength(0);
  });

  it("empty query returns all issues", async () => {
    const r = await call({ action: "search", projectPath: project, query: "" });
    expect((r as { hits?: unknown[] }).hits).toHaveLength(2);
  });
});

describe("issue tool — show + list + fix actions (Wish #21 Slice 3)", () => {
  beforeEach(async () => {
    await call({ action: "log", projectPath: project, title: "First", symptom: "first-symptom" });
    await call({ action: "log", projectPath: project, title: "Second", symptom: "second-symptom" });
  });

  it("list returns summary index", async () => {
    const r = await call({ action: "list", projectPath: project });
    expect((r as { issues?: unknown[] }).issues).toHaveLength(2);
  });

  it("show returns the full issue", async () => {
    const r = await call({ action: "show", projectPath: project, id: "i-001" });
    expect((r as { issue?: { title: string } }).issue?.title).toBe("First");
  });

  it("show returns error for unknown id", async () => {
    const r = await call({ action: "show", projectPath: project, id: "i-999" });
    expect((r as { error?: string }).error).toMatch(/not found/);
  });

  it("fix flips status to fixed", async () => {
    const r = await call({ action: "fix", projectPath: project, id: "i-001", resolution: "Reverted PR #99" });
    expect((r as { status?: string }).status).toBe("fixed");
    const showResult = await call({ action: "show", projectPath: project, id: "i-001" });
    expect((showResult as { issue?: { status: string } }).issue?.status).toBe("fixed");
    expect((showResult as { issue?: { body: string } }).issue?.body).toContain("Reverted PR #99");
  });

  it("fix accepts custom status (e.g. 'known')", async () => {
    const r = await call({ action: "fix", projectPath: project, id: "i-001", status: "known" });
    expect((r as { status?: string }).status).toBe("known");
  });

  it("fix returns error for unknown id", async () => {
    const r = await call({ action: "fix", projectPath: project, id: "i-404" });
    expect((r as { error?: string }).error).toMatch(/not found/);
  });
});
