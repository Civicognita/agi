/**
 * Bash audit log → issue registry promotion (Wish #21 Slice 6).
 *
 * Backfills the per-project issue registry from `~/.agi/logs/agi-bash-*.jsonl`
 * audit-log entries that match an issue-worthy pattern:
 *   - `blocked === true` — bash policy denied the command (most actionable;
 *     agent tried something the policy stopped, worth knowing about)
 *   - `exit_code !== 0` — command failed (signals a real error, but the
 *     audit log doesn't carry the raw cmd so context is sparse)
 *
 * Entries are grouped by their natural dedup key so the same recurring
 * failure collapses to one candidate; counts roll up. Each surviving
 * group becomes a candidate for `logIssue()` — the symptom-hash inside
 * `logIssue` then auto-increments occurrences on already-filed issues.
 *
 * The bash audit log doesn't capture the raw command (only `cmd_hash`).
 * That limits the symptom string we can build to denial_reason +
 * exit_code + cmd_hash. Future Slice could enrich by capturing the
 * command text into the audit log (separate change in the bash policy
 * surface — out of scope for this slice).
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Single bash audit log entry shape (mirrors what cmd_bash writes). */
export interface BashAuditEntry {
  ts: string;
  caller: string;
  cwd: string;
  cmd_hash: string;
  exit_code: number;
  duration_ms: number;
  stdout_bytes: number;
  stderr_bytes: number;
  blocked: boolean;
  denial_reason: string;
  audit_note: string;
}

/** Grouped candidate (one per `(cmd_hash, blocked, exit_code, denial_reason)`). */
export interface PromotionCandidate {
  cmd_hash: string;
  blocked: boolean;
  exit_code: number;
  denial_reason: string;
  count: number;
  first_ts: string;
  last_ts: string;
  example_caller: string;
  example_cwd: string;
}

export function bashLogDir(): string {
  return join(homedir(), ".agi", "logs");
}

/**
 * List bash audit log files for the last `daysBack` days. Filenames are
 * `agi-bash-YYYY-MM-DD.jsonl`; missing days are skipped silently.
 */
export function listBashLogFiles(daysBack: number, now: Date = new Date()): string[] {
  const dir = bashLogDir();
  if (!existsSync(dir)) return [];
  const wanted = new Set<string>();
  for (let i = 0; i < daysBack; i++) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    wanted.add(`agi-bash-${d.toISOString().slice(0, 10)}.jsonl`);
  }
  const present = readdirSync(dir).filter((f) => wanted.has(f));
  return present.map((f) => join(dir, f)).sort();
}

/** Read all matching entries from a single JSONL file. Tolerates malformed lines. */
function readBashLogFile(path: string): BashAuditEntry[] {
  if (!existsSync(path)) return [];
  const out: BashAuditEntry[] = [];
  const raw = readFileSync(path, "utf-8");
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (parsed && typeof parsed === "object") {
        out.push(parsed as BashAuditEntry);
      }
    } catch {
      // skip malformed line
    }
  }
  return out;
}

/**
 * Walk recent bash logs + return grouped candidates. Default
 * filter: blocked entries OR non-zero-exit entries. Groups identical
 * `(cmd_hash, blocked, exit_code, denial_reason)` so recurring failures
 * collapse.
 */
export function findPromotionCandidates(daysBack: number, now: Date = new Date()): PromotionCandidate[] {
  const groups = new Map<string, PromotionCandidate>();
  for (const file of listBashLogFiles(daysBack, now)) {
    for (const entry of readBashLogFile(file)) {
      if (!entry.blocked && entry.exit_code === 0) continue;
      const key = `${entry.cmd_hash}::${String(entry.blocked)}::${String(entry.exit_code)}::${entry.denial_reason}`;
      const existing = groups.get(key);
      if (existing) {
        existing.count++;
        if (entry.ts > existing.last_ts) existing.last_ts = entry.ts;
        if (entry.ts < existing.first_ts) existing.first_ts = entry.ts;
      } else {
        groups.set(key, {
          cmd_hash: entry.cmd_hash,
          blocked: entry.blocked,
          exit_code: entry.exit_code,
          denial_reason: entry.denial_reason,
          count: 1,
          first_ts: entry.ts,
          last_ts: entry.ts,
          example_caller: entry.caller,
          example_cwd: entry.cwd,
        });
      }
    }
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

/**
 * Build the LogIssueInput payload for a candidate. Caller wraps with
 * `logIssue(projectPath, ...)`. Symptom string is structured so the
 * dedup hash collapses recurring runs of the same blocked pattern.
 */
export interface CandidatePayload {
  title: string;
  symptom: string;
  tool: string;
  exit_code: number;
  tags: string[];
  body: string;
}

export function buildCandidatePayload(c: PromotionCandidate): CandidatePayload {
  const isBlocked = c.blocked;
  const reason = c.denial_reason || (isBlocked ? "(blocked, no reason)" : `exit ${String(c.exit_code)}`);
  const title = isBlocked
    ? `Bash policy blocked: ${reason}`
    : `Bash command failed: ${reason}`;
  const symptom = isBlocked
    ? `denial_reason="${c.denial_reason}" cmd_hash=${c.cmd_hash}`
    : `exit_code=${String(c.exit_code)} cmd_hash=${c.cmd_hash}`;
  const tags = isBlocked
    ? ["bash-blocked", "audit-promoted"]
    : ["bash-failed", "audit-promoted"];
  const body = [
    "## Symptom",
    "",
    title,
    "",
    "## Context",
    "",
    `- caller: \`${c.example_caller}\``,
    `- cwd: \`${c.example_cwd}\``,
    `- cmd_hash: \`${c.cmd_hash}\``,
    `- blocked: ${String(c.blocked)}`,
    `- exit_code: ${String(c.exit_code)}`,
    `- denial_reason: ${c.denial_reason || "(none)"}`,
    "",
    "## Repro",
    "",
    `Triggered ${String(c.count)} times in the bash audit log between ${c.first_ts} and ${c.last_ts}.`,
    "Raw command not captured by the audit log (only `cmd_hash` is stored). To reproduce, search ~/.agi/logs/agi-bash-*.jsonl for the cmd_hash above and check the chat session that originated the call.",
    "",
    "## Investigation log",
    "",
    `- ${new Date().toISOString()} — promoted from bash audit log via \`agi issue from-bash-log\`. ${String(c.count)} occurrences seen.`,
    "",
    "## Resolution",
    "",
    "_(filled when status flips to `fixed`)_",
    "",
  ].join("\n");
  return { title, symptom, tool: "agi-bash", exit_code: c.exit_code, tags, body };
}
