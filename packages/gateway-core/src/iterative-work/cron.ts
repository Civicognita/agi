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
