/**
 * PR Review Workflow Tests — Story 18
 *
 * Covers:
 * - Diff parsing (unified diff format)
 * - Pattern detection (security, style, performance, correctness)
 * - Verdict determination
 * - Complexity estimation
 * - Hotspot identification
 * - Report formatting
 */

import { describe, it, expect } from "vitest";
import { reviewPR, formatReviewReport } from "./pr-review.js";
import type { PRReviewResult } from "./pr-review.js";

// ---------------------------------------------------------------------------
// Helper: build minimal unified diff
// ---------------------------------------------------------------------------

function buildDiff(file: string, addedLines: string[], removedLines: string[] = []): string {
  const lines: string[] = [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -1,${String(removedLines.length)} +1,${String(addedLines.length)} @@`,
  ];
  for (const r of removedLines) {
    lines.push(`-${r}`);
  }
  for (const a of addedLines) {
    lines.push(`+${a}`);
  }
  return lines.join("\n");
}

describe("reviewPR", () => {
  it("returns approve for clean diff", () => {
    const diff = buildDiff("src/utils.ts", [
      "export function add(a: number, b: number): number {",
      "  return a + b;",
      "}",
    ]);

    const result = reviewPR({ diff });
    expect(result.verdict).toBe("approve");
    expect(result.comments).toHaveLength(0);
  });

  it("detects security issues — eval()", () => {
    const diff = buildDiff("src/handler.ts", [
      "const result = eval(userInput);",
    ]);

    const result = reviewPR({ diff });
    expect(result.verdict).toBe("request_changes");
    expect(result.comments).toHaveLength(1);
    expect(result.comments[0]!.severity).toBe("error");
    expect(result.comments[0]!.category).toBe("security");
    expect(result.comments[0]!.message).toContain("eval()");
  });

  it("detects security issues — secrets in console.log", () => {
    const diff = buildDiff("src/auth.ts", [
      "console.log(\"password:\", token);",
    ]);

    const result = reviewPR({ diff });
    expect(result.comments.some((c) => c.category === "security")).toBe(true);
  });

  it("detects security issues — innerHTML", () => {
    const diff = buildDiff("src/ui.ts", [
      "element.innerHTML = userContent;",
    ]);

    const result = reviewPR({ diff });
    expect(result.comments.some((c) => c.message.includes("innerHTML"))).toBe(true);
  });

  it("detects style issues — TODO comments", () => {
    const diff = buildDiff("src/main.ts", [
      "// TODO fix this later",
    ]);

    const result = reviewPR({ diff });
    expect(result.comments.some((c) => c.category === "style")).toBe(true);
  });

  it("detects correctness issues — loose equality", () => {
    const diff = buildDiff("src/compare.ts", [
      "if (x == null) return;",
    ]);

    const result = reviewPR({ diff });
    expect(result.comments.some((c) => c.message.includes("Loose equality"))).toBe(true);
  });

  it("detects performance issues — JSON deep clone", () => {
    const diff = buildDiff("src/clone.ts", [
      "const copy = JSON.parse(JSON.stringify(original));",
    ]);

    const result = reviewPR({ diff });
    expect(result.comments.some((c) => c.category === "performance")).toBe(true);
  });

  it("sets verdict to request_changes when errors exist", () => {
    const diff = buildDiff("src/bad.ts", [
      "eval(dangerousString);",
    ]);

    const result = reviewPR({ diff });
    expect(result.verdict).toBe("request_changes");
  });

  it("sets verdict to comment when many warnings exist", () => {
    const diff = buildDiff("src/sloppy.ts", [
      "if (a == b) {}",
      "if (c == d) {}",
      "if (e == f) {}",
    ]);

    const result = reviewPR({ diff });
    expect(result.verdict).toBe("comment");
  });

  it("estimates complexity based on size and file count", () => {
    // Trivial: small diff, 1 file
    const trivial = reviewPR({ diff: buildDiff("f.ts", ["x"]) });
    expect(trivial.complexity).toBe("trivial");

    // High: large diff
    const manyLines = Array.from({ length: 100 }, (_, i) => `const x${String(i)} = ${String(i)};`);
    const highDiff = [
      buildDiff("a.ts", manyLines),
      buildDiff("b.ts", manyLines),
      buildDiff("c.ts", manyLines),
      buildDiff("d.ts", manyLines),
      buildDiff("e.ts", manyLines),
      buildDiff("f.ts", manyLines),
      buildDiff("g.ts", manyLines),
      buildDiff("h.ts", manyLines),
      buildDiff("i.ts", manyLines),
    ].join("\n");
    const high = reviewPR({ diff: highDiff });
    expect(high.complexity).toBe("high");
  });

  it("identifies hotspot files", () => {
    const diff = [
      buildDiff("src/bad.ts", ["eval(a);", "eval(b);", "eval(c);"]),
      buildDiff("src/ok.ts", ["const x = 1;"]),
    ].join("\n");

    const result = reviewPR({ diff });
    expect(result.hotspots).toContain("src/bad.ts");
  });

  it("only analyzes added lines (not removed)", () => {
    const diff = buildDiff(
      "src/refactored.ts",
      ["const x = 1;"],
      ["eval(dangerousOldCode);"],
    );

    const result = reviewPR({ diff });
    // eval is in removed lines only — should not trigger
    expect(result.comments.filter((c) => c.message.includes("eval"))).toHaveLength(0);
  });

  it("handles multi-file diff", () => {
    const diff = [
      buildDiff("src/a.ts", ["eval(x);"]),
      buildDiff("src/b.ts", ["const y = 1;"]),
    ].join("\n");

    const result = reviewPR({ diff });
    expect(result.comments).toHaveLength(1);
    expect(result.comments[0]!.file).toBe("src/a.ts");
  });
});

describe("formatReviewReport", () => {
  it("formats a clean review", () => {
    const result: PRReviewResult = {
      verdict: "approve",
      summary: "**Approved** — 0 comments",
      comments: [],
      complexity: "trivial",
      hotspots: [],
    };

    const report = formatReviewReport(result);
    expect(report).toContain("## PR Review");
    expect(report).toContain("**Approved**");
    expect(report).toContain("**Complexity:** trivial");
  });

  it("formats a review with comments", () => {
    const result: PRReviewResult = {
      verdict: "request_changes",
      summary: "**Changes requested** — 1 comment",
      comments: [
        {
          file: "src/handler.ts",
          line: 5,
          severity: "error",
          message: "Use of eval()",
          category: "security",
        },
      ],
      complexity: "low",
      hotspots: ["src/handler.ts"],
    };

    const report = formatReviewReport(result);
    expect(report).toContain("### Comments");
    expect(report).toContain("[X]");
    expect(report).toContain("src/handler.ts:5");
    expect(report).toContain("**Hotspots:** src/handler.ts");
  });
});
