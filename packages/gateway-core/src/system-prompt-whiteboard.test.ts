/**
 * system-prompt whiteboard context tests — s157 t727/t728.
 *
 * Verifies summarizeWhiteboardBody() and that whiteboard notes injected
 * into the system prompt show readable text (not raw JSON).
 */

import { describe, expect, it } from "vitest";
import { summarizeWhiteboardBody, assembleSystemPrompt, type SystemPromptContext } from "./system-prompt.js";

// ---------------------------------------------------------------------------
// summarizeWhiteboardBody unit tests
// ---------------------------------------------------------------------------
describe("summarizeWhiteboardBody", () => {
  it("returns sticky note text", () => {
    const json = JSON.stringify({
      notes: [{ id: "n1", text: "Hello world" }, { id: "n2", text: "  Another note  " }],
      shapes: [],
      connectors: [],
      strokes: [],
    });
    const out = summarizeWhiteboardBody(json);
    expect(out).toContain("Hello world");
    expect(out).toContain("Another note");
  });

  it("falls back to content field when text is absent", () => {
    const json = JSON.stringify({
      notes: [{ id: "n1", content: "From content field" }],
      shapes: [],
      connectors: [],
      strokes: [],
    });
    expect(summarizeWhiteboardBody(json)).toContain("From content field");
  });

  it("includes shape labels", () => {
    const json = JSON.stringify({
      notes: [],
      shapes: [{ id: "s1", label: "Decision point" }],
      connectors: [],
      strokes: [],
    });
    expect(summarizeWhiteboardBody(json)).toContain("Decision point");
  });

  it("returns (empty whiteboard) for a board with no text content", () => {
    const json = JSON.stringify({
      notes: [],
      shapes: [{ id: "s1" }], // shape with no label
      connectors: [],
      strokes: [{ id: "st1" }],
    });
    expect(summarizeWhiteboardBody(json)).toBe("(empty whiteboard)");
  });

  it("returns (empty whiteboard) for empty JSON object", () => {
    expect(summarizeWhiteboardBody("{}")).toBe("(empty whiteboard)");
  });

  it("returns placeholder on invalid JSON", () => {
    expect(summarizeWhiteboardBody("not json")).toBe("(whiteboard — unable to parse)");
  });

  it("returns placeholder on empty string", () => {
    expect(summarizeWhiteboardBody("")).toBe("(whiteboard — unable to parse)");
  });

  it("skips notes/shapes with empty text/label", () => {
    const json = JSON.stringify({
      notes: [{ id: "n1", text: "  " }, { id: "n2", text: "Kept" }],
      shapes: [{ id: "s1", label: "" }],
      connectors: [],
      strokes: [],
    });
    const out = summarizeWhiteboardBody(json);
    expect(out).toBe("Kept");
  });
});

// ---------------------------------------------------------------------------
// System prompt injects text summary (not raw JSON) for whiteboard notes
// ---------------------------------------------------------------------------
describe("assembleSystemPrompt — whiteboard notes context", () => {
  const baseCtx: SystemPromptContext = {
    requestType: "project",
    entity: {
      entityId: "e0",
      coaAlias: "#E0",
      displayName: "Owner",
      verificationTier: "sealed",
      channel: "chat",
    },
    coaFingerprint: "#E0.#O0.$A0.test()<>$REG",
    state: "ONLINE",
    capabilities: { remoteOps: true, tynn: false, memory: false, deletions: false },
    tools: [],
    projectPath: "/home/test/proj",
  };

  it("injects sticky note text instead of raw JSON into project context", () => {
    const noteBody = JSON.stringify({
      notes: [{ id: "n1", text: "Important decision: use postgres not sqlite" }],
      shapes: [],
      connectors: [],
      strokes: [],
    });
    const ctx: SystemPromptContext = {
      ...baseCtx,
      projectNotes: [
        {
          title: "Architecture Board",
          body: noteBody,
          kind: "whiteboard",
          pinned: false,
          updatedAt: new Date().toISOString(),
          scope: "project",
        },
      ],
    };
    const prompt = assembleSystemPrompt(ctx);
    // Text summary must appear
    expect(prompt).toContain("Important decision: use postgres not sqlite");
    // Raw JSON must NOT appear in the prompt
    expect(prompt).not.toContain('"notes":[');
    expect(prompt).not.toContain('"strokes"');
  });

  it("tags whiteboard notes with [whiteboard] in the heading", () => {
    const ctx: SystemPromptContext = {
      ...baseCtx,
      projectNotes: [
        {
          title: "My Board",
          body: "{}",
          kind: "whiteboard",
          pinned: false,
          updatedAt: new Date().toISOString(),
          scope: "project",
        },
      ],
    };
    const prompt = assembleSystemPrompt(ctx);
    expect(prompt).toContain("### My Board [whiteboard]");
  });

  it("renders markdown notes bodies as-is (not summarized)", () => {
    const ctx: SystemPromptContext = {
      ...baseCtx,
      projectNotes: [
        {
          title: "Todo",
          body: "- finish the feature\n- write tests",
          kind: "markdown",
          pinned: false,
          updatedAt: new Date().toISOString(),
          scope: "project",
        },
      ],
    };
    const prompt = assembleSystemPrompt(ctx);
    expect(prompt).toContain("- finish the feature");
    expect(prompt).toContain("- write tests");
  });
});
