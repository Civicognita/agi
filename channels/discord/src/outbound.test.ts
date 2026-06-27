/**
 * Discord outbound formatting tests — the reasoning embed + text chunking.
 * Driven by the bug where Aion's <thinking> block was posted inline above the
 * reply; reasoning now rides as a separate de-emphasized embed.
 */
import { describe, it, expect } from "vitest";
import { buildThinkingEmbedData, splitText } from "./outbound.js";

describe("buildThinkingEmbedData", () => {
  it("builds a de-emphasized reasoning embed", () => {
    const e = buildThinkingEmbedData("I weighed X against Y.");
    expect(e.title).toContain("Reasoning");
    expect(e.description).toBe("I weighed X against Y.");
    expect(typeof e.color).toBe("number");
  });

  it("truncates reasoning to Discord's 4096-char embed description limit", () => {
    const long = "x".repeat(5000);
    const e = buildThinkingEmbedData(long);
    expect(e.description.length).toBeLessThanOrEqual(4096);
    expect(e.description.endsWith("…")).toBe(true);
  });

  it("leaves short reasoning unchanged (no ellipsis)", () => {
    const e = buildThinkingEmbedData("short");
    expect(e.description).toBe("short");
    expect(e.description.endsWith("…")).toBe(false);
  });
});

describe("splitText", () => {
  it("keeps a short message as a single chunk", () => {
    expect(splitText("hello", 2000)).toEqual(["hello"]);
  });

  it("splits a long message under the limit per chunk", () => {
    const chunks = splitText("a".repeat(5000), 2000);
    expect(chunks.every((c) => c.length <= 2000)).toBe(true);
    expect(chunks.join("")).toBe("a".repeat(5000));
  });
});
