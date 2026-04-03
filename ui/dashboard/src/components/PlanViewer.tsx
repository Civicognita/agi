/**
 * PlanViewer — Renders a plan inline within a chat session.
 *
 * Shows plan title, status badge, steps list with status icons,
 * and action buttons (Approve, Request Changes, Reject) when reviewing.
 * Collapses when the plan is "complete" or "failed".
 */

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { Plan, PlanStatus, PlanStepStatus } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stepStatusIcon(status: PlanStepStatus): string {
  switch (status) {
    case "pending": return "\u25CB";   // open circle
    case "running": return "\u25D4";   // quarter circle
    case "complete": return "\u2713";  // check mark
    case "failed": return "\u2717";    // X mark
    case "skipped": return "\u2013";   // en-dash
    default: return "\u25CB";
  }
}

const STEP_STATUS_CLASS: Record<string, string> = {
  pending: "text-muted-foreground",
  running: "text-blue",
  complete: "text-green",
  failed: "text-red",
  skipped: "text-muted-foreground/50",
};

const PLAN_STATUS_CLASS: Record<string, string> = {
  draft: "text-muted-foreground",
  reviewing: "text-yellow",
  approved: "text-blue",
  executing: "text-blue",
  testing: "text-mauve",
  complete: "text-green",
  failed: "text-red",
};

function planStatusLabel(status: PlanStatus): string {
  switch (status) {
    case "draft": return "Draft";
    case "reviewing": return "Reviewing";
    case "approved": return "Approved";
    case "executing": return "Executing";
    case "testing": return "Testing";
    case "complete": return "Complete";
    case "failed": return "Failed";
    default: return status;
  }
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface PlanViewerProps {
  plan: Plan;
  onApprove: (planId: string) => void;
  onReject: (planId: string) => void;
  theme?: "light" | "dark";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PlanViewer({ plan, onApprove, onReject }: PlanViewerProps) {
  const isCollapsed = plan.status === "complete" || plan.status === "failed";
  const [expanded, setExpanded] = useState(!isCollapsed);

  // Auto-collapse when plan completes or fails
  useEffect(() => {
    if (isCollapsed) setExpanded(false);
  }, [isCollapsed]);

  const statusClass = PLAN_STATUS_CLASS[plan.status] ?? "text-muted-foreground";
  const isReviewing = plan.status === "reviewing";

  const completedSteps = plan.steps.filter((s) => s.status === "complete").length;
  const totalSteps = plan.steps.length;

  return (
    <div className="rounded-[10px] border border-border bg-card overflow-hidden mb-1">
      {/* Header — always visible */}
      <div
        onClick={() => setExpanded((p) => !p)}
        className="flex items-center gap-2.5 px-3.5 py-2.5 cursor-pointer select-none"
      >
        {/* Expand/collapse chevron */}
        <span className={cn(
          "text-[10px] text-muted-foreground inline-block transition-transform duration-150",
          expanded && "rotate-90",
        )}>
          {"\u25B6"}
        </span>

        {/* Plan title */}
        <span className="flex-1 text-[13px] font-semibold text-card-foreground overflow-hidden text-ellipsis whitespace-nowrap">
          {plan.title}
        </span>

        {/* Progress summary */}
        {totalSteps > 0 && (
          <span className="text-[10px] text-muted-foreground shrink-0">
            {completedSteps}/{totalSteps}
          </span>
        )}

        {/* Status badge */}
        <span className={cn(
          "text-[10px] font-semibold px-2 py-0.5 rounded-[10px] bg-secondary shrink-0",
          statusClass,
        )}>
          {planStatusLabel(plan.status)}
        </span>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="px-3.5 pb-3">
          {/* Body text */}
          {plan.body && (
            <div className="text-xs leading-relaxed text-muted-foreground mb-2.5 whitespace-pre-wrap break-words">
              {plan.body}
            </div>
          )}

          {/* Steps list */}
          {plan.steps.length > 0 && (
            <div className="flex flex-col gap-1 mb-2.5">
              {plan.steps.map((step) => {
                const sClass = STEP_STATUS_CLASS[step.status] ?? "text-muted-foreground";
                const isRunning = step.status === "running";
                return (
                  <div
                    key={step.id}
                    className="flex items-center gap-2 py-[5px] px-2.5 rounded-md bg-mantle"
                  >
                    {/* Status icon */}
                    <span className={cn(
                      "text-[13px] font-bold w-4 text-center shrink-0",
                      sClass,
                      isRunning && "animate-spin",
                    )}>
                      {stepStatusIcon(step.status)}
                    </span>

                    {/* Step title */}
                    <span className={cn(
                      "flex-1 text-xs",
                      step.status === "skipped"
                        ? "text-muted-foreground line-through"
                        : "text-card-foreground",
                    )}>
                      {step.title}
                    </span>

                    {/* Step type badge */}
                    <span className="text-[9px] font-semibold px-1.5 py-px rounded bg-secondary text-muted-foreground uppercase tracking-wider shrink-0">
                      {step.type}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Action buttons — only when reviewing */}
          {isReviewing && (
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                size="sm"
                className="border-red text-red hover:bg-red/10 hover:text-red"
                onClick={() => onReject(plan.id)}
              >
                Reject
              </Button>
              <Button
                size="sm"
                className="bg-green text-background hover:bg-green/90"
                onClick={() => onApprove(plan.id)}
              >
                Approve
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
