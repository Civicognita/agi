/**
 * IterativeWorkTab — per-project iterative-work configuration UI.
 *
 * s118 t442 D1 — replaces the old `/settings/iterative-work` page. Each
 * eligible project (web/app/ops/administration category) has this tab with:
 *
 * - Enable toggle (on/off)
 * - Cadence dropdown (type-aware: dev=30m/1h; ops=30m through 1w)
 * - Status panel (next fire, last fire, in-flight indicator)
 * - Iteration log (Recent fires, scheduler-side ring buffer)
 * - Race-to-DONE bar (story progress derived from PmProvider)
 *
 * The cron expression is auto-staggered server-side via D3's
 * cadenceToStaggeredCron; the user only picks cadence.
 */

import { useEffect, useState } from "react";
import {
  type IterativeWorkCadence,
  type ProjectInfo,
  cadenceOptionsForCategory,
} from "../types";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Select } from "./ui/select";

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${String(res.status)}`);
  }
  return res.json() as Promise<T>;
}

interface IterativeWorkTabProps {
  project: ProjectInfo;
}

interface StatusResponse {
  enabled: boolean;
  cron: string | null;
  cadence?: string | null;
  nextFire?: string | null;
  lastFire?: string | null;
  inFlight?: boolean;
}

interface LogEntry {
  ts: string;
  outcome: "success" | "error" | "skipped";
  message?: string;
}

interface ProgressResponse {
  totalTasks: number;
  doneTasks: number;
  qaTasks: number;
  doingTasks: number;
  backlogTasks: number;
  blockedTasks: number;
  inProgressTasks: number;
  percentComplete: number;
}

export function IterativeWorkTab({ project }: IterativeWorkTabProps): JSX.Element {
  // Effective category — project.json `category` override wins over the
  // projectType-default. Mirrors the gateway API's eligibility logic.
  const category = project.category ?? project.projectType?.category;
  const cadenceOptions = cadenceOptionsForCategory(category);

  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [progress, setProgress] = useState<ProgressResponse | null>(null);
  const [enabled, setEnabled] = useState<boolean>(false);
  const [cadence, setCadence] = useState<IterativeWorkCadence | "">("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refresh status + log on mount and after successful saves.
  const refresh = async (): Promise<void> => {
    try {
      const s = await fetchJson<StatusResponse>(
        `/api/projects/iterative-work/status?path=${encodeURIComponent(project.path)}`,
      );
      setStatus(s);
      setEnabled(s.enabled);
      if (s.cadence && cadenceOptions.includes(s.cadence as IterativeWorkCadence)) {
        setCadence(s.cadence as IterativeWorkCadence);
      } else if (cadenceOptions.length > 0 && !cadence) {
        setCadence(cadenceOptions[0]!);
      }

      const l = await fetchJson<{ entries: LogEntry[] }>(
        `/api/projects/iterative-work/log?path=${encodeURIComponent(project.path)}&limit=20`,
      );
      setLog(l.entries ?? []);

      // Race-to-DONE progress (s118 t439). The endpoint returns 503 when no
      // PmProvider is wired or the provider doesn't expose getActiveFocusProgress
      // — render the bar without a value rather than blowing up the whole tab.
      try {
        const p = await fetchJson<ProgressResponse>(
          `/api/projects/iterative-work/progress?path=${encodeURIComponent(project.path)}`,
        );
        setProgress(p);
      } catch {
        setProgress(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => { void refresh(); }, 30_000);
    return (): void => { window.clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.path]);

  const save = async (): Promise<void> => {
    if (!cadence && enabled) {
      setError("Pick a cadence before enabling iterative-work.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await fetchJson("/api/projects/iterative-work/config", {
        method: "PUT",
        body: JSON.stringify({
          path: project.path,
          iterativeWork: {
            enabled,
            ...(cadence ? { cadence } : {}),
          },
        }),
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (!(project.iterativeWorkEligible ?? project.projectType?.iterativeWorkEligible)) {
    return (
      <Card className="p-4 text-[13px] text-muted-foreground">
        Iterative work is not available for the <span className="font-mono">{project.projectType?.id ?? project.category ?? "(unknown)"}</span> project type.
        Eligible categories: web, app, ops, administration.
      </Card>
    );
  }

  return (
    <Card className="p-4 space-y-4" data-testid="iterative-work-tab">
      <div>
        <h3 className="text-[13px] font-semibold mb-2">Iterative Work</h3>
        <p className="text-[12px] text-muted-foreground">
          When enabled, Aion participates in the tynn workflow on this project's behalf — race-to-DONE, look-for-MORE, slice discipline. Cadence picks the rhythm; the system auto-staggers fire times so projects don't all fire at the same minute.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-[12px]">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            data-testid="iterative-work-toggle"
          />
          <span>Enable iterative work</span>
        </label>
      </div>

      <div>
        <label className="block text-[11px] font-semibold text-muted-foreground mb-1">Cadence</label>
        <Select
          className="text-[12px]"
          list={[
            { value: "", label: "(pick one)" },
            ...cadenceOptions.map((c) => ({ value: c, label: cadenceLabel(c) })),
          ]}
          value={cadence}
          onValueChange={(v) => setCadence(v as IterativeWorkCadence)}
          data-testid="iterative-work-cadence"
          disabled={!enabled}
        />
        <p className="text-[11px] text-muted-foreground mt-1">
          Available cadences for <span className="font-mono">{category}</span>: {cadenceOptions.join(", ")}.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={() => { void save(); }} disabled={saving} data-testid="iterative-work-save">
          {saving ? "Saving…" : "Save"}
        </Button>
        {error && <span className="text-[12px] text-red">{error}</span>}
      </div>

      {status && (
        <div className="text-[12px] space-y-1 pt-2 border-t border-border">
          <div><span className="text-muted-foreground">Status:</span> <span className="font-mono">{status.enabled ? "enabled" : "disabled"}</span></div>
          {status.cron && <div><span className="text-muted-foreground">Cron (auto-staggered):</span> <span className="font-mono">{status.cron}</span></div>}
          {status.nextFire && <div><span className="text-muted-foreground">Next fire:</span> <span className="font-mono">{status.nextFire}</span></div>}
          {status.lastFire && <div><span className="text-muted-foreground">Last fire:</span> <span className="font-mono">{status.lastFire}</span></div>}
          {status.inFlight && <div className="text-yellow">In flight…</div>}
        </div>
      )}

      {progress && (
        <div className="pt-2 border-t border-border" data-testid="race-to-done">
          <h4 className="text-[12px] font-semibold mb-2">Race to DONE</h4>
          <RaceToDoneBar progress={progress} />
          <div className="text-[11px] text-muted-foreground mt-1">
            {progress.doneTasks} done · {progress.qaTasks} qa · {progress.doingTasks} doing · {progress.backlogTasks} backlog
            {progress.blockedTasks > 0 && <> · <span className="text-yellow">{progress.blockedTasks} blocked</span></>}
            {" · "}
            <span data-testid="race-to-done-percent">{progress.percentComplete}%</span> complete
          </div>
        </div>
      )}

      <div className="pt-2 border-t border-border">
        <h4 className="text-[12px] font-semibold mb-2">Recent fires</h4>
        {log.length === 0 ? (
          <div className="text-[12px] text-muted-foreground">No fires yet.</div>
        ) : (
          <ul className="text-[12px] space-y-1">
            {log.map((e, i) => (
              <li key={i} className="flex gap-2">
                <span className="font-mono text-muted-foreground">{e.ts}</span>
                <span className={e.outcome === "success" ? "text-green" : e.outcome === "error" ? "text-red" : "text-muted-foreground"}>
                  {e.outcome}
                </span>
                {e.message && <span className="text-muted-foreground truncate">{e.message}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

/**
 * Two-tone Race-to-DONE bar (s118 t439). Mirrors the terminal statusline shape:
 * finished portion solid (green), qa portion striped (yellow), rest empty.
 */
function RaceToDoneBar({ progress }: { progress: ProgressResponse }): JSX.Element {
  const total = Math.max(progress.totalTasks, 1);
  const donePct = (progress.doneTasks / total) * 100;
  const qaPct = (progress.qaTasks / total) * 100;
  return (
    <div className="w-full h-2 bg-muted rounded overflow-hidden flex" data-testid="race-to-done-bar" role="progressbar" aria-valuenow={progress.percentComplete} aria-valuemin={0} aria-valuemax={100}>
      <div
        className="bg-green h-full"
        style={{ width: `${donePct}%` }}
        data-testid="race-to-done-bar-done"
      />
      <div
        className="h-full"
        style={{
          width: `${qaPct}%`,
          backgroundImage: "repeating-linear-gradient(45deg, var(--yellow, #d4b95a) 0 4px, transparent 4px 8px)",
          backgroundColor: "rgba(212, 185, 90, 0.15)",
        }}
        data-testid="race-to-done-bar-qa"
      />
    </div>
  );
}

function cadenceLabel(c: IterativeWorkCadence): string {
  switch (c) {
    case "30m": return "Every 30 minutes";
    case "1h": return "Every hour";
    case "5h": return "Every 5 hours";
    case "12h": return "Every 12 hours";
    case "1d": return "Daily";
    case "5d": return "Every 5 days";
    case "1w": return "Weekly";
  }
}
