/**
 * realtalk-unpacker (first-pass) + extractTerminals — the terminal → unpacker →
 * output → agent path. Pure logic, no rendering.
 */

import { describe, it, expect } from "vitest";
import { unpackTerminal, terminalContent, buildWireMessage } from "./realtalk-unpacker.js";
import { extractTerminals } from "./realtalk-stream.js";

describe("terminalContent", () => {
  it("strips the :( ): delimiters and trims", () => {
    expect(terminalContent(":(TEST(0R 00 0RAW)):")).toBe("TEST(0R 00 0RAW)");
    expect(terminalContent(":( translate ):")).toBe("translate");
  });
});

describe("unpackTerminal (first-pass stub)", () => {
  it("passes an unrecognized 0FUNC through as-is (not mangled)", () => {
    const u = unpackTerminal(":(TEST(0R 00 0RAW)):");
    expect(u.content).toBe("TEST(0R 00 0RAW)");
    expect(u.output).toBe("TEST(0R 00 0RAW)"); // pass-through — parens preserved
    expect(u.recognized).toBe(false);
  });

  it("decodes a recognized 0REALTALK expression instead of passing it through", () => {
    const u = unpackTerminal(":(|+.95|):"); // confidence notation is recognized
    expect(u.recognized).toBe(true);
    expect(u.output).toContain("LAW candidate");
  });
});

describe("buildWireMessage", () => {
  it("returns prose unchanged when there are no terminals", () => {
    expect(buildWireMessage("just talking", [])).toBe("just talking");
  });

  it("appends a labeled unpacked block per terminal", () => {
    const u = unpackTerminal(":(TEST(0R 00 0RAW)):");
    expect(buildWireMessage("check this out", [u])).toBe("check this out\n\n⟦0REALTALK unpacked⟧ TEST(0R 00 0RAW)");
  });

  it("sends only the unpacked block when there's no prose", () => {
    const u = unpackTerminal(":(TEST(0R 00 0RAW)):");
    expect(buildWireMessage("", [u])).toBe("⟦0REALTALK unpacked⟧ TEST(0R 00 0RAW)");
  });
});

describe("extractTerminals", () => {
  it("separates prose from a terminal (parens inside the terminal are preserved)", () => {
    const { prose, terminals } = extractTerminals("check this out :(TEST(0R 00 0RAW)):");
    expect(prose).toBe("check this out");
    expect(terminals).toEqual([":(TEST(0R 00 0RAW)):"]);
  });

  it("returns empty prose when the message is only a terminal", () => {
    const { prose, terminals } = extractTerminals(":(TEST(0R 00 0RAW)):");
    expect(prose).toBe("");
    expect(terminals).toEqual([":(TEST(0R 00 0RAW)):"]);
  });

  it("extracts multiple top-level terminals", () => {
    const { prose, terminals } = extractTerminals("do :(a): and :(b): please");
    expect(prose).toBe("do and please");
    expect(terminals).toEqual([":(a):", ":(b):"]);
  });

  it("captures a nested terminal inside its outer one (not separately)", () => {
    const { terminals } = extractTerminals(":(outer :(inner): tail):");
    expect(terminals).toEqual([":(outer :(inner): tail):"]);
  });

  it("leaves an unbalanced open in the prose", () => {
    const { prose, terminals } = extractTerminals("still typing :(translate");
    expect(terminals).toEqual([]);
    expect(prose).toBe("still typing :(translate");
  });

  it("no terminals → prose is the whole message", () => {
    expect(extractTerminals("plain message")).toEqual({ prose: "plain message", terminals: [] });
  });
});
