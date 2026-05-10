/**
 * Issue store — Wish #21 Slice 1.
 *
 * File layout under `<projectPath>/k/issues/`:
 *   - `<id>.md`      — one issue per file (frontmatter + body)
 *   - `index.json`   — flat array of `IssueIndexEntry` for O(1) hash lookup
 *
 * Concurrency note: this slice is single-process. The on-disk
 * `index.json` is rewritten in full on each mutation, which is safe
 * for the gateway's serial request model. If we ever introduce
 * concurrent writers we'll switch to per-file index updates with a
 * lockfile — not this slice.
 *
 * The frontmatter parser/serializer is deliberately hand-rolled (not
 * `gray-matter`) — the surface is small enough that bringing a
 * dependency adds more risk than value.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import type {
  Issue,
  IssueFrontmatter,
  IssueIndexEntry,
  IssueStatus,
  LogIssueInput,
  LogIssueResult,
} from "./types.js";
import { hashSymptom } from "./symptom-hash.js";

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

export function issuesDir(projectPath: string): string {
  return join(projectPath, "k", "issues");
}

function indexPath(projectPath: string): string {
  return join(issuesDir(projectPath), "index.json");
}

function issueFilePath(projectPath: string, id: string): string {
  return join(issuesDir(projectPath), `${id}.md`);
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// ---------------------------------------------------------------------------
// Frontmatter (de)serialization
// ---------------------------------------------------------------------------

const FRONTMATTER_FENCE = "---";

/**
 * Parse a `<id>.md` file into `Issue`. Throws if frontmatter is missing
 * or malformed — every file we wrote has it; absence means corruption.
 */
export function parseIssueFile(text: string): Issue {
  const lines = text.split("\n");
  if (lines[0] !== FRONTMATTER_FENCE) {
    throw new Error("issue file is missing frontmatter fence");
  }
  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === FRONTMATTER_FENCE) {
      endIdx = i;
      break;
    }
  }
  if (endIdx < 0) {
    throw new Error("issue file frontmatter has no closing fence");
  }
  const fmLines = lines.slice(1, endIdx);
  const body = lines.slice(endIdx + 1).join("\n").replace(/^\n+/, "");
  const fm = parseFrontmatter(fmLines);
  return { ...fm, body };
}

function parseFrontmatter(lines: string[]): IssueFrontmatter {
  const map: Record<string, string> = {};
  for (const line of lines) {
    if (line.trim() === "") continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    map[key] = val;
  }
  const tagsRaw = map["tags"] ?? "[]";
  const tags = parseInlineList(tagsRaw);
  const occurrencesRaw = Number(map["occurrences"] ?? "1");
  const exitRaw = map["exit_code"];
  return {
    id: map["id"] ?? "",
    status: (map["status"] as IssueStatus) ?? "open",
    symptom_hash: map["symptom_hash"] ?? "",
    tags,
    agent: map["agent"] ?? "claude-code",
    title: stripQuotes(map["title"] ?? ""),
    created: map["created"] ?? "",
    last_occurrence: map["last_occurrence"] ?? "",
    occurrences: Number.isFinite(occurrencesRaw) ? occurrencesRaw : 1,
    tool: map["tool"] ? stripQuotes(map["tool"]) : undefined,
    exit_code: exitRaw && exitRaw !== "" ? Number(exitRaw) : undefined,
  };
}

function parseInlineList(raw: string): string[] {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "[]") return [];
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const inner = trimmed.slice(1, -1).trim();
    if (inner === "") return [];
    return inner
      .split(",")
      .map((s) => stripQuotes(s.trim()))
      .filter((s) => s.length > 0);
  }
  return [];
}

function stripQuotes(s: string): string {
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(s);
      if (typeof parsed === "string") return parsed;
    } catch {
      // fall through
    }
    return s.slice(1, -1);
  }
  return s;
}

function serializeIssueFile(issue: Issue): string {
  const fm: string[] = [
    FRONTMATTER_FENCE,
    `id: ${issue.id}`,
    `status: ${issue.status}`,
    `symptom_hash: ${issue.symptom_hash}`,
    `tags: [${issue.tags.map((t) => JSON.stringify(t)).join(", ")}]`,
    `agent: ${issue.agent}`,
    `title: ${JSON.stringify(issue.title)}`,
    `created: ${issue.created}`,
    `last_occurrence: ${issue.last_occurrence}`,
    `occurrences: ${String(issue.occurrences)}`,
  ];
  if (issue.tool !== undefined) fm.push(`tool: ${JSON.stringify(issue.tool)}`);
  if (issue.exit_code !== undefined) fm.push(`exit_code: ${String(issue.exit_code)}`);
  fm.push(FRONTMATTER_FENCE, "", issue.body);
  return fm.join("\n") + (issue.body.endsWith("\n") ? "" : "\n");
}

// ---------------------------------------------------------------------------
// Index
// ---------------------------------------------------------------------------

export function readIndex(projectPath: string): IssueIndexEntry[] {
  const file = indexPath(projectPath);
  if (!existsSync(file)) return [];
  try {
    const raw = readFileSync(file, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as IssueIndexEntry[];
  } catch {
    return [];
  }
}

function writeIndex(projectPath: string, entries: IssueIndexEntry[]): void {
  ensureDir(issuesDir(projectPath));
  writeFileSync(indexPath(projectPath), JSON.stringify(entries, null, 2) + "\n", "utf-8");
}

function summary(issue: Issue): IssueIndexEntry {
  return {
    id: issue.id,
    status: issue.status,
    symptom_hash: issue.symptom_hash,
    tags: issue.tags,
    title: issue.title,
    occurrences: issue.occurrences,
    last_occurrence: issue.last_occurrence,
  };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export function listIssues(projectPath: string): IssueIndexEntry[] {
  return readIndex(projectPath);
}

export function readIssue(projectPath: string, id: string): Issue | null {
  const file = issueFilePath(projectPath, id);
  if (!existsSync(file)) return null;
  return parseIssueFile(readFileSync(file, "utf-8"));
}

export function findBySymptomHash(projectPath: string, hash: string): IssueIndexEntry | null {
  return readIndex(projectPath).find((e) => e.symptom_hash === hash) ?? null;
}

/**
 * Determine the next issue id by scanning index + on-disk files. Picks
 * `i-NNN` where NNN is `max(existing) + 1`, zero-padded to 3 digits.
 */
export function nextIssueId(projectPath: string): string {
  const dir = issuesDir(projectPath);
  const used = new Set<string>(readIndex(projectPath).map((e) => e.id));
  if (existsSync(dir)) {
    for (const f of readdirSync(dir)) {
      if (f.endsWith(".md")) used.add(f.replace(/\.md$/, ""));
    }
  }
  let maxN = 0;
  for (const id of used) {
    const m = id.match(/^i-(\d+)$/);
    if (m) {
      const n = Number(m[1]);
      if (n > maxN) maxN = n;
    }
  }
  const next = maxN + 1;
  return `i-${String(next).padStart(3, "0")}`;
}

/**
 * Create or append-occurrence on an issue. Dedup driven by
 * `symptom_hash`. If a matching hash exists in the index, the existing
 * issue's `occurrences` is incremented + `last_occurrence` updated. New
 * tags / metadata from `input` are NOT merged into the existing record
 * (would be surprising behavior; agent should call `update` explicitly).
 */
export function logIssue(projectPath: string, input: LogIssueInput, now: Date = new Date()): LogIssueResult {
  ensureDir(issuesDir(projectPath));
  const symptom_hash = hashSymptom(input.symptom, input.tool, input.exit_code);
  const existing = findBySymptomHash(projectPath, symptom_hash);

  if (existing) {
    const issue = readIssue(projectPath, existing.id);
    if (!issue) throw new Error(`index points at ${existing.id} but file is missing`);
    issue.occurrences += 1;
    issue.last_occurrence = now.toISOString();
    issue.body = appendOccurrenceLine(issue.body, now);
    writeFileSync(issueFilePath(projectPath, issue.id), serializeIssueFile(issue), "utf-8");
    const idx = readIndex(projectPath);
    const at = idx.findIndex((e) => e.id === issue.id);
    if (at >= 0) idx[at] = summary(issue);
    writeIndex(projectPath, idx);
    return { outcome: "appended", id: issue.id, symptom_hash, occurrences: issue.occurrences };
  }

  const id = nextIssueId(projectPath);
  const iso = now.toISOString();
  const issue: Issue = {
    id,
    status: "open",
    symptom_hash,
    tags: input.tags ?? [],
    agent: input.agent ?? "claude-code",
    title: input.title,
    created: iso,
    last_occurrence: iso,
    occurrences: 1,
    tool: input.tool,
    exit_code: input.exit_code,
    body: input.body ?? defaultBody(input),
  };
  writeFileSync(issueFilePath(projectPath, id), serializeIssueFile(issue), "utf-8");
  const idx = readIndex(projectPath);
  idx.push(summary(issue));
  writeIndex(projectPath, idx);
  return { outcome: "created", id, symptom_hash, occurrences: 1 };
}

function defaultBody(input: LogIssueInput): string {
  const sections: string[] = [
    "## Symptom",
    "",
    input.symptom,
    "",
    "## Context",
    "",
  ];
  if (input.tool) sections.push(`- tool: \`${input.tool}\``);
  if (typeof input.exit_code === "number") sections.push(`- exit_code: ${String(input.exit_code)}`);
  sections.push(
    "",
    "## Repro",
    "",
    "_(steps to reproduce — fill in if known)_",
    "",
    "## Investigation log",
    "",
    `- ${new Date().toISOString()} — initial filing`,
    "",
    "## Resolution",
    "",
    "_(filled when status flips to `fixed`)_",
    "",
  );
  return sections.join("\n");
}

function appendOccurrenceLine(body: string, when: Date): string {
  const marker = "## Investigation log";
  const idx = body.indexOf(marker);
  const line = `- ${when.toISOString()} — recurred (auto-incremented)`;
  if (idx < 0) {
    return `${body.trimEnd()}\n\n${marker}\n\n${line}\n`;
  }
  const after = body.slice(idx + marker.length);
  const nextHeaderRel = after.search(/\n##\s/);
  const insertAt = nextHeaderRel < 0 ? body.length : idx + marker.length + nextHeaderRel;
  return `${body.slice(0, insertAt).trimEnd()}\n${line}\n${nextHeaderRel < 0 ? "" : "\n"}${body.slice(insertAt).trimStart()}`;
}

export function updateIssueStatus(
  projectPath: string,
  id: string,
  status: IssueStatus,
  resolution?: string,
): Issue | null {
  const issue = readIssue(projectPath, id);
  if (!issue) return null;
  issue.status = status;
  if (resolution) {
    issue.body = appendResolution(issue.body, resolution);
  }
  writeFileSync(issueFilePath(projectPath, id), serializeIssueFile(issue), "utf-8");
  const idx = readIndex(projectPath);
  const at = idx.findIndex((e) => e.id === id);
  if (at >= 0) idx[at] = summary(issue);
  writeIndex(projectPath, idx);
  return issue;
}

function appendResolution(body: string, resolution: string): string {
  const marker = "## Resolution";
  const idx = body.indexOf(marker);
  if (idx < 0) {
    return `${body.trimEnd()}\n\n${marker}\n\n${resolution}\n`;
  }
  const after = body.slice(idx + marker.length);
  const nextHeaderRel = after.search(/\n##\s/);
  const sectionEnd = nextHeaderRel < 0 ? body.length : idx + marker.length + nextHeaderRel;
  return `${body.slice(0, sectionEnd).trimEnd()}\n\n${resolution}\n${nextHeaderRel < 0 ? "" : "\n"}${body.slice(sectionEnd).trimStart()}`;
}
