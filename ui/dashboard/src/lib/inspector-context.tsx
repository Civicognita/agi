/**
 * Inspector context — shared state for the 3-panel Communications workspace.
 *
 * Any comms page can call inspect() to push a payload into the right panel
 * without prop-drilling through route hierarchy.
 */

import { createContext, useCallback, useContext, useState } from "react";
import type { ReactNode } from "react";
import type { ModerationFlag, AgentEventEntry } from "@/types.js";
import type { ThreadEntry } from "@/components/InboxView.js";

export type InspectorPayload =
  | { kind: "thread"; thread: ThreadEntry }
  | { kind: "moderation-flag"; flag: ModerationFlag }
  | { kind: "agent-event"; event: AgentEventEntry };

interface InspectorContextValue {
  payload: InspectorPayload | null;
  panelOpen: boolean;
  inspect: (payload: InspectorPayload) => void;
  dismiss: () => void;
}

const InspectorContext = createContext<InspectorContextValue | null>(null);

export function InspectorProvider({ children }: { children: ReactNode }) {
  const [payload, setPayload] = useState<InspectorPayload | null>(null);

  const inspect = useCallback((p: InspectorPayload) => setPayload(p), []);
  const dismiss = useCallback(() => setPayload(null), []);

  return (
    <InspectorContext.Provider value={{ payload, panelOpen: payload !== null, inspect, dismiss }}>
      {children}
    </InspectorContext.Provider>
  );
}

export function useInspector(): InspectorContextValue {
  const ctx = useContext(InspectorContext);
  if (ctx === null) throw new Error("useInspector must be used within InspectorProvider");
  return ctx;
}
