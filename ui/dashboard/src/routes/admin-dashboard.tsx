/**
 * Admin Dashboard — holistic view of the AGI application.
 *
 * Shows project counts, system usage, service status checks,
 * and running HuggingFace models in a single overview.
 */

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { PageScroll } from "@/components/PageScroll.js";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SafemodeCallout } from "@/components/SafemodeCallout.js";
import { IncidentsList } from "@/components/IncidentsList.js";
import { useProjects, useSystemStats } from "../hooks.js";
import { fetchServices, fetchHFRunningModels, fetchHFInstalledModels, fetchHFHardwareProfile, fetchHFAuthStatus } from "../api.js";
import type { ServiceInfo, HFRunningModel, HFInstalledModel, HFHardwareProfile } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${String(d)}d ${String(h)}h`;
  if (h > 0) return `${String(h)}h ${String(m)}m`;
  return `${String(m)}m`;
}

function UsageBar({ percent, color }: { percent: number; color: string }) {
  return (
    <div className="w-full h-2 bg-surface0 rounded-full overflow-hidden">
      <div
        className={cn("h-full rounded-full transition-all", color)}
        style={{ width: `${String(Math.min(percent, 100))}%` }}
      />
    </div>
  );
}

function StatusDot({ status }: { status: "healthy" | "degraded" | "down" | "unknown" }) {
  const colors: Record<string, string> = {
    healthy: "bg-green",
    degraded: "bg-yellow",
    down: "bg-red",
    unknown: "bg-overlay0",
  };
  return (
    <span className={cn("inline-block w-2.5 h-2.5 rounded-full shrink-0", colors[status] ?? colors.unknown)} />
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <Card className="p-4 text-center">
      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">{label}</div>
      <div className="text-2xl font-bold text-foreground">{value}</div>
      <div className="text-xs text-muted-foreground mt-1">{sub}</div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Admin Dashboard
// ---------------------------------------------------------------------------

export default function AdminDashboardPage() {
  const projectsHook = useProjects();
  const systemStats = useSystemStats();

  const [services, setServices] = useState<ServiceInfo[]>([]);
  const [servicesLoading, setServicesLoading] = useState(true);
  const [runningModels, setRunningModels] = useState<HFRunningModel[]>([]);
  const [installedModels, setInstalledModels] = useState<HFInstalledModel[]>([]);
  const [hwProfile, setHwProfile] = useState<HFHardwareProfile | null>(null);
  const [hfAuth, setHfAuth] = useState<{ authenticated: boolean; username?: string } | null>(null);

  useEffect(() => {
    fetchServices().then(setServices).catch(() => {}).finally(() => setServicesLoading(false));
    // HF data — these may fail if HF is not enabled, that's OK
    fetchHFRunningModels().then(setRunningModels).catch(() => {});
    fetchHFInstalledModels().then(setInstalledModels).catch(() => {});
    fetchHFHardwareProfile().then(setHwProfile).catch(() => {});
    fetchHFAuthStatus().then(setHfAuth).catch(() => {});
  }, []);

  const stats = systemStats.data;
  const projectList = projectsHook.projects;

  // Derive project-type breakdown for the Projects StatCard subtitle.
  // ProjectInfo.type doesn't exist — the actual fields are
  // `projectType.id` (e.g. "aionima", "web", "monorepo") and `category`
  // (e.g. "monorepo", "literature"). Fall back in that order so the
  // card shows meaningful counts instead of "unknown N".
  const projectsByType = new Map<string, number>();
  for (const p of projectList) {
    const t = p.projectType?.id ?? p.category ?? "unknown";
    projectsByType.set(t, (projectsByType.get(t) ?? 0) + 1);
  }
  const topProjectTypes = [...projectsByType.entries()]
    .sort(([, a], [, b]) => b - a);
  const projectTypeSub = topProjectTypes.length === 0
    ? ""
    : topProjectTypes.slice(0, 3).map(([type, count]) => `${type} ${String(count)}`).join(" · ")
      + (topProjectTypes.length > 3 ? ` +${String(topProjectTypes.length - 3)} more` : "");

  // Only show services whose container image is locally available.
  const visibleServices = services.filter((s) => s.imageAvailable !== false);

  return (
    <PageScroll>
      <div className="space-y-6">
        <SafemodeCallout />
        <h1 className="text-xl font-bold text-foreground">Admin Dashboard</h1>

        {/* ── Row 1: Quick stats ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            label="Projects"
            value={String(projectList.length)}
            sub={projectTypeSub}
          />
          <StatCard
            label="Uptime"
            value={stats !== null ? formatUptime(stats.uptime) : "—"}
            sub={stats?.hostname ?? ""}
          />
          <StatCard
            label="Services"
            value={servicesLoading ? "..." : String(visibleServices.length)}
            sub={`${String(visibleServices.filter((s) => s.status === "running").length)} running`}
          />
          <StatCard
            label="HF Models"
            value={String(installedModels.length)}
            sub={`${String(runningModels.length)} running`}
          />
        </div>

        {/* ── Row 2: System resources ── */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {stats !== null ? (
            <>
              <Card className="p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-muted-foreground">CPU</span>
                  <span className="text-sm font-mono text-foreground">{stats.cpu.usage.toFixed(1)}%</span>
                </div>
                <UsageBar percent={stats.cpu.usage} color={stats.cpu.usage > 80 ? "bg-red" : stats.cpu.usage > 50 ? "bg-yellow" : "bg-green"} />
                <div className="text-xs text-muted-foreground">
                  {String(stats.cpu.cores)} cores &middot; load {stats.cpu.loadAvg[0]?.toFixed(2) ?? "—"} / {stats.cpu.loadAvg[1]?.toFixed(2) ?? "—"} / {stats.cpu.loadAvg[2]?.toFixed(2) ?? "—"}
                </div>
              </Card>

              <Card className="p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-muted-foreground">Memory</span>
                  <span className="text-sm font-mono text-foreground">{stats.memory.percent.toFixed(1)}%</span>
                </div>
                <UsageBar percent={stats.memory.percent} color={stats.memory.percent > 85 ? "bg-red" : stats.memory.percent > 60 ? "bg-yellow" : "bg-green"} />
                <div className="text-xs text-muted-foreground">
                  {formatBytes(stats.memory.used)} / {formatBytes(stats.memory.total)}
                </div>
              </Card>

              <Card className="p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-muted-foreground">Disk</span>
                  <span className="text-sm font-mono text-foreground">{stats.disk.percent.toFixed(1)}%</span>
                </div>
                <UsageBar percent={stats.disk.percent} color={stats.disk.percent > 90 ? "bg-red" : stats.disk.percent > 70 ? "bg-yellow" : "bg-green"} />
                <div className="text-xs text-muted-foreground">
                  {formatBytes(stats.disk.used)} / {formatBytes(stats.disk.total)} &middot; {formatBytes(stats.disk.free)} free
                </div>
              </Card>
            </>
          ) : (
            <Card className="p-4 col-span-3 text-center text-muted-foreground text-sm">
              {systemStats.loading ? "Loading system stats..." : "System stats unavailable"}
            </Card>
          )}
        </div>

        {/* ── Row 3: Services ── */}
        <Card className="p-4">
          <h2 className="text-sm font-semibold text-foreground mb-3">Services</h2>
          {servicesLoading && <div className="text-sm text-muted-foreground">Loading...</div>}
          {!servicesLoading && visibleServices.length === 0 && (
            <div className="text-sm text-muted-foreground">No services configured.</div>
          )}
          {!servicesLoading && visibleServices.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {visibleServices.map((svc) => {
                const svcStatus = svc.status === "running" ? "healthy" : svc.status === "error" ? "down" : "unknown";
                return (
                  <div key={svc.name} className="flex items-center gap-3 p-3 rounded-lg bg-surface0/50">
                    <StatusDot status={svcStatus} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-foreground truncate">{svc.name}</div>
                      <div className="text-xs text-muted-foreground">{svc.status}{svc.port ? ` :${String(svc.port)}` : ""}</div>
                    </div>
                    <Badge variant="outline" className="text-[10px] shrink-0">
                      {svc.type ?? "service"}
                    </Badge>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* ── Row 4: HuggingFace Models (only if any exist) ── */}
        {(runningModels.length > 0 || installedModels.length > 0) && (
          <Card className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-foreground">HuggingFace Models</h2>
              {hwProfile !== null && (
                <Badge variant="outline" className={cn("text-[10px]",
                  hwProfile.capabilities.tier === "pro" ? "border-green text-green" :
                  hwProfile.capabilities.tier === "accelerated" ? "border-blue text-blue" :
                  hwProfile.capabilities.tier === "standard" ? "border-yellow text-yellow" :
                  "border-overlay0 text-overlay0",
                )}>
                  {hwProfile.capabilities.tier}
                </Badge>
              )}
            </div>

            {runningModels.length > 0 && (
              <div className="space-y-2 mb-4">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Running</div>
                {runningModels.map((model) => (
                  <div key={model.modelId} className="flex items-center gap-3 p-3 rounded-lg bg-surface0/50">
                    <StatusDot status={model.healthCheckPassed ? "healthy" : "degraded"} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-foreground truncate">
                        {model.displayName ?? model.modelId}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        <span className="font-mono">{model.modelId}</span>
                        {model.pipelineTag ? <span> &middot; {model.pipelineTag}</span> : null}
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        port {String(model.port)} &middot; {model.runtimeType}
                        {model.containerName ? <span> &middot; <span className="font-mono">{model.containerName}</span></span> : null}
                      </div>
                    </div>
                    <Badge variant="outline" className="text-[10px] border-green text-green shrink-0">running</Badge>
                  </div>
                ))}
              </div>
            )}

            {installedModels.filter((m) => m.status !== "running").length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Installed</div>
                {installedModels.filter((m) => m.status !== "running").map((model) => (
                  <div key={model.id} className="flex items-center gap-3 p-3 rounded-lg bg-surface0/50">
                    <StatusDot status={model.status === "error" ? "down" : model.status === "downloading" ? "degraded" : "unknown"} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-foreground truncate">{model.displayName}</div>
                      <div className="text-xs text-muted-foreground">
                        {model.runtimeType} &middot; {formatBytes(model.fileSizeBytes)}
                      </div>
                    </div>
                    <Badge variant="outline" className="text-[10px] shrink-0">{model.status}</Badge>
                  </div>
                ))}
              </div>
            )}

            {hwProfile !== null && (
              <div className="mt-3 pt-3 border-t border-border text-xs text-muted-foreground">
                {hwProfile.capabilities.summary}
                {hfAuth?.authenticated === true && hfAuth.username !== undefined && (
                  <span> &middot; HF: {hfAuth.username}</span>
                )}
              </div>
            )}
          </Card>
        )}

        <Card className="p-4 space-y-3">
          <h2 className="text-sm font-semibold text-foreground">Recent Incidents</h2>
          <IncidentsList />
        </Card>
      </div>
    </PageScroll>
  );
}
