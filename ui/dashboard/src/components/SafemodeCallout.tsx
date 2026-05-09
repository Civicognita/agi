/**
 * SafemodeCallout — red banner shown on the Admin route when the gateway
 * booted into safemode after a detected crash. Displays the incident report
 * summary and a "Recover now" action that runs reconciliation and exits
 * safemode.
 */

import { useEffect, useState } from "react";
import { Callout } from "@particle-academy/react-fancy";
import { Button } from "@/components/ui/button";
import { useSafemode, useExitSafemode, useAdminIncidentMarkdown } from "@/hooks";
import type { SafemodeSnapshot } from "@/types.js";

function investigationBadge(inv: SafemodeSnapshot["investigation"]): string {
  if (inv.status === "pending") return "pending";
  if (inv.status === "running") return "investigating…";
  if (inv.status === "complete") return inv.autoRecoverable ? "auto-recoverable" : "manual action needed";
  return `failed (${inv.error.slice(0, 40)})`;
}

function incidentIdFromPath(path: string | null): string | null {
  if (path === null) return null;
  const match = /\/([^/]+)\.md$/.exec(path);
  return match?.[1] ?? null;
}

export function SafemodeCallout() {
  const { data: snap } = useSafemode();
  const exitSafemode = useExitSafemode();
  const [showReport, setShowReport] = useState(false);
  const incidentId = incidentIdFromPath(snap?.reportPath ?? null);
  const { data: markdown } = useAdminIncidentMarkdown(showReport ? incidentId : null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  useEffect(() => {
    if (exitSafemode.error !== null) {
      setErrMsg(exitSafemode.error instanceof Error ? exitSafemode.error.message : String(exitSafemode.error));
    }
  }, [exitSafemode.error]);

  if (snap === undefined || !snap.active) return null;

  const onRecover = (): void => {
    setErrMsg(null);
    exitSafemode.mutate();
  };

  return (
    <Callout color="red" className="mb-4 px-4 py-4 border-2">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="text-[14px] font-bold text-red mb-1">
            SAFEMODE — last shutdown was a crash
          </div>
          <div className="text-[12px] text-muted-foreground mb-2">
            Since {snap.since ?? "unknown"} · investigation: {investigationBadge(snap.investigation)}
          </div>
          <div className="text-[13px] text-card-foreground mb-3">
            The gateway is blocking mutation endpoints until recovery completes.
            Review the incident report and click Recover to start managed
            containers and exit safemode.
          </div>
          {errMsg !== null ? (
            <Callout color="red" className="mb-3 px-3 py-2 text-[12px]">
              {errMsg}
            </Callout>
          ) : null}
          <div className="flex gap-2">
            <Button size="sm" onClick={onRecover} disabled={exitSafemode.isPending}>
              {exitSafemode.isPending ? "Recovering…" : "Recover now"}
            </Button>
            {snap.reportPath !== null ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowReport((s) => !s)}
              >
                {showReport ? "Hide report" : "View report"}
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      {showReport && markdown !== undefined ? (
        <pre className="mt-4 p-3 rounded bg-surface0 text-[11px] text-card-foreground overflow-auto max-h-96 whitespace-pre-wrap">
          {markdown}
        </pre>
      ) : null}
    </Callout>
  );
}
