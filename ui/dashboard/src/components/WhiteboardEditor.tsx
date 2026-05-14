/**
 * WhiteboardEditor — s157 Phase 2b (2026-05-11).
 *
 * Wraps `@particle-academy/agent-integrations`'s `SharedWhiteboard`, which
 * itself composes `fancy-whiteboard` primitives (Board / StickyNote /
 * Shape / Connector / Drawing / CursorLayer) with a `MicroMcpServer`,
 * AgentPanel, and presence cursors. One drop-in component delivers the
 * "agent-collaborative whiteboard" UX the owner asked for ("particle
 * academy has a fancy-whiteboard with agentic sessions sharing using
 * their agent-integrations package as well. get both.").
 *
 * **What this Phase 2b slice ships:**
 *   - Renders the full SharedWhiteboard inside the NotesPanel whiteboard
 *     branch (replacing the Phase 2a JSON-preview placeholder).
 *   - Reads initial board state from the note's body JSON when present,
 *     falling back to empty arrays when not parseable.
 *   - Identifies Aion ($A0) as the agent for the in-page MicroMcpServer
 *     so the AgentPanel surfaces real presence.
 *   - `shareBaseUrl={null}` — disables external relay. The board still
 *     works locally with the in-process MCP server, which is the right
 *     default until the gateway-side relay broker is wired (Phase 2c).
 *
 * **Phase 2c follow-ups (out of scope):**
 *   - State persistence — SharedWhiteboard owns its internal state and
 *     does NOT expose an onChange/onStateChange prop. New whiteboard
 *     content is session-ephemeral until either upstream adds the
 *     callback OR we swap to the lower-level Board + controlled state
 *     pattern. Tracked as Phase 2c.
 *   - Relay broker — wiring `shareBaseUrl` so multi-user / external-agent
 *     sessions work end-to-end. The host (this app) needs to implement
 *     the relay HTTP endpoints per upstream's relay-protocol.md.
 */

import { useMemo } from "react";
// agent-integrations 0.6.x moved heavy composites to subpath imports
// to keep the main barrel light. See upstream README:
//   import { SharedWhiteboard } from "@particle-academy/agent-integrations/components/shared-whiteboard";
import { SharedWhiteboard, type SharedWhiteboardProps } from "@particle-academy/agent-integrations/components/shared-whiteboard";

interface WhiteboardEditorProps {
  /** JSON-serialized board state from the note's body. May be empty/invalid. */
  body: string;
  /** Pixel height of the board area. Default 480 (fits the NotesPanel surface). */
  height?: number;
  /** Agent identity. Defaults to Aion ($A0). */
  agent?: SharedWhiteboardProps["agent"];
}

/**
 * Pure helper — parse the note body string into SharedWhiteboard
 * initial-state props. Tolerates empty/invalid JSON by returning empty
 * arrays for each slot. Exposed for testability.
 */
export function parseWhiteboardBody(body: string): {
  initialNotes: NonNullable<SharedWhiteboardProps["initialNotes"]>;
  initialShapes: NonNullable<SharedWhiteboardProps["initialShapes"]>;
  initialConnectors: NonNullable<SharedWhiteboardProps["initialConnectors"]>;
  initialStrokes: NonNullable<SharedWhiteboardProps["initialStrokes"]>;
  initialViewport: SharedWhiteboardProps["initialViewport"];
} {
  const empty = {
    initialNotes: [],
    initialShapes: [],
    initialConnectors: [],
    initialStrokes: [],
    initialViewport: undefined,
  } as const;
  if (body.trim().length === 0) return { ...empty };
  let parsed: Record<string, unknown>;
  try {
    const out = JSON.parse(body) as unknown;
    if (out === null || typeof out !== "object" || Array.isArray(out)) return { ...empty };
    parsed = out as Record<string, unknown>;
  } catch {
    return { ...empty };
  }
  function arr<T>(key: string): T[] {
    const v = parsed[key];
    return Array.isArray(v) ? (v as T[]) : [];
  }
  return {
    initialNotes: arr<NonNullable<SharedWhiteboardProps["initialNotes"]>[number]>("notes"),
    initialShapes: arr<NonNullable<SharedWhiteboardProps["initialShapes"]>[number]>("shapes"),
    initialConnectors: arr<NonNullable<SharedWhiteboardProps["initialConnectors"]>[number]>("connectors"),
    initialStrokes: arr<NonNullable<SharedWhiteboardProps["initialStrokes"]>[number]>("strokes"),
    initialViewport: (parsed["viewport"] ?? undefined) as SharedWhiteboardProps["initialViewport"],
  };
}

export function WhiteboardEditor({ body, height = 480, agent }: WhiteboardEditorProps) {
  const initial = useMemo(() => parseWhiteboardBody(body), [body]);
  return (
    <div className="flex-1 min-h-0" data-testid="notes-whiteboard-editor">
      <SharedWhiteboard
        {...initial}
        agent={agent ?? { id: "$A0", name: "Aion", color: "#fbbf24" }}
        shareBaseUrl={null}
        showAgentPanel
        showShareControls={false}
        broadcastEdits={false}
        height={height}
      />
    </div>
  );
}
