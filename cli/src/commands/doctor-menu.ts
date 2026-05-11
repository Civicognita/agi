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

// ---------------------------------------------------------------------------
// Phase 3a — arrow-key keypress state machine (pure logic; s144 t574)
//
// The interactive raw-mode wrapper that consumes this state machine lands in
// Phase 3b. Keeping the byte-sequence → action mapping as a pure function
// means the keymap is testable without a TTY fixture, and the wrapper code
// stays a thin adapter over stdin's data event.
//
// Byte sequences recognized:
//   "\x1b[A" — up arrow
//   "\x1b[B" — down arrow
//   "\r" or "\n" — Enter (commit current selection)
//   "0".."9" — direct numeric jump (matches a MenuItem.number)
//   "\x1b" (alone, immediate) — Escape (quit). Escape sequences for arrows
//     start with "\x1b" too — the wrapper distinguishes by reading the
//     follow-up bytes within a short timeout.
//   "\x03" — Ctrl-C (quit, mirrors EOF semantics from Phase 2)
//   "q", "Q" — letter quit (defensive; some terminals don't pass Esc cleanly)
//
// The state machine doesn't own the timeout-based Esc disambiguation — that's
// the wrapper's job. The pure function classifies finished sequences only.
// ---------------------------------------------------------------------------

export interface MenuKeyState {
  /** Index into MENU_ITEMS for the currently-highlighted entry. */
  selectedIndex: number;
}

/** Action emitted by the state machine for one finished keypress sequence. */
export type MenuKeyAction =
  | { kind: "noop" }
  | { kind: "move"; newSelectedIndex: number }
  | { kind: "commit"; item: MenuItem }
  | { kind: "quit" };

/**
 * Initialize the menu state. Default selection lands on the first non-quit
 * item (i.e., the most prominent "Run all checks" option).
 */
export function initialMenuState(): MenuKeyState {
  const idx = MENU_ITEMS.findIndex((m) => m.id !== "quit");
  return { selectedIndex: idx < 0 ? 0 : idx };
}

/**
 * Apply one finished key sequence to the menu state. Returns the action the
 * wrapper should take (no-op / move highlight / commit selection / quit).
 *
 * Bounds the selectedIndex within MENU_ITEMS — wrapping at both ends so
 * the menu feels predictable on long lists. Up/down skip nothing; even if
 * the highlight lands on Quit, that's a valid commit (== quit).
 */
export function applyMenuKey(state: MenuKeyState, key: string): MenuKeyAction {
  if (key === "\x1b" || key === "q" || key === "Q" || key === "\x03") {
    return { kind: "quit" };
  }
  if (key === "\x1b[A") {
    const next = (state.selectedIndex - 1 + MENU_ITEMS.length) % MENU_ITEMS.length;
    return { kind: "move", newSelectedIndex: next };
  }
  if (key === "\x1b[B") {
    const next = (state.selectedIndex + 1) % MENU_ITEMS.length;
    return { kind: "move", newSelectedIndex: next };
  }
  if (key === "\r" || key === "\n") {
    const item = MENU_ITEMS[state.selectedIndex];
    if (!item) return { kind: "noop" };
    if (item.id === "quit") return { kind: "quit" };
    return { kind: "commit", item };
  }
  // Numeric jump: "0".."9" hops the highlight to that MenuItem.number.
  if (/^\d$/.test(key)) {
    const n = Number(key);
    const targetIdx = MENU_ITEMS.findIndex((m) => m.number === n);
    if (targetIdx < 0) return { kind: "noop" };
    return { kind: "move", newSelectedIndex: targetIdx };
  }
  return { kind: "noop" };
}

/**
 * Detect whether the current process can support arrow-key TTY navigation.
 * False when stdin isn't a TTY (piped input, CI, non-interactive shell).
 * The interactive wrapper falls back to the Phase 2 numbered-input flow
 * when this returns false.
 */
export function canUseRawTty(): boolean {
  return process.stdin.isTTY === true;
}

/**
 * Render the menu with an arrow-key highlight marker. Pure function —
 * the interactive wrapper calls it on every state change.
 *
 * Exposed for testability. The interactive wrapper is responsible for
 * clearing the screen / repositioning the cursor between renders.
 */
export function renderArrowMenu(state: MenuKeyState): string {
  const lines: string[] = [];
  lines.push("");
  lines.push("  agi doctor — diagnostic menu (arrow keys to navigate, Enter to select, Esc/q to quit)");
  lines.push("");
  MENU_ITEMS.forEach((item, idx) => {
    const num = String(item.number).padStart(1, " ");
    const marker = idx === state.selectedIndex ? "▶ " : "  ";
    lines.push(`  ${marker}${num}  ${item.label}`);
    lines.push(`       ${item.description}`);
  });
  lines.push("");
  return lines.join("\n");
}

/**
 * Arrow-key TUI wrapper around the state machine. Phase 3b — consumes
 * `applyMenuKey` and emits raw-mode reads. Falls back to the Phase 2
 * numbered loop when stdin isn't a TTY.
 *
 * Limitations (Phase 3b ships these; Phase 3c+ may polish):
 *   - No timeout-based Esc disambiguation. Standalone Esc quits
 *     immediately; arrow keys (also start with \x1b) are recognized
 *     when the wrapper receives the full 3-byte sequence in one chunk
 *     (the common case for terminal input).
 *   - Sub-command spawning: raw mode is dropped during spawnSync and
 *     restored on return. The next render redraws the menu.
 *   - No screen-clear between renders — the menu accumulates on stdout.
 *     Acceptable for the early-2026 TUI; cleaner rendering follows.
 */
export async function runArrowKeyMenu(opts?: { agiBin?: string }): Promise<MenuItemId> {
  if (!canUseRawTty()) {
    // Non-TTY (piped, CI) — fall back to Phase 2 numbered loop.
    return runDoctorMenu(opts);
  }
  const bin = opts?.agiBin ?? "agi";
  const stdin = process.stdin;
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");

  let state = initialMenuState();
  let lastResolution: MenuItemId = "quit";

  function render(): void {
    process.stdout.write(renderArrowMenu(state));
  }

  return new Promise<MenuItemId>((resolve) => {
    function cleanup(): void {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
    }

    function onData(key: string): void {
      const action = applyMenuKey(state, key);
      switch (action.kind) {
        case "quit": {
          cleanup();
          process.stdout.write("\n");
          resolve("quit");
          return;
        }
        case "move": {
          state = { selectedIndex: action.newSelectedIndex };
          render();
          return;
        }
        case "commit": {
          // Suspend raw-mode + data listener while the child runs with
          // inherit stdio. spawnSync blocks the event loop, which is what
          // we want — no risk of overlapping menu input.
          stdin.setRawMode(false);
          stdin.removeListener("data", onData);
          process.stdout.write("\n");
          spawnSync(bin, ["doctor", ...action.item.args], { stdio: "inherit" });
          lastResolution = action.item.id;
          stdin.setRawMode(true);
          stdin.on("data", onData);
          render();
          return;
        }
        case "noop":
        default:
          return;
      }
    }

    stdin.on("data", onData);
    render();
    // Resolution is owned by the quit handler in onData; if stdin closes
    // unexpectedly the lastResolution value tracks the most recent commit.
    stdin.once("end", () => {
      cleanup();
      resolve(lastResolution);
    });
  });
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
