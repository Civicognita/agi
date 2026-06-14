/**
 * TaskmasterTab — per-project job browser registered on ProjectDetail.
 *
 * Shows every job TaskMaster ever dispatched for this project (pending,
 * running, checkpoint, complete, failed) with a status filter, createdAt
 * timing, and expandable rows that reveal the worker's persisted summary.
 *
 * Complements the chat drawer's Work Queue view, which is narrowed to
 * active-only work so it doesn't pile up.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchTaskmasterJobs, approveTaskmasterJob, rejectTaskmasterJob } from "../api.js";
import type { WorkerJobSummary } from "../types.js";
import { useDashboardWS } from "../hooks.js";
import { cn } from "../lib/utils.js";
import { DevNotes } from "@/components/ui/dev-notes";

type StatusFilter = "active" | "all" | "complete" | "failed";

function statusColor(status: WorkerJobSummary["status"]): string {
  if (status === "complete") return "text-green border-green/40";
  if (status === "failed") return "text-red border-red/40";
  if (status === "checkpoint") return "text-yellow border-yellow/40";
  if (status === "running") return "text-blue border-blue/40";
  return "text-muted-foreground border-border";
}

function formatTiming(job: WorkerJobSummary): string {
  const started = new Date(job.createdAt).getTime();
  if (job.completedAt !== undefined) {
    const finished = new Date(job.completedAt).getTime();
    const secs = Math.max(1, Math.round((finished - started) / 1000));
    return `${new Date(job.createdAt).toLocaleString()} · ${String(secs)}s`;
  }
  return new Date(job.createdAt).toLocaleString();
}

export function TaskmasterTab({ projectPath }: { projectPath: string }): React.ReactElement {
  const [jobs, setJobs] = useState<WorkerJobSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>("active");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    try {
      const fetched = await fetchTaskmasterJobs(projectPath);
      setJobs(fetched);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load jobs");
    }
  }, [projectPath]);

  const handleApprove = useCallback(async (jobId: string) => {
    setActionPending((p) => ({ ...p, [jobId]: true }));
    try {
      await approveTaskmasterJob(jobId);
      void load();
    } finally {
      setActionPending((p) => ({ ...p, [jobId]: false }));
    }
  }, [load]);

  const handleReject = useCallback(async (jobId: string) => {
    setActionPending((p) => ({ ...p, [jobId]: true }));
    try {
      await rejectTaskmasterJob(jobId);
      void load();
    } finally {
      setActionPending((p) => ({ ...p, [jobId]: false }));
    }
  }, [load]);

  useEffect(() => {
    setLoading(true);
    void load().finally(() => setLoading(false));
    // 30s safety-net poll — primary update path is the WS subscription below.
    const interval = setInterval(() => { void load(); }, 30_000);
    return () => clearInterval(interval);
  }, [load]);

  // Live updates — any TM event for this project triggers a refresh.
  useDashboardWS(
    useCallback((event) => {
      if (event.type === "tm:job_update" || event.type === "tm:report_ready") {
        void load();
      }
    }, [load]),
  );

  const filtered = useMemo(() => {
    if (filter === "all") return jobs;
    if (filter === "complete") return jobs.filter((j) => j.status === "complete");
    if (filter === "failed") return jobs.filter((j) => j.status === "failed");
    // active
    return jobs.filter((j) => j.status === "pending" || j.status === "running" || j.status === "checkpoint");
  }, [jobs, filter]);

  const counts = useMemo(() => ({
    all: jobs.length,
    active: jobs.filter((j) => j.status === "pending" || j.status === "running" || j.status === "checkpoint").length,
    complete: jobs.filter((j) => j.status === "complete").length,
    failed: jobs.filter((j) => j.status === "failed").length,
  }), [jobs]);

  return (
    <div className="flex flex-col gap-3">
      {/* Filter row */}
      <div className="flex items-center gap-1.5 text-[11px]">
        {(["active", "all", "complete", "failed"] as StatusFilter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              "px-2.5 py-1 rounded-md border cursor-pointer capitalize",
              filter === f
                ? "border-blue bg-secondary text-blue"
                : "border-border bg-transparent text-muted-foreground",
            )}
          >
            {f} <span className="opacity-60">({String(counts[f])})</span>
          </button>
        ))}
        <button
          onClick={() => { void load(); }}
          className="ml-auto px-2.5 py-1 rounded-md border border-border bg-transparent text-muted-foreground text-[11px] cursor-pointer"
        >
          Refresh
        </button>
      </div>

      {/* Status */}
      {loading && jobs.length === 0 && <div className="text-[12px] text-muted-foreground">Loading…</div>}
      {error !== null && <div className="text-[12px] text-red">{error}</div>}
      {!loading && filtered.length === 0 && error === null && (
        <div className="text-[12px] text-muted-foreground italic">
          No jobs matching filter.
        </div>
      )}

      {/* Checkpoint banner — shown when any active job is paused for approval */}
      {filtered.some((j) => j.status === "checkpoint") && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-yellow/40 bg-yellow/5 text-yellow text-[11px]">
          <span className="font-semibold">⏸</span>
          <span>
            {String(filtered.filter((j) => j.status === "checkpoint").length)} job
            {filtered.filter((j) => j.status === "checkpoint").length !== 1 ? "s" : ""} paused for approval —
            expand to review
          </span>
        </div>
      )}

      {/* Job list */}
      <div className="flex flex-col gap-1.5">
        {filtered.map((job) => {
          const expanded = expandedId === job.id;
          return (
            <div
              key={job.id}
              className="rounded-md border border-border bg-card/50 overflow-hidden"
            >
              <button
                type="button"
                onClick={() => setExpandedId(expanded ? null : job.id)}
                className="w-full flex items-start gap-3 px-3 py-2 text-left cursor-pointer hover:bg-card"
              >
                <span
                  className={cn(
                    "shrink-0 px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase border",
                    statusColor(job.status),
                  )}
                >
                  {job.status}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] text-foreground whitespace-nowrap overflow-hidden text-ellipsis">
                    {job.description}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    {job.workers.length > 0 && <span>{job.workers.join(", ")} · </span>}
                    <span>{formatTiming(job)}</span>
                    {job.status === "checkpoint" && (
                      <span className="ml-1.5 text-yellow font-medium">⏸ awaiting approval</span>
                    )}
                  </div>
                </div>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {expanded ? "▾" : "▸"}
                </span>
              </button>

              {expanded && (
                <div className="px-3 py-2 border-t border-border bg-background/50 text-[11px] space-y-2">
                  {job.status === "checkpoint" && (
                    <div className="flex items-center gap-2 py-1.5 border-b border-yellow/30">
                      <span className="text-yellow font-semibold text-[11px]">
                        ⏸ Paused for review — approve to continue or reject to cancel
                      </span>
                      <div className="ml-auto flex gap-1.5 shrink-0">
                        <button
                          type="button"
                          disabled={actionPending[job.id] === true}
                          onClick={(e) => { e.stopPropagation(); void handleApprove(job.id); }}
                          className="px-2.5 py-1 rounded border border-green/60 text-green text-[10px] font-semibold disabled:opacity-40 cursor-pointer hover:bg-green/10"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          disabled={actionPending[job.id] === true}
                          onClick={(e) => { e.stopPropagation(); void handleReject(job.id); }}
                          className="px-2.5 py-1 rounded border border-red/60 text-red text-[10px] font-semibold disabled:opacity-40 cursor-pointer hover:bg-red/10"
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  )}
                  {job.error !== undefined && (
                    <div>
                      <div className="text-[10px] uppercase font-semibold text-red mb-0.5">Error</div>
                      <div className="text-red whitespace-pre-wrap">{job.error}</div>
                    </div>
                  )}
                  {job.summary !== undefined && job.summary.length > 0 && (
                    <div>
                      <div className="text-[10px] uppercase font-semibold text-muted-foreground mb-0.5">Summary</div>
                      <div className="whitespace-pre-wrap text-foreground">{job.summary}</div>
                    </div>
                  )}
                  {job.summary === undefined && job.error === undefined && (
                    <div className="text-muted-foreground italic">
                      No summary yet — worker is still in flight or the report was not persisted (older job).
                    </div>
                  )}
                  {job.toolCalls && job.toolCalls.length > 0 && (
                    <div>
                      <div className="text-[10px] uppercase font-semibold text-muted-foreground mb-0.5">
                        Tool calls ({String(job.toolCalls.length)})
                      </div>
                      <div className="font-mono text-[10px] text-muted-foreground">
                        {job.toolCalls.map((tc, i) => (
                          <div key={`${tc.name}-${String(i)}`}>
                            {new Date(tc.ts).toLocaleTimeString()} · {tc.name}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {job.tokens !== undefined && (
                    <div className="text-[10px] text-muted-foreground">
                      Tokens: {String(job.tokens.input)} in / {String(job.tokens.output)} out
                    </div>
                  )}
                  <div className="text-[10px] text-muted-foreground font-mono opacity-60">
                    {job.id}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <DevNotes title="Taskmaster tab — dev notes">
        <DevNotes.Item kind="info" heading="s101 t404 (2026-05-18) — Checkpoint approval UI">
          Added Approve/Reject buttons to the expanded job detail row when status is &quot;checkpoint&quot;.
          A banner above the job list counts paused jobs. Collapsed rows show &quot;⏸ awaiting approval&quot;
          subtitle. Pairs with t406 enforced-chain dispatch (hacker→tester, writer→editor, modeler→linguist).
        </DevNotes.Item>
      </DevNotes>
    </div>
  );
}
