/**
 * Issue registry — Wish #21. Public barrel.
 */

export type {
  Issue,
  IssueAgent,
  IssueFrontmatter,
  IssueIndexEntry,
  IssueStatus,
  LogIssueInput,
  LogIssueResult,
} from "./types.js";

export { hashSymptom, normalizeSymptom } from "./symptom-hash.js";

export {
  findBySymptomHash,
  issuesDir,
  listIssues,
  logIssue,
  nextIssueId,
  parseIssueFile,
  readIndex,
  readIssue,
  updateIssueStatus,
} from "./store.js";

export type { IssueSearchHit, IssueSearchHitWithBody } from "./search.js";
export { parseSearchQuery, searchIssues } from "./search.js";
