/**
 * Readline prompt helpers for the interactive setup wizard.
 * Uses node:readline/promises (built-in, no external deps).
 */

import type { Interface as ReadlineInterface } from "node:readline/promises";

/** Simple text input with optional default. */
export async function ask(
  rl: ReadlineInterface,
  question: string,
  defaultValue?: string,
): Promise<string> {
  const suffix = defaultValue ? ` (${defaultValue})` : "";
  const answer = await rl.question(`  ${question}${suffix}: `);
  return answer.trim() || defaultValue || "";
}

/**
 * Secret input — uses muted output so the value isn't echoed.
 * Falls back to regular input if stdout manipulation fails.
 */
export async function askSecret(
  rl: ReadlineInterface,
  question: string,
): Promise<string> {
  // Temporarily mute stdout by overriding the readline's write behavior.
  // The readline/promises Interface inherits from readline.Interface which
  // has `output` but the TS types don't expose it, so we cast.
  const rlAny = rl as unknown as { output: NodeJS.WritableStream; _writeToOutput: (s: string) => void };
  const originalWrite = rlAny._writeToOutput;

  let muted = false;
  rlAny._writeToOutput = (s: string): void => {
    if (muted) {
      // Only print asterisks for non-control characters
      if (s && !s.startsWith("\x1b") && s !== "\r" && s !== "\n") {
        rlAny.output.write("*".repeat(s.length));
      } else {
        rlAny.output.write(s);
      }
    } else if (originalWrite) {
      originalWrite.call(rl, s);
    } else {
      rlAny.output.write(s);
    }
  };

  muted = true;
  const answer = await rl.question(`  ${question}: `);
  muted = false;
  rlAny._writeToOutput = originalWrite;

  return answer.trim();
}

/** Yes/No prompt. Returns boolean. */
export async function askYesNo(
  rl: ReadlineInterface,
  question: string,
  defaultYes = true,
): Promise<boolean> {
  const hint = defaultYes ? "Y/n" : "y/N";
  const answer = await rl.question(`  ${question} (${hint}): `);
  const trimmed = answer.trim().toLowerCase();
  if (trimmed === "") return defaultYes;
  return trimmed === "y" || trimmed === "yes";
}

/** Numbered single-select list. Returns selected option value. */
export async function askChoice<T extends string>(
  rl: ReadlineInterface,
  question: string,
  options: Array<{ label: string; value: T }>,
  defaultValue?: T,
): Promise<T> {
  console.log(`  ${question}`);
  const defaultIndex = defaultValue
    ? options.findIndex((o) => o.value === defaultValue)
    : -1;

  for (let i = 0; i < options.length; i++) {
    const marker = i === defaultIndex ? " (default)" : "";
    console.log(`    ${String(i + 1)}. ${options[i]!.label}${marker}`);
  }

  const answer = await rl.question(`  Choice [1-${String(options.length)}]: `);
  const idx = parseInt(answer.trim(), 10) - 1;

  if (idx >= 0 && idx < options.length) return options[idx]!.value;
  if (defaultValue) return defaultValue;
  return options[0]!.value;
}

/** Multi-select with space-separated indices. Returns selected values. */
export async function askMultiSelect<T extends string>(
  rl: ReadlineInterface,
  question: string,
  options: Array<{ label: string; value: T }>,
): Promise<T[]> {
  console.log(`  ${question}`);

  for (let i = 0; i < options.length; i++) {
    console.log(`    ${String(i + 1)}. ${options[i]!.label}`);
  }

  const answer = await rl.question(
    `  Select (space-separated numbers, or empty for none): `,
  );
  const indices = answer
    .trim()
    .split(/[\s,]+/)
    .map((s) => parseInt(s, 10) - 1)
    .filter((i) => i >= 0 && i < options.length);

  return indices.map((i) => options[i]!.value);
}
