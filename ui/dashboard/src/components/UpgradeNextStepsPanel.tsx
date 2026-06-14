/**
 * UpgradeNextStepsPanel — post-upgrade modal showing what changed and
 * any required/optional next steps stacked by the migration.
 *
 * Triggered by the system:upgraded WS event. Required steps must be
 * acknowledged before the panel can be closed. Optional steps can be
 * dismissed individually.
 */

import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Modal } from "@particle-academy/react-fancy";
import type { UpgradeNextStep } from "../types.js";
import { fetchUpgradeNextSteps, completeUpgradeStep, dismissUpgradeStep, fetchChangelog } from "../api.js";

export interface UpgradeNextStepsPanelProps {
  open: boolean;
  toVersion: string;
  fromVersion: string | null;
  onClose: () => void;
  /** When true, renders inline without the outer Modal wrapper (used inside UpgradeWizard step 3). */
  embedded?: boolean;
}

type ChangelogCommit = { hash: string; subject: string; body: string };

export function UpgradeNextStepsPanel({ open, toVersion, fromVersion, onClose, embedded = false }: UpgradeNextStepsPanelProps) {
  const navigate = useNavigate();
  const [steps, setSteps] = useState<UpgradeNextStep[]>([]);
  const [hasRequired, setHasRequired] = useState(false);
  const [commits, setCommits] = useState<ChangelogCommit[]>([]);
  const [working, setWorking] = useState<string | null>(null);

  const refresh = useCallback(() => {
    fetchUpgradeNextSteps("all")
      .then(({ steps: s, hasRequired: r }) => { setSteps(s); setHasRequired(r); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!open) return;
    refresh();
    // Load recent commits for the changelog summary
    fetchChangelog(8).then(({ commits: c }) => setCommits(c)).catch(() => {});
  }, [open, refresh]);

  const handleAction = useCallback(async (step: UpgradeNextStep) => {
    if (step.action) {
      if (step.action.kind === "navigate") {
        void navigate(step.action.target);
        onClose();
        return;
      }
      if (step.action.kind === "external-url") {
        window.open(step.action.target, "_blank", "noopener noreferrer");
      }
    }
    setWorking(step.id);
    const { ok, hasRequired: r } = await completeUpgradeStep(step.id).catch(() => ({ ok: false, hasRequired: hasRequired }));
    if (ok) {
      setSteps((prev) => prev.map((s) => s.id === step.id ? { ...s, status: "done" as const } : s));
      setHasRequired(r);
    }
    setWorking(null);
  }, [navigate, onClose, hasRequired]);

  const handleDismiss = useCallback(async (id: string) => {
    setWorking(id);
    const { ok, hasRequired: r } = await dismissUpgradeStep(id).catch(() => ({ ok: false, hasRequired: hasRequired }));
    if (ok) {
      setSteps((prev) => prev.map((s) => s.id === id ? { ...s, status: "dismissed" as const } : s));
      setHasRequired(r);
    }
    setWorking(null);
  }, [hasRequired]);

  // Superseded steps are invisible — a later migration cancelled them before the user saw them
  const pendingSteps = steps.filter((s) => s.status === "pending");
  const doneOrDismissed = steps.filter((s) => s.status === "done" || s.status === "dismissed");
  const canClose = !hasRequired;

  if (!open) return null;

  const inner = (
    <div className="flex flex-col gap-4 p-1">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-[11px] px-1.5 py-0.5 rounded bg-green/15 text-green font-semibold">Updated</span>
              {fromVersion && (
                <span className="text-[11px] text-muted-foreground font-mono">{fromVersion} → <span className="text-foreground font-semibold">{toVersion}</span></span>
              )}
              {!fromVersion && (
                <span className="text-[11px] text-foreground font-mono font-semibold">{toVersion}</span>
              )}
            </div>
            <h2 className="text-[16px] font-bold text-foreground">Aionima upgraded</h2>
          </div>
          {canClose && (
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-[18px] leading-none">×</button>
          )}
        </div>

        {/* Changelog */}
        {commits.length > 0 && (
          <div className="rounded-lg border border-border bg-surface1 p-3">
            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">What changed</div>
            <div className="space-y-1">
              {commits.slice(0, 6).map((c) => (
                <div key={c.hash} className="flex items-start gap-2 text-[11px]">
                  <span className="font-mono text-muted-foreground shrink-0">{c.hash.slice(0, 7)}</span>
                  <span className="text-foreground leading-relaxed">{c.subject}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Pending next steps */}
        {pendingSteps.length > 0 && (
          <div>
            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Next steps
              {pendingSteps.some((s) => s.required) && (
                <span className="ml-1.5 text-red font-semibold">· some required</span>
              )}
            </div>
            <div className="space-y-2">
              {pendingSteps.map((step) => (
                <div
                  key={step.id}
                  className={cn(
                    "rounded-lg border p-3",
                    step.required ? "border-red/30 bg-red/5" : "border-border bg-card",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        {step.required && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-red/15 text-red font-bold uppercase tracking-wide">Required</span>
                        )}
                        {!step.required && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted/30 text-muted-foreground font-semibold uppercase tracking-wide">Optional</span>
                        )}
                        <span className="text-[12px] font-semibold text-foreground">{step.title}</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">{step.description}</p>
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      {step.action && (
                        <Button
                          size="sm"
                          variant={step.required ? "default" : "outline"}
                          onClick={() => void handleAction(step)}
                          disabled={working === step.id}
                          className="text-[11px] h-7"
                        >
                          {working === step.id ? "…" : step.action.label}
                        </Button>
                      )}
                      {!step.required && (
                        <button
                          onClick={() => void handleDismiss(step.id)}
                          disabled={working === step.id}
                          className="text-[10px] text-muted-foreground hover:text-foreground px-1.5 disabled:opacity-40"
                        >
                          Dismiss
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Completed / dismissed */}
        {doneOrDismissed.length > 0 && pendingSteps.length === 0 && (
          <div className="text-[11px] text-muted-foreground text-center py-2">
            All steps complete.
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between pt-1 border-t border-border">
          <span className="text-[10px] text-muted-foreground">
            {hasRequired
              ? `${pendingSteps.filter((s) => s.required).length} required step${pendingSteps.filter((s) => s.required).length !== 1 ? "s" : ""} remaining`
              : "Ready to close"}
          </span>
          <Button
            size="sm"
            onClick={onClose}
            disabled={!canClose}
            className="text-[12px]"
          >
            {canClose ? "Done" : "Complete required steps to continue"}
          </Button>
        </div>
    </div>
  );

  if (embedded) {
    return (
      <div className="rounded-lg border border-border bg-card">
        {inner}
      </div>
    );
  }

  return (
    <Modal open={open} onClose={canClose ? onClose : undefined} size="lg">
      {inner}
    </Modal>
  );
}
