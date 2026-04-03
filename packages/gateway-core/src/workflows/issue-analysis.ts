/**
 * Issue Analysis Workflow
 *
 * Provides heuristic issue analysis: reads related files from the workspace,
 * identifies likely root causes, suggests an approach, and estimates complexity.
 *
 * Pure logic except for `analyzeIssue` which reads files via `node:fs`.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IssueAnalysisInput {
  /** Free-text description of the issue / bug report. */
  issueText: string;
  /** Optional list of file paths related to the issue (relative to workspace root). */
  relatedFiles?: string[];
  /** Optional list of recent commit messages for context. */
  recentCommits?: string[];
}

export interface IssueAnalysisResult {
  /** Best-guess root cause based on heuristic analysis. */
  rootCause: string;
  /** Suggested approach to fixing the issue. */
  suggestedApproach: string;
  /** Files likely affected by or related to the issue. */
  affectedFiles: string[];
  /** Estimated complexity of the fix. */
  complexity: "low" | "medium" | "high";
  /** Whether this issue is likely auto-fixable by a code generation workflow. */
  autoFixable: boolean;
}

// ---------------------------------------------------------------------------
// Keyword / heuristic maps
// ---------------------------------------------------------------------------

const ERROR_KEYWORDS: ReadonlyArray<{ pattern: RegExp; cause: string; approach: string }> = [
  {
    pattern: /cannot find module|module not found|import.*not found/i,
    cause: "Missing or incorrect module import",
    approach: "Check import paths, ensure the module is installed and the path uses correct extensions (.js for ESM).",
  },
  {
    pattern: /type\s*error|is not assignable|property.*does not exist/i,
    cause: "TypeScript type mismatch",
    approach: "Review the type definitions and ensure interfaces/types align across modules.",
  },
  {
    pattern: /null|undefined is not|cannot read propert/i,
    cause: "Null/undefined reference at runtime",
    approach: "Add null checks or optional chaining. Trace the data flow to find where the value becomes null/undefined.",
  },
  {
    pattern: /timeout|ETIMEDOUT|deadline exceeded/i,
    cause: "Operation timeout",
    approach: "Increase timeout values, add retry logic, or investigate slow downstream dependencies.",
  },
  {
    pattern: /permission denied|EACCES|unauthorized|403/i,
    cause: "Permission or authorization failure",
    approach: "Check file permissions, API tokens, and authorization logic.",
  },
  {
    pattern: /syntax error|unexpected token/i,
    cause: "Syntax error in source code",
    approach: "Run the linter/compiler and fix the syntax at the indicated location.",
  },
  {
    pattern: /out of memory|heap|allocation failed/i,
    cause: "Memory exhaustion",
    approach: "Profile memory usage, look for leaks (unbounded caches, retained references), and consider streaming.",
  },
  {
    pattern: /ECONNREFUSED|ECONNRESET|connection refused/i,
    cause: "Network connection failure",
    approach: "Verify the target service is running and reachable. Check URLs, ports, and firewall rules.",
  },
  {
    pattern: /test fail|assertion|expect.*to/i,
    cause: "Test assertion failure",
    approach: "Compare expected vs. actual values. Check if the implementation changed without updating the test.",
  },
  {
    pattern: /race condition|concurrent|deadlock/i,
    cause: "Concurrency issue",
    approach: "Review shared state access, add proper locking/synchronization, or redesign to avoid shared mutable state.",
  },
];

const COMPLEXITY_HIGH_PATTERNS = [
  /refactor/i,
  /architect/i,
  /redesign/i,
  /migration/i,
  /breaking change/i,
  /across.*multiple.*files/i,
  /security vuln/i,
  /race condition/i,
  /deadlock/i,
];

const COMPLEXITY_LOW_PATTERNS = [
  /typo/i,
  /missing import/i,
  /wrong path/i,
  /rename/i,
  /add.*comment/i,
  /lint/i,
  /formatting/i,
];

const AUTO_FIXABLE_PATTERNS = [
  /typo/i,
  /missing import/i,
  /wrong path/i,
  /unused.*variable/i,
  /lint/i,
  /formatting/i,
  /add.*export/i,
];

// ---------------------------------------------------------------------------
// File reading helper
// ---------------------------------------------------------------------------

function safeReadFile(workspaceRoot: string, relPath: string): string | null {
  try {
    const fullPath = resolve(workspaceRoot, relPath);
    if (!existsSync(fullPath)) return null;
    return readFileSync(fullPath, "utf-8");
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Core analysis
// ---------------------------------------------------------------------------

/**
 * Analyze an issue using heuristic pattern matching.
 *
 * Reads related files from the workspace to gather context.
 * This is the only function in this module with side effects (filesystem reads).
 */
export async function analyzeIssue(
  input: IssueAnalysisInput,
  workspaceRoot: string,
): Promise<IssueAnalysisResult> {
  const { issueText, relatedFiles = [], recentCommits = [] } = input;

  // Combine all text for analysis
  const combinedContext = [
    issueText,
    ...recentCommits,
  ].join("\n");

  // 1. Identify root cause via keyword matching
  let rootCause = "Unable to determine root cause from the description alone.";
  let suggestedApproach = "Manually inspect the affected code and reproduce the issue to identify the root cause.";

  for (const entry of ERROR_KEYWORDS) {
    if (entry.pattern.test(combinedContext)) {
      rootCause = entry.cause;
      suggestedApproach = entry.approach;
      break;
    }
  }

  // 2. Read related files and extract additional context
  const affectedFiles: string[] = [...relatedFiles];
  const fileContents: string[] = [];

  for (const relPath of relatedFiles) {
    const content = safeReadFile(workspaceRoot, relPath);
    if (content !== null) {
      fileContents.push(content);
    }
  }

  // Scan file contents for additional hints
  const allFileText = fileContents.join("\n");
  if (allFileText.length > 0) {
    for (const entry of ERROR_KEYWORDS) {
      if (entry.pattern.test(allFileText) && rootCause === "Unable to determine root cause from the description alone.") {
        rootCause = entry.cause;
        suggestedApproach = entry.approach;
        break;
      }
    }
  }

  // 3. Extract file references from issue text (e.g., "src/foo.ts", "./bar.js")
  const fileRefPattern = /(?:^|\s)((?:\.\/|\.\.\/|src\/|packages\/)\S+\.(?:ts|js|tsx|jsx|json|md))/g;
  let match: RegExpExecArray | null;
  while ((match = fileRefPattern.exec(issueText)) !== null) {
    const ref = match[1]!.trim();
    if (!affectedFiles.includes(ref)) {
      affectedFiles.push(ref);
    }
  }

  // 4. Estimate complexity
  const complexity = estimateComplexity(combinedContext, affectedFiles.length);

  // 5. Determine auto-fixability
  const autoFixable = complexity === "low" && AUTO_FIXABLE_PATTERNS.some((p) => p.test(combinedContext));

  return {
    rootCause,
    suggestedApproach,
    affectedFiles,
    complexity,
    autoFixable,
  };
}

// ---------------------------------------------------------------------------
// Complexity estimation
// ---------------------------------------------------------------------------

function estimateComplexity(
  text: string,
  fileCount: number,
): "low" | "medium" | "high" {
  // High complexity signals
  if (COMPLEXITY_HIGH_PATTERNS.some((p) => p.test(text))) return "high";
  if (fileCount > 5) return "high";

  // Low complexity signals
  if (COMPLEXITY_LOW_PATTERNS.some((p) => p.test(text))) return "low";
  if (fileCount <= 1) return "low";

  return "medium";
}

// ---------------------------------------------------------------------------
// Skill content formatter
// ---------------------------------------------------------------------------

/**
 * Create a human-readable skill content block from an analysis result.
 * Suitable for embedding in a skill manifest or system prompt.
 */
export function createIssueAnalysisSkillContent(result: IssueAnalysisResult): string {
  const lines: string[] = [
    "## Issue Analysis",
    "",
    `**Root Cause:** ${result.rootCause}`,
    "",
    `**Suggested Approach:** ${result.suggestedApproach}`,
    "",
    `**Complexity:** ${result.complexity}`,
    `**Auto-Fixable:** ${result.autoFixable ? "Yes" : "No"}`,
    "",
  ];

  if (result.affectedFiles.length > 0) {
    lines.push("**Affected Files:**");
    for (const file of result.affectedFiles) {
      lines.push(`- ${file}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
