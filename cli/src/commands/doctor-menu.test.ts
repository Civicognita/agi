/**
 * doctor-menu pure-logic tests (s144 t574 Phase 1).
 *
 * Covers the menu→command mapping and renderer. The interactive
 * `runDoctorMenu` itself spawns a child process and reads stdin so it's
 * exercised by the manual recipe, not unit tests.
 */

import { describe, it, expect } from "vitest";
import {
  MENU_ITEMS,
  applyMenuKey,
  classifyMenuTurn,
  initialMenuState,
  pickMenuItem,
  renderMenu,
} from "./doctor-menu.js";

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

describe("initialMenuState (s144 t574 Phase 3a)", () => {
  it("selects the first non-quit menu item", () => {
    const state = initialMenuState();
    const item = MENU_ITEMS[state.selectedIndex];
    expect(item?.id).not.toBe("quit");
  });
});

describe("applyMenuKey (s144 t574 Phase 3a)", () => {
  it("up arrow moves selection back, wrapping at top", () => {
    const action = applyMenuKey({ selectedIndex: 0 }, "\x1b[A");
    expect(action).toEqual({ kind: "move", newSelectedIndex: MENU_ITEMS.length - 1 });
  });

  it("down arrow moves selection forward, wrapping at bottom", () => {
    const action = applyMenuKey({ selectedIndex: MENU_ITEMS.length - 1 }, "\x1b[B");
    expect(action).toEqual({ kind: "move", newSelectedIndex: 0 });
  });

  it("down arrow increments selectedIndex by 1 mid-list", () => {
    const action = applyMenuKey({ selectedIndex: 2 }, "\x1b[B");
    expect(action).toEqual({ kind: "move", newSelectedIndex: 3 });
  });

  it("Enter commits the highlighted non-quit item", () => {
    // MENU_ITEMS[0] is run-all per the items array; commit returns that item.
    const action = applyMenuKey({ selectedIndex: 0 }, "\r");
    expect(action.kind).toBe("commit");
    if (action.kind === "commit") {
      expect(action.item.id).toBe("run-all");
    }
  });

  it("Enter on quit-highlight emits quit (not commit)", () => {
    const quitIdx = MENU_ITEMS.findIndex((m) => m.id === "quit");
    const action = applyMenuKey({ selectedIndex: quitIdx }, "\r");
    expect(action).toEqual({ kind: "quit" });
  });

  it("'\\n' is treated as Enter", () => {
    const action = applyMenuKey({ selectedIndex: 0 }, "\n");
    expect(action.kind).toBe("commit");
  });

  it("Esc, Ctrl-C, 'q', 'Q' all quit", () => {
    expect(applyMenuKey({ selectedIndex: 0 }, "\x1b")).toEqual({ kind: "quit" });
    expect(applyMenuKey({ selectedIndex: 0 }, "\x03")).toEqual({ kind: "quit" });
    expect(applyMenuKey({ selectedIndex: 0 }, "q")).toEqual({ kind: "quit" });
    expect(applyMenuKey({ selectedIndex: 0 }, "Q")).toEqual({ kind: "quit" });
  });

  it("numeric key jumps highlight to that MenuItem.number", () => {
    const action = applyMenuKey({ selectedIndex: 0 }, "3");
    expect(action.kind).toBe("move");
    if (action.kind === "move") {
      const target = MENU_ITEMS[action.newSelectedIndex];
      expect(target?.number).toBe(3);
    }
  });

  it("numeric jump to out-of-range number is noop", () => {
    expect(applyMenuKey({ selectedIndex: 0 }, "9")).toEqual({ kind: "noop" });
  });

  it("unknown sequence is noop (e.g., left arrow)", () => {
    expect(applyMenuKey({ selectedIndex: 0 }, "\x1b[D")).toEqual({ kind: "noop" });
    expect(applyMenuKey({ selectedIndex: 0 }, "x")).toEqual({ kind: "noop" });
  });
});
