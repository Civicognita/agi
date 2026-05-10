/**
 * doctor-menu pure-logic tests (s144 t574 Phase 1).
 *
 * Covers the menu→command mapping and renderer. The interactive
 * `runDoctorMenu` itself spawns a child process and reads stdin so it's
 * exercised by the manual recipe, not unit tests.
 */

import { describe, it, expect } from "vitest";
import { MENU_ITEMS, classifyMenuTurn, pickMenuItem, renderMenu } from "./doctor-menu.js";

describe("MENU_ITEMS (s144 t574)", () => {
  it("includes a quit option at number 0", () => {
    const quit = MENU_ITEMS.find((m) => m.id === "quit");
    expect(quit).toBeDefined();
    expect(quit?.number).toBe(0);
  });

  it("has unique numeric labels", () => {
    const numbers = MENU_ITEMS.map((m) => m.number);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it("has unique ids", () => {
    const ids = MENU_ITEMS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every non-quit item carries args", () => {
    for (const item of MENU_ITEMS) {
      if (item.id === "quit") continue;
      // run-all maps to bare `agi doctor` so empty args is correct
      if (item.id === "run-all") {
        expect(item.args).toEqual([]);
        continue;
      }
      expect(item.args.length).toBeGreaterThan(0);
    }
  });
});

describe("pickMenuItem (s144 t574)", () => {
  it("resolves the schema item from '2'", () => {
    const item = pickMenuItem("2");
    expect(item?.id).toBe("schema");
  });

  it("resolves with surrounding whitespace", () => {
    expect(pickMenuItem("  3  ")?.id).toBe("dump");
  });

  it("resolves quit from '0'", () => {
    expect(pickMenuItem("0")?.id).toBe("quit");
  });

  it("returns null for empty input", () => {
    expect(pickMenuItem("")).toBeNull();
    expect(pickMenuItem("   ")).toBeNull();
  });

  it("returns null for non-integer", () => {
    expect(pickMenuItem("abc")).toBeNull();
    expect(pickMenuItem("1.5")).toBeNull();
    expect(pickMenuItem("schema")).toBeNull();
  });

  it("returns null for out-of-range numbers", () => {
    expect(pickMenuItem("99")).toBeNull();
    expect(pickMenuItem("-1")).toBeNull();
  });
});

describe("classifyMenuTurn (s144 t574 Phase 2)", () => {
  it("classifies '0' as quit", () => {
    expect(classifyMenuTurn("0")).toEqual({ kind: "quit" });
  });

  it("classifies a known number as ran", () => {
    const outcome = classifyMenuTurn("2");
    expect(outcome.kind).toBe("ran");
    if (outcome.kind === "ran") {
      expect(outcome.item.id).toBe("schema");
    }
  });

  it("classifies unknown input as invalid with raw preserved", () => {
    expect(classifyMenuTurn("xyz")).toEqual({ kind: "invalid", raw: "xyz" });
  });

  it("classifies empty input as invalid", () => {
    expect(classifyMenuTurn("")).toEqual({ kind: "invalid", raw: "" });
  });

  it("classifies out-of-range as invalid", () => {
    expect(classifyMenuTurn("99")).toEqual({ kind: "invalid", raw: "99" });
  });

  it("tolerates whitespace around quit", () => {
    expect(classifyMenuTurn("  0  ")).toEqual({ kind: "quit" });
  });
});

describe("renderMenu (s144 t574)", () => {
  it("includes every menu item label", () => {
    const out = renderMenu();
    for (const item of MENU_ITEMS) {
      expect(out).toContain(item.label);
    }
  });

  it("opens with the menu heading", () => {
    expect(renderMenu()).toContain("agi doctor — diagnostic menu");
  });

  it("ends with a trailing newline", () => {
    expect(renderMenu()).toMatch(/\n$/);
  });
});
