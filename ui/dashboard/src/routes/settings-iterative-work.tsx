/**
 * Settings → Iterative Work — s118 t437.
 *
 * Per-project owner control for autonomous-iteration mode. Lists every
 * workspace project; each row shows current status (enabled / cron / next
 * fire / in-flight) and lets the owner toggle on/off + edit the cron.
 *
 * Backend: cycle 40 shipped GET /api/projects/iterative-work/status?path=
 * + PUT /api/projects/iterative-work/config (mirroring existing
 * /api/projects route conventions). Hot-reload — the scheduler picks up
 * the new config on its next 30s tick.
 *
 * Deliberately omitted in this slice (deferred to follow-up cycles):
 *   - Pause/resume toggles (separate from enabled — pause halts fires
 *     without losing the config; needs scheduler API extension)
 *   - Kill-switch for in-flight iterations (best-effort cancel)
 *   - Cron-to-text humanizer ("every 30 minutes") — would need either
 *     a tiny lib dep or a hand-written formatter
 *   - Iteration log view (t438) — separate route
 *   - Race-to-DONE progress indicator (t439) — separate surface
 */

import { useEffect, useState, useCallback } from "react";
import { Card } from "@/components/ui/card";
import {
  fetchProjects,
  fetchIterativeWorkStatus,
  fetchIterativeWorkLog,
  fetchIterativeWorkProgress,
  updateIterativeWorkConfig,
  type ProjectInfo,
  type IterativeWorkProjectStatus,
  type IterativeWorkLogEntry,
  type IterativeWorkProgress,
} from "@/api.js";

interface RowState {
  status: IterativeWorkProjectStatus | null;
  log: IterativeWorkLogEntry[];
  progress: IterativeWorkProgress | null;
  filter: "all" | "errors";
  loading: boolean;
  error: string | null;
  pending: boolean;
  cronDraft: string;
}

function emptyRowState(): RowState {
  return {
    status: null,
    log: [],
    progress: null,
    filter: "all",
    loading: true,
    error: null,
    pending: false,
    cronDraft: "",
  };
}

/**
 * Two-tone Race-to-DONE bar — mirrors the terminal statusline shape:
 * solid bright-green for finished, striped dim-green for QA awaiting
 * sign-off, dim-white for remaining (backlog/doing/blocked). The gap
 * between solid and stripe is the visible "owner-review backlog" signal.
 *
 * Cell math matches statusline-command.sh exactly: floor each share, clamp
 * so done+qa <= width, remainder is empty.
 */
function ProgressBar({ progress }: { progress: IterativeWorkProgress }) {
  const W = 24;
  if (progress.totalTasks === 0) {
    return (
      <div className="text-[11px] text-muted-foreground italic">
        No tasks scoped to active focus.
      </div>
    );
  }
  const cDone = Math.floor((progress.doneTasks * W) / progress.totalTasks);
  const cQa = Math.min(W - cDone, Math.floor((progress.qaTasks * W) / progress.totalTasks));
  const cEmpty = W - cDone - cQa;
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <div className="font-mono text-[12px] tracking-tighter leading-none">
          <span className="text-emerald-400">{"█".repeat(cDone)}</span>
          <span className="text-emerald-700">{"▓".repeat(cQa)}</span>
          <span className="text-muted-foreground/40">{"░".repeat(cEmpty)}</span>
        </div>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {progress.percentComplete}%
        </span>
      </div>
      <div className="text-[10px] text-muted-foreground tabular-nums">
        {progress.doneTasks} done · {progress.qaTasks} qa · {progress.doingTasks} doing · {progress.backlogTasks} backlog
        {progress.blockedTasks > 0 && (
          <> · <span className="text-rose-400">{progress.blockedTasks} blocked</span></>
        )}
      </div>
    </div>
  );
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${String(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function LogStatusBadge({ status }: { status: IterativeWorkLogEntry["status"] }) {
  const colorClass = {
    running: "bg-amber-500/15 text-amber-400",
    done: "bg-emerald-500/15 text-emerald-400",
    error: "bg-rose-500/15 text-rose-400",
  }[status];
  return (
    <span className={`text-[9.5px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider ${colorClass}`}>
      {status}
    </span>
  );
}

function formatRelative(iso: string | null): string {
  if (iso === null) return "—";
  const t = new Date(iso).getTime();
  const now = Date.now();
  const deltaSec = Math.round((t - now) / 1000);
  const past = deltaSec < 0;
  const abs = Math.abs(deltaSec);
  if (abs < 60) return past ? `${String(abs)}s ago` : `in ${String(abs)}s`;
  if (abs < 3600) return past ? `${String(Math.round(abs / 60))}m ago` : `in ${String(Math.round(abs / 60))}m`;
  if (abs < 86400) return past ? `${String(Math.round(abs / 3600))}h ago` : `in ${String(Math.round(abs / 3600))}h`;
  return new Date(iso).toLocaleString();
}

function StatusBadge({ status }: { status: IterativeWorkProjectStatus }) {
  if (!status.enabled) {
    return <span className="text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wider bg-muted text-muted-foreground">Off</span>;
  }
  if (status.inFlight) {
    return <span className="text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wider bg-amber-500/15 text-amber-400">Running</span>;
  }
  if (status.cron === null) {
    return <span className="text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wider bg-blue-500/15 text-blue-400">Manual</span>;
  }
  if (status.nextFireAt === null) {
    return <span className="text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wider bg-rose-500/15 text-rose-400">Bad cron</span>;
  }
  return <span className="text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wider bg-emerald-500/15 text-emerald-400">On</span>;
}

function ProjectRow({ project }: { project: ProjectInfo }) {
  const [state, setState] = useState<RowState>(emptyRowState);

  const refresh = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const [status, log, progress] = await Promise.all([
        fetchIterativeWorkStatus(project.path),
        fetchIterativeWorkLog(project.path, 20).catch(() => [] as IterativeWorkLogEntry[]),
        fetchIterativeWorkProgress(project.path).catch(() => null),
      ]);
      setState((s) => ({
        ...s,
        status,
        log,
        progress,
        loading: false,
        error: null,
        pending: false,
        cronDraft: status.cron ?? "",
      }));
    } catch (err) {
      setState((s) => ({
        ...s,
        status: null,
        log: [],
        progress: null,
        loading: false,
        error: err instanceof Error ? err.message : String(err),
        pending: false,
        cronDraft: "",
      }));
    }
  }, [project.path]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = useCallback(async (next: { enabled?: boolean; cron?: string }) => {
    setState((s) => ({ ...s, pending: true, error: null }));
    try {
      await updateIterativeWorkConfig({
        path: project.path,
        iterativeWork: next,
      });
      await refresh();
    } catch (err) {
      setState((s) => ({
        ...s,
        pending: false,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }, [project.path, refresh]);

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold truncate">{project.name}</div>
          <div className="text-[11px] text-muted-foreground truncate">{project.path}</div>
        </div>
        {state.status && <StatusBadge status={state.status} />}
      </div>

      {state.loading && <div className="text-[11px] text-muted-foreground">Loading…</div>}
      {state.error !== null && (
        <div className="text-[11px] text-rose-400 break-all">{state.error}</div>
      )}

      {state.status && !state.loading && (
        <>
          {state.progress && (
            <div className="pt-1 pb-2 border-b border-border/40">
              <div className="text-[10px] uppercase tracking-wider text-foreground/60 mb-1">Race to DONE — active focus</div>
              <ProgressBar progress={state.progress} />
            </div>
          )}

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-[12px]">
              <input
                type="checkbox"
                checked={state.status.enabled}
                disabled={state.pending}
                onChange={(e) => void save({ enabled: e.target.checked, cron: state.cronDraft.trim() === "" ? undefined : state.cronDraft })}
              />
              Enable iterative-work
            </label>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="*/30 * * * *"
              className="flex-1 h-8 rounded border border-input bg-card px-2 text-[12px] font-mono"
              value={state.cronDraft}
              disabled={state.pending}
              onChange={(e) => setState((s) => ({ ...s, cronDraft: e.target.value }))}
            />
            <button
              type="button"
              className="h-8 px-3 rounded bg-primary text-primary-foreground text-[11px] font-semibold disabled:opacity-50"
              disabled={state.pending || state.cronDraft === (state.status.cron ?? "")}
              onClick={() => void save({ enabled: state.status?.enabled ?? false, cron: state.cronDraft.trim() === "" ? undefined : state.cronDraft })}
            >
              Save cron
            </button>
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            <div>
              <span className="text-foreground/70">Last fired:</span> {formatRelative(state.status.lastFiredAt)}
            </div>
            <div>
              <span className="text-foreground/70">Next fire:</span> {formatRelative(state.status.nextFireAt)}
            </div>
          </div>

          <div className="pt-2 border-t border-border/50">
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-[11px] font-semibold text-foreground/70 uppercase tracking-wider">Recent fires</div>
              <div className="flex gap-1 text-[10px]">
                <button
                  type="button"
                  className={`px-1.5 py-0.5 rounded ${state.filter === "all" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"}`}
                  onClick={() => setState((s) => ({ ...s, filter: "all" }))}
                >
                  All
                </button>
                <button
                  type="button"
                  className={`px-1.5 py-0.5 rounded ${state.filter === "errors" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"}`}
                  onClick={() => setState((s) => ({ ...s, filter: "errors" }))}
                >
                  Errors only
                </button>
                <button
                  type="button"
                  className="px-1.5 py-0.5 rounded text-muted-foreground hover:text-foreground"
                  onClick={() => void refresh()}
                  disabled={state.pending || state.loading}
                >
                  ↻
                </button>
              </div>
            </div>
            {state.log.length === 0 ? (
              <div className="text-[11px] text-muted-foreground italic">
                No fires recorded yet. {state.status.enabled && state.status.cron !== null
                  ? `Next fire ${formatRelative(state.status.nextFireAt).toLowerCase()}.`
                  : "Enable iterative-work + set a cron above to start."}
              </div>
            ) : (
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {state.log
                  .filter((e) => state.filter !== "errors" || e.status === "error")
                  .map((entry) => (
                    <div
                      key={entry.firedAt}
                      className="flex items-center gap-2 text-[11px] py-1 px-2 rounded bg-card/50"
                      title={entry.error}
                    >
                      <LogStatusBadge status={entry.status} />
                      <span className="font-mono text-muted-foreground tabular-nums">{formatRelative(entry.firedAt)}</span>
                      <span className="text-muted-foreground">·</span>
                      <span className="text-muted-foreground">{formatDuration(entry.durationMs)}</span>
                      {entry.error !== undefined && (
                        <span className="text-rose-400 truncate flex-1">{entry.error}</span>
                      )}
                    </div>
                  ))}
                {state.filter === "errors" && state.log.every((e) => e.status !== "error") && (
                  <div className="text-[11px] text-muted-foreground italic">No errors in the recent buffer.</div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

export default function SettingsIterativeWorkPage() {
  const [projects, setProjects] = useState<ProjectInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const list = await fetchProjects();
        setProjects(list);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Iterative Work</h1>
        <p className="text-[12px] text-muted-foreground">
          Enable autonomous iteration per project. Aion reads the project's tynn workflow on each cron tick,
          picks the highest-priority READY task, and ships a slice. Disabled by default.
        </p>
      </div>

      {error !== null && (
        <Card className="p-4 text-[12px] text-rose-400 break-all">{error}</Card>
      )}

      {projects === null && error === null && (
        <Card className="p-4 text-[12px] text-muted-foreground">Loading projects…</Card>
      )}

      {projects && projects.length === 0 && (
        <Card className="p-4 text-[12px] text-muted-foreground">
          No workspace projects configured. Add one under Settings → Gateway → workspace.projects first.
        </Card>
      )}

      {projects && projects.length > 0 && (
        <div className="grid gap-3">
          {projects.map((p) => (
            <ProjectRow key={p.path} project={p} />
          ))}
        </div>
      )}
    </div>
  );
}
