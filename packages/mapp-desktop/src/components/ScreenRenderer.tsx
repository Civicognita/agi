/**
 * ScreenRenderer — s146 Phase D / t612 (cycle 200).
 *
 * Reads a MApp's `screens[*]` definition (cycle-182 schema landing) and
 * dispatches each element's `componentRef` to the actual PAx component
 * invocation. Initial scope (Phase D MVP):
 *
 *   - Renders `fancy-screens:Screen` + `fancy-screens:ScreenSystem` as
 *     the canonical app-shell primitives. Other PAx component refs
 *     (react-fancy:Card, fancy-code:Editor, etc.) fall through to a
 *     placeholder until the broader component registry lands.
 *
 *   - Reads `props` from each element verbatim and forwards to the
 *     resolved component. Validation against the actual component's
 *     prop types is the runtime's responsibility (TypeScript at the
 *     component level handles this for the well-known few).
 *
 *   - When the MApp has multiple screens, renders the first one only
 *     (Phase D MVP). Multi-screen routing + ScreenSystem integration
 *     comes when fancy-screens' lifecycle hooks are wired (next slice).
 *
 *   - Mini-agent invocation hooks (cycle-191 Phase C schema) are NOT
 *     wired here yet — the schema captures the intent + tools; the
 *     runtime hookup to agent-invoker is a separate slice.
 *
 * Coexists with the cycle-177 panelUrl iframe path. Window.tsx picks
 * which renderer fires based on manifest fields: panelUrl wins when
 * both are set (legacy MApps stay on iframe); screens[] fires when
 * panelUrl is absent.
 */

import { Screen, ScreenSystem } from "@particle-academy/fancy-screens";
import type { ReactElement } from "react";

/**
 * Minimal MApp screen shape consumed at runtime. Mirrors `MAppScreen`
 * from `@agi/sdk` but kept local to mapp-desktop so this package
 * doesn't need to import the SDK directly. The runtime is duck-typed
 * against the on-wire JSON shape, not the source-of-truth TS interface
 * — same posture as cycle-179's IPC envelope handling.
 */
export interface MAppScreenLike {
  id: string;
  label: string;
  interface?: "static" | "dynamic";
  inputs?: Array<{ key: string; label: string; type: string }>;
  elements: Array<{
    id: string;
    componentRef: string;
    props?: Record<string, unknown>;
    children?: unknown[];
  }>;
  miniAgent?: {
    intent: string;
    toolMode?: "auto" | "whitelist" | "blacklist";
    tools?: string[];
  };
}

interface ScreenRendererProps {
  /** All screens declared by the MApp manifest. MVP renders the first
   *  screen only; multi-screen routing comes in a follow-up slice. */
  screens: MAppScreenLike[];
  /** MApp id passed down for element data attributes + future
   *  per-MApp logging / mini-agent scoping. */
  mappId: string;
}

/**
 * Resolve a componentRef string ("<package>:<ComponentName>") to a
 * concrete React component. Phase D MVP: handles only the fancy-screens
 * primitives; other refs render as placeholders. Future slices extend
 * this dispatch to all PAx packages (the cycle-198 PAX_COMPONENT_REFS
 * curated list is the natural input source).
 */
function resolveComponent(componentRef: string): React.ComponentType<Record<string, unknown>> | null {
  switch (componentRef) {
    case "fancy-screens:Screen":
      // Screen is a composite namespace — Screen.Root is the renderable.
      // The `.Body` and `.Port` subcomponents compose inside Screen via
      // children; the dispatcher here just hands children through.
      return Screen as unknown as React.ComponentType<Record<string, unknown>>;
    case "fancy-screens:ScreenSystem":
      return ScreenSystem as unknown as React.ComponentType<Record<string, unknown>>;
    default:
      return null;
  }
}

/**
 * Render a single MApp screen by dispatching its elements to PAx
 * components. Wraps everything in a fancy-screens ScreenSystem so the
 * containerized application surface (lifecycle, ports, hibernation)
 * is wired by default — even when the manifest didn't explicitly
 * declare a ScreenSystem element.
 */
export function ScreenRenderer({ screens, mappId }: ScreenRendererProps): ReactElement {
  const screen = screens[0];

  if (screen === undefined) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted text-sm">
        <div className="text-center">
          <div className="text-[14px] font-medium text-fg mb-1">No screens declared</div>
          <div className="text-[11px]">Manifest carries `screens: []` — author at least one screen.</div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex-1 w-full bg-bg overflow-auto"
      data-testid={`window-screen-${mappId}`}
      data-mapp-id={mappId}
    >
      <ScreenSystem>
        <Screen id={screen.id} title={screen.label}>
          {screen.elements.map((el) => {
            const Component = resolveComponent(el.componentRef);
            if (Component === null) {
              return (
                <div
                  key={el.id}
                  data-testid={`screen-element-placeholder-${el.id}`}
                  className="p-3 m-2 bg-card border border-amber-400/40 rounded text-[11px]"
                >
                  <div className="font-mono text-amber-400 mb-1">{el.componentRef}</div>
                  <div className="text-muted">
                    Component not yet dispatched in Phase D MVP — placeholder until full PAx registry lands.
                  </div>
                  {el.props !== undefined && Object.keys(el.props).length > 0 && (
                    <pre className="text-[10px] text-muted mt-1 overflow-auto max-h-20">
                      {JSON.stringify(el.props, null, 2)}
                    </pre>
                  )}
                </div>
              );
            }
            return (
              <Component
                key={el.id}
                {...(el.props ?? {})}
                data-testid={`screen-element-${el.id}`}
              />
            );
          })}
        </Screen>
      </ScreenSystem>
    </div>
  );
}
