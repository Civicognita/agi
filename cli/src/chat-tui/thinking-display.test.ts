/**
 * thinking-display — pure helpers for collapsible reasoning blocks.
 */

import { describe, it, expect } from "vitest";
import { isThinkingContent, stripThinkingTags, thinkingSummary } from "./thinking-display.js";

describe("isThinkingContent", () => {
  it("is true when flagged (a persisted thought-role message)", () => {
    expect(isThinkingContent("plain reasoning", true)).toBe(true);
  });

  it("is true when the content carries literal thinking tags (leaked, unflagged)", () => {
    expect(isThinkingContent("<thinking>reasoning</thinking>", false)).toBe(true);
    expect(isThinkingContent("<think>reasoning", false)).toBe(true); // unclosed
  });

  it("is false for ordinary content", () => {
    expect(isThinkingContent("just a normal reply", false)).toBe(false);
  });
});

describe("stripThinkingTags", () => {
  it("removes open + close thinking tags and trims", () => {
    expect(stripThinkingTags("<thinking>\nthe corpus search failed\n</thinking>")).toBe("the corpus search failed");
  });

  it("removes an unclosed tag too", () => {
    expect(stripThinkingTags("<thinking>\nlet me look directly")).toBe("let me look directly");
  });

  it("handles <think> short form", () => {
    expect(stripThinkingTags("<think>hmm</think>")).toBe("hmm");
  });
});

describe("thinkingSummary", () => {
  it("reports line count and a preview of the first line", () => {
    const s = thinkingSummary("<thinking>\nfirst reasoning line\nsecond\nthird\n</thinking>");
    expect(s).toContain("💭 thinking");
    expect(s).toContain("3 lines");
    expect(s).toContain("first reasoning line");
  });

  it("uses the singular for one line", () => {
    expect(thinkingSummary("<thinking>only one</thinking>")).toContain("1 line");
  });

  it("truncates a long first line", () => {
    const long = "x".repeat(100);
    const s = thinkingSummary(`<thinking>${long}</thinking>`);
    expect(s).toContain("…");
    expect(s.length).toBeLessThan(100);
  });
});
