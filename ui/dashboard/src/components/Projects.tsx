/**
 * Projects — Workspace project grid with compact cards.
 *
 * Cards navigate to /projects/:slug for full detail view.
 * Inline expansion has been removed in favor of dedicated project pages.
 */

import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SACRED_PROJECTS, PAX_SACRED_PROJECTS, isSacredProject, isPaxProject, matchSacredProject, matchPaxProjects } from "@/lib/sacred-projects.js";
import { Table } from "@particle-academy/react-fancy";
import { fetchProjectActivitySummary, type ProjectActivitySummary } from "../api.js";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import type { ProjectActivity, ProjectInfo } from "../types.js";
import { HostingSetupBanner } from "./HostingSetupBanner.js";
import { SetupTerminal } from "./SetupTerminal.js";
import type { HostingStatus } from "../api.js";

/** Derive a URL slug from a project path (last segment, lowercased, alphanumeric + dashes). */
export function projectSlug(path: string): string {
  return path.split("/").pop()?.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") ?? "";
}

export interface ProjectsProps {
  projects: ProjectInfo[];
  loading: boolean;
  error: string | null;
  creating: boolean;
  updating: boolean;
  onCreate: (params: { name: string; tynnToken?: string; repoRemote?: string; category?: string; type?: string; stacks?: string[] }) => Promise<unknown>;
  onUpdate: (params: { path: string; name?: string; tynnToken?: string | null }) => Promise<void>;
  onRefresh: () => void;
  onOpenChat: (context: string) => void;
  theme?: "light" | "dark";
  projectActivity?: Record<string, ProjectActivity | null>;
  hostingStatus?: HostingStatus | null;
  onHostingEnable?: (params: { path: string; type?: string; hostname?: string; docRoot?: string; startCommand?: string }) => Promise<unknown>;
  onHostingDisable?: (path: string) => Promise<unknown>;
  onHostingConfigure?: (params: { path: string; type?: string; hostname?: string; docRoot?: string; startCommand?: string }) => Promise<unknown>;
  onHostingRestart?: (path: string) => Promise<unknown>;
  hostingBusy?: boolean;
  contributingEnabled?: boolean;
}

export function Projects({
  projects, loading, error, creating, onCreate, onRefresh,
  projectActivity, hostingStatus, contributingEnabled,
}: ProjectsProps) {
  const [showModal, setShowModal] = useState(false);
  const [showSetupTerminal, setShowSetupTerminal] = useState(false);
  // s130 t516 slice 1 (cycle 102) — list view via react-fancy Table.
  // Default "list" matches projects-ux-v2/projects-browser-v2.html mockup.
  // "grid" preserved as opt-in toggle for power users / dense layouts.
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  // s130 t516 slice 2 (cycle 106) — activity sparklines. Map of
  // projectPath → ProjectActivitySummary. Populated by a parallel
  // batch-fetch when projects load. Errors per-project don't block
  // the table render; a project without a summary just shows a flat line.
  const [activitySummaries, setActivitySummaries] = useState<Record<string, ProjectActivitySummary>>({});
  const navigate = useNavigate();
  const isContributing = Boolean(contributingEnabled);

  const sacredEntries = isContributing
    ? SACRED_PROJECTS.map((sacred) => ({
        sacred,
        project: matchSacredProject(projects, sacred.id),
      }))
    : [];

  const isAionimaProject = (p: ProjectInfo) => isSacredProject(p) || p.projectType?.id === "aionima";
  // s136 t522 — PAx forks (react-fancy/fancy-code/fancy-sheets/fancy-echarts)
  // are also filtered out of regular tiles. They render as the PAx sacred
  // portal card below, mirroring the Aionima consolidation pattern.
  const visibleProjects = projects.filter((p) => !isAionimaProject(p) && !isPaxProject(p));
  const paxProjects = isContributing ? matchPaxProjects(projects) : [];

  // s130 t516 slice 2 — batch-fetch 30-day activity summaries for the
  // visible projects. Runs once when the visible-projects set changes.
  // Errors per-project are non-fatal (the row falls back to a flat
  // sparkline). Skipped when viewMode is "grid" since the grid layout
  // doesn't render the sparkline column.
  useEffect(() => {
    if (viewMode !== "list") return;
    if (visibleProjects.length === 0) return;
    let cancelled = false;
    void Promise.all(
      visibleProjects.map(async (p) => {
        try {
          const summary = await fetchProjectActivitySummary(p.path, 30);
          return { path: p.path, summary };
        } catch {
          return null;
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      const next: Record<string, ProjectActivitySummary> = {};
      for (const r of results) {
        if (r !== null) next[r.path] = r.summary;
      }
      setActivitySummaries(next);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleProjects.map((p) => p.path).join(","), viewMode]);

  // Unicode-block sparkline renderer — turns a number array into a
  // 8-step block-character string. Mirrors the projects-ux-v2 mockup's
  // ▁▂▃▆█▃▁ aesthetic; zero dependency, works in any monospace font.
  const renderSparkline = (values: number[]): string => {
    const blocks = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
    const max = Math.max(...values, 1);
    return values
      .map((v) => {
        const idx = Math.min(Math.floor((v / max) * (blocks.length - 1)), blocks.length - 1);
        return blocks[idx];
      })
      .join("");
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-xl font-bold text-foreground">Projects</h2>
        <div className="flex gap-2 flex-wrap items-center">
          {/* s130 t516 slice 1 — list/grid view toggle */}
          <div className="inline-flex border border-border rounded-md overflow-hidden" data-testid="projects-view-toggle">
            <button
              type="button"
              onClick={() => setViewMode("list")}
              className={cn(
                "px-3 py-1 text-[12px] font-medium transition-colors cursor-pointer",
                viewMode === "list"
                  ? "bg-primary text-primary-foreground"
                  : "bg-card text-muted-foreground hover:text-foreground",
              )}
              aria-pressed={viewMode === "list"}
              data-testid="projects-view-list"
            >
              List
            </button>
            <button
              type="button"
              onClick={() => setViewMode("grid")}
              className={cn(
                "px-3 py-1 text-[12px] font-medium transition-colors cursor-pointer border-l border-border",
                viewMode === "grid"
                  ? "bg-primary text-primary-foreground"
                  : "bg-card text-muted-foreground hover:text-foreground",
              )}
              aria-pressed={viewMode === "grid"}
              data-testid="projects-view-grid"
            >
              Grid
            </button>
          </div>
          <Button variant="outline" size="sm" onClick={onRefresh}>
            Refresh
          </Button>
          <Button size="sm" onClick={() => setShowModal(true)}>
            Add Project
          </Button>
        </div>
      </div>

      {/* Error banner */}
      {error !== null && (
        <div className="px-3.5 py-2.5 rounded-lg bg-surface0 text-red text-[13px] mb-4">
          {error}
        </div>
      )}

      {/* Hosting setup banner */}
      {hostingStatus !== undefined && hostingStatus !== null && !hostingStatus.ready && (
        <HostingSetupBanner
          caddy={hostingStatus.caddy}
          dnsmasq={hostingStatus.dnsmasq}
          podman={hostingStatus.podman}
          onSetup={async () => setShowSetupTerminal(true)}
          settingUp={false}
        />
      )}

      {/* Setup terminal stream */}
      <SetupTerminal
        open={showSetupTerminal}
        onClose={() => setShowSetupTerminal(false)}
        onComplete={onRefresh}
      />

      {/* Loading */}
      {loading && projects.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">Loading projects...</div>
      )}

      {/* Empty state */}
      {!loading && projects.length === 0 && (
        <div className="text-center py-12 text-muted-foreground text-[15px]">
          No projects found. Click "Add Project" to create one.
        </div>
      )}

      {/* Aionima — single platform-contribution portal tile (s119 redesign).
          Replaces the per-core-repo sacred tiles. Users don't ship updates
          per package; they contribute across channels through the
          consolidated /aionima view (upstream alignment + PR + MINT).
          Impactium-blockchain COA<>COI ties back to THIS single entry. */}
      {isContributing && (
        // Aionima + PAx render in a single Sacred row (owner directive
        // 2026-04-29 cycle ~121): the two consolidation cards belong on
        // the same row, not stacked. The auto-fill grid degrades to 1
        // column at narrow widths and pairs them side-by-side at wider
        // widths. Each card self-identifies via its name + badge so the
        // per-section h3 ("Aionima", "PAx · ADF UI primitives") is
        // dropped in favor of one shared "Sacred" header.
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Star className="h-4 w-4 text-yellow" />
            <h3 className="text-[13px] font-semibold text-foreground">Sacred</h3>
          </div>
          <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
            <div
              onClick={() => { void navigate("/aionima"); }}
              className={cn(
                "rounded-xl border transition-colors duration-150 cursor-pointer hover:border-yellow",
                "bg-indigo-50/70 border-indigo-200/80",
                "dark:bg-indigo-950/40 dark:border-indigo-700/60",
              )}
              data-testid="project-card-aionima"
            >
              <div className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Star className="h-4 w-4 text-yellow" />
                  <span className="text-[15px] font-semibold text-card-foreground">Aionima</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow/15 text-yellow font-semibold">
                    platform
                  </span>
                </div>
                <div className="text-[11px] text-muted-foreground">
                  Platform contribution portal — upstream alignment, PR submission, MINT impact ($WORK / $K / $RES). Wraps the {sacredEntries.length} core forks (agi, prime, id, marketplace, mapp-marketplace) as one user-facing surface.
                </div>
                <div className="text-[11px] text-yellow mt-2 font-medium">Open Aionima Development →</div>
              </div>
            </div>

            {/* PAx — Particle-Academy ADF UI primitives sacred card
                (s136 t522). Mirrors the Aionima consolidation pattern.
                Only renders in contributing-mode (forks aren't
                provisioned otherwise). */}
            {isContributing && (
              <div
                onClick={() => { void navigate("/settings/gateway"); }}
                className={cn(
                  "rounded-xl border transition-colors duration-150 cursor-pointer hover:border-yellow",
                  "bg-indigo-50/70 border-indigo-200/80",
                  "dark:bg-indigo-950/40 dark:border-indigo-700/60",
                )}
                data-testid="project-card-pax"
              >
                <div className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Star className="h-4 w-4 text-yellow" />
                    <span className="text-[15px] font-semibold text-card-foreground">PAx</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow/15 text-yellow font-semibold">
                      primitives
                    </span>
                    {paxProjects.length > 0 && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-green/15 text-green font-semibold">
                        {paxProjects.length}/{PAX_SACRED_PROJECTS.length} provisioned
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    ADF UI primitive maintenance portal — wraps the {PAX_SACRED_PROJECTS.length} Particle-Academy packages (react-fancy, fancy-code, fancy-sheets, fancy-echarts) consumed by the dashboard, plugins, MApps, and locally-hosted apps. File issues + open PRs via the maintenance loop at agi/docs/agents/contributing-to-adf-packages.md.
                  </div>
                  <div className="text-[11px] text-yellow mt-2 font-medium">Open Contributing tab →</div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* s130 t516 slice 1 (cycle 102) — list view via react-fancy Table.
          Matches projects-ux-v2/projects-browser-v2.html mockup. Activity
          sparkline (fancy-echarts), Knowledge column, and click-to-expand
          inline panel land in subsequent slices. */}
      {viewMode === "list" && (
        <div data-testid="projects-list">
          <Table>
            <Table.Head>
              <Table.Column label="" />
              <Table.Column label="Project" />
              <Table.Column label="Category" />
              <Table.Column label="Repos" />
              <Table.Column label="Stacks" />
              <Table.Column label="Tags" />
              <Table.Column label="Activity (30d)" />
              <Table.Column label="Knowledge" />
              <Table.Column label="Hosting" />
            </Table.Head>
            <Table.Body>
              {visibleProjects.map((p) => {
                const slug = projectSlug(p.path);
                const cat = p.category ?? p.projectType?.category;
                const isOps = cat === "ops" || cat === "administration";
                // s130 t516 slice 3 (cycle 104) — click-to-expand inline
                // panel via Table.Row's tray prop. Shows path + description
                // + type details + quick actions. Uses data already on
                // ProjectInfo; no new endpoint needed.
                const tray = (
                  <div className="px-4 py-3 bg-secondary/20" data-testid={`project-tray-${slug}`}>
                    <div className="grid grid-cols-2 gap-x-6 gap-y-2 mb-3">
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mb-0.5">Path</div>
                        <div className="text-[12px] font-mono text-foreground break-all">{p.path}</div>
                      </div>
                      {p.projectType?.label && (
                        <div>
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mb-0.5">Project Type</div>
                          <div className="text-[12px] text-foreground">{p.projectType.label}</div>
                        </div>
                      )}
                      {p.description && (
                        <div className="col-span-2">
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mb-0.5">Description</div>
                          <div className="text-[12px] text-muted-foreground">{p.description}</div>
                        </div>
                      )}
                      {p.magicApps && p.magicApps.length > 0 && (
                        <div className="col-span-2">
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mb-0.5">MagicApps</div>
                          <div className="flex gap-1 flex-wrap">
                            {p.magicApps.map((id) => (
                              <span key={id} className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400 font-medium">
                                {id}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {p.repos && p.repos.length > 0 && (
                        <div className="col-span-2">
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mb-0.5">Repos ({p.repos.length})</div>
                          <div className="space-y-0.5">
                            {p.repos.map((r) => (
                              <div key={r.name} className="flex items-center gap-2 text-[11px]">
                                <span className="font-mono font-semibold text-foreground">{r.name}</span>
                                <span className="text-muted-foreground font-mono">→</span>
                                <span className="text-muted-foreground font-mono break-all">{r.url}</span>
                                {r.branch && (
                                  <span className="text-[10px] px-1 py-0.5 rounded bg-blue/15 text-blue font-mono">{r.branch}</span>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); void navigate(`/projects/${slug}`); }}
                        className="text-[11px] px-2.5 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 cursor-pointer font-medium"
                      >
                        Open workspace →
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onOpenChat(p.path); }}
                        className="text-[11px] px-2.5 py-1 rounded bg-secondary text-secondary-foreground hover:bg-secondary/80 cursor-pointer font-medium"
                      >
                        Open chat
                      </button>
                    </div>
                  </div>
                );
                return (
                  <Table.Row
                    key={p.path}
                    onClick={() => void navigate(`/projects/${slug}`)}
                    className="cursor-pointer hover:bg-secondary/30"
                    tray={tray}
                    trayTriggerPosition="end"
                  >
                    <Table.Cell>
                      {projectActivity?.[p.path] ? (
                        <span className="inline-block w-2 h-2 rounded-full bg-green animate-[pulse-green_2s_ease-in-out_infinite]" />
                      ) : (
                        <span className="inline-block w-2 h-2 rounded-full bg-muted-foreground/20" />
                      )}
                    </Table.Cell>
                    <Table.Cell>
                      <span className="text-[13px] font-semibold text-card-foreground">{p.name}</span>
                    </Table.Cell>
                    <Table.Cell>
                      {cat && (
                        <span
                          className={cn(
                            "text-[10px] px-1.5 py-0.5 rounded font-medium capitalize",
                            isOps ? "bg-yellow/20 text-yellow font-semibold" : "bg-surface1 text-muted-foreground",
                          )}
                          title={isOps ? "Ops mode" : undefined}
                        >
                          {isOps ? `${cat} · ops mode` : cat}
                        </span>
                      )}
                    </Table.Cell>
                    <Table.Cell>
                      {(() => {
                        const repoCount = p.repos?.length ?? 0;
                        if (repoCount === 0) {
                          return (
                            <span className="text-[11px] font-mono text-muted-foreground" title="Single-repo project">
                              ⌗1
                            </span>
                          );
                        }
                        const names = (p.repos ?? []).map((r) => r.name).join(", ");
                        return (
                          <span
                            className="text-[11px] font-mono text-foreground font-semibold"
                            title={`Multi-repo: ${names}`}
                            data-testid={`project-repos-${projectSlug(p.path)}`}
                          >
                            ⌗{repoCount}
                          </span>
                        );
                      })()}
                    </Table.Cell>
                    <Table.Cell>
                      {(() => {
                        const stacks = p.attachedStacks ?? [];
                        if (stacks.length === 0) {
                          return <span className="text-[11px] text-muted-foreground/40">—</span>;
                        }
                        return (
                          <div
                            className="flex gap-1 flex-wrap"
                            data-testid={`project-stacks-${projectSlug(p.path)}`}
                          >
                            {stacks.map((s) => {
                              // Strip leading "stack-" prefix from id for compact display
                              const label = s.stackId.replace(/^stack-/, "");
                              return (
                                <span
                                  key={s.stackId}
                                  className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-400 font-mono font-medium"
                                  title={s.stackId}
                                >
                                  ▣ {label}
                                </span>
                              );
                            })}
                          </div>
                        );
                      })()}
                    </Table.Cell>
                    <Table.Cell>
                      <div className="flex gap-1 flex-wrap">
                        {p.hasGit && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-green/15 text-green font-semibold">git</span>
                        )}
                        {p.tynnToken !== null && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue/15 text-blue font-semibold">tynn</span>
                        )}
                      </div>
                    </Table.Cell>
                    <Table.Cell>
                      {(() => {
                        const summary = activitySummaries[p.path];
                        if (!summary) {
                          return <span className="text-[11px] text-muted-foreground/40 font-mono">·······</span>;
                        }
                        const intensity = summary.total === 0 ? "text-muted-foreground/40" : "text-green";
                        return (
                          <span
                            className={cn("text-[12px] font-mono", intensity)}
                            title={`${String(summary.total)} events over ${String(summary.days)} days`}
                            data-testid={`project-activity-${projectSlug(p.path)}`}
                          >
                            {renderSparkline(summary.dailyCounts)}
                          </span>
                        );
                      })()}
                    </Table.Cell>
                    <Table.Cell>
                      {(() => {
                        const k = p.knowledge;
                        if (!k) {
                          return <span className="text-[11px] text-muted-foreground/40">—</span>;
                        }
                        const total = k.pages + k.plans + k.chatSessions;
                        return (
                          <span
                            className="text-[11px] font-mono text-foreground"
                            title={`${String(k.pages)} pages · ${String(k.plans)} plans · ${String(k.chatSessions)} chat sessions`}
                            data-testid={`project-knowledge-${projectSlug(p.path)}`}
                          >
                            ▣ {total}
                          </span>
                        );
                      })()}
                    </Table.Cell>
                    <Table.Cell>
                      {p.hosting ? (
                        <div className="flex items-center gap-2">
                          <span className={cn(
                            "text-[10px] px-1.5 py-0.5 rounded font-semibold",
                            p.hosting.status === "running" ? "bg-green/15 text-green" :
                            p.hosting.status === "error" ? "bg-red/15 text-red" :
                            "bg-muted-foreground/15 text-muted-foreground",
                          )}>
                            {p.hosting.status}
                          </span>
                          {p.hosting.hostname && (
                            <a
                              href={`https://${p.hosting.hostname}.${hostingStatus?.baseDomain ?? "ai.on"}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="text-[11px] text-blue underline"
                            >
                              {p.hosting.hostname}.{hostingStatus?.baseDomain ?? "ai.on"}
                            </a>
                          )}
                        </div>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">—</span>
                      )}
                    </Table.Cell>
                  </Table.Row>
                );
              })}
            </Table.Body>
          </Table>
        </div>
      )}

      {/* Project grid — original compact card layout, opt-in via viewMode toggle */}
      {viewMode === "grid" && (
      <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
        {visibleProjects.map((p) => {
          const slug = projectSlug(p.path);
          return (
            <div
              key={p.path}
              onClick={() => void navigate(`/projects/${slug}`)}
              className={cn(
                "rounded-xl bg-card border border-border transition-colors duration-150 cursor-pointer",
                "hover:border-blue",
              )}
              data-testid="project-card"
            >
              <div className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  {projectActivity?.[p.path] && (
                    <span className="inline-block w-2 h-2 rounded-full bg-green animate-[pulse-green_2s_ease-in-out_infinite]" />
                  )}
                  <span className="text-[15px] font-semibold text-card-foreground">{p.name}</span>
                  {p.hasGit && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-green/15 text-green font-semibold">
                      git
                    </span>
                  )}
                  {p.tynnToken !== null && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue/15 text-blue font-semibold">
                      tynn
                    </span>
                  )}
                  {(() => {
                    const cat = p.category ?? p.projectType?.category;
                    if (!cat) return null;
                    const isOps = cat === "ops" || cat === "administration";
                    return (
                      <span
                        className={cn(
                          "text-[10px] px-1.5 py-0.5 rounded font-medium capitalize",
                          isOps
                            ? "bg-yellow/20 text-yellow font-semibold"
                            : "bg-surface1 text-muted-foreground",
                        )}
                        title={isOps ? "Ops mode — agent has cross-project tool access" : undefined}
                      >
                        {isOps ? `${cat} · ops mode` : cat}
                      </span>
                    );
                  })()}
                  {p.hosting && (
                    <span className={cn(
                      "text-[10px] px-1.5 py-0.5 rounded font-semibold",
                      p.hosting.status === "running" ? "bg-green/15 text-green" :
                      p.hosting.status === "error" ? "bg-red/15 text-red" :
                      "bg-muted-foreground/15 text-muted-foreground",
                    )}>
                      {p.hosting.status}
                    </span>
                  )}
                </div>
                {p.hosting?.hostname && (
                  <div className="flex flex-col gap-0.5 mt-0.5">
                    <a
                      href={`https://${p.hosting.hostname}.${hostingStatus?.baseDomain ?? "ai.on"}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-[11px] text-blue underline inline-block"
                    >
                      {p.hosting.hostname}.{hostingStatus?.baseDomain ?? "ai.on"}
                    </a>
                    {p.hosting.tunnelUrl && (
                      <a
                        href={p.hosting.tunnelUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-[10px] text-green underline inline-block"
                      >
                        {p.hosting.tunnelUrl.replace(/^https?:\/\//, "")}
                      </a>
                    )}
                  </div>
                )}
                {projectActivity?.[p.path] && (
                  <div
                    className="text-[11px] mt-1"
                    style={{
                      background: "linear-gradient(90deg, #22c55e 0%, #4ade80 50%, #22c55e 100%)",
                      backgroundSize: "200% 100%",
                      WebkitBackgroundClip: "text",
                      WebkitTextFillColor: "transparent",
                      animation: "shimmer 1.5s ease-in-out infinite",
                    }}
                  >
                    <style>{`@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>
                    {projectActivity[p.path]!.summary}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      )}

      {/* Add Project Modal */}
      <AddProjectModal
        open={showModal}
        creating={creating}
        onClose={() => setShowModal(false)}
        onCreate={async (params) => {
          await onCreate(params);
          setShowModal(false);
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// AddProjectModal — two-step wizard: 1) project info, 2) stack suggestions
// ---------------------------------------------------------------------------

/** Project type info for the type selector (matches GET /api/hosting/project-types). */
interface TypeOption {
  id: string;
  label: string;
  category: string;
  hostable: boolean;
}

/** Minimal stack info for the suggestion step. */
interface StackOption {
  id: string;
  label: string;
  description: string;
  category: string;
  hasContainer: boolean;
  icon?: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  web: "Web",
  app: "App",
  literature: "Literature",
  media: "Media",
  monorepo: "Monorepo",
  ops: "Ops",
  administration: "Administration",
};

/** Category display order. */
const CATEGORY_ORDER = ["web", "app", "literature", "media", "monorepo", "ops", "administration"];

interface AddProjectModalProps {
  open: boolean;
  creating: boolean;
  onClose: () => void;
  onCreate: (params: { name: string; tynnToken?: string; repoRemote?: string; category?: string; type?: string; stacks?: string[] }) => Promise<void>;
}

function AddProjectModal({ open, creating, onClose, onCreate }: AddProjectModalProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState("");
  const [tynnToken, setTynnToken] = useState("");
  const [repoRemote, setRepoRemote] = useState("");
  const [selectedType, setSelectedType] = useState("");
  const [types, setTypes] = useState<TypeOption[]>([]);
  const [stacks, setStacks] = useState<StackOption[]>([]);
  const [selectedStacks, setSelectedStacks] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // Fetch project types when modal opens
  useEffect(() => {
    if (!open) return;
    setStep(1);
    setName("");
    setTynnToken("");
    setRepoRemote("");
    setSelectedType("");
    setSelectedStacks(new Set());
    setError(null);

    fetch("/api/hosting/project-types")
      .then((res) => res.json())
      .then((data: { types: TypeOption[] }) => setTypes(data.types))
      .catch(() => { /* non-critical */ });
  }, [open]);

  // Fetch available stacks when moving to step 2
  useEffect(() => {
    if (step !== 2) return;
    fetch("/api/stacks")
      .then((res) => res.json())
      .then((data: { stacks: StackOption[] }) => {
        setStacks(data.stacks);
      })
      .catch(() => { /* non-critical */ });
  }, [step]);

  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

  // Group types by category in display order
  const grouped = CATEGORY_ORDER
    .map((cat) => ({
      category: cat,
      label: CATEGORY_LABELS[cat] ?? cat,
      items: types.filter((t) => t.category === cat),
    }))
    .filter((g) => g.items.length > 0);

  const selectedCategory = types.find((t) => t.id === selectedType)?.category;

  // Filter stacks relevant to selected project type category
  const relevantStacks = selectedCategory
    ? stacks.filter((s) => s.category === "framework" || s.category === "runtime" || s.category === "tooling")
    : stacks.filter((s) => s.category === "framework" || s.category === "runtime" || s.category === "tooling");

  const toggleStack = useCallback((stackId: string) => {
    setSelectedStacks((prev) => {
      const next = new Set(prev);
      if (next.has(stackId)) next.delete(stackId);
      else next.add(stackId);
      return next;
    });
  }, []);

  const handleCreate = useCallback(async () => {
    if (!name.trim()) return;
    setError(null);
    try {
      await onCreate({
        name: name.trim(),
        tynnToken: tynnToken.trim() || undefined,
        repoRemote: repoRemote.trim() || undefined,
        category: selectedCategory || undefined,
        type: selectedType || undefined,
        stacks: selectedStacks.size > 0 ? Array.from(selectedStacks) : undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create project");
    }
  }, [name, tynnToken, repoRemote, selectedType, selectedCategory, selectedStacks, onCreate]);

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>
            {step === 1 ? "Add Project" : "Choose Stacks"}
          </DialogTitle>
          {step === 2 && (
            <p className="text-[12px] text-muted-foreground mt-1">
              Select frameworks, runtimes, or tools to install. You can always add more later.
            </p>
          )}
        </DialogHeader>

        {step === 1 ? (
          /* ─── Step 1: Project Info ──────────────────────────────── */
          <div className="flex flex-col gap-3.5 pt-1">
            <div>
              <label className="block text-[12px] font-semibold text-muted-foreground mb-1">
                Project Name *
              </label>
              <Input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Project"
                autoFocus
              />
              {slug && (
                <div className="text-[11px] text-muted-foreground mt-1">
                  Folder: <span className="font-mono text-blue">{slug}</span>
                </div>
              )}
            </div>

            <div>
              <label className="block text-[12px] font-semibold text-muted-foreground mb-1">
                Type
              </label>
              <select
                value={selectedType}
                onChange={(e) => setSelectedType(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-[13px] text-foreground shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="">Auto-detect</option>
                {grouped.map((group) => (
                  <optgroup key={group.category} label={group.label}>
                    {group.items.map((t) => (
                      <option key={t.id} value={t.id}>{t.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <div className="text-[11px] text-muted-foreground mt-1">
                {selectedType ? `Category: ${CATEGORY_LABELS[selectedCategory ?? ""] ?? selectedCategory}` : "Will auto-detect from project files"}
              </div>
            </div>

            <div>
              <label className="block text-[12px] font-semibold text-muted-foreground mb-1">
                Repo Remote
              </label>
              <Input
                type="text"
                value={repoRemote}
                onChange={(e) => setRepoRemote(e.target.value)}
                placeholder="https://github.com/user/repo.git"
              />
            </div>

            <div>
              <label className="block text-[12px] font-semibold text-muted-foreground mb-1">
                Tynn MCP Token
              </label>
              <Input
                type="text"
                value={tynnToken}
                onChange={(e) => setTynnToken(e.target.value)}
                placeholder="rpk_..."
              />
            </div>

            {error !== null && (
              <div className="px-3 py-2 rounded-lg bg-surface0 text-red text-[12px]">
                {error}
              </div>
            )}
          </div>
        ) : (
          /* ─── Step 2: Stack Suggestions ─────────────────────────── */
          <div className="flex flex-col gap-2 pt-1 max-h-[360px] overflow-y-auto">
            {relevantStacks.length === 0 ? (
              <p className="text-[12px] text-muted-foreground py-4 text-center">
                No stacks available. You can add them later from the project settings.
              </p>
            ) : (
              relevantStacks.map((s) => (
                <label
                  key={s.id}
                  className={cn(
                    "flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors",
                    selectedStacks.has(s.id) ? "border-blue bg-blue/5" : "border-surface0 hover:border-overlay0",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={selectedStacks.has(s.id)}
                    onChange={() => toggleStack(s.id)}
                    className="mt-0.5 rounded"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium">{s.label}</div>
                    <div className="text-[11px] text-muted-foreground line-clamp-2">{s.description}</div>
                    <div className="flex gap-1.5 mt-1">
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface0 text-muted-foreground">
                        {s.category}
                      </span>
                      {s.hasContainer && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface0 text-muted-foreground">
                          container
                        </span>
                      )}
                    </div>
                  </div>
                </label>
              ))
            )}

            {error !== null && (
              <div className="px-3 py-2 rounded-lg bg-surface0 text-red text-[12px]">
                {error}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {step === 1 ? (
            <>
              <Button variant="outline" onClick={onClose} disabled={creating}>
                Cancel
              </Button>
              <Button
                variant="outline"
                onClick={() => void handleCreate()}
                disabled={creating || !name.trim()}
              >
                Skip Stacks
              </Button>
              <Button
                onClick={() => setStep(2)}
                disabled={!name.trim()}
              >
                Next
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setStep(1)} disabled={creating}>
                Back
              </Button>
              <Button
                onClick={() => void handleCreate()}
                disabled={creating}
              >
                {creating ? "Creating..." : selectedStacks.size > 0 ? `Create with ${selectedStacks.size} stack${selectedStacks.size > 1 ? "s" : ""}` : "Create Project"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
