/**
 * WhiteboardEditor — s157 Phase 2c (2026-05-15): persistent controlled board.
 *
 * Replaces Phase 2b's `SharedWhiteboard` wrapper with a host-controlled Board
 * that owns notes/shapes/connectors/strokes/viewport state. Every edit fires
 * `onSave` (debounced 500ms) with the full JSON blob, enabling the parent to
 * persist the whiteboard without an explicit Save button.
 *
 * Why: SharedWhiteboard owns its state internally with no `onChange`/`onSave`
 * prop — edits were session-ephemeral (Phase 2b comment, 2026-05-11). Phase 2c
 * drops to the lower-level Board + StickyNote + Shape + Drawing pattern where
 * the host is the state authority, and adds persistence.
 *
 * `registerWhiteboardBridge` is still wired so the in-page agent (Aion) can
 * read and manipulate the board via MCP tools. AgentPanel displays the agent
 * sidebar.
 */

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  Board,
  StickyNote,
  Shape,
  Drawing,
  type StickyNoteItem,
  type ShapeItem,
  type ConnectorItem,
  type Stroke,
  type Viewport,
} from "@particle-academy/fancy-whiteboard";
import {
  AgentPanel,
  MicroMcpServer,
  attachInProcess,
  type AgentActivity,
} from "@particle-academy/agent-integrations";
import { registerWhiteboardBridge } from "@particle-academy/agent-integrations/bridges/whiteboard";

interface WhiteboardEditorProps {
  /** JSON-serialized board state from the note's body. May be empty/invalid. */
  body: string;
  /** Pixel height of the board area. Default 480 (fits the NotesPanel surface). */
  height?: number;
  /**
   * Called with a fresh JSON string whenever board state changes.
   * Debounced 500ms — parent should persist via updateNote().
   */
  onSave?: (json: string) => void;
  /** Agent identity. Defaults to Aion ($A0). */
  agent?: { id: string; name?: string; color?: string };
}

/** Shape of JSON written to / read from the note body. */
interface WhiteboardState {
  notes: StickyNoteItem[];
  shapes: ShapeItem[];
  connectors: ConnectorItem[];
  strokes: Stroke[];
  viewport?: Viewport;
}

/**
 * Parse note body string into initial board state.
 * Tolerates empty/invalid JSON by returning empty arrays.
 * Exported for testability.
 */
export function parseWhiteboardBody(body: string): Required<WhiteboardState> {
  const empty: Required<WhiteboardState> = {
    notes: [],
    shapes: [],
    connectors: [],
    strokes: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
  if (body.trim().length === 0) return empty;
  let parsed: Record<string, unknown>;
  try {
    const out = JSON.parse(body) as unknown;
    if (out === null || typeof out !== "object" || Array.isArray(out)) return empty;
    parsed = out as Record<string, unknown>;
  } catch {
    return empty;
  }
  function arr<T>(key: string): T[] {
    const v = parsed[key];
    return Array.isArray(v) ? (v as T[]) : [];
  }
  const vp = parsed["viewport"];
  const viewport: Viewport =
    vp !== null && typeof vp === "object" && !Array.isArray(vp)
      ? (vp as Viewport)
      : { x: 0, y: 0, zoom: 1 };
  return {
    notes: arr<StickyNoteItem>("notes"),
    shapes: arr<ShapeItem>("shapes"),
    connectors: arr<ConnectorItem>("connectors"),
    strokes: arr<Stroke>("strokes"),
    viewport,
  };
}

/**
 * Serialize current board state to JSON body string.
 * Exported for testability / summary extraction.
 */
export function serializeWhiteboardBody(state: WhiteboardState): string {
  return JSON.stringify(state);
}

const DEFAULT_AGENT = { id: "$A0", name: "Aion", color: "#fbbf24" } as const;
const SAVE_DEBOUNCE_MS = 500;

export function WhiteboardEditor({ body, height = 480, onSave, agent }: WhiteboardEditorProps) {
  const initial = useMemo(() => parseWhiteboardBody(body), [body]);

  const [notes, setNotes] = useState<StickyNoteItem[]>(initial.notes);
  const [shapes, setShapes] = useState<ShapeItem[]>(initial.shapes);
  const [connectors, setConnectors] = useState<ConnectorItem[]>(initial.connectors);
  const [strokes, setStrokes] = useState<Stroke[]>(initial.strokes);
  const [viewport, setViewport] = useState<Viewport>(initial.viewport);
  const [activity, setActivity] = useState<AgentActivity[]>([]);

  // Stable ref so the bridge adapter closure never stales.
  const stateRef = useRef({ notes, shapes, connectors, strokes, viewport });
  useEffect(() => {
    stateRef.current = { notes, shapes, connectors, strokes, viewport };
  }, [notes, shapes, connectors, strokes, viewport]);

  const onSaveRef = useRef(onSave);
  useEffect(() => { onSaveRef.current = onSave; }, [onSave]);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleSave = useCallback(() => {
    if (saveTimer.current !== null) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      onSaveRef.current?.(serializeWhiteboardBody(stateRef.current));
    }, SAVE_DEBOUNCE_MS);
  }, []);

  const agentDef = agent ?? DEFAULT_AGENT;

  // MCP server + whiteboard bridge wired once on mount.
  useEffect(() => {
    const server = new MicroMcpServer({
      info: { name: "whiteboard-editor", version: "0.2.0" },
      instructions:
        "Collaborative whiteboard. Use whiteboard_* tools to read and modify the board (add/edit stickies, shapes, connectors, drawings).",
    });

    const bridge = registerWhiteboardBridge(server, {
      adapter: {
        getNotes: () => stateRef.current.notes,
        setNotes: (next) => {
          setNotes((prev) => (typeof next === "function" ? next(prev) : next));
          scheduleSave();
        },
        getShapes: () => stateRef.current.shapes,
        setShapes: (next) => {
          setShapes((prev) => (typeof next === "function" ? next(prev) : next));
          scheduleSave();
        },
        getConnectors: () => stateRef.current.connectors,
        setConnectors: (next) => {
          setConnectors((prev) => (typeof next === "function" ? next(prev) : next));
          scheduleSave();
        },
        getStrokes: () => stateRef.current.strokes,
        setStrokes: (next) => {
          setStrokes((prev) => (typeof next === "function" ? next(prev) : next));
          scheduleSave();
        },
        getViewport: () => stateRef.current.viewport,
        setViewport: (v) => {
          setViewport(v);
          scheduleSave();
        },
      },
      agent: agentDef,
    });

    const inProc = attachInProcess(server);

    // Wire activity feed into AgentPanel. The in-process transport
    // fires onServerMessage on every tool result — extract the activity
    // entry shape the panel expects.
    const off = inProc.onServerMessage((msg: unknown) => {
      if (
        msg !== null &&
        typeof msg === "object" &&
        "result" in msg &&
        msg.result !== null &&
        typeof msg.result === "object" &&
        "structuredContent" in msg.result
      ) {
        const sc = (msg.result as Record<string, unknown>).structuredContent as Record<string, unknown>;
        if (typeof sc.id === "string") {
          setActivity((prev) => [
            ...prev.slice(-19),
            { id: sc.id as string, label: String(sc.label ?? sc.id), ts: Date.now() },
          ]);
        }
      }
    });

    return () => {
      if (saveTimer.current !== null) clearTimeout(saveTimer.current);
      off();
      bridge.dispose();
      server.detach(inProc);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // mount-only — bridge config is stable

  return (
    <div
      className="flex gap-2 min-h-0"
      style={{ height }}
      data-testid="notes-whiteboard-editor"
    >
      {/* Canvas area */}
      <Board
        viewport={viewport}
        onViewportChange={(v) => {
          setViewport(v);
          scheduleSave();
        }}
        className="flex-1 border rounded overflow-hidden"
      >
        {notes.map((n) => (
          <StickyNote
            key={n.id}
            item={n}
            onChange={(next) => {
              setNotes((all) => all.map((x) => (x.id === next.id ? next : x)));
              scheduleSave();
            }}
          />
        ))}
        {shapes.map((s) => (
          <Shape
            key={s.id}
            item={s}
            onChange={(next) => {
              setShapes((all) => all.map((x) => (x.id === next.id ? next : x)));
              scheduleSave();
            }}
          />
        ))}
        <Drawing
          strokes={strokes}
          onStrokeEnd={(s) => {
            setStrokes((all) => [...all, s]);
            scheduleSave();
          }}
        />
      </Board>

      {/* Agent sidebar */}
      <AgentPanel
        agent={agentDef}
        activity={activity}
        className="w-48 shrink-0"
      />
    </div>
  );
}
