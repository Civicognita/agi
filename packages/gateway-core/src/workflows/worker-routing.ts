/**
 * Worker Routing Workflow
 *
 * Parses worker emissions, validates task permissions against
 * entity tiers, suggests workers based on keyword heuristics, and
 * formats dispatch reports.
 *
 * Pure synchronous logic -- no API calls, no side effects.
 */

import type { VerificationTier } from "@agi/entity-model";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkerTask {
  /** Human-readable description of the task. */
  description: string;
  /** Worker domain (e.g., "code", "k", "ux", "strat"). */
  domain: string;
  /** Specific worker within the domain (e.g., "engineer", "hacker"). */
  worker: string;
  /** Task priority. */
  priority: "low" | "normal" | "high" | "critical";
}

export interface WorkerDispatchResult {
  /** Tasks that were successfully dispatched. */
  dispatched: WorkerTask[];
  /** Tasks that were rejected (with reasons). */
  rejected: Array<{ task: WorkerTask; reason: string }>;
}

// ---------------------------------------------------------------------------
// Worker domain mapping
// Worker → domain/worker name mapping registry (keyword heuristic driven)
// ---------------------------------------------------------------------------

interface WorkerMapping {
  domain: string;
  worker: string;
  keywords: RegExp;
}

const WORKER_MAPPINGS: readonly WorkerMapping[] = [
  // code domain
  { domain: "code", worker: "engineer", keywords: /\b(implement|build|create|develop|scaffold|wire)\b/i },
  { domain: "code", worker: "hacker", keywords: /\b(hack|prototype|spike|experiment|quick.?fix)\b/i },
  { domain: "code", worker: "reviewer", keywords: /\b(review|audit code|check code|inspect|pr review)\b/i },
  { domain: "code", worker: "tester", keywords: /\b(test|spec|coverage|assertion|vitest|jest)\b/i },

  // knowledge domain
  { domain: "k", worker: "analyst", keywords: /\b(analy[sz]e|research|investigate|assess|evaluate)\b/i },
  { domain: "k", worker: "cryptologist", keywords: /\b(encrypt|decrypt|hash|sign|verify|crypto|certificate)\b/i },
  { domain: "k", worker: "librarian", keywords: /\b(catalog|index|archive|organize|classify|tag)\b/i },
  { domain: "k", worker: "linguist", keywords: /\b(translate|i18n|locale|language|locali[sz]ation|naming)\b/i },

  // ux domain
  { domain: "ux", worker: "designer.web", keywords: /\b(ui|ux|design|layout|component|css|style|frontend)\b/i },
  { domain: "ux", worker: "designer.cli", keywords: /\b(cli|terminal|console|command.?line|prompt)\b/i },

  // strategy domain
  { domain: "strat", worker: "planner", keywords: /\b(plan|roadmap|strategy|phase|milestone|schedule)\b/i },
  { domain: "strat", worker: "prioritizer", keywords: /\b(prioriti[sz]e|rank|triage|backlog|sort|order)\b/i },

  // communication domain
  { domain: "comm", worker: "writer.tech", keywords: /\b(document|readme|api doc|jsdoc|write.*doc|technical writing)\b/i },
  { domain: "comm", worker: "writer.policy", keywords: /\b(policy|governance|terms|compliance|regulation)\b/i },
  { domain: "comm", worker: "editor", keywords: /\b(edit|proofread|revise|grammar|style guide)\b/i },

  // operations domain
  { domain: "ops", worker: "deployer", keywords: /\b(deploy|ci.?cd|pipeline|release|ship|publish)\b/i },
  { domain: "ops", worker: "custodian", keywords: /\b(maintain|cleanup|housekeep|deprecat|remove unused)\b/i },
  { domain: "ops", worker: "syncer", keywords: /\b(sync|replicate|mirror|backup|restore)\b/i },

  // governance domain
  { domain: "gov", worker: "auditor", keywords: /\b(audit|compliance|check|verify compliance|inspect)\b/i },
  { domain: "gov", worker: "archivist", keywords: /\b(archive|preserve|record|log|history|retain)\b/i },

  // data domain
  { domain: "data", worker: "modeler", keywords: /\b(model|schema|entity|data.*model|database design)\b/i },
  { domain: "data", worker: "migrator", keywords: /\b(migrat|upgrade.*schema|alter.*table|transform data)\b/i },
];

// ---------------------------------------------------------------------------
// Tier permission rules
// ---------------------------------------------------------------------------

/**
 * Domains accessible at each verification tier.
 * Controls which worker domains an entity can dispatch to.
 *
 * - unverified: only knowledge lookups (analyst, librarian)
 * - verified: code, knowledge, ux, communication, data
 * - sealed: all domains
 */
const TIER_ALLOWED_DOMAINS: Record<VerificationTier, ReadonlySet<string>> = {
  unverified: new Set(["k"]),
  verified: new Set(["code", "k", "ux", "comm", "data"]),
  sealed: new Set(["code", "k", "ux", "strat", "comm", "ops", "gov", "data"]),
};

// ---------------------------------------------------------------------------
// Emission parsing
// ---------------------------------------------------------------------------

/**
 * Parse a worker emission line (e.g., `q:> implement auth module`).
 *
 * Returns null if the emission does not match the expected pattern.
 */
export function parseWorkerEmission(emission: string): WorkerTask | null {
  const match = /^q:>\s+(.+)$/.exec(emission.trim());
  if (match?.[1] === undefined) return null;

  const description = match[1].trim();
  if (description.length === 0) return null;

  const { domain, worker } = suggestWorker(description);

  // Extract priority from description if annotated
  const priority = extractPriority(description);

  return { description, domain, worker, priority };
}

// ---------------------------------------------------------------------------
// Priority extraction
// ---------------------------------------------------------------------------

function extractPriority(text: string): WorkerTask["priority"] {
  if (/\b(critical|urgent|emergency|p0)\b/i.test(text)) return "critical";
  if (/\b(high|important|p1)\b/i.test(text)) return "high";
  if (/\b(low|minor|p3)\b/i.test(text)) return "low";
  return "normal";
}

// ---------------------------------------------------------------------------
// Permission validation
// ---------------------------------------------------------------------------

/**
 * Check whether an entity at the given verification tier is permitted
 * to dispatch a worker task to the specified domain.
 */
export function validateTaskPermissions(
  task: WorkerTask,
  entityTier: VerificationTier,
): boolean {
  const allowed = TIER_ALLOWED_DOMAINS[entityTier];
  return allowed.has(task.domain);
}

// ---------------------------------------------------------------------------
// Worker suggestion
// ---------------------------------------------------------------------------

/**
 * Suggest a worker domain and worker name based on keyword
 * heuristic analysis of the task description.
 *
 * Falls back to `code/engineer` if no keywords match.
 */
export function suggestWorker(description: string): { domain: string; worker: string } {
  for (const mapping of WORKER_MAPPINGS) {
    if (mapping.keywords.test(description)) {
      return { domain: mapping.domain, worker: mapping.worker };
    }
  }

  // Default fallback
  return { domain: "code", worker: "engineer" };
}

// ---------------------------------------------------------------------------
// Dispatch report formatting
// ---------------------------------------------------------------------------

/**
 * Format a worker dispatch result into a human-readable report.
 */
export function formatDispatchReport(result: WorkerDispatchResult): string {
  const lines: string[] = [];

  lines.push("## Worker Dispatch Report");
  lines.push("");

  if (result.dispatched.length > 0) {
    lines.push(`### Dispatched (${String(result.dispatched.length)})`);
    lines.push("");
    for (const task of result.dispatched) {
      lines.push(`- [${task.domain}/${task.worker}] (${task.priority}) ${task.description}`);
    }
    lines.push("");
  }

  if (result.rejected.length > 0) {
    lines.push(`### Rejected (${String(result.rejected.length)})`);
    lines.push("");
    for (const entry of result.rejected) {
      lines.push(`- ${entry.task.description}`);
      lines.push(`  Reason: ${entry.reason}`);
    }
    lines.push("");
  }

  if (result.dispatched.length === 0 && result.rejected.length === 0) {
    lines.push("No tasks to report.");
    lines.push("");
  }

  return lines.join("\n");
}
