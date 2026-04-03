/**
 * PR Review Workflow — Story 18
 *
 * Heuristic-based pull request review: analyzes diffs for common issues,
 * checks style conventions, estimates review complexity, and produces
 * structured review feedback.
 *
 * Pure synchronous logic — no API calls, no side effects.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PRReviewInput {
  /** The unified diff content to review. */
  diff: string;
  /** Optional PR title for context. */
  title?: string;
  /** Optional PR description for context. */
  description?: string;
  /** File paths changed in the PR. */
  changedFiles?: string[];
}

export interface ReviewComment {
  /** File path the comment applies to. */
  file: string;
  /** Line number (approximate). */
  line: number;
  /** Severity of the issue. */
  severity: "info" | "warning" | "error";
  /** The review comment. */
  message: string;
  /** Category of the issue. */
  category: string;
}

export interface PRReviewResult {
  /** Overall review verdict. */
  verdict: "approve" | "request_changes" | "comment";
  /** Summary of the review. */
  summary: string;
  /** Individual review comments. */
  comments: ReviewComment[];
  /** Estimated complexity of the changes. */
  complexity: "trivial" | "low" | "medium" | "high";
  /** Files with the most issues. */
  hotspots: string[];
}

// ---------------------------------------------------------------------------
// Issue patterns
// ---------------------------------------------------------------------------

interface DiffPattern {
  pattern: RegExp;
  message: string;
  severity: ReviewComment["severity"];
  category: string;
}

const DIFF_PATTERNS: readonly DiffPattern[] = [
  // Security
  { pattern: /console\.log\(.*password|secret|token|api.?key/i, message: "Potential secret logged to console", severity: "error", category: "security" },
  { pattern: /eval\s*\(/, message: "Use of eval() is a security risk", severity: "error", category: "security" },
  { pattern: /innerHTML\s*=/, message: "innerHTML assignment — potential XSS vector", severity: "warning", category: "security" },
  { pattern: /process\.env\.\w+.*(?:log|console|print)/i, message: "Environment variable may be logged", severity: "warning", category: "security" },

  // Style
  { pattern: /any(?:\s|[;,>])/, message: "Explicit 'any' type — consider a more specific type", severity: "info", category: "style" },
  { pattern: /\/\/ TODO/, message: "TODO comment — track in issue tracker", severity: "info", category: "style" },
  { pattern: /eslint-disable/, message: "ESLint rule disabled — ensure this is necessary", severity: "info", category: "style" },

  // Performance
  { pattern: /new RegExp\(.*\).*(?:forEach|map|filter|some|every)/, message: "RegExp created inside a loop/iterator — compile once outside", severity: "warning", category: "performance" },
  { pattern: /JSON\.parse\(JSON\.stringify/, message: "Deep clone via JSON — consider structuredClone() or a targeted clone", severity: "info", category: "performance" },

  // Correctness
  { pattern: /==\s(?!=)/, message: "Loose equality (==) — prefer strict equality (===)", severity: "warning", category: "correctness" },
  { pattern: /catch\s*\(\s*\)\s*\{/, message: "Empty catch block — errors are silently swallowed", severity: "warning", category: "correctness" },
  { pattern: /\.then\(.*\)(?!\s*\.catch)/, message: "Promise chain without .catch() — unhandled rejection risk", severity: "info", category: "correctness" },
];

// ---------------------------------------------------------------------------
// Core review
// ---------------------------------------------------------------------------

/**
 * Review a PR diff using heuristic pattern matching.
 */
export function reviewPR(input: PRReviewInput): PRReviewResult {
  const { diff, changedFiles = [] } = input;
  const comments: ReviewComment[] = [];
  const fileIssueCount = new Map<string, number>();

  // Parse diff into file hunks
  const hunks = parseDiffHunks(diff);

  for (const hunk of hunks) {
    // Only analyze added lines (lines starting with +)
    for (let i = 0; i < hunk.addedLines.length; i++) {
      const line = hunk.addedLines[i]!;

      for (const pattern of DIFF_PATTERNS) {
        if (pattern.pattern.test(line.content)) {
          comments.push({
            file: hunk.file,
            line: line.lineNumber,
            severity: pattern.severity,
            message: pattern.message,
            category: pattern.category,
          });

          fileIssueCount.set(
            hunk.file,
            (fileIssueCount.get(hunk.file) ?? 0) + 1,
          );
        }
      }
    }
  }

  // Determine complexity
  const totalAddedLines = hunks.reduce(
    (sum, h) => sum + h.addedLines.length,
    0,
  );
  const totalRemovedLines = hunks.reduce(
    (sum, h) => sum + h.removedLines,
    0,
  );
  const complexity = estimateComplexity(
    totalAddedLines + totalRemovedLines,
    changedFiles.length || hunks.length,
  );

  // Determine hotspots (files with most issues)
  const hotspots = [...fileIssueCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([file]) => file);

  // Determine verdict
  const errorCount = comments.filter((c) => c.severity === "error").length;
  const warningCount = comments.filter((c) => c.severity === "warning").length;

  let verdict: PRReviewResult["verdict"];
  if (errorCount > 0) {
    verdict = "request_changes";
  } else if (warningCount > 2) {
    verdict = "comment";
  } else {
    verdict = "approve";
  }

  // Build summary
  const summary = buildSummary(
    verdict,
    comments.length,
    errorCount,
    warningCount,
    totalAddedLines,
    totalRemovedLines,
    hunks.length,
  );

  return { verdict, summary, comments, complexity, hotspots };
}

// ---------------------------------------------------------------------------
// Diff parsing
// ---------------------------------------------------------------------------

interface DiffHunk {
  file: string;
  addedLines: Array<{ lineNumber: number; content: string }>;
  removedLines: number;
}

function parseDiffHunks(diff: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  const lines = diff.split("\n");

  let currentFile = "";
  let currentLineNumber = 0;
  let addedLines: DiffHunk["addedLines"] = [];
  let removedLines = 0;

  for (const line of lines) {
    // New file header
    const fileMatch = /^(?:diff --git a\/(.+?) b\/|^\+\+\+ b\/(.+))/.exec(line);
    if (fileMatch !== null) {
      // Flush previous hunk
      if (currentFile !== "" && (addedLines.length > 0 || removedLines > 0)) {
        hunks.push({ file: currentFile, addedLines, removedLines });
      }
      currentFile = fileMatch[1] ?? fileMatch[2] ?? "";
      addedLines = [];
      removedLines = 0;
      continue;
    }

    // Hunk header: @@ -old,count +new,count @@
    const hunkMatch = /^@@ .+\+(\d+)/.exec(line);
    if (hunkMatch !== null) {
      currentLineNumber = parseInt(hunkMatch[1]!, 10);
      continue;
    }

    // Added line
    if (line.startsWith("+") && !line.startsWith("+++")) {
      addedLines.push({
        lineNumber: currentLineNumber,
        content: line.slice(1),
      });
      currentLineNumber++;
      continue;
    }

    // Removed line
    if (line.startsWith("-") && !line.startsWith("---")) {
      removedLines++;
      continue;
    }

    // Context line
    if (!line.startsWith("\\")) {
      currentLineNumber++;
    }
  }

  // Flush last hunk
  if (currentFile !== "" && (addedLines.length > 0 || removedLines > 0)) {
    hunks.push({ file: currentFile, addedLines, removedLines });
  }

  return hunks;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function estimateComplexity(
  totalLines: number,
  fileCount: number,
): PRReviewResult["complexity"] {
  if (totalLines <= 10 && fileCount <= 1) return "trivial";
  if (totalLines <= 50 && fileCount <= 3) return "low";
  if (totalLines <= 200 && fileCount <= 8) return "medium";
  return "high";
}

function buildSummary(
  verdict: PRReviewResult["verdict"],
  totalComments: number,
  errors: number,
  warnings: number,
  added: number,
  removed: number,
  fileCount: number,
): string {
  const verdictText =
    verdict === "approve"
      ? "Approved"
      : verdict === "request_changes"
        ? "Changes requested"
        : "Commented";

  const parts = [
    `**${verdictText}** — ${String(totalComments)} comment${totalComments !== 1 ? "s" : ""}`,
    `(${String(errors)} error${errors !== 1 ? "s" : ""}, ${String(warnings)} warning${warnings !== 1 ? "s" : ""})`,
    `| ${String(fileCount)} file${fileCount !== 1 ? "s" : ""} | +${String(added)} -${String(removed)}`,
  ];

  return parts.join(" ");
}

/**
 * Format a review result into human-readable markdown.
 */
export function formatReviewReport(result: PRReviewResult): string {
  const lines: string[] = [
    `## PR Review`,
    "",
    result.summary,
    "",
  ];

  if (result.comments.length > 0) {
    lines.push("### Comments");
    lines.push("");

    for (const comment of result.comments) {
      const icon =
        comment.severity === "error" ? "X"
          : comment.severity === "warning" ? "!"
            : "i";
      lines.push(`- [${icon}] **${comment.file}:${String(comment.line)}** — ${comment.message} _(${comment.category})_`);
    }
    lines.push("");
  }

  if (result.hotspots.length > 0) {
    lines.push(`**Hotspots:** ${result.hotspots.join(", ")}`);
    lines.push("");
  }

  lines.push(`**Complexity:** ${result.complexity}`);
  return lines.join("\n");
}
