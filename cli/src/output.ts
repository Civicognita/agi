/**
 * CLI output formatting — tables, status indicators, and styled text.
 */

/** ANSI color codes */
const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
} as const;

export function green(s: string): string { return `${c.green}${s}${c.reset}`; }
export function yellow(s: string): string { return `${c.yellow}${s}${c.reset}`; }
export function red(s: string): string { return `${c.red}${s}${c.reset}`; }
export function cyan(s: string): string { return `${c.cyan}${s}${c.reset}`; }
export function bold(s: string): string { return `${c.bold}${s}${c.reset}`; }
export function dim(s: string): string { return `${c.dim}${s}${c.reset}`; }

/** Print a formatted table to stdout */
export function printTable(headers: string[], rows: string[][]): void {
  const widths = headers.map((h, i) => {
    const colValues = rows.map(r => r[i] ?? "");
    return Math.max(h.length, ...colValues.map(v => stripAnsi(v).length));
  });

  const sep = widths.map(w => "─".repeat(w + 2)).join("┼");
  const headerLine = headers.map((h, i) => ` ${pad(h, widths[i] ?? 0)} `).join("│");

  console.log(dim(`┌${"─".repeat(sep.length)}┐`));
  console.log(`│${bold(headerLine)}│`);
  console.log(dim(`├${sep}┤`));

  for (const row of rows) {
    const line = headers.map((_, i) => {
      const val = row[i] ?? "";
      const w = widths[i] ?? 0;
      return ` ${pad(val, w)} `;
    }).join("│");
    console.log(`│${line}│`);
  }

  console.log(dim(`└${"─".repeat(sep.length)}┘`));
}

/** Print a key-value status block */
export function printStatus(entries: Array<{ label: string; value: string }>): void {
  const maxLabel = Math.max(...entries.map(e => e.label.length));

  for (const { label, value } of entries) {
    console.log(`  ${dim(label.padEnd(maxLabel))}  ${value}`);
  }
}

/** Format a BAIF state with color */
export function formatState(state: string): string {
  switch (state.toUpperCase()) {
    case "ONLINE": return green("● ONLINE");
    case "LIMBO": return yellow("◐ LIMBO");
    case "OFFLINE": return red("○ OFFLINE");
    default: return dim("? UNKNOWN");
  }
}

/** Format a boolean check result */
export function formatCheck(ok: boolean, label: string): string {
  return ok ? `${green("✓")} ${label}` : `${red("✗")} ${label}`;
}

/** Pad a string accounting for ANSI escape codes */
function pad(s: string, width: number): string {
  const visible = stripAnsi(s).length;
  return s + " ".repeat(Math.max(0, width - visible));
}

/** Strip ANSI escape codes for width calculation */
function stripAnsi(s: string): string {
  // oxlint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}
