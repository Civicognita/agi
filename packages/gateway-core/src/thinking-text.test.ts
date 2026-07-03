/**
 * splitThinking tests — the framework primitive that separates a model's inline
 * <thinking>/<think> reasoning from the user-visible response. Driven by the
 * Discord bug where Aion posted its entire <thinking>...</thinking> block inline
 * above the actual reply (debug screenshot 2026-06-21).
 */
import { describe, it, expect } from "vitest";
import { splitThinking, ensureVisibleReply, EMPTY_VISIBLE_REPLY_FALLBACK } from "./thinking-text.js";

describe("splitThinking", () => {
  it("returns text unchanged when there is no thinking block", () => {
    const r = splitThinking("Just a normal reply.");
    expect(r.visibleText).toBe("Just a normal reply.");
    expect(r.thinking).toBe("");
  });

  it("strips a <thinking> block and keeps the visible response", () => {
    const input = "<thinking>\nThe user asked X. I should answer Y.\n</thinking>\n\nHere is the answer.";
    const r = splitThinking(input);
    expect(r.visibleText).toBe("Here is the answer.");
    expect(r.thinking).toBe("The user asked X. I should answer Y.");
  });

  it("handles the <think> tag variant (Qwen/DeepSeek-style)", () => {
    const r = splitThinking("<think>reasoning here</think>Answer.");
    expect(r.visibleText).toBe("Answer.");
    expect(r.thinking).toBe("reasoning here");
  });

  it("is case-insensitive on the tag name", () => {
    const r = splitThinking("<Thinking>hmm</Thinking>Reply.");
    expect(r.visibleText).toBe("Reply.");
    expect(r.thinking).toBe("hmm");
  });

  it("concatenates multiple thinking blocks", () => {
    const r = splitThinking("<thinking>a</thinking>First.<thinking>b</thinking>Second.");
    expect(r.visibleText).toBe("First.Second.");
    expect(r.thinking).toBe("a\n\nb");
  });

  it("treats an unclosed <thinking> (truncated output) as all-thinking", () => {
    // Model spent its budget thinking and never produced a closing tag or answer.
    const r = splitThinking("<thinking>I am still reasoning and got cut off");
    expect(r.visibleText).toBe("");
    expect(r.thinking).toBe("I am still reasoning and got cut off");
  });

  it("collapses the blank lines left behind so the reply has no leading gap", () => {
    const r = splitThinking("<thinking>x</thinking>\n\n\n\nAnswer.");
    expect(r.visibleText).toBe("Answer.");
  });

  it("preserves Discord markdown in the visible text untouched", () => {
    const input = "<thinking>plan</thinking>\n**Bold** and *italic* and `code` and > quote";
    const r = splitThinking(input);
    expect(r.visibleText).toBe("**Bold** and *italic* and `code` and > quote");
  });
});

/**
 * ensureVisibleReply — guards the "Aion went quiet" bug: an all-reasoning turn
 * produced empty visibleText, the outbound gate only dispatched truthy text, so
 * the reply was silently dropped. This must collapse to a safe fallback (never
 * silence, never a chain-of-thought leak).
 */
describe("ensureVisibleReply", () => {
  it("passes normal visible text straight through (no fallback)", () => {
    const r = ensureVisibleReply("Here is the answer.");
    expect(r.text).toBe("Here is the answer.");
    expect(r.usedFallback).toBe(false);
  });

  it("substitutes the fallback for empty text (the regression) — never silent", () => {
    const r = ensureVisibleReply("");
    expect(r.text).toBe(EMPTY_VISIBLE_REPLY_FALLBACK);
    expect(r.usedFallback).toBe(true);
    expect(r.text.length).toBeGreaterThan(0); // outbound gate will now dispatch it
  });

  it("substitutes the fallback for whitespace-only text", () => {
    const r = ensureVisibleReply("   \n\n  ");
    expect(r.usedFallback).toBe(true);
    expect(r.text).toBe(EMPTY_VISIBLE_REPLY_FALLBACK);
  });

  it("the fallback does NOT leak reasoning — it's a fixed neutral message", () => {
    const r = ensureVisibleReply("");
    expect(r.text.toLowerCase()).not.toContain("thinking");
    expect(r.text.toLowerCase()).not.toContain("<think");
  });

  it("end-to-end: an all-reasoning model output never yields a silent (empty) reply", () => {
    // The exact incident shape: model emitted only an unclosed <thinking> body.
    const raw = "<thinking>I was pressured to answer and I'm deliberating about what to say";
    const { visibleText } = splitThinking(raw);
    expect(visibleText).toBe(""); // splitThinking correctly withholds the CoT
    const { text, usedFallback } = ensureVisibleReply(visibleText);
    expect(usedFallback).toBe(true);
    expect(text).toBe(EMPTY_VISIBLE_REPLY_FALLBACK); // ...but a reply is still sent
  });
});
