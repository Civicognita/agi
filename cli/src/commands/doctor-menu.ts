/**
 * `agi doctor menu` — Phase 1 of s144 t574 (TUI shell).
 *
 * Owner directive (t574): "interactive `agi doctor` with category menu …
 * Arrow-keys + Enter navigation, Esc to back out." Phase 1 ships the
 * smallest meaningful primitive — a numbered menu read via Node's
 * built-in readline (no ink/blessed dep). The user types a number, hits
 * Enter, the matching sub-command runs once, the menu exits.
 *
 * Phase 2+ adds: arrow-key navigation, sub-menus, looped re-prompt,
 * Esc-to-back. Those slices either pull in a TUI library or implement
 * raw-mode keypress handling. Phase 1 deliberately uses the same
 * readline/promises pattern as setup.ts so Phase 1 is shippable in
 * isolation without dep churn.
 *
 * Routing: each menu item is one of the existing `agi doctor <sub>`
 * surfaces (schema/dump/logs/config/health/run-all). The menu is just
 * navigation — implementations live where they already do.
 */

import { createInterface } from "node:readline/promises";
import { spawnSync } from "node:child_process";

/**
 * Stable id for a menu pick. Each id maps to an `agi doctor <id>` call
 * (or to no-op for `quit`). Keeps the menu→command relation explicit
 * and unit-testable without spinning up a child process.
 */
export type MenuItemId =
  | "run-all"
  | "schema"
  | "dump"
  | "logs"
  | "config-get"
  | "health"
  | "quit";

export interface MenuItem {
  /** Numeric label printed in the menu — 0 reserved for quit. */
  number: number;
  /** Stable id used by routing + tests. */
  id: MenuItemId;
  /** Short label printed alongside the number. */
  label: string;
  /** One-line description shown beneath the label. */
  description: string;
  /** Sub-command args passed to `agi doctor <args>`. Empty for run-all. Empty for quit. */
  args: string[];
}

export const MENU_ITEMS: readonly MenuItem[] = [
  {
    number: 1,
    id: "run-all",
    label: "Run all checks",
    description: "Full grouped diagnostic — every check group end-to-end",
    args: [],
  },
  {
    number: 2,
    id: "schema",
    label: "Validate config schemas",
    description: "Walk every on-disk gateway-loaded config through its Zod schema",
    args: ["schema"],
  },
  {
    number: 3,
    id: "dump",
    label: "Write diagnostic bundle",
    description: "Redacted config + recent logs + check results to ~/.agi/doctor-dumps/",
    args: ["dump"],
  },
  {
    number: 4,
    id: "logs",
    label: "Tail logs + crash-pattern detection",
    description: "Surface known crash patterns (ZodError, EADDRINUSE, OOM, container exit, …)",
    args: ["logs"],
  },
  {
    number: 5,
    id: "config-get",
    label: "Read a gateway.json config key",
    description: "Prompts for the dotted key path and prints the validated value",
    args: ["config", "get"],
  },
  {
    number: 6,
    id: "health",
    label: "Legacy 5-check infra health",
    description: "Node / pnpm / Caddy / podman / hosted-projects / flapping",
    args: ["health"],
  },
  {
    number: 0,
    id: "quit",
    label: "Quit",
    description: "Exit the menu without running anything",
    args: [],
  },
] as const;

/**
 * Resolve a user-typed selection string to a menu item. Pure function
 * — exposed for unit tests so the menu→command mapping is verifiable
 * without a TTY.
 *
 * Accepts the numeric label as a string. Whitespace is trimmed. Returns
 * null for any input that doesn't match a known number.
 */
export function pickMenuItem(input: string): MenuItem | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  if (!Number.isInteger(n)) return null;
  return MENU_ITEMS.find((m) => m.number === n) ?? null;
}

/**
 * Print the menu in a stable, narrow format. Exposed for tests.
 */
export function renderMenu(): string {
  const lines: string[] = [];
  lines.push("");
  lines.push("  agi doctor — diagnostic menu");
  lines.push("");
  for (const item of MENU_ITEMS) {
    const num = String(item.number).padStart(1, " ");
    lines.push(`  ${num}  ${item.label}`);
    lines.push(`     ${item.description}`);
  }
  lines.push("");
  return lines.join("\n");
}

/** Classification of one menu turn's outcome — exposed for unit tests. */
export type MenuTurnOutcome =
  | { kind: "quit" }
  | { kind: "invalid"; raw: string }
  | { kind: "ran"; item: MenuItem };

/**
 * Pure classifier — turn one user input string into a menu-turn outcome.
 * Used by both the interactive loop and the unit tests for invalid /
 * valid / quit branches.
 */
export function classifyMenuTurn(input: string): MenuTurnOutcome {
  const item = pickMenuItem(input);
  if (!item) return { kind: "invalid", raw: input };
  if (item.id === "quit") return { kind: "quit" };
  return { kind: "ran", item };
}

/**
 * Run the menu interactively. Phase 2 (s144 t574, 2026-05-10) — wraps
 * Phase 1's read-once in a while loop so the menu stays open until the
 * user picks Quit (or hits Ctrl-D / Ctrl-C). After each sub-command
 * finishes, prompts "Press Enter to continue…" before re-rendering the
 * menu, so the diagnostic output isn't immediately scrolled away.
 *
 * Spawns the same `agi` binary that's currently running so the routing
 * goes back through the existing CLI surface (bash → TS commander).
 * No reentrancy with this same Node process.
 */
export async function runDoctorMenu(opts?: { agiBin?: string }): Promise<MenuItemId> {
  const bin = opts?.agiBin ?? "agi";
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let lastRan: MenuItemId = "quit";
  try {
    while (true) {
      process.stdout.write(renderMenu());
      let answer: string;
      try {
        answer = await rl.question("  Pick a number (0 to quit): ");
      } catch {
        // EOF / Ctrl-D / Ctrl-C abort — treat as quit.
        process.stdout.write("\n");
        return lastRan;
      }
      const outcome = classifyMenuTurn(answer);
      if (outcome.kind === "quit") {
        process.stdout.write("\n");
        return "quit";
      }
      if (outcome.kind === "invalid") {
        process.stdout.write(`\n  Unknown selection: ${JSON.stringify(answer)}. Try again.\n`);
        continue;
      }
      process.stdout.write("\n");
      spawnSync(bin, ["doctor", ...outcome.item.args], { stdio: "inherit" });
      lastRan = outcome.item.id;
      try {
        await rl.question("\n  Press Enter to continue… ");
      } catch {
        process.stdout.write("\n");
        return lastRan;
      }
    }
  } finally {
    rl.close();
  }
}
