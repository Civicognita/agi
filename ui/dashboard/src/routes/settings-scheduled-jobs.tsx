/**
 * Settings → Scheduled Jobs (s118 t443 D2).
 *
 * System-wide cron manager — lists EVERY scheduled job running in the AGI:
 *   - Per-project iterative-work loops (one per eligible+enabled project)
 *   - Plugin-registered scheduled tasks (e.g. backup runs, log rotations)
 *
 * Cadence is shown as the user-friendly key (when set via the Iterative
 * Work tab) plus the auto-staggered cron expression. Time fields show
 * last fire + next fire when known. Click-through to the project tab for
 * project loops; inline pause/resume for plugin tasks (via existing
 * /api/dashboard/scheduled-tasks/:id/:action endpoint).
 *
 * AGI's own iterative loop (system-wide ops cadence) lands here when
 * implemented — currently empty for this surface.
 */

import type { ReactElement } from "react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { ProjectInfo } from "../types";
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

interface ProjectIwInfo {
  project: ProjectInfo;
  enabled: boolean;
  cron: string | null;
  cadence: string | null;
}

async function fetchPluginScheduled(): Promise<PluginScheduledTask[]> {
  const res = await fetch("/api/dashboard/plugin-scheduled-tasks");
  if (!res.ok) return [];
  return (await res.json()) as PluginScheduledTask[];
}

async function fetchProjectIwSummaries(): Promise<ProjectIwInfo[]> {
  const projects = await fetchProjects();
  const eligible = projects.filter((p) => p.iterativeWorkEligible ?? p.projectType?.iterativeWorkEligible);
  const out: ProjectIwInfo[] = [];
  for (const project of eligible) {
    try {
      const res = await fetch(`/api/projects/iterative-work/status?path=${encodeURIComponent(project.path)}`);
      if (!res.ok) continue;
      const status = (await res.json()) as { enabled: boolean; cron: string | null; cadence?: string | null };
      // Only show projects with iterative-work enabled — disabled projects
      // shouldn't clutter the system-wide cron view.
      if (status.enabled) {
        out.push({ project, enabled: status.enabled, cron: status.cron, cadence: status.cadence ?? null });
      }
    } catch {
      /* skip projects whose status endpoint errored */
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
  const [projectIws, setProjectIws] = useState<ProjectIwInfo[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const [tasks, iws] = await Promise.all([fetchPluginScheduled(), fetchProjectIwSummaries()]);
      setPluginTasks(tasks);
      setProjectIws(iws);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // Refresh every 30s — cron firings change last-fire/next-fire timestamps.
    const id = window.setInterval(() => { void refresh(); }, 30_000);
    return (): void => { window.clearInterval(id); };
  }, []);

  return (
    <div className="p-4 max-w-5xl space-y-6" data-testid="scheduled-jobs-page">
      <div>
        <h1 className="text-[16px] font-semibold mb-1">Scheduled Jobs</h1>
        <p className="text-[12px] text-muted-foreground">
          System-wide view of every cron running in this AGI: per-project iterative-work loops, plugin-registered tasks, and (when active) the system-wide ops loop. Cadence is auto-staggered per project so loops don't collide.
        </p>
      </div>

      {error && <div className="text-[12px] text-red">{error}</div>}
      {loading && projectIws.length === 0 && pluginTasks.length === 0 && (
        <div className="text-[12px] text-muted-foreground">Loading…</div>
      )}

      <section data-testid="scheduled-jobs-projects">
        <h2 className="text-[14px] font-semibold mb-2">Project Iterative Work Loops</h2>
        {projectIws.length === 0 ? (
          <div className="text-[12px] text-muted-foreground">
            No projects have iterative work enabled. Enable per-project on a project's <span className="font-mono">Iterative Work</span> tab (eligible categories: web, app, ops, administration).
          </div>
        ) : (
          <table className="w-full text-[12px]" data-testid="scheduled-jobs-projects-table">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left pb-1">Project</th>
                <th className="text-left pb-1">Cadence</th>
                <th className="text-left pb-1">Cron (auto-staggered)</th>
                <th className="text-left pb-1">Action</th>
              </tr>
            </thead>
            <tbody>
              {projectIws.map((iw) => (
                <tr key={iw.project.path} className="border-b border-border/50">
                  <td className="py-1">
                    <Link to={`/projects/${iw.project.name}`} className="text-[12px] underline">
                      {iw.project.name}
                    </Link>
                  </td>
                  <td className="py-1 font-mono">{iw.cadence ?? "—"}</td>
                  <td className="py-1 font-mono text-muted-foreground">{iw.cron ?? "—"}</td>
                  <td className="py-1">
                    <Link to={`/projects/${iw.project.name}`} className="text-[11px] underline">Configure →</Link>
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

      <div className="text-[11px] text-muted-foreground">
        AGI's own iterative loop (system-wide ops cadence) lands in this view when implemented. Currently empty.
      </div>
    </div>
  );
}
