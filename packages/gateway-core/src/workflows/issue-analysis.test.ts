/**
 * Issue Analysis Workflow Tests — Story 15
 *
 * Covers:
 * - Keyword-based root cause identification
 * - Complexity estimation
 * - Auto-fixable detection
 * - Skill content formatting
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { analyzeIssue, createIssueAnalysisSkillContent } from "./issue-analysis.js";

describe("analyzeIssue", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "issue-analysis-test-"));
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("identifies missing module import issues", async () => {
    const result = await analyzeIssue(
      { issueText: "Error: Cannot find module '@agi/skills'" },
      tmpDir,
    );

    expect(result.rootCause).toContain("import");
    expect(result.suggestedApproach.length).toBeGreaterThan(0);
  });

  it("identifies TypeScript type errors", async () => {
    const result = await analyzeIssue(
      { issueText: "Type error: property 'foo' does not exist on type 'Bar'" },
      tmpDir,
    );

    expect(result.rootCause).toContain("type");
  });

  it("identifies null reference issues", async () => {
    const result = await analyzeIssue(
      { issueText: "Error: null is not an object. Cannot read undefined at runtime" },
      tmpDir,
    );

    expect(result.rootCause.toLowerCase()).toContain("null");
  });

  it("identifies timeout issues", async () => {
    const result = await analyzeIssue(
      { issueText: "Request timeout: ETIMEDOUT connecting to database" },
      tmpDir,
    );

    expect(result.rootCause.toLowerCase()).toContain("timeout");
  });

  it("estimates high complexity for architectural issues", async () => {
    const result = await analyzeIssue(
      { issueText: "Need to refactor the entire authentication architecture to support OAuth" },
      tmpDir,
    );

    expect(result.complexity).toBe("high");
  });

  it("estimates low complexity for typos", async () => {
    const result = await analyzeIssue(
      { issueText: "Typo in the error message: 'unauthroized' should be 'unauthorized'" },
      tmpDir,
    );

    expect(result.complexity).toBe("low");
    expect(result.autoFixable).toBe(true);
  });

  it("detects auto-fixable issues for missing imports", async () => {
    const result = await analyzeIssue(
      { issueText: "missing import for the EventEmitter class" },
      tmpDir,
    );

    expect(result.autoFixable).toBe(true);
  });

  it("reads related files for context", async () => {
    const srcDir = join(tmpDir, "src");
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, "example.ts"), "export function buggy() { return undefined.foo; }");

    const result = await analyzeIssue(
      {
        issueText: "Function returns undefined",
        relatedFiles: ["src/example.ts"],
      },
      tmpDir,
    );

    expect(result.affectedFiles).toContain("src/example.ts");
  });

  it("handles issues with no pattern match gracefully", async () => {
    const result = await analyzeIssue(
      { issueText: "The sky is blue today" },
      tmpDir,
    );

    expect(result.rootCause).toBeDefined();
    expect(result.suggestedApproach).toBeDefined();
    expect(["low", "medium"]).toContain(result.complexity);
  });
});

describe("createIssueAnalysisSkillContent", () => {
  it("formats a skill content string", () => {
    const report = createIssueAnalysisSkillContent({
      rootCause: "Missing module import",
      suggestedApproach: "Check import paths",
      affectedFiles: ["src/index.ts"],
      complexity: "low",
      autoFixable: true,
    });

    expect(typeof report).toBe("string");
    expect(report.length).toBeGreaterThan(0);
  });
});

// Need these for beforeAll/afterAll
import { beforeAll, afterAll } from "vitest";
