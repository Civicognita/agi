/**
 * PlansDrawer — compact list of non-done plans for the active project chat.
 *
 * Rendered inside the chat flyout's bottom drawer (same slot as Work Queue).
 * Each row shows title + UI status pill + progress + timestamp. Clicking a
 * row calls `onSelect(planId)` so the parent can open the PlanPane on the
 * left side of the chat.
 *
 * Only visible when the chat has a project context (context !== "general").
 * The ChatFlyout filters DRAWER_TABS on that condition.
 */

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { fetchPlans } from "../api.js";
import type { Plan, PlanStatus } from "../types.js";

// Map the 7-status internal enum to the 4-lane user-facing view.
type PlanView = "proposed" | "accepted" | "in-progress" | "done";

function planView(status: PlanStatus): PlanView {
  switch (status) {
    case "draft":
    case "reviewing":
      return "proposed";
    case "approved":
      return "accepted";
    case "executing":
    case "testing":
      return "in-progress";
    case "complete":
    case "failed":
      return "done";
  }
}

const VIEW_CLASS: Record<PlanView, string> = {
  proposed: "border-yellow text-yellow",
  accepted: "border-blue text-blue",
  "in-progress": "border-mauve text-mauve",
  done: "border-green text-green",
};

const VIEW_LABEL: Record<PlanView, string> = {
  proposed: "Proposed",
  accepted: "Accepted",
  "in-progress": "In progress",
  done: "Done",
};

interface PlansDrawerProps {
  projectPath: string;
  selectedPlanId: string | null;
  onSelect: (planId: string) => void;
  /** Incremented by the parent to force a refresh (e.g. after a plan-created WS event). */
  refreshTick?: number;
}

export function PlansDrawer({ projectPath, selectedPlanId, onSelect, refreshTick = 0 }: PlansDrawerProps) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const list = await fetchPlans(projectPath, { excludeDone: true });
      setPlans(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load plans");
    }
  }, [projectPath]);

  useEffect(() => {
    setLoading(true);
    void load().finally(() => setLoading(false));
    // Light polling so step-status advances show up without needing a WS
    // round-trip for every plan mutation. 5s mirrors Work Queue.
    const t = setInterval(() => { void load(); }, 5000);
    return () => clearInterval(t);
  }, [load, refreshTick]);

  if (loading && plans.length === 0) {
    return <span className="text-[11px] text-muted-foreground">Loading plans...</span>;
  }
  if (error !== null) {
    return <span className="text-[11px] text-red">{error}</span>;
  }
  if (plans.length === 0) {
    return <span className="text-[11px] text-muted-foreground">No active plans for this project.</span>;
  }

  return (
    <div className="flex flex-col gap-1">
      {plans.map((plan) => {
        const view = planView(plan.status);
        const completed = plan.steps.filter((s) => s.status === "complete").length;
        const total = plan.steps.length;
        const isSelected = selectedPlanId === plan.id;
        return (
          <button
            key={plan.id}
            type="button"
            onClick={() => onSelect(plan.id)}
            className={cn(
              "flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left cursor-pointer transition-colors border",
              isSelected
                ? "bg-secondary border-primary"
                : "bg-transparent border-border hover:bg-secondary/50",
            )}
          >
            <span className="flex-1 text-[12px] text-foreground truncate">{plan.title}</span>
            {total > 0 && (
              <span className="text-[10px] text-muted-foreground shrink-0 font-mono">
                {completed}/{total}
              </span>
            )}
            <span className={cn("text-[9px] font-semibold px-2 py-0.5 rounded-full border shrink-0", VIEW_CLASS[view])}>
              {VIEW_LABEL[view]}
            </span>
          </button>
        );
      })}
    </div>
  );
}
