/**
 * ScheduledJobsTab — per-project recurring job scheduler UI (s118 redesign).
 *
 * Replaces the single-mode IterativeWorkTab with a multi-type job list.
 * Each job has a type (pm-loop / prompt / command / action), a cadence,
 * and a status indicator. Users can add/edit/delete jobs and trigger them
 * manually via "Run Now".
 */

import { useEffect, useState, useCallback } from "react";
import type {
  ScheduledJob,
  ScheduledJobStatus,
  ScheduledJobType,
  IterativeWorkCadence,
  ProjectInfo,
} from "../types";
import { cadenceOptionsForCategory } from "../types";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Select } from "./ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { DevNotes } from "./ui/dev-notes";

const ALL_CADENCES: IterativeWorkCadence[] = ["30m", "1h", "5h", "12h", "1d", "5d", "1w"];

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${String(res.status)}`);
  }
  return res.json() as Promise<T>;
}

interface LogEntry {
  ts?: string;
  firedAt?: string;
  outcome?: "success" | "error" | "skipped";
  status?: "running" | "done" | "error";
  message?: string;
  error?: string;
  cron?: string;
}

interface ScheduledJobsTabProps {
  project: ProjectInfo;
}

const JOB_TYPE_LABELS: Record<ScheduledJobType, string> = {
  "pm-loop": "PM Loop",
  prompt: "Prompt",
  command: "Command",
  action: "Plugin Action",
};

const JOB_TYPE_COLORS: Record<ScheduledJobType, string> = {
  "pm-loop": "text-blue border-blue/40 bg-blue/5",
  prompt: "text-green border-green/40 bg-green/5",
  command: "text-yellow border-yellow/40 bg-yellow/5",
  action: "text-primary border-primary/40 bg-primary/5",
};

function cadenceLabel(c: IterativeWorkCadence): string {
  const labels: Record<IterativeWorkCadence, string> = {
    "30m": "Every 30 min", "1h": "Every hour", "5h": "Every 5 hours",
    "12h": "Every 12 hours", "1d": "Daily", "5d": "Every 5 days", "1w": "Weekly",
  };
  return labels[c];
}

// ---------------------------------------------------------------------------
// Add / Edit dialog
// ---------------------------------------------------------------------------

interface JobFormState {
  name: string;
  type: ScheduledJobType;
  enabled: boolean;
  cadence: IterativeWorkCadence | "";
  prompt: string;
  command: string;
  actionId: string;
}

const EMPTY_FORM: JobFormState = {
  name: "", type: "pm-loop", enabled: true, cadence: "", prompt: "", command: "", actionId: "",
};

function jobToForm(job: ScheduledJob): JobFormState {
  return {
    name: job.name,
    type: job.type,
    enabled: job.enabled,
    cadence: job.cadence ?? "",
    prompt: job.type === "prompt" ? job.prompt : "",
    command: job.type === "command" ? job.command : "",
    actionId: job.type === "action" ? job.actionId : "",
  };
}

function formToJobBody(form: JobFormState): Record<string, unknown> {
  const base: Record<string, unknown> = {
    name: form.name,
    type: form.type,
    enabled: form.enabled,
    ...(form.cadence ? { cadence: form.cadence } : {}),
  };
  if (form.type === "prompt") base["prompt"] = form.prompt;
  if (form.type === "command") base["command"] = form.command;
  if (form.type === "action") base["actionId"] = form.actionId;
  return base;
}

interface JobDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (job: Record<string, unknown>) => Promise<void>;
  initial?: ScheduledJob | null;
  projectCategory?: string;
  saving: boolean;
  error: string | null;
}

function JobDialog({ open, onClose, onSave, initial, projectCategory, saving, error }: JobDialogProps) {
  const [form, setForm] = useState<JobFormState>(initial ? jobToForm(initial) : EMPTY_FORM);
  useEffect(() => { setForm(initial ? jobToForm(initial) : EMPTY_FORM); }, [initial, open]);

  const pmLoopCadences = cadenceOptionsForCategory(projectCategory);
  const availableCadences = form.type === "pm-loop" && pmLoopCadences.length > 0 ? pmLoopCadences : ALL_CADENCES;

  const set = <K extends keyof JobFormState>(key: K, value: JobFormState[K]): void =>
    setForm((f) => ({ ...f, [key]: value }));

  const handleTypeChange = (t: ScheduledJobType): void => {
    setForm((f) => ({ ...f, type: t, cadence: "" }));
  };

  const canSave =
    form.name.trim().length > 0 &&
    (form.type !== "prompt" || form.prompt.trim().length > 0) &&
    (form.type !== "command" || form.command.trim().length > 0) &&
    (form.type !== "action" || form.actionId.trim().length > 0);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit Job" : "Add Scheduled Job"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <label className="block text-[11px] font-semibold text-muted-foreground mb-1">Name</label>
            <input
              type="text"
              className="w-full text-[12px] border border-border rounded px-2 py-1.5 bg-background"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="e.g. Nightly lint check"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-muted-foreground mb-1">Type</label>
            <Select
              className="text-[12px]"
              list={[
                { value: "pm-loop", label: "PM Loop — race-to-DONE iterative work" },
                { value: "prompt", label: "Prompt — send a recurring message" },
                { value: "command", label: "Command — run a shell command" },
                { value: "action", label: "Plugin Action — invoke a plugin handler" },
              ]}
              value={form.type}
              onValueChange={(v) => handleTypeChange(v as ScheduledJobType)}
            />
          </div>

          {form.type === "pm-loop" && (
            <p className="text-[11px] text-muted-foreground bg-muted/30 rounded px-3 py-2">
              Fires the iterative-work discipline prompt for this project — Aion picks up READY tasks
              and races to DONE per the tynn workflow.
            </p>
          )}

          {form.type === "prompt" && (
            <div>
              <label className="block text-[11px] font-semibold text-muted-foreground mb-1">Prompt</label>
              <textarea
                className="w-full text-[12px] border border-border rounded px-2 py-1.5 bg-background resize-y min-h-[80px]"
                value={form.prompt}
                onChange={(e) => set("prompt", e.target.value)}
                placeholder="Enter the recurring prompt text…"
              />
            </div>
          )}

          {form.type === "command" && (
            <div>
              <label className="block text-[11px] font-semibold text-muted-foreground mb-1">Shell command</label>
              <input
                type="text"
                className="w-full text-[12px] border border-border rounded px-2 py-1.5 bg-background font-mono"
                value={form.command}
                onChange={(e) => set("command", e.target.value)}
                placeholder="e.g. npm run lint"
              />
              <p className="text-[10px] text-muted-foreground mt-1">Runs via <code>agi bash</code> — logged and policy-gated.</p>
            </div>
          )}

          {form.type === "action" && (
            <div>
              <label className="block text-[11px] font-semibold text-muted-foreground mb-1">Action ID</label>
              <input
                type="text"
                className="w-full text-[12px] border border-border rounded px-2 py-1.5 bg-background font-mono"
                value={form.actionId}
                onChange={(e) => set("actionId", e.target.value)}
                placeholder="plugin-id:action-name"
              />
              <p className="text-[10px] text-muted-foreground mt-1">ID of a registered plugin action.</p>
            </div>
          )}

          <div>
            <label className="block text-[11px] font-semibold text-muted-foreground mb-1">Cadence</label>
            <Select
              className="text-[12px]"
              list={[
                { value: "", label: "(no automatic schedule — manual only)" },
                ...availableCadences.map((c) => ({ value: c, label: cadenceLabel(c) })),
              ]}
              value={form.cadence}
              onValueChange={(v) => set("cadence", v as IterativeWorkCadence | "")}
            />
          </div>

          <label className="flex items-center gap-2 text-[12px]">
            <input type="checkbox" checked={form.enabled} onChange={(e) => set("enabled", e.target.checked)} />
            <span>Enabled</span>
          </label>

          {error && <p className="text-[11px] text-red">{error}</p>}

          <div className="flex gap-2 pt-1">
            <Button onClick={() => { void onSave(formToJobBody(form)); }} disabled={saving || !canSave}>
              {saving ? "Saving…" : "Save"}
            </Button>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Log panel
// ---------------------------------------------------------------------------

function JobLogPanel({ projectPath, jobId }: { projectPath: string; jobId: string }) {
  const [log, setLog] = useState<LogEntry[]>([]);
  useEffect(() => {
    void fetchJson<{ entries: LogEntry[] }>(
      `/api/projects/iterative-work/log?path=${encodeURIComponent(projectPath)}&jobId=${encodeURIComponent(jobId)}&limit=10`,
    ).then((r) => { setLog(r.entries ?? []); }).catch(() => { /* non-fatal */ });
  }, [projectPath, jobId]);

  if (log.length === 0) return <div className="text-[11px] text-muted-foreground">No fires yet.</div>;
  return (
    <ul className="text-[11px] space-y-0.5">
      {log.map((e, i) => {
        const ts = e.ts ?? e.firedAt ?? "";
        const outcome = e.outcome ?? (e.status === "done" ? "success" : e.status === "running" ? "skipped" : "error");
        return (
          <li key={i} className="flex gap-2">
            <span className="font-mono text-muted-foreground">{ts}</span>
            <span className={outcome === "success" ? "text-green" : outcome === "error" ? "text-red" : "text-muted-foreground"}>{outcome}</span>
            {(e.message ?? e.error) && <span className="text-muted-foreground truncate">{e.message ?? e.error}</span>}
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ScheduledJobsTab({ project }: ScheduledJobsTabProps): JSX.Element {
  const [jobs, setJobs] = useState<ScheduledJob[]>([]);
  const [statuses, setStatuses] = useState<ScheduledJobStatus[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editJob, setEditJob] = useState<ScheduledJob | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [expandedLog, setExpandedLog] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState<string | null>(null);

  const category = project.category ?? project.projectType?.category;

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const data = await fetchJson<{ jobs: ScheduledJob[]; status: ScheduledJobStatus[] }>(
        `/api/projects/scheduled-jobs?path=${encodeURIComponent(project.path)}`,
      );
      setJobs(data.jobs ?? []);
      setStatuses(data.status ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [project.path]);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => { void refresh(); }, 30_000);
    return (): void => { window.clearInterval(id); };
  }, [refresh]);

  const statusFor = (jobId: string): ScheduledJobStatus | undefined =>
    statuses.find((s) => s.jobId === jobId);

  const openAdd = (): void => { setEditJob(null); setSaveError(null); setDialogOpen(true); };
  const openEdit = (job: ScheduledJob): void => { setEditJob(job); setSaveError(null); setDialogOpen(true); };

  const handleSave = async (jobBody: Record<string, unknown>): Promise<void> => {
    setSaving(true);
    setSaveError(null);
    try {
      if (editJob) {
        await fetchJson(`/api/projects/scheduled-jobs/${editJob.id}`, {
          method: "PUT",
          body: JSON.stringify({ path: project.path, job: jobBody }),
        });
      } else {
        await fetchJson("/api/projects/scheduled-jobs", {
          method: "POST",
          body: JSON.stringify({ path: project.path, job: jobBody }),
        });
      }
      setDialogOpen(false);
      await refresh();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (job: ScheduledJob): Promise<void> => {
    setActionPending(`delete-${job.id}`);
    try {
      await fetchJson(`/api/projects/scheduled-jobs/${job.id}?path=${encodeURIComponent(project.path)}`, { method: "DELETE" });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionPending(null);
    }
  };

  const handleStop = async (job: ScheduledJob): Promise<void> => {
    setActionPending(`stop-${job.id}`);
    try {
      await fetchJson(`/api/projects/scheduled-jobs/${job.id}/stop?path=${encodeURIComponent(project.path)}`, { method: "POST" });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionPending(null);
    }
  };

  const handleRunNow = async (job: ScheduledJob): Promise<void> => {
    setActionPending(`run-${job.id}`);
    try {
      await fetchJson(`/api/projects/scheduled-jobs/${job.id}/run-now`, {
        method: "POST",
        body: JSON.stringify({ path: project.path }),
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionPending(null);
    }
  };

  return (
    <Card className="p-4 space-y-4" data-testid="scheduled-jobs-tab">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-[13px] font-semibold">Scheduled Jobs</h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Recurring prompts, commands, or actions on this project. Fires are auto-staggered so multiple projects with the same cadence don't all run at once.
          </p>
        </div>
        <Button size="sm" onClick={openAdd} data-testid="add-job-btn">Add Job</Button>
      </div>

      {error && <p className="text-[11px] text-red">{error}</p>}

      {jobs.length === 0 ? (
        <div className="text-[12px] text-muted-foreground py-4 text-center border border-dashed border-border rounded">
          No scheduled jobs yet. Add one to automate recurring work on this project.
        </div>
      ) : (
        <div className="space-y-2">
          {jobs.map((job) => {
            const st = statusFor(job.id);
            const isRunning = st?.inFlight === true;
            const isPending = actionPending !== null;
            const typeColor = JOB_TYPE_COLORS[job.type] ?? "";
            const isLogOpen = expandedLog === job.id;

            return (
              <div key={job.id} className="border border-border rounded p-3 space-y-2" data-testid={`job-row-${job.id}`}>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold ${typeColor}`}>
                    {JOB_TYPE_LABELS[job.type]}
                  </span>
                  <span className="text-[12px] font-medium flex-1">{job.name}</span>
                  {isRunning && <span className="text-[10px] text-yellow animate-pulse">● running</span>}
                  {!job.enabled && <span className="text-[10px] text-muted-foreground">disabled</span>}
                </div>

                <div className="flex gap-4 text-[10px] text-muted-foreground flex-wrap">
                  {job.cadence && <span>Cadence: <span className="font-mono">{cadenceLabel(job.cadence)}</span></span>}
                  {st?.nextFireAt && <span>Next: <span className="font-mono">{new Date(st.nextFireAt).toLocaleTimeString()}</span></span>}
                  {st?.lastFiredAt && <span>Last: <span className="font-mono">{new Date(st.lastFiredAt).toLocaleTimeString()}</span></span>}
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <Button size="sm" variant="outline" onClick={() => openEdit(job)} disabled={isPending}>Edit</Button>
                  <Button size="sm" variant="outline" onClick={() => { void handleRunNow(job); }} disabled={isPending || isRunning}>
                    {actionPending === `run-${job.id}` ? "Firing…" : "Run Now"}
                  </Button>
                  {isRunning && (
                    <Button size="sm" variant="outline" onClick={() => { void handleStop(job); }} disabled={isPending}>
                      {actionPending === `stop-${job.id}` ? "Stopping…" : "Stop"}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-muted-foreground"
                    onClick={() => setExpandedLog(isLogOpen ? null : job.id)}
                  >
                    {isLogOpen ? "Hide log" : "Log"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-red ml-auto"
                    onClick={() => { void handleDelete(job); }}
                    disabled={isPending}
                  >
                    {actionPending === `delete-${job.id}` ? "…" : "Delete"}
                  </Button>
                </div>

                {isLogOpen && (
                  <div className="border-t border-border pt-2 mt-1">
                    <JobLogPanel projectPath={project.path} jobId={job.id} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <JobDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSave={handleSave}
        initial={editJob}
        projectCategory={category}
        saving={saving}
        error={saveError}
      />

      <DevNotes title="Scheduled Jobs tab — dev notes">
        <DevNotes.Item kind="info" heading="s118 redesign — generalized job scheduler">
          Replaced the single-mode IterativeWork tab with a multi-type job scheduler. Four job types: pm-loop (original behavior), prompt (recurring agent prompt), command (agi bash passthrough), action (plugin-registered). Existing iterativeWork configs migrate transparently to a pm-loop job on first read.
        </DevNotes.Item>
      </DevNotes>
    </Card>
  );
}
