/**
 * Minimal cron expression evaluator for iterative-work scheduling.
 *
 * Supports the cadences the loop actually uses today:
 *   - Every N minutes within the hour: "* /N * * * *"
 *   - Specific minutes within the hour: "M,M,M * * * *" (e.g. "8,38 * * * *")
 *   - A single fixed minute every hour: "M * * * *" (e.g. "0 * * * *")
 *
 * Anything else (hour ranges, day-of-week, day-of-month, ranges like 0-30)
 * returns null from `nextFireAfter` — the consumer treats null as
 * "unparseable, skip this project this tick" rather than guessing a wrong
 * cadence. Extend this when a real exotic schedule shows up; failing loud
 * is cheaper than firing silently at the wrong time.
 *
 * Same shape as the bash parser in ~/.claude/statusline-command.sh — both
 * surfaces accept the same minute-field forms so a cron expression that
 * renders correctly on the statusline always evaluates correctly here.
 */

/**
 * Returns the wall-clock time of the next minute at or after `after` when the
 * cron expression's minute field matches. Returns null when the expression
 * uses unsupported syntax (see file header).
 *
 * The minute precision is good enough for the scheduler's tick model — the
 * consumer's tick interval (default 30s) determines real-world latency, not
 * sub-minute cron precision.
 */
export function nextFireAfter(cron: string, after: Date): Date | null {
  const minutes = parseMinuteField(cron);
  if (minutes === null || minutes.length === 0) return null;

  // Walk forward minute-by-minute up to 24h. Bounded so a malformed expression
  // can't infinite-loop the tick.
  const candidate = new Date(after);
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  for (let stepCount = 0; stepCount < 24 * 60; stepCount += 1) {
    if (minutes.includes(candidate.getMinutes())) return candidate;
    candidate.setMinutes(candidate.getMinutes() + 1);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Cadence → staggered cron expression (s118 redesign 2026-04-27, t444 D3)
// ---------------------------------------------------------------------------

import type { IterativeWorkCadence } from "../project-types.js";

/**
 * Deterministic FNV-1a 32-bit hash. Same input → same output, stable across
 * process restarts so a project's stagger offset doesn't drift. Used purely
 * for spreading fire times — not security-sensitive.
 */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  // Convert to unsigned 32-bit.
  return hash >>> 0;
}

/**
 * Convert a user-picked cadence + project path into a 5-field cron expression
 * with a deterministic stagger offset. Two projects with the same cadence get
 * different fire times based on their path hash, avoiding the "every cron
 * fires at :00 and :30" thundering-herd problem owner identified.
 *
 * Stagger strategy by cadence:
 *
 * - **30m**: pick minute m in [0..29] from hash; cron = `${m},${m+30} * * * *`.
 * - **1h**: pick minute m in [0..59] from hash; cron = `${m} * * * *`.
 * - **5h**: pick minute m in [0..59] + hour-offset h in [0..4]; cron =
 *   `${m} ${h},${h+5},${h+10},${h+15},${h+20} * * *` (cron supports up to
 *   24 hour values; stops at the 5-step boundary).
 * - **12h**: pick minute + hour-offset h in [0..11]; cron =
 *   `${m} ${h},${h+12} * * *`.
 * - **1d**: pick minute + hour h in [0..23]; cron = `${m} ${h} * * *`.
 * - **5d**: pick minute + hour + day-of-month offset; cron =
 *   `${m} ${h} ${d},${d+5},...} * *` (caps at 28 to avoid month-boundary
 *   surprises).
 * - **1w**: pick minute + hour + day-of-week d in [0..6]; cron =
 *   `${m} ${h} * * ${d}`.
 *
 * The minute-field cron evaluator (nextFireAfter) only accepts wildcard for
 * fields 2-5, so for cadences that need hour/day-of-month/day-of-week, the
 * scheduler will need an extension. **For now (cycle 61) only 30m and 1h
 * produce expressions evaluable by nextFireAfter — longer cadences are
 * staged for D3 follow-up when the scheduler matures.** The function still
 * returns the full expression; consumers that can't evaluate it handle
 * gracefully (skip-with-warning, per the file header pattern).
 */
export function cadenceToStaggeredCron(cadence: IterativeWorkCadence, projectPath: string): string {
  const h = fnv1a(projectPath);
  const minute = h % 60;

  switch (cadence) {
    case "30m": {
      // Two fires per hour, 30 min apart. Stagger across the half-hour window.
      const m = h % 30;
      return `${String(m)},${String(m + 30)} * * * *`;
    }
    case "1h": {
      return `${String(minute)} * * * *`;
    }
    case "5h": {
      const hourOffset = (h >>> 8) % 5;
      const hours = [hourOffset, hourOffset + 5, hourOffset + 10, hourOffset + 15, hourOffset + 20]
        .filter((hr) => hr < 24)
        .map(String)
        .join(",");
      return `${String(minute)} ${hours} * * *`;
    }
    case "12h": {
      const hourOffset = (h >>> 8) % 12;
      return `${String(minute)} ${String(hourOffset)},${String(hourOffset + 12)} * * *`;
    }
    case "1d": {
      const hour = (h >>> 8) % 24;
      return `${String(minute)} ${String(hour)} * * *`;
    }
    case "5d": {
      const hour = (h >>> 8) % 24;
      const dayOffset = ((h >>> 16) % 5) + 1; // day-of-month 1..28
      const days = [dayOffset, dayOffset + 5, dayOffset + 10, dayOffset + 15, dayOffset + 20, dayOffset + 25]
        .filter((d) => d <= 28)
        .map(String)
        .join(",");
      return `${String(minute)} ${String(hour)} ${days} * *`;
    }
    case "1w": {
      const hour = (h >>> 8) % 24;
      const dayOfWeek = (h >>> 16) % 7;
      return `${String(minute)} ${String(hour)} * * ${String(dayOfWeek)}`;
    }
  }
}

/**
 * Internal: pull the minute-field minute list from a cron expression.
 * Returns null on unsupported syntax. Empty array means "no minutes match
 * within the hour" (also treated as unsupported by the caller).
 */
function parseMinuteField(cron: string): number[] | null {
  const trimmed = cron.trim();
  if (trimmed.length === 0) return null;

  const parts = trimmed.split(/\s+/);
  if (parts.length !== 5) return null;

  // The other four fields must be wildcard for our supported subset.
  if (parts.slice(1).some((p) => p !== "*")) return null;

  const field = parts[0]!;

  if (field === "*") {
    return Array.from({ length: 60 }, (_, i) => i);
  }

  if (field.startsWith("*/")) {
    const stepStr = field.slice(2);
    const step = Number.parseInt(stepStr, 10);
    if (!Number.isFinite(step) || step <= 0 || step > 59 || String(step) !== stepStr) {
      return null;
    }
    const out: number[] = [];
    for (let m = 0; m < 60; m += step) out.push(m);
    return out;
  }

  // Comma-separated minutes or a single minute.
  const tokens = field.split(",");
  const out: number[] = [];
  for (const tok of tokens) {
    const n = Number.parseInt(tok, 10);
    if (!Number.isFinite(n) || n < 0 || n > 59 || String(n) !== tok) return null;
    out.push(n);
  }
  out.sort((a, b) => a - b);
  return out;
}
