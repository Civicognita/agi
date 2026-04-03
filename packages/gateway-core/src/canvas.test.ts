/**
 * Canvas / A2UI Tests — Task #166, #168
 *
 * Covers:
 *   - canvas-types.ts: canvasToPlainText (all section types)
 *   - canvas-tool.ts: CANVAS_TOOL_MANIFEST, CANVAS_TOOL_INPUT_SCHEMA,
 *                     createCanvasToolHandler
 */

import { describe, it, expect } from "vitest";
import type {
  CanvasDocument,
  TextSection,
  ChartSection,
  MetricSection,
  TableSection,
  EntityCardSection,
  SealSection,
  COAChainSection,
  FormSection,
} from "./canvas-types.js";
import { canvasToPlainText } from "./canvas-types.js";
import {
  CANVAS_TOOL_MANIFEST,
  CANVAS_TOOL_INPUT_SCHEMA,
  createCanvasToolHandler,
} from "./canvas-tool.js";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Build a minimal valid CanvasDocument for testing. */
function makeDoc(sections: CanvasDocument["sections"], overrides?: Partial<CanvasDocument>): CanvasDocument {
  return {
    id: "doc-001",
    title: "Test Document",
    sections,
    createdAt: "2024-01-01T00:00:00.000Z",
    createdBy: "#E0",
    ...overrides,
  };
}

function makeTextSection(content: string): TextSection {
  return { type: "text", content };
}

function makeChartSection(): ChartSection {
  return {
    type: "chart",
    title: "Revenue Over Time",
    chartType: "line",
    xKey: "month",
    data: [
      { month: "Jan", revenue: 100 },
      { month: "Feb", revenue: 200 },
      { month: "Mar", revenue: 150 },
    ],
    series: [{ key: "revenue", label: "Revenue", color: "#4f46e5" }],
  };
}

function makeMetricSection(): MetricSection {
  return {
    type: "metric",
    label: "Total $imp",
    value: 1234,
    unit: "$imp",
    change: { value: 42, direction: "up", period: "30d" },
  };
}

function makeTableSection(): TableSection {
  return {
    type: "table",
    title: "Entities",
    columns: [
      { key: "id", label: "ID" },
      { key: "name", label: "Name" },
      { key: "tier", label: "Tier" },
    ],
    rows: [
      { id: "E001", name: "Alice", tier: "sealed" },
      { id: "E002", name: "Bob", tier: "verified" },
    ],
  };
}

function makeEntityCardSection(): EntityCardSection {
  return {
    type: "entity-card",
    entityId: "entity-001",
    entityType: "#E",
    displayName: "Alice",
    verificationTier: "sealed",
    totalImp: 9876,
    sealStatus: "active",
  };
}

function makeSealSection(): SealSection {
  return {
    type: "seal",
    sealId: "seal-entity-001-1700000000000",
    entityId: "entity-001",
    entityType: "#E",
    status: "active",
    alignment: { a_a: 0.85, u_u: 0.80, c_c: 0.70 },
    issuedAt: "2024-01-01T00:00:00.000Z",
    issuedBy: "reviewer-001",
    grid: "A1B2C3",
  };
}

function makeCOAChainSection(): COAChainSection {
  return {
    type: "coa-chain",
    entries: [
      {
        fingerprint: "fp-aaa",
        entityId: "entity-001",
        workType: "governance",
        impScore: 100,
        timestamp: "2024-01-01T00:00:00.000Z",
      },
      {
        fingerprint: "fp-bbb",
        entityId: "entity-002",
        workType: "innovation",
        impScore: 75,
        timestamp: "2024-01-02T00:00:00.000Z",
        parentFingerprint: "fp-aaa",
      },
    ],
  };
}

function makeFormSection(): FormSection {
  return {
    type: "form",
    title: "Submit Proof",
    action: "verification.submit",
    submitLabel: "Submit",
    fields: [
      { name: "handle", label: "Telegram Handle", fieldType: "text", required: true },
      { name: "message", label: "Proof Message", fieldType: "textarea" },
    ],
  };
}

// ---------------------------------------------------------------------------
// 1. canvasToPlainText — TextSection
// ---------------------------------------------------------------------------

describe("canvasToPlainText — TextSection", () => {
  it("includes the document title in bold at the top", () => {
    const doc = makeDoc([makeTextSection("Hello world")], { title: "My Report" });
    const result = canvasToPlainText(doc);
    expect(result).toContain("**My Report**");
  });

  it("includes the text section content verbatim", () => {
    const doc = makeDoc([makeTextSection("## Heading\n\nSome paragraph text.")]);
    const result = canvasToPlainText(doc);
    expect(result).toContain("## Heading\n\nSome paragraph text.");
  });

  it("handles Markdown headings in content", () => {
    const doc = makeDoc([makeTextSection("# Top Level")]);
    expect(canvasToPlainText(doc)).toContain("# Top Level");
  });

  it("handles multi-line text content", () => {
    const multiline = "Line one.\nLine two.\nLine three.";
    const doc = makeDoc([makeTextSection(multiline)]);
    expect(canvasToPlainText(doc)).toContain(multiline);
  });
});

// ---------------------------------------------------------------------------
// 2. canvasToPlainText — ChartSection
// ---------------------------------------------------------------------------

describe("canvasToPlainText — ChartSection", () => {
  it("renders a [Chart: ...] placeholder with the title", () => {
    const doc = makeDoc([makeChartSection()]);
    expect(canvasToPlainText(doc)).toContain("[Chart: Revenue Over Time]");
  });

  it("includes the data point count", () => {
    const doc = makeDoc([makeChartSection()]);
    expect(canvasToPlainText(doc)).toContain("3 data points");
  });

  it("renders correctly for a chart with zero data points", () => {
    const empty: ChartSection = { ...makeChartSection(), data: [] };
    const doc = makeDoc([empty]);
    expect(canvasToPlainText(doc)).toContain("0 data points");
  });
});

// ---------------------------------------------------------------------------
// 3. canvasToPlainText — MetricSection
// ---------------------------------------------------------------------------

describe("canvasToPlainText — MetricSection", () => {
  it("includes the metric label and value", () => {
    const doc = makeDoc([makeMetricSection()]);
    const result = canvasToPlainText(doc);
    expect(result).toContain("Total $imp:");
    expect(result).toContain("1234");
  });

  it("includes the unit when present", () => {
    const doc = makeDoc([makeMetricSection()]);
    expect(canvasToPlainText(doc)).toContain("$imp");
  });

  it("includes a '+' prefix for upward change", () => {
    const doc = makeDoc([makeMetricSection()]);
    expect(canvasToPlainText(doc)).toContain("+42 30d");
  });

  it("includes a '-' prefix for downward change", () => {
    const section: MetricSection = {
      type: "metric",
      label: "Errors",
      value: 5,
      change: { value: 3, direction: "down", period: "7d" },
    };
    const doc = makeDoc([section]);
    expect(canvasToPlainText(doc)).toContain("-3 7d");
  });

  it("includes no prefix for flat change", () => {
    const section: MetricSection = {
      type: "metric",
      label: "Users",
      value: 100,
      change: { value: 0, direction: "flat", period: "24h" },
    };
    const doc = makeDoc([section]);
    const result = canvasToPlainText(doc);
    expect(result).toContain("0 24h");
    expect(result).not.toMatch(/\+0/);
    expect(result).not.toMatch(/-0/);
  });

  it("omits change string when change is absent", () => {
    const section: MetricSection = { type: "metric", label: "Score", value: 42 };
    const doc = makeDoc([section]);
    const result = canvasToPlainText(doc);
    expect(result).toContain("Score: 42");
    expect(result).not.toContain("(");
  });

  it("omits unit when unit is absent", () => {
    const section: MetricSection = { type: "metric", label: "Count", value: 7 };
    const doc = makeDoc([section]);
    expect(canvasToPlainText(doc)).toContain("Count: 7");
  });

  it("handles string value", () => {
    const section: MetricSection = { type: "metric", label: "Status", value: "green" };
    const doc = makeDoc([section]);
    expect(canvasToPlainText(doc)).toContain("Status: green");
  });
});

// ---------------------------------------------------------------------------
// 4. canvasToPlainText — TableSection
// ---------------------------------------------------------------------------

describe("canvasToPlainText — TableSection", () => {
  it("includes the table title", () => {
    const doc = makeDoc([makeTableSection()]);
    expect(canvasToPlainText(doc)).toContain("Entities:");
  });

  it("includes column labels as a header row", () => {
    const doc = makeDoc([makeTableSection()]);
    const result = canvasToPlainText(doc);
    expect(result).toContain("ID | Name | Tier");
  });

  it("includes row data joined with ' | '", () => {
    const doc = makeDoc([makeTableSection()]);
    const result = canvasToPlainText(doc);
    expect(result).toContain("E001 | Alice | sealed");
    expect(result).toContain("E002 | Bob | verified");
  });

  it("uses 'Table' as fallback title when title is absent", () => {
    const section: TableSection = {
      type: "table",
      columns: [{ key: "x", label: "X" }],
      rows: [{ x: 1 }],
    };
    const doc = makeDoc([section]);
    expect(canvasToPlainText(doc)).toContain("Table:");
  });

  it("respects pageSize limit — only renders up to pageSize rows", () => {
    const section: TableSection = {
      type: "table",
      columns: [{ key: "n", label: "N" }],
      rows: [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }, { n: 5 }],
      pageSize: 3,
    };
    const doc = makeDoc([section]);
    const result = canvasToPlainText(doc);
    expect(result).toContain("1");
    expect(result).toContain("3");
    // Row 4 and 5 should not appear
    const lines = result.split("\n").filter((l) => l.match(/^\d+$/));
    expect(lines.length).toBeLessThanOrEqual(3);
  });

  it("renders empty string for missing column keys in a row", () => {
    const section: TableSection = {
      type: "table",
      columns: [
        { key: "a", label: "A" },
        { key: "b", label: "B" },
      ],
      rows: [{ a: "hello" }], // no 'b' key
    };
    const doc = makeDoc([section]);
    const result = canvasToPlainText(doc);
    // The row renders as "hello | " but trailing whitespace may be trimmed at
    // the join boundary, so check for the column value and separator presence.
    expect(result).toContain("hello |");
    expect(result).toContain("A | B");
  });
});

// ---------------------------------------------------------------------------
// 5. canvasToPlainText — EntityCardSection
// ---------------------------------------------------------------------------

describe("canvasToPlainText — EntityCardSection", () => {
  it("includes the entity display name", () => {
    const doc = makeDoc([makeEntityCardSection()]);
    expect(canvasToPlainText(doc)).toContain("Entity: Alice");
  });

  it("includes the entity type", () => {
    const doc = makeDoc([makeEntityCardSection()]);
    expect(canvasToPlainText(doc)).toContain("Type: #E");
  });

  it("includes the verification tier", () => {
    const doc = makeDoc([makeEntityCardSection()]);
    expect(canvasToPlainText(doc)).toContain("Tier: sealed");
  });

  it("includes the total $imp value", () => {
    const doc = makeDoc([makeEntityCardSection()]);
    expect(canvasToPlainText(doc)).toContain("Total $imp: 9876");
  });
});

// ---------------------------------------------------------------------------
// 6. canvasToPlainText — SealSection
// ---------------------------------------------------------------------------

describe("canvasToPlainText — SealSection", () => {
  it("includes the seal ID", () => {
    const doc = makeDoc([makeSealSection()]);
    expect(canvasToPlainText(doc)).toContain("Seal: seal-entity-001-1700000000000");
  });

  it("includes the status", () => {
    const doc = makeDoc([makeSealSection()]);
    expect(canvasToPlainText(doc)).toContain("Status: active");
  });

  it("includes the alignment values", () => {
    const doc = makeDoc([makeSealSection()]);
    const result = canvasToPlainText(doc);
    expect(result).toContain("A:A 0.85");
    expect(result).toContain("U:U 0.8");
    expect(result).toContain("C:C 0.7");
  });

  it("renders revoked status correctly", () => {
    const section: SealSection = { ...makeSealSection(), status: "revoked" };
    const doc = makeDoc([section]);
    expect(canvasToPlainText(doc)).toContain("Status: revoked");
  });
});

// ---------------------------------------------------------------------------
// 7. canvasToPlainText — COAChainSection
// ---------------------------------------------------------------------------

describe("canvasToPlainText — COAChainSection", () => {
  it("includes the entry count in the header", () => {
    const doc = makeDoc([makeCOAChainSection()]);
    expect(canvasToPlainText(doc)).toContain("COA Chain (2 entries)");
  });

  it("includes each entry fingerprint", () => {
    const doc = makeDoc([makeCOAChainSection()]);
    const result = canvasToPlainText(doc);
    expect(result).toContain("fp-aaa");
    expect(result).toContain("fp-bbb");
  });

  it("includes each entry workType", () => {
    const doc = makeDoc([makeCOAChainSection()]);
    const result = canvasToPlainText(doc);
    expect(result).toContain("governance");
    expect(result).toContain("innovation");
  });

  it("includes $imp scores", () => {
    const doc = makeDoc([makeCOAChainSection()]);
    const result = canvasToPlainText(doc);
    expect(result).toContain("$imp 100");
    expect(result).toContain("$imp 75");
  });

  it("renders correctly for an empty entries array", () => {
    const section: COAChainSection = { type: "coa-chain", entries: [] };
    const doc = makeDoc([section]);
    expect(canvasToPlainText(doc)).toContain("COA Chain (0 entries)");
  });
});

// ---------------------------------------------------------------------------
// 8. canvasToPlainText — FormSection
// ---------------------------------------------------------------------------

describe("canvasToPlainText — FormSection", () => {
  it("includes the form title in a [Form: ...] placeholder", () => {
    const doc = makeDoc([makeFormSection()]);
    expect(canvasToPlainText(doc)).toContain("[Form: Submit Proof]");
  });

  it("includes the field count", () => {
    const doc = makeDoc([makeFormSection()]);
    expect(canvasToPlainText(doc)).toContain("2 fields");
  });

  it("renders correctly for a form with zero fields", () => {
    const section: FormSection = {
      type: "form",
      title: "Empty Form",
      action: "noop",
      fields: [],
    };
    const doc = makeDoc([section]);
    expect(canvasToPlainText(doc)).toContain("0 fields");
  });
});

// ---------------------------------------------------------------------------
// 9. canvasToPlainText — Multiple sections and empty array
// ---------------------------------------------------------------------------

describe("canvasToPlainText — document-level behaviour", () => {
  it("renders multiple sections in order", () => {
    const doc = makeDoc([
      makeTextSection("Intro paragraph."),
      makeMetricSection(),
      makeTableSection(),
    ]);
    const result = canvasToPlainText(doc);
    const introIdx = result.indexOf("Intro paragraph.");
    const metricIdx = result.indexOf("Total $imp:");
    const tableIdx = result.indexOf("Entities:");
    expect(introIdx).toBeGreaterThan(-1);
    expect(metricIdx).toBeGreaterThan(introIdx);
    expect(tableIdx).toBeGreaterThan(metricIdx);
  });

  it("starts with the bolded title when sections are present", () => {
    const doc = makeDoc([makeTextSection("content")], { title: "Alpha" });
    expect(canvasToPlainText(doc).startsWith("**Alpha**")).toBe(true);
  });

  it("returns only the bolded title when sections array is empty", () => {
    const doc = makeDoc([]);
    expect(canvasToPlainText(doc)).toBe("**Test Document**");
  });

  it("trims trailing whitespace/newlines from the output", () => {
    const doc = makeDoc([makeTextSection("hello")]);
    const result = canvasToPlainText(doc);
    expect(result).toBe(result.trim());
  });
});

// ---------------------------------------------------------------------------
// 10. CANVAS_TOOL_MANIFEST
// ---------------------------------------------------------------------------

describe("CANVAS_TOOL_MANIFEST", () => {
  it("has name = 'canvas_emit'", () => {
    expect(CANVAS_TOOL_MANIFEST.name).toBe("canvas_emit");
  });

  it("has a non-empty description string", () => {
    expect(typeof CANVAS_TOOL_MANIFEST.description).toBe("string");
    expect(CANVAS_TOOL_MANIFEST.description.length).toBeGreaterThan(0);
  });

  it("description mentions 'Canvas'", () => {
    expect(CANVAS_TOOL_MANIFEST.description).toContain("Canvas");
  });

  it("requiredState is 'ONLINE'", () => {
    expect(CANVAS_TOOL_MANIFEST.requiredState).toBe("ONLINE");
  });

  it("requiredTier is 'unverified'", () => {
    expect(CANVAS_TOOL_MANIFEST.requiredTier).toBe("unverified");
  });
});

// ---------------------------------------------------------------------------
// 11. CANVAS_TOOL_INPUT_SCHEMA
// ---------------------------------------------------------------------------

describe("CANVAS_TOOL_INPUT_SCHEMA", () => {
  it("is an object", () => {
    expect(typeof CANVAS_TOOL_INPUT_SCHEMA).toBe("object");
    expect(CANVAS_TOOL_INPUT_SCHEMA).not.toBeNull();
  });

  it("has type 'object' at root", () => {
    expect(CANVAS_TOOL_INPUT_SCHEMA.type).toBe("object");
  });

  it("lists 'title' and 'sections' as required fields", () => {
    const required = CANVAS_TOOL_INPUT_SCHEMA.required as string[];
    expect(required).toContain("title");
    expect(required).toContain("sections");
  });

  it("does not list 'metadata' as required", () => {
    const required = CANVAS_TOOL_INPUT_SCHEMA.required as string[];
    expect(required).not.toContain("metadata");
  });

  it("properties includes 'title', 'sections', and 'metadata'", () => {
    const props = CANVAS_TOOL_INPUT_SCHEMA.properties as Record<string, unknown>;
    expect(props).toHaveProperty("title");
    expect(props).toHaveProperty("sections");
    expect(props).toHaveProperty("metadata");
  });

  it("sections property has type 'array'", () => {
    const props = CANVAS_TOOL_INPUT_SCHEMA.properties as Record<string, Record<string, unknown>> | undefined;
    expect(props?.sections?.type).toBe("array");
  });

  it("section items enum contains all 8 section types", () => {
    const props = CANVAS_TOOL_INPUT_SCHEMA.properties as Record<string, unknown> | undefined;
    const sections = props?.sections as Record<string, unknown>;
    const items = sections.items as Record<string, unknown>;
    const itemProps = items.properties as Record<string, unknown>;
    const typeField = itemProps.type as Record<string, string[]>;
    const enumValues = typeField.enum as string[];

    expect(enumValues).toContain("text");
    expect(enumValues).toContain("chart");
    expect(enumValues).toContain("coa-chain");
    expect(enumValues).toContain("entity-card");
    expect(enumValues).toContain("seal");
    expect(enumValues).toContain("metric");
    expect(enumValues).toContain("table");
    expect(enumValues).toContain("form");
    expect(enumValues).toHaveLength(8);
  });

  it("section items require 'type' field", () => {
    const props = CANVAS_TOOL_INPUT_SCHEMA.properties as Record<string, unknown>;
    const sections = props.sections as Record<string, unknown>;
    const items = sections.items as Record<string, string[]>;
    expect(items.required).toContain("type");
  });
});

// ---------------------------------------------------------------------------
// 12. createCanvasToolHandler
// ---------------------------------------------------------------------------

describe("createCanvasToolHandler — valid input", () => {
  it("returns a JSON string with documentId, sectionCount, sectionTypes on success", async () => {
    const captured: CanvasDocument[] = [];
    const handler = createCanvasToolHandler("#E0", async (doc) => {
      captured.push(doc);
    });

    const raw = await handler({
      title: "Hello Canvas",
      sections: [makeTextSection("World")],
    });

    const result = JSON.parse(raw) as { documentId: string; sectionCount: number; sectionTypes: string[] };
    expect(typeof result.documentId).toBe("string");
    expect(result.documentId.length).toBeGreaterThan(0);
    expect(result.sectionCount).toBe(1);
    expect(result.sectionTypes).toEqual(["text"]);
  });

  it("calls onEmit with a CanvasDocument that has the correct title", async () => {
    let emitted: CanvasDocument | undefined;
    const handler = createCanvasToolHandler("#E1", async (doc) => {
      emitted = doc;
    });

    await handler({ title: "My Doc", sections: [] });

    expect(emitted).toBeDefined();
    expect(emitted!.title).toBe("My Doc");
  });

  it("sets createdBy to the provided entityId", async () => {
    let emitted: CanvasDocument | undefined;
    const handler = createCanvasToolHandler("entity-xyz", async (doc) => {
      emitted = doc;
    });

    await handler({ title: "X", sections: [] });
    expect(emitted!.createdBy).toBe("entity-xyz");
  });

  it("assigns a ULID-format documentId (26 chars, alphanumeric)", async () => {
    const handler = createCanvasToolHandler("#E0", async () => {});
    const raw = await handler({ title: "T", sections: [] });
    const result = JSON.parse(raw) as { documentId: string };
    expect(result.documentId).toMatch(/^[0-9A-Z]{26}$/);
  });

  it("sets createdAt to an ISO timestamp", async () => {
    let emitted: CanvasDocument | undefined;
    const handler = createCanvasToolHandler("#E0", async (doc) => {
      emitted = doc;
    });

    await handler({ title: "T", sections: [] });
    expect(() => new Date(emitted!.createdAt)).not.toThrow();
    expect(new Date(emitted!.createdAt).toISOString()).toBe(emitted!.createdAt);
  });

  it("passes metadata through to the CanvasDocument", async () => {
    let emitted: CanvasDocument | undefined;
    const handler = createCanvasToolHandler("#E0", async (doc) => {
      emitted = doc;
    });

    await handler({ title: "T", sections: [], metadata: { jobId: "job-001" } });
    expect(emitted!.metadata).toEqual({ jobId: "job-001" });
  });

  it("accepts empty sections array as valid", async () => {
    const handler = createCanvasToolHandler("#E0", async () => {});
    const raw = await handler({ title: "Empty", sections: [] });
    const result = JSON.parse(raw) as { sectionCount: number };
    expect(result.sectionCount).toBe(0);
  });

  it("deduplicates sectionTypes in the result", async () => {
    const handler = createCanvasToolHandler("#E0", async () => {});
    const raw = await handler({
      title: "Multi Text",
      sections: [
        makeTextSection("A"),
        makeTextSection("B"),
        makeTextSection("C"),
      ],
    });
    const result = JSON.parse(raw) as { sectionTypes: string[] };
    expect(result.sectionTypes).toEqual(["text"]);
  });

  it("includes all distinct section types in sectionTypes", async () => {
    const handler = createCanvasToolHandler("#E0", async () => {});
    const raw = await handler({
      title: "Mixed",
      sections: [
        makeTextSection("t"),
        makeMetricSection(),
        makeTableSection(),
      ],
    });
    const result = JSON.parse(raw) as { sectionTypes: string[] };
    expect(result.sectionTypes).toContain("text");
    expect(result.sectionTypes).toContain("metric");
    expect(result.sectionTypes).toContain("table");
  });
});

describe("createCanvasToolHandler — each section type accepted", () => {
  async function emitSections(sections: CanvasDocument["sections"]): Promise<{ sectionCount: number; sectionTypes: string[] }> {
    const handler = createCanvasToolHandler("#E0", async () => {});
    const raw = await handler({ title: "T", sections });
    return JSON.parse(raw) as { sectionCount: number; sectionTypes: string[] };
  }

  it("accepts text section", async () => {
    const r = await emitSections([makeTextSection("hello")]);
    expect(r.sectionTypes).toContain("text");
  });

  it("accepts chart section", async () => {
    const r = await emitSections([makeChartSection()]);
    expect(r.sectionTypes).toContain("chart");
  });

  it("accepts metric section", async () => {
    const r = await emitSections([makeMetricSection()]);
    expect(r.sectionTypes).toContain("metric");
  });

  it("accepts table section", async () => {
    const r = await emitSections([makeTableSection()]);
    expect(r.sectionTypes).toContain("table");
  });

  it("accepts entity-card section", async () => {
    const r = await emitSections([makeEntityCardSection()]);
    expect(r.sectionTypes).toContain("entity-card");
  });

  it("accepts seal section", async () => {
    const r = await emitSections([makeSealSection()]);
    expect(r.sectionTypes).toContain("seal");
  });

  it("accepts coa-chain section", async () => {
    const r = await emitSections([makeCOAChainSection()]);
    expect(r.sectionTypes).toContain("coa-chain");
  });

  it("accepts form section", async () => {
    const r = await emitSections([makeFormSection()]);
    expect(r.sectionTypes).toContain("form");
  });
});

describe("createCanvasToolHandler — missing required fields", () => {
  it("returns error JSON when title is missing", async () => {
    const handler = createCanvasToolHandler("#E0", async () => {});
    const raw = await handler({ sections: [makeTextSection("x")] });
    const result = JSON.parse(raw) as { error?: string };
    expect(result.error).toBeDefined();
    expect(result.error).toContain("title");
  });

  it("returns error JSON when sections is missing", async () => {
    const handler = createCanvasToolHandler("#E0", async () => {});
    const raw = await handler({ title: "T" });
    const result = JSON.parse(raw) as { error?: string };
    expect(result.error).toBeDefined();
    expect(result.error).toContain("sections");
  });

  it("returns error JSON when sections is not an array", async () => {
    const handler = createCanvasToolHandler("#E0", async () => {});
    const raw = await handler({ title: "T", sections: "not-an-array" });
    const result = JSON.parse(raw) as { error?: string };
    expect(result.error).toBeDefined();
  });

  it("returns error JSON when title is empty string (falsy)", async () => {
    const handler = createCanvasToolHandler("#E0", async () => {});
    const raw = await handler({ title: "", sections: [] });
    const result = JSON.parse(raw) as { error?: string };
    expect(result.error).toBeDefined();
  });
});

describe("createCanvasToolHandler — invalid section type", () => {
  it("returns error JSON containing the invalid type name", async () => {
    const handler = createCanvasToolHandler("#E0", async () => {});
    const raw = await handler({
      title: "T",
      sections: [{ type: "unknown-type" }],
    });
    const result = JSON.parse(raw) as { error?: string };
    expect(result.error).toBeDefined();
    expect(result.error).toContain("unknown-type");
  });

  it("does not call onEmit when a section type is invalid", async () => {
    let called = false;
    const handler = createCanvasToolHandler("#E0", async () => {
      called = true;
    });
    await handler({
      title: "T",
      sections: [{ type: "bogus" }],
    });
    expect(called).toBe(false);
  });
});
