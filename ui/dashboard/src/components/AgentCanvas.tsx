/**
 * AgentCanvas — the second surface inside AccordionFlyout.
 *
 * **What it is:** a dynamic playground hosted alongside chat. First iteration
 * supports two surfaces (Plan, IterationArtifact); future iterations will
 * host 3D engines, diagram editors, and richer agent-driven UX (per owner
 * direction: "the Agent Canvas that opens in the second panel … is going to
 * be a dynamic playground for chat agents to use for interacting with users
 * and other agents").
 *
 * **Why a discriminated union for surface state?** We want to add new surface
 * kinds without touching the AccordionFlyout chrome. Each kind owns its own
 * input shape; the canvas dispatches by `kind`. Callers (chat + iteration
 * stream) just push a new surface — the canvas doesn't care which caller
 * "won" the slot, only that the latest surface is rendered.
 *
 * **ADF status:** dashboard-local for now. Once a second consumer (a plugin
 * or MApp) wants the same canvas pattern, lift to the ADF UI layer
 * (particle-academy or `./ui/*` wrappers).
 */

import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { PlanPane } from "./PlanPane.js";
import { IterativeWorkArtifactCard } from "./IterativeWorkArtifactCard.js";
import { SupportCanvas } from "./SupportCanvas.js";
import type { Notification } from "../types.js";

/** What's currently rendered inside the canvas. Add a new variant here when
 *  a new surface kind ships; AgentCanvas dispatches on `kind`. */
export type CanvasSurface =
  | { kind: "empty" }
  | { kind: "plan"; planId: string; projectPath: string }
  | { kind: "iteration-artifact"; notification: Notification }
  | { kind: "support"; initialPath?: string };

interface AgentCanvasProps {
  surface: CanvasSurface;
  /** Called when a hosted surface wants to dismiss itself (PlanPane close,
   *  user clicks the canvas header X). */
  onDismiss?: () => void;
  /** Plan approve/reject handlers — forwarded to PlanPane. */
  onPlanApprove?: (planId: string) => void;
  onPlanReject?: (planId: string) => void;
  className?: string;
}

/** Empty state when no surface is set. Lives inside the open canvas section
 *  so users see "this slot is here, waiting" rather than a blank panel. */
function CanvasEmptyState() {
  return (
    <div className="h-full w-full flex items-center justify-center p-8">
      <Card className="max-w-md p-6 bg-secondary/30 border-dashed">
        <div className="space-y-2 text-center">
          <h3 className="text-[14px] font-semibold text-foreground">Agent Canvas</h3>
          <p className="text-[12px] text-muted-foreground leading-relaxed">
            A surface for plans, iteration artifacts, and (eventually)
            interactive renders. Surfaces appear here when you ask the agent
            for one — open a plan from the drawer, or wait for an iterative
            work cycle to complete.
          </p>
        </div>
      </Card>
    </div>
  );
}

export function AgentCanvas({
  surface,
  onDismiss,
  onPlanApprove,
  onPlanReject,
  className,
}: AgentCanvasProps): ReactNode {
  return (
    <div
      data-testid="agent-canvas"
      data-surface-kind={surface.kind}
      className={cn("h-full w-full bg-background flex flex-col min-h-0", className)}
    >
      {surface.kind === "empty" && <CanvasEmptyState />}

      {surface.kind === "plan" && (
        <PlanPane
          projectPath={surface.projectPath}
          planId={surface.planId}
          onClose={() => { onDismiss?.(); }}
          onApprove={(id) => { onPlanApprove?.(id); }}
          onReject={(id) => { onPlanReject?.(id); }}
        />
      )}

      {surface.kind === "iteration-artifact" && (
        <div className="flex-1 min-h-0 overflow-y-auto p-4">
          <IterativeWorkArtifactCard notification={surface.notification} />
        </div>
      )}

      {/* s137 t531 — SupportCanvas surface for help-mode chat. The chat
          layer sets this when isHelpModeContext(session.context) is true;
          the page-context can pre-resolve initialPath but the user can
          still navigate the full docs tree. */}
      {surface.kind === "support" && (
        <SupportCanvas initialPath={surface.initialPath} className="flex-1" />
      )}
    </div>
  );
}
