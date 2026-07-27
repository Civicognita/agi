/**
 * PromptInput pure logic — the key→action mapping (i-004: arrow keys must
 * move the cursor) and the caret-visibility model (i-005: caret shows on
 * empty focused input). Tested with no Ink rendering.
 */

import { describe, it, expect } from "vitest";
import { reduceTextBuffer, createTextBuffer } from "@particle-academy/fancy-tui";
import { mapKeyToPromptAction, promptSegments, CARET, type PromptKey } from "./prompt-input-logic.js";

function key(overrides: Partial<PromptKey> = {}): PromptKey {
  return {
    leftArrow: false, rightArrow: false, upArrow: false, downArrow: false,
    backspace: false, delete: false, return: false, ctrl: false, meta: false, shift: false,
    ...overrides,
  };
}

describe("mapKeyToPromptAction — i-004 (arrow keys move the cursor)", () => {
  it("maps each arrow key to its buffer-navigation action", () => {
    expect(mapKeyToPromptAction("", key({ leftArrow: true }), false)).toEqual({ kind: "action", action: { type: "left" } });
    expect(mapKeyToPromptAction("", key({ rightArrow: true }), false)).toEqual({ kind: "action", action: { type: "right" } });
    expect(mapKeyToPromptAction("", key({ upArrow: true }), false)).toEqual({ kind: "action", action: { type: "up" } });
    expect(mapKeyToPromptAction("", key({ downArrow: true }), false)).toEqual({ kind: "action", action: { type: "down" } });
  });

  it("a left arrow actually moves the cursor when fed through reduceTextBuffer (the end-to-end i-004 path)", () => {
    const start = createTextBuffer("hello"); // cursor at offset 5 (end)
    const result = mapKeyToPromptAction("", key({ leftArrow: true }), false);
    expect(result.kind).toBe("action");
    if (result.kind !== "action") throw new Error("unreachable");
    const moved = reduceTextBuffer(start, result.action);
    expect(moved.cursor.offset).toBe(4); // moved left from 5 → 4
  });

  it("maps backspace/delete and Ctrl+A/Ctrl+E", () => {
    expect(mapKeyToPromptAction("", key({ backspace: true }), false)).toEqual({ kind: "action", action: { type: "backspace" } });
    expect(mapKeyToPromptAction("", key({ delete: true }), false)).toEqual({ kind: "action", action: { type: "delete" } });
    expect(mapKeyToPromptAction("a", key({ ctrl: true }), false)).toEqual({ kind: "action", action: { type: "home" } });
    expect(mapKeyToPromptAction("e", key({ ctrl: true }), false)).toEqual({ kind: "action", action: { type: "end" } });
  });

  it("inserts printable characters and ignores control chords like Ctrl+C", () => {
    expect(mapKeyToPromptAction("x", key(), false)).toEqual({ kind: "action", action: { type: "insert", text: "x" } });
    expect(mapKeyToPromptAction("c", key({ ctrl: true }), false)).toEqual({ kind: "ignore" });
  });
});

describe("mapKeyToPromptAction — Enter / newline", () => {
  it("Enter submits", () => {
    expect(mapKeyToPromptAction("", key({ return: true }), false)).toEqual({ kind: "submit" });
  });

  it("Alt+Enter always inserts a newline", () => {
    expect(mapKeyToPromptAction("", key({ return: true, meta: true }), false)).toEqual({ kind: "newline" });
  });

  it("Shift+Enter inserts a newline only when enhanced keyboard is supported", () => {
    expect(mapKeyToPromptAction("", key({ return: true, shift: true }), false)).toEqual({ kind: "submit" });
    expect(mapKeyToPromptAction("", key({ return: true, shift: true }), true)).toEqual({ kind: "newline" });
  });
});

describe("promptSegments — i-005 (caret visible on empty focused input)", () => {
  it("shows the caret before the placeholder when empty AND focused", () => {
    const segs = promptSegments("", 0, true, "Message…");
    expect(segs).toEqual([{ text: CARET }, { text: "Message…", dim: true }]);
  });

  it("shows only the dim placeholder when empty and NOT focused (no stray caret)", () => {
    expect(promptSegments("", 0, false, "Message…")).toEqual([{ text: "Message…", dim: true }]);
  });

  it("places the caret at the cursor offset within non-empty focused text", () => {
    expect(promptSegments("hello", 2, true, "")).toEqual([{ text: `he${CARET}llo` }]);
  });

  it("renders plain text with no caret when non-empty and NOT focused", () => {
    expect(promptSegments("hello", 2, false, "")).toEqual([{ text: "hello" }]);
  });

  it("clamps an out-of-range offset", () => {
    expect(promptSegments("hi", 99, true, "")).toEqual([{ text: `hi${CARET}` }]);
  });
});
