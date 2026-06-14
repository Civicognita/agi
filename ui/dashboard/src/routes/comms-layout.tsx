/**
 * CommsLayout — 3-panel workspace shell for all /comms/* routes.
 *
 * Implements the aio-app.with-inspector grid pattern from the Aionima Channel
 * design pack: center content area (flex-1) + right inspector (360px).
 * The inspector panel is conditionally rendered when a payload is present.
 *
 * InspectorProvider wraps this layout so any child comms page can call
 * useInspector().inspect() without prop drilling.
 */

import { Outlet, useOutletContext } from "react-router";
import { InspectorProvider, useInspector } from "@/lib/inspector-context.js";
import { InspectorPanel } from "@/components/InspectorPanel.js";
import type { RootContext } from "@/routes/root.js";

function CommsLayoutInner() {
  const ctx = useOutletContext<RootContext>();
  const { payload, panelOpen, dismiss } = useInspector();

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* Center — route content, scrolls independently */}
      <div className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
        <Outlet context={ctx} />
      </div>

      {/* Right inspector — shown when a payload is active */}
      {panelOpen && payload !== null && (
        <InspectorPanel payload={payload} onDismiss={dismiss} />
      )}
    </div>
  );
}

export default function CommsLayout() {
  return (
    <InspectorProvider>
      <CommsLayoutInner />
    </InspectorProvider>
  );
}
