/**
 * WhiteboardEditor pure-helper tests (s157 Phase 2b).
 *
 * Covers parseWhiteboardBody — the JSON deserializer that feeds initial
 * state into SharedWhiteboard. Pure function; no React render.
 */

import { describe, it, expect } from "vitest";
import { parseWhiteboardBody } from "./WhiteboardEditor.js";

describe("parseWhiteboardBody (s157 Phase 2b)", () => {
  it("returns empty arrays for empty body", () => {
    const out = parseWhiteboardBody("");
    expect(out.initialNotes).toEqual([]);
    expect(out.initialShapes).toEqual([]);
    expect(out.initialConnectors).toEqual([]);
    expect(out.initialStrokes).toEqual([]);
    expect(out.initialViewport).toBeUndefined();
  });

  it("returns empty arrays for whitespace-only body", () => {
    const out = parseWhiteboardBody("   \n  \t ");
    expect(out.initialNotes).toEqual([]);
  });

  it("returns empty arrays for invalid JSON", () => {
    const out = parseWhiteboardBody("not json");
    expect(out.initialNotes).toEqual([]);
    expect(out.initialShapes).toEqual([]);
  });

  it("returns empty arrays for JSON null/array (not object)", () => {
    expect(parseWhiteboardBody("null").initialNotes).toEqual([]);
    expect(parseWhiteboardBody("[1,2,3]").initialNotes).toEqual([]);
  });

  it("extracts each slot when present", () => {
    const stickyNote = { id: "n1", x: 10, y: 20, text: "hello", color: "yellow" };
    const shape = { id: "s1", kind: "rect", x: 0, y: 0, w: 100, h: 100 };
    const body = JSON.stringify({
      notes: [stickyNote],
      shapes: [shape],
      connectors: [],
      strokes: [],
      viewport: { x: 5, y: 5, zoom: 1.5 },
    });
    const out = parseWhiteboardBody(body);
    expect(out.initialNotes).toEqual([stickyNote]);
    expect(out.initialShapes).toEqual([shape]);
    expect(out.initialViewport).toEqual({ x: 5, y: 5, zoom: 1.5 });
  });

  it("falls back to empty array for slot with wrong type", () => {
    const body = JSON.stringify({ notes: "not an array", shapes: 42 });
    const out = parseWhiteboardBody(body);
    expect(out.initialNotes).toEqual([]);
    expect(out.initialShapes).toEqual([]);
  });

  it("returns empty for the {} body (Phase 2a default for new whiteboards)", () => {
    const out = parseWhiteboardBody("{}");
    expect(out.initialNotes).toEqual([]);
    expect(out.initialShapes).toEqual([]);
    expect(out.initialConnectors).toEqual([]);
    expect(out.initialStrokes).toEqual([]);
    expect(out.initialViewport).toBeUndefined();
  });
});
