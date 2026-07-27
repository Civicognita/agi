/**
 * realtalk-stream — tokenizing + folding a 0REALTALK "stream of consciousness"
 * into terminals (local modes), triggers (pass-through to Aion), and switches
 * (n>, local request-queue). Pure logic, tested with no rendering. Patterns are
 * grounded in repos/prime/docs/triggers.md + core/truth/chained-triggers.md.
 */

import { describe, it, expect } from "vitest";
import { tokenizeStream, foldStream, type StreamToken } from "./realtalk-stream.js";

function kinds(tokens: StreamToken[]): string[] {
  return tokens.map((t) => t.kind);
}
function texts(tokens: StreamToken[], kind: StreamToken["kind"]): string[] {
  return tokens.filter((t) => t.kind === kind).map((t) => t.text);
}

describe("tokenizeStream — triggers (pass-through)", () => {
  it("recognizes a single trigger and decodes it from the prime table", () => {
    const t = tokenizeStream(":muse:");
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ kind: "trigger", text: ":muse:", passthrough: true });
    expect(t[0]?.decode).toContain("capture a thought");
  });

  it("recognizes a chained trigger :action:scope:target: and shows the route", () => {
    const [tok] = tokenizeStream(":coa:core:truth:");
    expect(tok?.kind).toBe("trigger");
    expect(tok?.decode).toContain("core → truth");
  });

  it("gives unknown triggers a generic decode, still pass-through", () => {
    const [tok] = tokenizeStream(":wibble:");
    expect(tok).toMatchObject({ kind: "trigger", passthrough: true });
    expect(tok?.decode).toContain("wibble");
  });

  it("does not treat uppercase A:A or a time 10:30 as triggers (lowercase-word rule)", () => {
    expect(kinds(tokenizeStream("A:A"))).toEqual(["text"]);
    expect(kinds(tokenizeStream("meet at 10:30"))).toEqual(["text"]);
  });
});

describe("tokenizeStream — terminals (local modes)", () => {
  it("recognizes terminal open/close and marks them non-pass-through", () => {
    const t = tokenizeStream(":(translate):");
    expect(kinds(t)).toEqual(["terminal-open", "text", "terminal-close"]);
    expect(t[0]?.passthrough).toBe(false);
    expect(t[2]?.passthrough).toBe(false);
  });

  it("does not confuse :( with a trigger", () => {
    const t = tokenizeStream(":(FUNC -v0):");
    expect(kinds(t)).toEqual(["terminal-open", "text", "terminal-close"]);
  });
});

describe("tokenizeStream — n> switch (local)", () => {
  it("recognizes n> as a next-in-queue switch, non-pass-through", () => {
    const t = tokenizeStream("first n> second");
    expect(kinds(t)).toEqual(["text", "switch", "text"]);
    const sw = t.find((x) => x.kind === "switch");
    expect(sw).toMatchObject({ text: "n>", passthrough: false, decode: "next in queue" });
  });
});

describe("tokenizeStream — mixed stream of consciousness", () => {
  it("decomposes terminals + triggers + switches + text in one stream", () => {
    const t = tokenizeStream("fix the bug :fix: then :(builder): make an app n> also :muse: an idea");
    // triggers pass through; terminals + switch handled locally
    expect(texts(t, "trigger")).toEqual([":fix:", ":muse:"]);
    expect(texts(t, "terminal-open")).toEqual([":("]);
    expect(texts(t, "terminal-close")).toEqual(["):"]);
    expect(texts(t, "switch")).toEqual(["n>"]);
  });

  it("token spans are contiguous and cover the whole input", () => {
    const src = "a :muse: b n> c";
    const t = tokenizeStream(src);
    expect(t[0]?.start).toBe(0);
    expect(t.at(-1)?.end).toBe(src.length);
    for (let k = 1; k < t.length; k++) expect(t[k]?.start).toBe(t[k - 1]?.end);
  });
});

describe("foldStream — terminal mode state", () => {
  it("tracks depth and the active terminal label", () => {
    const src = ":(translate): hello";
    const s = foldStream(tokenizeStream(src), src);
    // open then close → depth back to 0
    expect(s.terminalDepth).toBe(0);
  });

  it("reports being inside an open terminal with its label", () => {
    const src = ":(builder): still typing";
    // Only the open, no close yet
    const tokens = tokenizeStream(src).filter((t) => t.kind !== "terminal-close");
    const s = foldStream(tokens, src);
    expect(s.terminalDepth).toBe(1);
    expect(s.activeTerminal).toBe("builder");
  });

  it("nests terminals and pops in order", () => {
    const src = ":(outer): :(inner):";
    const tokens = tokenizeStream(src).filter((t) => t.kind !== "terminal-close");
    const s = foldStream(tokens, src);
    expect(s.terminalDepth).toBe(2);
    expect(s.activeTerminal).toBe("inner");
  });

  it("flags an unbalanced close", () => {
    const src = "oops ):";
    const s = foldStream(tokenizeStream(src), src);
    expect(s.unbalancedClose).toBe(true);
  });
});

describe("foldStream — n> request queue", () => {
  it("splits the stream into ordered requests at top-level n>", () => {
    const src = "summarize the readme n> then run the tests n> then open a PR";
    const s = foldStream(tokenizeStream(src), src);
    expect(s.requests).toEqual(["summarize the readme", "then run the tests", "then open a PR"]);
  });

  it("does NOT split on n> inside an open terminal (that context is layered, not queued)", () => {
    const src = ":(context: a n> b ):";
    const s = foldStream(tokenizeStream(src), src);
    // the n> is at depth 1, so it doesn't segment the top-level queue
    expect(s.requests).toHaveLength(1);
  });

  it("a stream with no n> is a single request", () => {
    const src = "just one thing please";
    expect(foldStream(tokenizeStream(src), src).requests).toEqual(["just one thing please"]);
  });

  it("collects recognized triggers in order", () => {
    const src = ":muse: idea n> :fix: bug";
    expect(foldStream(tokenizeStream(src), src).triggers).toEqual([":muse:", ":fix:"]);
  });
});

describe("foldStream — verbatim request segments (no rewriting)", () => {
  it("keeps a terminal/0FUNC with inner parentheses intact — the segment is sent as-is", () => {
    // Regression for the strip/route corruption of :(TEST(0R 00 0RAW)):
    const src = "ok so far so good :(TEST(0R 00 0RAW)):";
    const requests = foldStream(tokenizeStream(src), src).requests;
    expect(requests).toEqual(["ok so far so good :(TEST(0R 00 0RAW)):"]);
  });
});
