/**
 * PmLitePanel — always-available, file-based PM-Lite UI surface for a project.
 *
 * Wish #17 / s155 t671 — owner directive 2026-05-08:
 *   "there should always be the PM-lite workflow and UI that is always
 *    available and file based … project management should have one entryway
 *    but many functions … local pm-lite is always updated based on
 *    DONE, CURRENT, NEXT (these are views, not kanban status/state)."
 *
 * Three view tabs:
 *   - DONE     — finished work
 *   - CURRENT  — in-flight (starting/doing/testing)
 *   - NEXT     — upcoming (backlog/blocked)
 *
 * Plus a Plans section sourced directly from `<projectPath>/k/plans/` via
 * `/api/pm/plans` so plans surface regardless of remote PM provider state.
 *
 * The backend route is wrapped around LayeredPmProvider, so reads always
 * succeed: when the configured remote provider (tynn / linear / …) is
 * unreachable, the layer falls through to TynnLite. That makes this panel
 * a true floor — never an empty error state due to "tynn not configured."
 */

import { useCallback, useEffect, useState, type ReactElement } from "react";
import { Card } from "@/components/ui/card";
import { fetchPmPlans, fetchPmView, type PmPlanLite, type PmTaskLite, type PmView } from "../api.js";

const VIEW_PILL_CLASS =
  "px-2 py-1 text-[12px] rounded transition-colors data-[active=true]:bg-foreground data-[active=true]:text-background";

const STATUS_BADGE: Record<string, string> = {
  finished: "bg-green/20 text-green",
  doing: "bg-blue/20 text-blue",
  testing: "bg-orange/20 text-orange",
  starting: "bg-yellow/20 text-yellow",
  backlog: "bg-secondary text-muted-foreground",
  blocked: "bg-red/20 text-red",
  archived: "bg-secondary text-muted-foreground/50",
};

const PLAN_STATUS_BADGE: Record<string, string> = {
  draft: "bg-secondary text-muted-foreground",
  reviewing: "bg-yellow/20 text-yellow",
  approved: "bg-blue/20 text-blue",
  executing: "bg-orange/20 text-orange",
  testing: "bg-orange/20 text-orange",
  complete: "bg-green/20 text-green",
  failed: "bg-red/20 text-red",
};

export interface PmLitePanelProps {
  projectPath: string;
}

export function PmLitePanel({ projectPath }: PmLitePanelProps): ReactElement {
  const [view, setView] = useState<PmView>("current");
  const [tasks, setTasks] = useState<PmTaskLite[]>([]);
  const [plans, setPlans] = useState<PmPlanLite[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [plansLoading, setPlansLoading] = useState(false);
  const [plansError, setPlansError] = useState<string | null>(null);
  const [providerId, setProviderId] = useState<string | null>(null);

  const loadView = useCallback(async (target: PmView) => {
    setTasksLoading(true);
    setTasksError(null);
    try {
      const result = await fetchPmView(target);
      setTasks(result.tasks);
      setProviderId(result.providerId);
    } catch (err) {
      setTasksError(err instanceof Error ? err.message : String(err));
      setTasks([]);
    } finally {
      setTasksLoading(false);
    }
  }, []);

  const loadPlans = useCallback(async () => {
    setPlansLoading(true);
    setPlansError(null);
    try {
      const result = await fetchPmPlans(projectPath);
      setPlans(result);
    } catch (err) {
      setPlansError(err instanceof Error ? err.message : String(err));
      setPlans([]);
    } finally {
      setPlansLoading(false);
    }
  }, [projectPath]);

  useEffect(() => {
    void loadView(view);
  }, [view, loadView]);

  useEffect(() => {
    void loadPlans();
  }, [loadPlans]);

  return (
    <div className="flex flex-col gap-4" data-testid="pm-lite-panel">
      {/* DONE / CURRENT / NEXT view tabs over tasks */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
          <div className="flex items-center gap-1" data-testid="pm-view-tabs">
            {(["next", "current", "done"] as PmView[]).map((v) => (
              <button
                key={v}
                type="button"
                className={VIEW_PILL_CLASS}
                data-active={v === view}
                data-testid={`pm-view-${v}`}
                onClick={() => setView(v)}
              >
                {v.toUpperCase()}
              </button>
            ))}
          </div>
          {providerId !== null && (
            <span className="text-[10px] text-muted-foreground/70 font-mono" title="Provider id resolving these reads">
              {providerId}
            </span>
          )}
        </div>

        {tasksLoading && (
          <p className="text-[12px] text-muted-foreground italic" data-testid="pm-tasks-loading">Loading…</p>
        )}
        {!tasksLoading && tasksError !== null && (
          <p className="text-[12px] text-red" data-testid="pm-tasks-error">{tasksError}</p>
        )}
        {!tasksLoading && tasksError === null && tasks.length === 0 && (
          <p className="text-[12px] text-muted-foreground italic" data-testid="pm-tasks-empty">
            No tasks in {view.toUpperCase()}.
          </p>
        )}
        {!tasksLoading && tasksError === null && tasks.length > 0 && (
          <ul className="space-y-1.5" data-testid="pm-tasks-list">
            {tasks.map((task) => (
              <li
                key={task.id}
                className="flex items-start gap-2 text-[13px] py-1 px-2 rounded hover:bg-secondary/40"
                data-testid="pm-task-row"
              >
                <span className="text-[10px] text-muted-foreground/60 font-mono mt-0.5 min-w-[3ch] text-right">
                  {task.number > 0 ? `t${String(task.number)}` : ""}
                </span>
                <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider font-medium ${STATUS_BADGE[task.status] ?? "bg-secondary"}`}>
                  {task.status}
                </span>
                <span className="flex-1 truncate" title={task.title}>{task.title}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Plans — file-based, always available regardless of remote PM provider */}
      <Card className="p-4" data-testid="pm-plans-card">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
            Plans
          </h3>
          <span className="text-[10px] text-muted-foreground/60" title="Source: <projectPath>/k/plans/">
            file-based · always available
          </span>
        </div>
        {plansLoading && (
          <p className="text-[12px] text-muted-foreground italic" data-testid="pm-plans-loading">Loading plans…</p>
        )}
        {!plansLoading && plansError !== null && (
          <p className="text-[12px] text-red" data-testid="pm-plans-error">{plansError}</p>
        )}
        {!plansLoading && plansError === null && plans.length === 0 && (
          <p className="text-[12px] text-muted-foreground italic" data-testid="pm-plans-empty">
            No plans yet for this project. Aion creates plans via the <code>pm</code> tool's <code>plan-create</code> action.
          </p>
        )}
        {!plansLoading && plansError === null && plans.length > 0 && (
          <ul className="space-y-1.5" data-testid="pm-plans-list">
            {plans.map((plan) => (
              <li
                key={plan.id}
                className="flex items-start gap-2 text-[13px] py-1 px-2 rounded hover:bg-secondary/40"
                data-testid="pm-plan-row"
              >
                <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider font-medium ${PLAN_STATUS_BADGE[plan.status] ?? "bg-secondary"}`}>
                  {plan.status}
                </span>
                <span className="flex-1 truncate" title={plan.title}>{plan.title}</span>
                <span className="text-[10px] text-muted-foreground/60 font-mono whitespace-nowrap">
                  {String(plan.steps.length)} step{plan.steps.length === 1 ? "" : "s"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
