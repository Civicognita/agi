/**
 * message-viewport — pure windowing math for the scrollable message pane
 * (i-006). Tested with no rendering.
 */

import { describe, it, expect } from "vitest";
import { computeViewportWindow, clampScroll } from "./message-viewport.js";

describe("clampScroll", () => {
  it("clamps into [0, total-1]", () => {
    expect(clampScroll(-3, 10)).toBe(0);
    expect(clampScroll(5, 10)).toBe(5);
    expect(clampScroll(99, 10)).toBe(9);
    expect(clampScroll(2, 0)).toBe(0);
    expect(clampScroll(Number.NaN, 10)).toBe(0);
  });
});

describe("computeViewportWindow", () => {
  it("follows the latest at scrollUp=0 — newest message is the window's end", () => {
    const w = computeViewportWindow(20, 8, 0);
    expect(w.endIndex).toBe(20);
    expect(w.startIndex).toBe(12);
    expect(w.atBottom).toBe(true);
    expect(w.hiddenBelow).toBe(0);
    expect(w.hiddenAbove).toBe(12);
  });

  it("scrolling up moves the newest-visible message back and reports newer-below", () => {
    const w = computeViewportWindow(20, 8, 5);
    expect(w.endIndex).toBe(15); // 5 back from the latest
    expect(w.startIndex).toBe(7);
    expect(w.atBottom).toBe(false);
    expect(w.hiddenBelow).toBe(5); // the 5 newest are scrolled past
  });

  it("clamps scroll so you can't go past the oldest message", () => {
    const w = computeViewportWindow(10, 8, 999);
    expect(w.endIndex).toBe(1); // only message[0] as newest-visible
    expect(w.startIndex).toBe(0);
    expect(w.hiddenBelow).toBe(9);
  });

  it("handles an empty conversation", () => {
    expect(computeViewportWindow(0, 8, 0)).toEqual({ startIndex: 0, endIndex: 0, atBottom: true, hiddenAbove: 0, hiddenBelow: 0 });
  });

  it("does not underflow when capacity exceeds the message count", () => {
    const w = computeViewportWindow(3, 50, 0);
    expect(w.startIndex).toBe(0);
    expect(w.endIndex).toBe(3);
    expect(w.hiddenAbove).toBe(0);
  });

  it("treats capacity < 1 as 1 (renders at least the newest-visible message)", () => {
    const w = computeViewportWindow(10, 0, 0);
    expect(w.endIndex).toBe(10);
    expect(w.startIndex).toBe(9);
  });
});
