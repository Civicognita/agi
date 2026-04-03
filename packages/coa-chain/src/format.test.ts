import { describe, it, expect } from "vitest";
import {
  formatFingerprint,
  parseFingerprint,
  nextChainId,
  nextWorkId,
} from "./format.js";

describe("formatFingerprint", () => {
  it("formats a 4-part fingerprint", () => {
    const result = formatFingerprint({
      resource: "$A0",
      entity: "#E0",
      node: "@A0",
      chain: "C010",
    });
    expect(result).toBe("$A0.#E0.@A0.C010");
  });

  it("formats a 5-part fingerprint with work segment", () => {
    const result = formatFingerprint({
      resource: "$W1",
      entity: "#E0",
      node: "@A0",
      chain: "C010",
      work: "W001",
    });
    expect(result).toBe("$W1.#E0.@A0.C010.W001");
  });

  it("accepts org entity prefix #O0", () => {
    const result = formatFingerprint({
      resource: "$A0",
      entity: "#O0",
      node: "@A0",
      chain: "C001",
    });
    expect(result).toBe("$A0.#O0.@A0.C001");
  });

  it("throws on invalid resource (missing $ prefix)", () => {
    expect(() =>
      formatFingerprint({
        resource: "A0",
        entity: "#E0",
        node: "@A0",
        chain: "C010",
      })
    ).toThrow(/resource/);
  });

  it("throws on invalid entity (missing # prefix)", () => {
    expect(() =>
      formatFingerprint({
        resource: "$A0",
        entity: "E0",
        node: "@A0",
        chain: "C010",
      })
    ).toThrow(/entity/);
  });

  it("throws on invalid node (missing @ prefix)", () => {
    expect(() =>
      formatFingerprint({
        resource: "$A0",
        entity: "#E0",
        node: "A0",
        chain: "C010",
      })
    ).toThrow(/node/);
  });

  it("throws on invalid chain (missing C prefix)", () => {
    expect(() =>
      formatFingerprint({
        resource: "$A0",
        entity: "#E0",
        node: "@A0",
        chain: "010",
      })
    ).toThrow(/chain/);
  });

  it("throws on invalid work (missing W prefix)", () => {
    expect(() =>
      formatFingerprint({
        resource: "$A0",
        entity: "#E0",
        node: "@A0",
        chain: "C010",
        work: "001",
      })
    ).toThrow(/work/);
  });
});

describe("parseFingerprint", () => {
  it("parses a 4-part fingerprint", () => {
    const result = parseFingerprint("$A0.#E0.@A0.C010");
    expect(result).toEqual({
      resource: "$A0",
      entity: "#E0",
      node: "@A0",
      chain: "C010",
    });
  });

  it("parses a 5-part fingerprint with work segment", () => {
    const result = parseFingerprint("$A0.#E0.@A0.C010.W001");
    expect(result).toEqual({
      resource: "$A0",
      entity: "#E0",
      node: "@A0",
      chain: "C010",
      work: "W001",
    });
  });

  it("round-trips through formatFingerprint (4-part)", () => {
    const fp = {
      resource: "$A0",
      entity: "#O0",
      node: "@A0",
      chain: "C001",
    };
    expect(parseFingerprint(formatFingerprint(fp))).toEqual(fp);
  });

  it("round-trips through formatFingerprint (5-part)", () => {
    const fp = {
      resource: "$W1",
      entity: "#E0",
      node: "@A0",
      chain: "C099",
      work: "W042",
    };
    expect(parseFingerprint(formatFingerprint(fp))).toEqual(fp);
  });

  it("throws on too few segments", () => {
    expect(() => parseFingerprint("$A0.#E0.@A0")).toThrow(/3/);
  });

  it("throws on too many segments", () => {
    expect(() => parseFingerprint("$A0.#E0.@A0.C010.W001.extra")).toThrow(/6/);
  });

  it("throws on invalid resource prefix", () => {
    expect(() => parseFingerprint("A0.#E0.@A0.C010")).toThrow(/resource/);
  });

  it("throws on invalid entity prefix", () => {
    expect(() => parseFingerprint("$A0.E0.@A0.C010")).toThrow(/entity/);
  });

  it("throws on invalid node prefix", () => {
    expect(() => parseFingerprint("$A0.#E0.A0.C010")).toThrow(/node/);
  });

  it("throws on invalid chain prefix", () => {
    expect(() => parseFingerprint("$A0.#E0.@A0.010")).toThrow(/chain/);
  });

  it("throws on invalid work prefix", () => {
    expect(() => parseFingerprint("$A0.#E0.@A0.C010.001")).toThrow(/work/);
  });

  it("throws on empty string", () => {
    expect(() => parseFingerprint("")).toThrow();
  });
});

describe("nextChainId", () => {
  it("increments with zero-padding preserved", () => {
    expect(nextChainId("C009")).toBe("C010");
  });

  it("increments across decade boundary", () => {
    expect(nextChainId("C099")).toBe("C100");
  });

  it("grows beyond 3 digits when needed", () => {
    expect(nextChainId("C999")).toBe("C1000");
  });

  it("handles single-increment from C001", () => {
    expect(nextChainId("C001")).toBe("C002");
  });

  it("handles already 4-digit ID", () => {
    expect(nextChainId("C1000")).toBe("C1001");
  });

  it("throws on wrong prefix", () => {
    expect(() => nextChainId("W001")).toThrow(/prefix/);
  });
});

describe("nextWorkId", () => {
  it("increments with zero-padding preserved", () => {
    expect(nextWorkId("W009")).toBe("W010");
  });

  it("increments across decade boundary", () => {
    expect(nextWorkId("W099")).toBe("W100");
  });

  it("grows beyond 3 digits when needed", () => {
    expect(nextWorkId("W999")).toBe("W1000");
  });

  it("handles single-increment from W001", () => {
    expect(nextWorkId("W001")).toBe("W002");
  });

  it("handles already 4-digit ID", () => {
    expect(nextWorkId("W1000")).toBe("W1001");
  });

  it("throws on wrong prefix", () => {
    expect(() => nextWorkId("C001")).toThrow(/prefix/);
  });
});
