/**
 * `parseRealtalk` — pure pattern recognition against PRIME's LAW-status
 * lexicon (`repos/prime/core/0TERMS.md`) and accessor grammar
 * (`repos/prime/core/0ACCESSOR.md`). Every case here is drawn directly from
 * those two corpus documents' own worked examples, not invented.
 */

import { describe, it, expect } from "vitest";
import { parseRealtalk, LAW_TERMS } from "./realtalk-reader.js";

describe("parseRealtalk — accessor pattern (<FRAME>STATION>ROLE)", () => {
  it("decodes the packed form from 0ACCESSOR.md's own portability example: <A>O>Op", () => {
    const result = parseRealtalk("<A>O>Op");
    expect(result?.kind).toBe("accessor");
    expect(result?.detail).toEqual({ user: undefined, frame: "AGENDA", station: "OPS", role: "OPERATOR" });
  });

  it("decodes the second packed example: <P>P>A (PURPOSE/PRIME/ADMIN — same letter, different positions)", () => {
    const result = parseRealtalk("<P>P>A");
    expect(result?.detail).toEqual({ user: undefined, frame: "PURPOSE", station: "PRIME", role: "ADMIN" });
  });

  it("decodes the full-word unpacked form case-insensitively", () => {
    const result = parseRealtalk("<agenda>ops>operator");
    expect(result?.detail).toEqual({ user: undefined, frame: "AGENDA", station: "OPS", role: "OPERATOR" });
  });

  it("decodes a STATION USER-prefixed accessor: #E0@<AGENDA>OPS>OPERATOR", () => {
    const result = parseRealtalk("#E0@<AGENDA>OPS>OPERATOR");
    expect(result?.detail).toMatchObject({ user: "#E0", frame: "AGENDA", station: "OPS", role: "OPERATOR" });
    expect(result?.summary).toContain("#E0 accessing");
  });

  it("disambiguates OPERATOR from OBSERVER by their distinct abbreviations", () => {
    expect(parseRealtalk("<S>W>Op")?.detail).toMatchObject({ role: "OPERATOR" });
    expect(parseRealtalk("<S>W>Ob")?.detail).toMatchObject({ role: "OBSERVER" });
  });

  it("rejects an accessor with an unrecognized segment", () => {
    expect(parseRealtalk("<NOPE>OPS>ADMIN")).toBeNull();
  });
});

describe("parseRealtalk — confidence notation (|+value|)", () => {
  it.each([
    ["|+.3|", "BULLSHIT"],
    ["|+.6|", "MAGIC minimum"],
    ["|+.8|", "Solid THEORY"],
    ["|+.95|", "LAW candidate"],
    ["|+1.0|", "LAW candidate"],
  ])("classifies %s per 0TERMS.md's threshold table", (input, expectedLabel) => {
    const result = parseRealtalk(input);
    expect(result?.kind).toBe("confidence");
    expect(result?.summary).toContain(expectedLabel);
  });
});

describe("parseRealtalk — impact mark (:seg:seg:...:)", () => {
  it("decodes the 0realtalk-engine.md worked example: :coa:core:truth:", () => {
    const result = parseRealtalk(":coa:core:truth:");
    expect(result?.kind).toBe("impactMark");
    expect(result?.detail).toEqual({ segments: ["coa", "core", "truth"] });
  });

  it("requires the string to both start and end with a colon", () => {
    expect(parseRealtalk(":coa:core:truth")).toBeNull();
    expect(parseRealtalk("coa:core:truth:")).toBeNull();
  });
});

describe("parseRealtalk — boon/burn ($imp)", () => {
  it("recognizes +$imp as 0BOON", () => {
    expect(parseRealtalk("+$imp")?.summary).toContain("0BOON");
  });

  it("recognizes -$imp as 0BURN", () => {
    expect(parseRealtalk("-$imp")?.summary).toContain("0BURN");
  });
});

describe("parseRealtalk — LAW-status terms", () => {
  it("every LAW_TERMS key resolves to itself with its own definition as the summary", () => {
    for (const [term, definition] of Object.entries(LAW_TERMS)) {
      expect(parseRealtalk(term)).toEqual({ kind: "term", summary: definition, detail: { term } });
    }
  });

  it("is case-sensitive — the lexicon itself is", () => {
    expect(parseRealtalk("0stage")).not.toEqual(expect.objectContaining({ kind: "term" }));
  });
});

describe("parseRealtalk — unrecognized root-marked terms", () => {
  it("flags a 0<WORD> pattern that isn't in the LAW lexicon, rather than staying silent", () => {
    const result = parseRealtalk("0NOTAREALTERM");
    expect(result?.kind).toBe("unrecognizedRootTerm");
    expect(result?.detail).toEqual({ term: "0NOTAREALTERM" });
  });
});

describe("parseRealtalk — non-matches", () => {
  it("returns null for plain natural-language input", () => {
    expect(parseRealtalk("hello Aion, how are you?")).toBeNull();
  });

  it("returns null for empty/whitespace-only input", () => {
    expect(parseRealtalk("")).toBeNull();
    expect(parseRealtalk("   ")).toBeNull();
  });
});
