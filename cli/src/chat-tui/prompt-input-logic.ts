/**
 * Pure logic for `PromptInput` — the key→buffer-action mapping (i-004) and
 * the caret-visibility display model (i-005) — extracted so both can be
 * unit-tested with no Ink rendering, matching this codebase's convention
 * (see chat-session-reducer, realtalk-reader). `PromptInput.tsx` is a thin
 * Ink binding over these.
 */

import type { BufferAction } from "@particle-academy/fancy-tui";

/** Structural subset of Ink's `Key` that the prompt keymap actually reads. */
export interface PromptKey {
  leftArrow: boolean;
  rightArrow: boolean;
  upArrow: boolean;
  downArrow: boolean;
  backspace: boolean;
  delete: boolean;
  return: boolean;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
}

/** What a keypress resolves to in the prompt. */
export type PromptKeyResult =
  | { kind: "action"; action: BufferAction }
  | { kind: "submit" }
  | { kind: "newline" }
  | { kind: "ignore" };

/**
 * Map a keypress to a prompt action. Pure — no state, no side effects.
 *
 * - Enter submits; Alt+Enter always inserts a newline, Shift+Enter inserts
 *   one only when the terminal reports enhanced-keyboard support
 *   (`shiftEnterSupported`), mirroring fancy-tui's own MultilineInput.
 * - Arrow keys move the cursor via reduceTextBuffer actions — this is the
 *   fix for i-004 (fancy-tui's Composer dropped these).
 * - Ctrl+A / Ctrl+E jump to line home/end.
 * - Any other printable char inserts; control/meta chords (Ctrl+C etc.) are
 *   ignored here so they reach App's own handler.
 */
export function mapKeyToPromptAction(input: string, key: PromptKey, shiftEnterSupported: boolean): PromptKeyResult {
  if (key.return) {
    if (key.meta || (key.shift && shiftEnterSupported)) return { kind: "newline" };
    return { kind: "submit" };
  }
  if (key.leftArrow) return { kind: "action", action: { type: "left" } };
  if (key.rightArrow) return { kind: "action", action: { type: "right" } };
  if (key.upArrow) return { kind: "action", action: { type: "up" } };
  if (key.downArrow) return { kind: "action", action: { type: "down" } };
  if (key.backspace) return { kind: "action", action: { type: "backspace" } };
  if (key.delete) return { kind: "action", action: { type: "delete" } };
  if (key.ctrl && input === "a") return { kind: "action", action: { type: "home" } };
  if (key.ctrl && input === "e") return { kind: "action", action: { type: "end" } };
  if (!key.ctrl && !key.meta && input) return { kind: "action", action: { type: "insert", text: input } };
  return { kind: "ignore" };
}

/** Bar caret glyph — same one fancy-tui's MultilineInput uses. */
export const CARET = "▌";

export interface PromptSegment {
  text: string;
  /** True for the dim placeholder text. */
  dim?: boolean;
}

/**
 * The ordered text segments the prompt renders. The core of the i-005 fix:
 * when focused, the caret (`CARET`) always appears — including on empty
 * input, where fancy-tui's MultilineInput showed only the placeholder.
 */
export function promptSegments(value: string, offset: number, isFocused: boolean, placeholder: string): PromptSegment[] {
  const o = Math.max(0, Math.min(value.length, offset));
  if (value.length === 0) {
    return isFocused
      ? [{ text: CARET }, { text: placeholder, dim: true }]
      : [{ text: placeholder, dim: true }];
  }
  return isFocused
    ? [{ text: `${value.slice(0, o)}${CARET}${value.slice(o)}` }]
    : [{ text: value }];
}
