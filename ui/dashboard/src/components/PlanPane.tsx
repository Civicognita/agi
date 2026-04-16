/**
 * PlanPane — left-side drawer showing the selected plan alongside the chat.
 *
 * Visual layout (docked mode): the chat occupies the right column; this pane
 * slides in from its left edge as a peer panel of the same height. Both
 * remain visible at once so the user can watch the agent execute while
 * reading / editing the plan body.
 *
 * Body rendering gated on status:
 *   - draft | reviewing  -> Editor (react-fancy); editable; save button
 *                           PUTs the edited body to /api/plans/:id.
 *   - accepted / later   -> ContentRenderer; read-only markdown.
 *
 * Step list is always shown. Approve/Reject buttons only show in the
 * reviewing state and route through the same WS events the inline
 * PlanViewer uses (chat:plan_approve / chat:plan_reject).
 */

import { useCallback, useEffect, useState } from "react";
import { ContentRenderer, Editor } from "@particle-academy/react-fancy";
import { X as XIcon } from "lucide-react";
import { marked } from "marked";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { fetchPlan, updatePlanBody } from "../api.js";
import type { Plan, PlanStatus, PlanStepStatus } from "../types.js";

/**
 * react-fancy's Editor is HTML-input-only — its `value` / `defaultValue`
 * prop is always treated as HTML, there is no "inputFormat" switch. Plans
 * persist as markdown, so we convert once at mount via marked and feed the
 * HTML in as `defaultValue`. `outputFormat="markdown"` means onChange hands
 * us markdown back, which we persist verbatim. Round-trip: markdown on
 * disk, HTML in the DOM, markdown in our edit state.
 */
function markdownToHtml(md: string): string {
  // `marked.parse` can be async with certain extensions; using the sync
  // parser explicitly keeps this deterministic for React rendering.
  return marked.parse(md, { async: false }) as string;
}

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

function stepStatusIcon(status: PlanStepStatus): string {
  switch (status) {
    case "pending": return "\u25CB";
    case "running": return "\u25D4";
    case "complete": return "\u2713";
    case "failed": return "\u2717";
    case "skipped": return "\u2013";
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

interface PlanPaneProps {
  projectPath: string;
  planId: string;
  onClose: () => void;
  onApprove: (planId: string) => void;
  onReject: (planId: string) => void;
}

export function PlanPane({ projectPath, planId, onClose, onApprove, onReject }: PlanPaneProps) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editedBody, setEditedBody] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const p = await fetchPlan(planId, projectPath);
      setPlan(p);
      setError(null);
      setEditedBody(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load plan");
    }
  }, [planId, projectPath]);

  useEffect(() => {
    setLoading(true);
    void load().finally(() => setLoading(false));
    // Refresh plan every 3s so step-status advances show live during execution.
    const t = setInterval(() => { void load(); }, 3000);
    return () => clearInterval(t);
  }, [load]);

  const handleSave = useCallback(async () => {
    if (plan === null || editedBody === null) return;
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await updatePlanBody(plan.id, projectPath, { body: editedBody });
      setPlan(updated);
      setEditedBody(null);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [plan, editedBody, projectPath]);

  const view: PlanView | null = plan ? planView(plan.status) : null;
  const isEditable = view === "proposed";
  const isReviewing = plan?.status === "reviewing";
  const dirty = editedBody !== null && editedBody !== plan?.body;

  return (
    <div className="h-full flex flex-col bg-background border-r border-border">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border shrink-0">
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {view ? view.toUpperCase() : "PLAN"}
          </div>
          <div className="text-sm font-semibold text-foreground truncate">
            {plan?.title ?? "Loading..."}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="w-7 h-7 rounded-md flex items-center justify-center bg-transparent hover:bg-secondary text-muted-foreground hover:text-foreground cursor-pointer"
          title="Close plan"
          aria-label="Close plan"
        >
          <XIcon className="w-4 h-4" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-4">
        {loading && plan === null && (
          <div className="text-sm text-muted-foreground">Loading plan...</div>
        )}
        {error !== null && (
          <div className="text-sm text-red">{error}</div>
        )}

        {plan !== null && (
          <>
            {/* Body: Editor when proposed, ContentRenderer when accepted+ */}
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Body
              </div>
              {isEditable ? (
                <div className="rounded-md border border-border overflow-hidden">
                  {/* Editor is a compound component — Toolbar + Content must
                      be rendered as children or the editable surface isn't
                      drawn at all. Plans persist as markdown but the Editor
                      expects HTML input (see markdownToHtml + plan.body key
                      prop above). outputFormat="markdown" ensures onChange
                      hands us markdown back for persistence. */}
                  <Editor
                    key={plan.id}
                    defaultValue={markdownToHtml(plan.body)}
                    onChange={(next: string) => setEditedBody(next)}
                    outputFormat="markdown"
                    className="min-h-[300px]"
                  >
                    <Editor.Toolbar />
                    <Editor.Content />
                  </Editor>
                </div>
              ) : (
                <div className="text-[13px] leading-relaxed">
                  <ContentRenderer value={plan.body} format="markdown" />
                </div>
              )}
              {isEditable && dirty && (
                <div className="flex items-center gap-2 mt-2">
                  <Button size="sm" onClick={() => void handleSave()} disabled={saving}>
                    {saving ? "Saving..." : "Save edits"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setEditedBody(null)} disabled={saving}>
                    Discard
                  </Button>
                  {saveError !== null && <span className="text-xs text-red">{saveError}</span>}
                </div>
              )}
            </div>

            {/* Steps */}
            {plan.steps.length > 0 && (
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  Steps
                </div>
                <div className="flex flex-col gap-1">
                  {plan.steps.map((step) => {
                    const sClass = STEP_STATUS_CLASS[step.status] ?? "text-muted-foreground";
                    const isRunning = step.status === "running";
                    return (
                      <div key={step.id} className="flex items-center gap-2 py-[6px] px-2.5 rounded-md bg-card border border-border">
                        <span className={cn("text-[13px] font-bold w-4 text-center shrink-0", sClass, isRunning && "animate-spin")}>
                          {stepStatusIcon(step.status)}
                        </span>
                        <span className={cn("flex-1 text-[12px]", step.status === "skipped" ? "text-muted-foreground line-through" : "text-card-foreground")}>
                          {step.title}
                        </span>
                        <span className="text-[9px] font-semibold px-1.5 py-px rounded bg-secondary text-muted-foreground uppercase tracking-wider shrink-0">
                          {step.type}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Approve / Reject — only while the plan is in "reviewing" */}
            {isReviewing && (
              <div className="flex gap-2 justify-end pt-2 border-t border-border">
                <Button
                  variant="outline"
                  size="sm"
                  className="border-red text-red hover:bg-red/10"
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

            {view === "accepted" && (
              <div className="text-[11px] text-muted-foreground italic pt-2 border-t border-border">
                Plan accepted — body is locked. Step status will advance as the agent executes.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
