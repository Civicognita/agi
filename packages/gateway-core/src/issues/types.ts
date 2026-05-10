/**
 * Issue registry types — Wish #21 Slice 1.
 *
 * Per-project Markdown registry at `<projectPath>/k/issues/`. Each issue
 * is one `.md` file with frontmatter (the structured fields below) plus
 * Markdown body (Symptom / Context / Repro / Investigation / Resolution).
 * `index.json` at the same path is a flat array of summary records for
 * fast hash lookup without parsing every file.
 */

export type IssueStatus = "open" | "known" | "fixed" | "wont-fix";

export type IssueAgent = "$A0" | "claude-code" | "owner" | string;

/**
 * One frontmatter record. Body Markdown is stored separately by the
 * store API (which reads/writes the whole file).
 */
export interface IssueFrontmatter {
  /** Stable identifier scoped to the project — `i-001`, `i-002`, … */
  id: string;
  /** Workflow state. */
  status: IssueStatus;
  /**
   * Deterministic dedup hash derived from
   * `sha1(normalize(symptom) || "::" || tool || "::" || exit_code)`.
   * See `symptom-hash.ts`.
   */
  symptom_hash: string;
  /** Free-form tags for human-curated grouping (e.g. "taskmaster", "mcp-config-drift"). */
  tags: string[];
  /** Who filed the issue. */
  agent: IssueAgent;
  /** Short headline. */
  title: string;
  /** ISO timestamp at first-file-creation. */
  created: string;
  /** ISO timestamp of the most recent occurrence (== created on first file). */
  last_occurrence: string;
  /** Counter incremented each time the same symptom_hash recurs. */
  occurrences: number;
  /** Optional: tool/command/endpoint that failed. */
  tool?: string;
  /** Optional: numeric exit code (0 = N/A). */
  exit_code?: number;
}

/** Compact summary for `index.json` — what we keep for fast lookup. */
export interface IssueIndexEntry {
  id: string;
  status: IssueStatus;
  symptom_hash: string;
  tags: string[];
  title: string;
  occurrences: number;
  last_occurrence: string;
}

/** Full issue: frontmatter + body. */
export interface Issue extends IssueFrontmatter {
  body: string;
}

/** Input shape for `logIssue` (creates new OR appends to existing). */
export interface LogIssueInput {
  title: string;
  symptom: string;
  tool?: string;
  exit_code?: number;
  tags?: string[];
  agent?: IssueAgent;
  /** Optional Markdown body for first-creation. Ignored on dedup-append. */
  body?: string;
}

/** Result of a `logIssue` call. */
export interface LogIssueResult {
  /** "created" if new file, "appended" if existing issue's occurrence counter bumped. */
  outcome: "created" | "appended";
  id: string;
  symptom_hash: string;
  occurrences: number;
}
