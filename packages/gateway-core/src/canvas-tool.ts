/**
 * Canvas Tool — Task #168
 *
 * Agent tool for producing structured Canvas output.
 * The agent calls `canvas_emit` with a Canvas document spec,
 * and the gateway routes it to the appropriate renderer.
 *
 * @see canvas-types.ts for the section type definitions
 */

import { ulid } from "ulid";
import type {
  CanvasDocument,
  CanvasSection,
  CanvasSectionType,
} from "./canvas-types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Input schema for the canvas_emit tool. */
export interface CanvasEmitInput {
  /** Document title. */
  title: string;
  /** Sections to render. */
  sections: CanvasSection[];
  /** Optional metadata. */
  metadata?: Record<string, unknown>;
}

/** Result of canvas emission. */
export interface CanvasEmitResult {
  /** The created canvas document ID. */
  documentId: string;
  /** Number of sections. */
  sectionCount: number;
  /** Section types present. */
  sectionTypes: CanvasSectionType[];
}

/** Handler called when a canvas is emitted. */
export type CanvasEmitHandler = (doc: CanvasDocument) => Promise<void>;

// ---------------------------------------------------------------------------
// Canvas tool manifest (for ToolRegistry integration)
// ---------------------------------------------------------------------------

/** Tool manifest entry for canvas_emit. */
export const CANVAS_TOOL_MANIFEST = {
  name: "canvas_emit",
  description:
    "Produce structured visual output (Canvas). Use this instead of plain text " +
    "when the response benefits from charts, tables, entity cards, seal badges, " +
    "or COA chain visualizations. Sections are rendered as interactive components " +
    "in WebChat/iOS, with text fallback in Telegram.",
  requiredState: "ONLINE" as const,
  requiredTier: "unverified" as const,
} as const;

/** JSON Schema for canvas_emit input validation. */
export const CANVAS_TOOL_INPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    title: { type: "string", description: "Document title" },
    sections: {
      type: "array",
      description: "Ordered list of typed sections to render",
      items: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["text", "chart", "coa-chain", "entity-card", "seal", "metric", "table", "form"],
          },
        },
        required: ["type"],
      },
    },
    metadata: {
      type: "object",
      description: "Optional metadata for tracking",
    },
  },
  required: ["title", "sections"],
};

// ---------------------------------------------------------------------------
// Canvas tool handler factory
// ---------------------------------------------------------------------------

/**
 * Create a canvas_emit tool handler.
 *
 * @param entityId - The entity ID of the agent producing the canvas.
 * @param onEmit - Handler called with the completed canvas document.
 * @returns Tool handler function compatible with ToolRegistry.
 */
export function createCanvasToolHandler(
  entityId: string,
  onEmit: CanvasEmitHandler,
): (input: Record<string, unknown>) => Promise<string> {
  return async (input: Record<string, unknown>): Promise<string> => {
    const emit = input as unknown as CanvasEmitInput;

    if (!emit.title || !Array.isArray(emit.sections)) {
      return JSON.stringify({
        error: "canvas_emit requires 'title' (string) and 'sections' (array)",
      });
    }

    const doc: CanvasDocument = {
      id: ulid(),
      title: emit.title,
      sections: emit.sections,
      createdAt: new Date().toISOString(),
      createdBy: entityId,
      metadata: emit.metadata,
    };

    // Validate sections have valid types
    const validTypes = new Set<string>([
      "text", "chart", "coa-chain", "entity-card",
      "seal", "metric", "table", "form",
    ]);

    for (const section of doc.sections) {
      if (!validTypes.has(section.type)) {
        return JSON.stringify({
          error: `Invalid section type: "${section.type}". Valid types: ${[...validTypes].join(", ")}`,
        });
      }
    }

    await onEmit(doc);

    const sectionTypes = [...new Set(doc.sections.map((s) => s.type))];

    const result: CanvasEmitResult = {
      documentId: doc.id,
      sectionCount: doc.sections.length,
      sectionTypes,
    };

    return JSON.stringify(result);
  };
}
