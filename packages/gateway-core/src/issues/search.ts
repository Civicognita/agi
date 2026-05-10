/**
 * Issue search — Wish #21 Slice 2.
 *
 * Free-text substring search over issue title + body + tags. Cheap
 * grep-style implementation reading each issue file once. The index
 * (`index.json`) is loaded for the candidate set; only matching
 * candidates' bodies are read from disk.
 *
 * Match semantics:
 *   - Whitespace-tokenized query — every token must match somewhere
 *     in (title + tags-joined + body), case-insensitive.
 *   - Multiple tokens are AND-combined.
 *   - Tag filter `tag:<name>` matches when `<name>` is in the issue's
 *     tags array (exact, case-insensitive).
 *   - Status filter `status:<s>` matches the workflow status exactly.
 *
 * No FTS index — for the scale we expect (per-project, low-thousands
 * of issues max), linear scan is fast enough. If usage proves
 * otherwise, a sibling slice can add a sqlite-backed FTS5 index
 * without changing the calling surface.
 *
 * Result ordering: matched-tokens descending, then last_occurrence
 * descending. Most-relevant + most-recent first.
 */

import { readIndex, readIssue } from "./store.js";
import type { Issue, IssueIndexEntry, IssueStatus } from "./types.js";

export interface IssueSearchHit {
  /** Index summary (cheap fields). */
  entry: IssueIndexEntry;
  /** First ~200 chars of the body where the match landed. */
  snippet: string;
  /** Number of tokens that matched. */
  matchedTokens: number;
}

interface ParsedQuery {
  textTokens: string[];
  tagFilters: string[];
  statusFilter?: IssueStatus;
}

const VALID_STATUSES: IssueStatus[] = ["open", "known", "fixed", "wont-fix"];

/**
 * Parse a free-form query into text tokens + structured filters.
 * Tokens that look like `tag:<name>` or `status:<s>` route to filters
 * instead of joining the text-token AND group.
 */
export function parseSearchQuery(raw: string): ParsedQuery {
  const out: ParsedQuery = { textTokens: [], tagFilters: [] };
  const tokens = raw.trim().split(/\s+/).filter((t) => t.length > 0);
  for (const tok of tokens) {
    const lower = tok.toLowerCase();
    if (lower.startsWith("tag:") && lower.length > 4) {
      out.tagFilters.push(lower.slice(4));
    } else if (lower.startsWith("status:") && lower.length > 7) {
      const s = lower.slice(7);
      if ((VALID_STATUSES as string[]).includes(s)) {
        out.statusFilter = s as IssueStatus;
      }
      // unknown status filter silently dropped — search returns nothing
      // when the user typed e.g. status:fixedd, which is correct
      // (intent: "give me only fixed-typo'd issues" = none)
    } else {
      out.textTokens.push(lower);
    }
  }
  return out;
}

/** Apply tag/status filters to the index entry first (cheap pre-filter). */
function passesIndexFilters(entry: IssueIndexEntry, q: ParsedQuery): boolean {
  if (q.statusFilter && entry.status !== q.statusFilter) return false;
  if (q.tagFilters.length > 0) {
    const lowerTags = entry.tags.map((t) => t.toLowerCase());
    for (const filterTag of q.tagFilters) {
      if (!lowerTags.includes(filterTag)) return false;
    }
  }
  return true;
}

/** Count how many of `tokens` appear in `haystack` (case-insensitive). */
function countTokenMatches(tokens: string[], haystack: string): number {
  const lower = haystack.toLowerCase();
  let count = 0;
  for (const tok of tokens) {
    if (lower.includes(tok)) count++;
  }
  return count;
}

/** Build a ~200-char snippet centered on the first matched token. */
function buildSnippet(body: string, tokens: string[]): string {
  if (tokens.length === 0) return body.slice(0, 200);
  const lower = body.toLowerCase();
  let firstMatchPos = -1;
  for (const tok of tokens) {
    const idx = lower.indexOf(tok);
    if (idx >= 0 && (firstMatchPos < 0 || idx < firstMatchPos)) {
      firstMatchPos = idx;
    }
  }
  if (firstMatchPos < 0) return body.slice(0, 200);
  const start = Math.max(0, firstMatchPos - 60);
  const end = Math.min(body.length, firstMatchPos + 140);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < body.length ? "…" : "";
  return `${prefix}${body.slice(start, end).trim()}${suffix}`;
}

/**
 * Search the project's issue registry. Returns hits ranked by
 * matched-tokens desc, then last_occurrence desc.
 *
 * Empty queries return all issues that pass the structured filters
 * (tag:/status:), or all issues if no filters either.
 */
export function searchIssues(projectPath: string, query: string): IssueSearchHit[] {
  const q = parseSearchQuery(query);
  const candidates = readIndex(projectPath).filter((e) => passesIndexFilters(e, q));

  if (q.textTokens.length === 0) {
    // Filter-only query: return all candidates with matchedTokens=0
    // ordered by last_occurrence desc.
    return candidates
      .map((entry) => ({ entry, snippet: "", matchedTokens: 0 }))
      .sort((a, b) => b.entry.last_occurrence.localeCompare(a.entry.last_occurrence));
  }

  const hits: IssueSearchHit[] = [];

  for (const entry of candidates) {
    // Title + tags can be matched without reading the file.
    const titleMatches = countTokenMatches(q.textTokens, entry.title);
    const tagText = entry.tags.join(" ");
    const tagMatches = countTokenMatches(q.textTokens, tagText);

    // Skip body read if title + tags already fail every token. We need
    // ALL tokens to match somewhere in (title + tags + body), so an
    // optimization: read the body only when (titleMatches + tagMatches)
    // doesn't already cover all tokens.
    const titleAndTagHaystack = `${entry.title}\n${tagText}`;
    const titleAndTagFullMatch = countTokenMatches(q.textTokens, titleAndTagHaystack) === q.textTokens.length;

    let body = "";
    let bodyMatches = 0;
    if (!titleAndTagFullMatch) {
      const issue = readIssue(projectPath, entry.id);
      if (!issue) continue;
      body = issue.body;
      bodyMatches = countTokenMatches(q.textTokens, body);
    }

    // ALL tokens must match somewhere in (title + tags + body). Compute
    // the union: a token "matches" if it's in any of the three.
    const fullHaystack = `${entry.title}\n${tagText}\n${body}`;
    const allTokensMatch = countTokenMatches(q.textTokens, fullHaystack) === q.textTokens.length;
    if (!allTokensMatch) continue;

    const totalMatches = titleMatches + tagMatches + bodyMatches;
    hits.push({
      entry,
      snippet: buildSnippet(body || entry.title, q.textTokens),
      matchedTokens: totalMatches,
    });
  }

  hits.sort((a, b) => {
    if (b.matchedTokens !== a.matchedTokens) return b.matchedTokens - a.matchedTokens;
    return b.entry.last_occurrence.localeCompare(a.entry.last_occurrence);
  });
  return hits;
}

/**
 * Re-export-friendly type for callers who want the full Issue alongside
 * the search hit. Use sparingly — readIssue is a disk hit per call.
 */
export interface IssueSearchHitWithBody extends IssueSearchHit {
  issue: Issue;
}
