/**
 * Settings → Scheduled Jobs (s118 redesign).
 *
 * System-wide view of every scheduled job running in this AGI:
 *   - Per-project jobs (all types: pm-loop, prompt, command, action)
 *   - Plugin-registered scheduled tasks (e.g. backup runs, log rotations)
 *
 * Click-through to the project's "Scheduled Jobs" tab for editing.
 * Inline pause/resume for plugin tasks via the existing API.
 */

import type { ReactElement } from "react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { ProjectInfo, ScheduledJob, ScheduledJobStatus } from "../types";
import { fetchProjects } from "../api";
import { Button } from "../components/ui/button";

interface PluginScheduledTask {
  id: string;
  pluginId: string;
  name: string;
  description?: string;
  cron?: string;
  intervalMs?: number;
  enabled: boolean;
}

interface ProjectJobRow {
  project: ProjectInfo;
  job: ScheduledJob;
  status?: ScheduledJobStatus;
}

const JOB_TYPE_LABELS: Record<string, string> = {
  "pm-loop": "PM Loop",
  prompt: "Prompt",
  command: "Command",
  action: "Action",
};

async function fetchPluginScheduled(): Promise<PluginScheduledTask[]> {
  const res = await fetch("/api/dashboard/plugin-scheduled-tasks");
  if (!res.ok) return [];
  return (await res.json()) as PluginScheduledTask[];
}

async function fetchProjectJobRows(): Promise<ProjectJobRow[]> {
  const projects = await fetchProjects();
  const eligible = projects.filter((p) => p.iterativeWorkEligible ?? p.projectType?.iterativeWorkEligible);
  const out: ProjectJobRow[] = [];
  for (const project of eligible) {
    try {
      const res = await fetch(`/api/projects/scheduled-jobs?path=${encodeURIComponent(project.path)}`);
      if (!res.ok) continue;
      const data = (await res.json()) as { jobs: ScheduledJob[]; status: ScheduledJobStatus[] };
      for (const job of data.jobs ?? []) {
        if (!job.enabled) continue; // only show active jobs in global view
        const status = (data.status ?? []).find((s) => s.jobId === job.id);
        out.push({ project, job, status });
      }
    } catch {
      /* skip on error */
    }
  }
  return out;
}

async function setPluginEnabled(id: string, enabled: boolean): Promise<void> {
  const action = enabled ? "enable" : "disable";
  await fetch(`/api/dashboard/scheduled-tasks/${id}/${action}`, { method: "POST" });
}

export default function ScheduledJobsPage(): ReactElement {
  const [pluginTasks, setPluginTasks] = useState<PluginScheduledTask[]>([]);
  const [projectRows, setProjectRows] = useState<ProjectJobRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const [tasks, rows] = await Promise.all([fetchPluginScheduled(), fetchProjectJobRows()]);
      setPluginTasks(tasks);
      setProjectRows(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => { void refresh(); }, 30_000);
    return (): void => { window.clearInterval(id); };
  }, []);

  return (
    <div className="p-4 max-w-5xl space-y-6" data-testid="scheduled-jobs-page">
      <div>
        <h1 className="text-[16px] font-semibold mb-1">Scheduled Jobs</h1>
        <p className="text-[12px] text-muted-foreground">
          System-wide view of every active scheduled job: per-project prompts, commands, actions, and PM loops plus plugin-registered tasks. Manage per-project jobs on each project's <span className="font-mono">Scheduled Jobs</span> tab.
        </p>
      </div>

      {error && <div className="text-[12px] text-red">{error}</div>}
      {loading && projectRows.length === 0 && pluginTasks.length === 0 && (
        <div className="text-[12px] text-muted-foreground">Loading…</div>
      )}

      <section data-testid="scheduled-jobs-projects">
        <h2 className="text-[14px] font-semibold mb-2">Project Scheduled Jobs</h2>
        {projectRows.length === 0 ? (
          <div className="text-[12px] text-muted-foreground">
            No active scheduled jobs. Add one from a project's <span className="font-mono">Scheduled Jobs</span> tab.
          </div>
        ) : (
          <table className="w-full text-[12px]" data-testid="scheduled-jobs-projects-table">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left pb-1 pr-3">Project</th>
                <th className="text-left pb-1 pr-3">Job</th>
                <th className="text-left pb-1 pr-3">Type</th>
                <th className="text-left pb-1 pr-3">Cadence</th>
                <th className="text-left pb-1 pr-3">Next fire</th>
                <th className="text-left pb-1">Action</th>
              </tr>
            </thead>
            <tbody>
              {projectRows.map(({ project, job, status }) => (
                <tr key={`${project.path}::${job.id}`} className="border-b border-border/50">
                  <td className="py-1 pr-3">
                    <Link to={`/projects/${project.name}`} className="text-[12px] underline">
                      {project.name}
                    </Link>
                  </td>
                  <td className="py-1 pr-3">{job.name}</td>
                  <td className="py-1 pr-3">
                    <span className="text-[10px] font-mono text-muted-foreground">
                      {JOB_TYPE_LABELS[job.type] ?? job.type}
                    </span>
                  </td>
                  <td className="py-1 pr-3 font-mono">{job.cadence ?? "—"}</td>
                  <td className="py-1 pr-3 font-mono text-muted-foreground">
                    {status?.nextFireAt ? new Date(status.nextFireAt).toLocaleTimeString() : "—"}
                    {status?.inFlight && <span className="text-yellow ml-1">●</span>}
                  </td>
                  <td className="py-1">
                    <Link to={`/projects/${project.name}`} className="text-[11px] underline">
                      Configure →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section data-testid="scheduled-jobs-plugins">
        <h2 className="text-[14px] font-semibold mb-2">Plugin Tasks</h2>
        {pluginTasks.length === 0 ? (
          <div className="text-[12px] text-muted-foreground">No plugin-registered scheduled tasks.</div>
        ) : (
          <table className="w-full text-[12px]" data-testid="scheduled-jobs-plugins-table">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left pb-1">Plugin</th>
                <th className="text-left pb-1">Task</th>
                <th className="text-left pb-1">Schedule</th>
                <th className="text-left pb-1">State</th>
                <th className="text-left pb-1">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pluginTasks.map((t) => (
                <tr key={t.id} className="border-b border-border/50">
                  <td className="py-1 font-mono">{t.pluginId}</td>
                  <td className="py-1">
                    <div>{t.name}</div>
                    {t.description && <div className="text-[11px] text-muted-foreground">{t.description}</div>}
                  </td>
                  <td className="py-1 font-mono text-muted-foreground">
                    {t.cron ?? (t.intervalMs ? `every ${String(Math.round(t.intervalMs / 1000))}s` : "—")}
                  </td>
                  <td className="py-1">{t.enabled ? <span className="text-green">enabled</span> : <span className="text-muted-foreground">disabled</span>}</td>
                  <td className="py-1">
                    <Button
                      onClick={() => { void setPluginEnabled(t.id, !t.enabled).then(() => refresh()); }}
                      data-testid={`scheduled-jobs-plugin-toggle-${t.id}`}
                    >
                      {t.enabled ? "Disable" : "Enable"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
