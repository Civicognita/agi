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
import { DevNotes } from "@/components/ui/dev-notes";
import { SACRED_PROJECTS, PAX_SACRED_PROJECTS, isSacredProject, isPaxProject, matchSacredProject } from "@/lib/sacred-projects.js";
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

/** Derive a URL slug from a project path. Last segment, lowercased.
 *  Preserves alphanumerics + dashes + underscores so the meta-project
 *  `_aionima` (owner-managed local-customizations root) keeps its leading
 *  underscore in the URL. The Sacred card navigates to `/projects/_aionima`
 *  and the project-detail route resolves the same slug back. */
export function projectSlug(path: string): string {
  return path.split("/").pop()?.toLowerCase().replace(/[^a-z0-9_]+/g, "-").replace(/^-|-$/g, "") ?? "";
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

  // Owner directive 2026-05-13: `_aionima` is the Sacred project and must be
  // present + visible regardless of dev/contributing mode. Dev mode now only
  // gates fork-population into `_aionima/repos/`, not card visibility.
  // sacredEntries enumerated unconditionally; counts in the card description
  // reflect what's actually cloned (0 when contributing-mode off + no forks).
  const sacredEntries = SACRED_PROJECTS.map((sacred) => ({
    sacred,
    project: matchSacredProject(projects, sacred.id),
  }));

  // Owner directive 2026-05-13: `_aionima/` is the meta-project and must
  // never appear in the regular projects list — only as the Sacred card.
  // Backend stamping of projectType.id===\"aionima-system\" is the canonical
  // signal; the path-basename fallback covers the case where the boot
  // scaffolder hasn't yet written project.json so the gateway has
  // auto-detected the directory with a wrong type.
  const isAionimaProject = (p: ProjectInfo) => {
    if (isSacredProject(p)) return true;
    const typeId = p.projectType?.id;
    if (typeId === "aionima" || typeId === "aionima-system") return true;
    const basename = p.path.split("/").pop() ?? "";
    if (basename === "_aionima") return true;
    return false;
  };
  // s119 t705 — PAx forks live as repos under `_aionima/repos/` now,
  // not as standalone projects. They never appear as their own tiles;
  // the single Aionima sacred card (above) is the entry point.
  const visibleProjects = projects.filter((p) => !isAionimaProject(p) && !isPaxProject(p));

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
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-bold text-foreground">Projects</h2>
          <DevNotes title="Projects browser — dev notes">
            <DevNotes.Item kind="info" heading="Cycle 136 — click-to-expand row tray (mockup B)">
              Each row expands to a 4-quadrant grid (Repos / Stacks / Aion context / Knowledge) +
              a 5-button action row (Open workspace / Open chat / Configure repos / Manage stacks /
              Disable hosting). Click the chevron at the row end to expand.
            </DevNotes.Item>
            <DevNotes.Item kind="info" heading="Cycle 134 — Health column (✓ / ⚠ / —)">
              Hosting health surfaced as a compact icon column. ✓ green = container running &
              reachable. ⚠ amber = degraded. ⚠ red = error. — = not hosted.
            </DevNotes.Item>
            <DevNotes.Item kind="info" heading="Cycle 133 — Tynn column">
              `open|doing` two-tone counts per project. **Currently shows `—` for all projects** —
              backend population deferred to PM-Lite slice (s139 forthcoming). The reframe today
              shifts this from a remote-tynn fetch to a local PM-Lite store read.
            </DevNotes.Item>
            <DevNotes.Item kind="todo" heading="PM-Lite kanban incoming (s139)">
              The Tynn column in this browser will populate from the local PM-Lite store once
              s139 ships. The PM-Lite kanban itself surfaces in the Operate tab inside each
              project's workspace. Codename was tynn-lite; user-facing name is PM-Lite.
            </DevNotes.Item>
            <DevNotes.Item kind="warning" heading="Project folder structure migrating (s140)">
              All non-sacred projects will be restructured to {"{k/, repos/, sandbox/}"} at
              the project root (chat stays at k/chat/) with a single `project.json` config file at
              the root holding both project- and per-repo-config. Migration runs as a dry-run
              report first; no file moves until owner sign-off.
            </DevNotes.Item>
            <DevNotes.Item kind="deferred" heading="COA chain dots in Knowledge column">
              Per cycle-128 audit, the Knowledge column should also show a small COA-chain
              indicator (deferred until the COA aggregator lands).
            </DevNotes.Item>
          </DevNotes>
        </div>
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
          Impactium-blockchain COA<>COI ties back to THIS single entry.
          Visible unconditionally per owner directive 2026-05-13: dev/
          contributing mode only controls whether owner forks get cloned
          into `_aionima/repos/`, not whether the Sacred card renders. */}
      <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Star className="h-4 w-4 text-yellow" />
            <h3 className="text-[13px] font-semibold text-foreground">Sacred</h3>
          </div>
          {/* s119 t705 — Aionima is now a self-managed project at
              `_aionima`. The legacy /aionima consolidated view + the
              separate /pax tile collapsed into this single card; both
              routes redirect to `/projects/_aionima`. PAx repos live as
              repos under `_aionima/repos/<name>` alongside the 5
              Civicognita cores. */}
          <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
            <div
              onClick={() => { void navigate("/projects/_aionima"); }}
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
                  Platform contribution portal — upstream alignment, PR submission, MINT impact ($WORK / $K / $RES). {isContributing
                    ? <>Wraps the {sacredEntries.filter((e) => e.project !== null).length} core forks + {PAX_SACRED_PROJECTS.length} Particle-Academy ADF UI primitives as a single self-managed project (`_aionima/repos/`).</>
                    : <>Enable contributing mode in Settings to clone the {SACRED_PROJECTS.length} core Aionima forks + {PAX_SACRED_PROJECTS.length} Particle-Academy ADF UI primitives into <code>_aionima/repos/</code>.</>}
                </div>
                <div className="text-[11px] text-yellow mt-2 font-medium">Open Aionima →</div>
              </div>
            </div>
          </div>
        </div>

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
              <Table.Column label="Tynn" />
              <Table.Column label="Activity (30d)" />
              <Table.Column label="Knowledge" />
              <Table.Column label="Health" />
            </Table.Head>
            <Table.Body>
              {visibleProjects.map((p) => {
                const slug = projectSlug(p.path);
                const cat = p.category ?? p.projectType?.category;
                const isOps = cat === "ops" || cat === "administration";
                // s130 t516 slice 3 — click-to-expand row tray. Restructured
                // cycle 136 per projects-browser-v2.html mockup: 4 quadrant
                // layout (Repos / Stacks / Aion context / Knowledge) + 5
                // action buttons row. Uses data already on ProjectInfo;
                // no new endpoint needed for this slice.
                const tray = (
                  <div className="px-4 py-3 bg-secondary/20" data-testid={`project-tray-${slug}`}>
                    <div className="text-[11px] text-muted-foreground mb-3">
                      <span className="text-foreground font-semibold">{p.name}</span>
                      {p.category && <span> · {p.category}</span>}
                      <span> · {p.repos?.length ?? 1} {(p.repos?.length ?? 1) === 1 ? "repo" : "repos"}</span>
                      {p.attachedStacks && p.attachedStacks.length > 0 && (
                        <span> · stacks: {p.attachedStacks.map((s) => s.stackId.replace(/^stack-/, "")).join(" + ")}</span>
                      )}
                    </div>

                    {/* 4-quadrant grid per mockup B */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-3">
                      {/* Quadrant 1: Repos */}
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mb-1.5 font-semibold">Repos</div>
                        {p.repos && p.repos.length > 0 ? (
                          <div className="space-y-1">
                            {p.repos.map((r) => (
                              <div key={r.name} className="text-[11px]">
                                <div className="flex items-center gap-1.5">
                                  <span className="font-mono font-semibold text-foreground">{r.name}</span>
                                  {r.branch && <span className="text-[10px] px-1 py-0.5 rounded bg-blue/15 text-blue font-mono">{r.branch}</span>}
                                </div>
                                <div className="text-muted-foreground font-mono break-all text-[10px]">{r.url}</div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-[11px] text-muted-foreground/60 font-mono break-all">{p.path}</div>
                        )}
                      </div>

                      {/* Quadrant 2: Stacks */}
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mb-1.5 font-semibold">Stacks</div>
                        {p.attachedStacks && p.attachedStacks.length > 0 ? (
                          <div className="space-y-0.5">
                            {p.attachedStacks.map((s) => (
                              <div key={s.stackId} className="text-[11px] font-mono text-foreground">
                                ▣ {s.stackId.replace(/^stack-/, "")}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-[11px] text-muted-foreground/60 italic">none attached</div>
                        )}
                      </div>

                      {/* Quadrant 3: Aion context */}
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mb-1.5 font-semibold">Aion context</div>
                        <div className="space-y-0.5 text-[11px]">
                          {p.iterativeWorkEligible && (
                            <div className="text-foreground">Iterative-work eligible</div>
                          )}
                          {p.tynnTokenSet && (
                            <div className="text-foreground">PM provider: <span className="text-blue">tynn</span></div>
                          )}
                          {p.magicApps && p.magicApps.length > 0 && (
                            <div className="text-muted-foreground">MApps: {p.magicApps.join(", ")}</div>
                          )}
                          {!p.iterativeWorkEligible && !p.tynnTokenSet && (!p.magicApps || p.magicApps.length === 0) && (
                            <div className="text-muted-foreground/60 italic">no agent context</div>
                          )}
                        </div>
                      </div>

                      {/* Quadrant 4: Knowledge */}
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mb-1.5 font-semibold">Knowledge</div>
                        {p.knowledge ? (
                          <div className="space-y-0.5 text-[11px]">
                            <div className="text-foreground">▣ {p.knowledge.pages} pages</div>
                            <div className="text-muted-foreground">{p.knowledge.plans} plans · {p.knowledge.chatSessions} sessions</div>
                          </div>
                        ) : (
                          <div className="text-[11px] text-muted-foreground/60 italic">not s130-migrated</div>
                        )}
                      </div>
                    </div>

                    {/* 5-button action row per mockup B */}
                    <div className="flex gap-2 flex-wrap pt-2 border-t border-border/40">
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
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); void navigate(`/projects/${slug}#repository`); }}
                        className="text-[11px] px-2.5 py-1 rounded bg-secondary/60 text-secondary-foreground hover:bg-secondary/80 cursor-pointer font-medium"
                      >
                        Configure repos
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); void navigate(`/projects/${slug}#hosting`); }}
                        className="text-[11px] px-2.5 py-1 rounded bg-secondary/60 text-secondary-foreground hover:bg-secondary/80 cursor-pointer font-medium"
                      >
                        Manage stacks
                      </button>
                      {p.hosting?.enabled && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); if (onHostingDisable) void onHostingDisable(p.path); }}
                          className="text-[11px] px-2.5 py-1 rounded text-red-400 border border-red-500/30 hover:bg-red-500/10 cursor-pointer font-medium ml-auto"
                          title="Disable hosting (stops the container)"
                        >
                          Disable hosting
                        </button>
                      )}
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
                        {p.tynnTokenSet && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue/15 text-blue font-semibold">tynn</span>
                        )}
                      </div>
                    </Table.Cell>
                    <Table.Cell>
                      {/* s130 t524 — Tynn column. Renders open|doing two-tone
                          per projects-browser-v2.html mockup. Empty state
                          when no PM provider is configured / reachable.
                          Backend wiring of `tynnSlice` lands in a follow-up
                          slice (PM provider client integration). */}
                      {(() => {
                        const t = p.tynnSlice;
                        if (!t) {
                          return <span className="text-[11px] text-muted-foreground/40">—</span>;
                        }
                        return (
                          <span
                            className="text-[11px] font-mono"
                            title={t.storyId ? `Story ${t.storyId}` : undefined}
                            data-testid={`project-tynn-${projectSlug(p.path)}`}
                          >
                            <span className="text-blue font-semibold">{t.open}</span>
                            <span className="text-muted-foreground"> | </span>
                            <span className="text-yellow font-semibold">{t.doing}</span>
                          </span>
                        );
                      })()}
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
                      {(() => {
                        // Health column per projects-browser-v2 mockup:
                        // ✓ green = running healthy
                        // ⚠ amber = configured but stopped or in error state
                        // ─ idle  = not hosting OR unconfigured
                        if (!p.hosting || !p.hosting.enabled || p.hosting.status === "unconfigured") {
                          return <span className="text-[11px] text-muted-foreground" title="Not hosting">— idle</span>;
                        }
                        if (p.hosting.status === "running") {
                          return (
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] text-green font-semibold" title="Running">✓ green</span>
                              {p.hosting.hostname && (
                                <a
                                  href={`https://${p.hosting.hostname}.${hostingStatus?.baseDomain ?? "ai.on"}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="text-[10px] text-blue underline"
                                >
                                  {p.hosting.hostname}
                                </a>
                              )}
                            </div>
                          );
                        }
                        if (p.hosting.status === "error") {
                          return (
                            <span
                              className="text-[11px] text-red font-semibold"
                              title={p.hosting.error ?? "Container error"}
                            >
                              ⚠ error
                            </span>
                          );
                        }
                        // status = "stopped" but enabled = true → amber
                        return <span className="text-[11px] text-yellow font-semibold" title="Stopped (configured)">⚠ amber</span>;
                      })()}
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
                  {p.tynnTokenSet && (
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
