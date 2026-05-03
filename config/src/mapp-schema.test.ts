import { describe, expect, it } from "vitest";
import { MAppDefinitionSchema, MAppScreenSchema, MAppScreenInputSchema, MAppScreenMiniAgentSchema } from "./mapp-schema.js";

/**
 * Unit tests for s146 Phase A.1 — MApp screens primitive schema landing.
 *
 * Verifies: (a) the screens primitive parses cleanly when present, (b)
 * legacy form-and-formula MApps (no screens, just pages) still parse,
 * (c) the safety guards (qualifier enum, source enum, componentRef
 * format, id pattern) reject invalid shapes.
 */

const MINIMAL_LEGACY_MAPP = {
  $schema: "mapp/1.0" as const,
  id: "kronos-trader",
  name: "Kronos Trader",
  author: "wishborn",
  version: "1.0.0",
  description: "Forecasting and trading workspace.",
  category: "tool" as const,
  permissions: [],
  panel: { label: "Kronos", widgets: [] },
  pages: [{
    key: "p1",
    title: "Inputs",
    pageType: "standard" as const,
    visibility: "always" as const,
  }],
};

describe("MAppDefinitionSchema — screens primitive (s146 Phase A.1)", () => {
  it("parses a legacy form-and-formula MApp cleanly (no screens field)", () => {
    const result = MAppDefinitionSchema.safeParse(MINIMAL_LEGACY_MAPP);
    expect(result.success, result.success ? undefined : JSON.stringify(result.error.format(), null, 2)).toBe(true);
  });

  it("parses a screens-shaped MApp cleanly", () => {
    const result = MAppDefinitionSchema.safeParse({
      ...MINIMAL_LEGACY_MAPP,
      pages: undefined,
      screens: [{
        id: "main",
        label: "Main",
        interface: "static",
        inputs: [
          { key: "title", label: "Title", type: "string", qualifier: "required", source: "user" },
          { key: "summary", label: "Summary", type: "text", qualifier: "prefilled", source: "either", default: "" },
          { key: "tags", label: "Tags", type: "select", qualifier: "optional", options: ["a", "b"] },
        ],
        elements: [
          { id: "header", componentRef: "react-fancy:Card", props: { title: "Hello" } },
          { id: "editor", componentRef: "fancy-code:Editor", props: { value: "$input.summary" } },
        ],
      }],
    });
    expect(result.success, result.success ? undefined : JSON.stringify(result.error.format(), null, 2)).toBe(true);
  });

  it("allows a MApp to have BOTH pages and screens (coexistence path)", () => {
    const result = MAppDefinitionSchema.safeParse({
      ...MINIMAL_LEGACY_MAPP,
      screens: [{ id: "s1", label: "S1", elements: [] }],
    });
    expect(result.success).toBe(true);
  });
});

describe("MAppScreenInputSchema — qualifier + source guarantees", () => {
  it("rejects an invalid qualifier value", () => {
    const result = MAppScreenInputSchema.safeParse({
      key: "x", label: "X", type: "string", qualifier: "mandatory", source: "user",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid source value", () => {
    const result = MAppScreenInputSchema.safeParse({
      key: "x", label: "X", type: "string", qualifier: "required", source: "system",
    });
    expect(result.success).toBe(false);
  });

  it("defaults source to 'either' when omitted", () => {
    const result = MAppScreenInputSchema.safeParse({
      key: "x", label: "X", type: "string", qualifier: "required",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.source).toBe("either");
  });

  it("accepts all three qualifier values", () => {
    for (const qualifier of ["required", "prefilled", "optional"] as const) {
      const result = MAppScreenInputSchema.safeParse({
        key: "x", label: "X", type: "string", qualifier,
      });
      expect(result.success, `qualifier=${qualifier}`).toBe(true);
    }
  });
});

describe("MAppScreenSchema — element + id safety", () => {
  it("rejects a screen with an invalid id (uppercase)", () => {
    const result = MAppScreenSchema.safeParse({
      id: "Main", label: "M", elements: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an element with an invalid componentRef format", () => {
    const result = MAppScreenSchema.safeParse({
      id: "main", label: "M",
      elements: [{ id: "x", componentRef: "Card" }], // missing package prefix
    });
    expect(result.success).toBe(false);
  });

  it("rejects an element with a lowercase component name", () => {
    const result = MAppScreenSchema.safeParse({
      id: "main", label: "M",
      elements: [{ id: "x", componentRef: "react-fancy:card" }], // lowercase component
    });
    expect(result.success).toBe(false);
  });

  it("accepts well-formed componentRefs across all five PAx packages", () => {
    const refs = [
      "react-fancy:Card",
      "fancy-sheets:Sheet",
      "fancy-code:Editor",
      "fancy-echarts:Chart",
      "fancy-3d:Scene",
    ];
    for (const ref of refs) {
      const result = MAppScreenSchema.safeParse({
        id: "main", label: "M",
        elements: [{ id: "el", componentRef: ref }],
      });
      expect(result.success, `componentRef=${ref}`).toBe(true);
    }
  });

  it("defaults interface to 'static' when omitted", () => {
    const result = MAppScreenSchema.safeParse({
      id: "main", label: "M", elements: [],
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.interface).toBe("static");
  });

  it("accepts a screen with miniAgent (s146 phase C, Hybrid shape)", () => {
    const result = MAppScreenSchema.safeParse({
      id: "main", label: "Main", elements: [],
      miniAgent: {
        intent: "Help the user draft policy documents based on inputs.",
        toolMode: "whitelist",
        tools: ["mcp:project-grep", "mcp:web-search"],
      },
    });
    expect(result.success, result.success ? undefined : JSON.stringify(result.error.format(), null, 2)).toBe(true);
  });
});

describe("MAppScreenMiniAgentSchema — Hybrid mini-agent shape (s146 phase C)", () => {
  it("requires non-empty intent", () => {
    const result = MAppScreenMiniAgentSchema.safeParse({ intent: "" });
    expect(result.success).toBe(false);
  });

  it("defaults toolMode to 'auto' when omitted", () => {
    const result = MAppScreenMiniAgentSchema.safeParse({ intent: "do the thing" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.toolMode).toBe("auto");
  });

  it("rejects invalid toolMode value", () => {
    const result = MAppScreenMiniAgentSchema.safeParse({
      intent: "x", toolMode: "manual",
    });
    expect(result.success).toBe(false);
  });

  it("accepts whitelist + blacklist + auto with tool list", () => {
    for (const mode of ["whitelist", "blacklist", "auto"] as const) {
      const result = MAppScreenMiniAgentSchema.safeParse({
        intent: "do the thing", toolMode: mode, tools: ["a", "b"],
      });
      expect(result.success, `mode=${mode}`).toBe(true);
    }
  });
});
