/**
 * ProjectDetail — full project page with repo, hosting, and settings sections.
 * Route: /projects/:slug
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { cn } from "@/lib/utils";
import { Callout } from "@particle-academy/react-fancy";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { execGitAction, fetchProjectFileTree, fetchProjectFile, saveProjectFile, createProjectFile, deleteProjectFile, renameProjectFile, fetchPluginPanels, fetchPluginActions, fetchProjectTypes, fetchIterativeWorkStatus, fetchIterativeWorkProgress, updateProjectRepo } from "../api.js";
import type { FileNode, IterativeWorkProjectStatus, IterativeWorkProgress } from "../api.js";
import { DevNotes } from "@/components/ui/dev-notes";
import type { PluginAction, PluginPanel, ProjectActivity, ProjectInfo } from "../types.js";
import { RepoPanel } from "./RepoPanel.js";
import { RepoManager } from "./RepoManager.js";
import { CoreForkRepoPanel } from "./CoreForkRepoPanel.js";
import { HostingPanel } from "./HostingPanel.js";
import { EnvManager } from "./EnvManager.js";
import { TaskmasterTab } from "./TaskmasterTab.js";
import { IterativeWorkTab } from "./IterativeWorkTab.js";
import { MCPTab } from "./MCPTab.js";
import { ProjectActivityTab } from "./ProjectActivityTab.js";
import { ProjectManagement } from "./ProjectManagement.js";
import type { HostingStatus } from "../api.js";
import { TreeNav, ContextMenu, useToast } from "@particle-academy/react-fancy";
import { CodeEditor } from "@particle-academy/fancy-code";
import "@particle-academy/fancy-code/styles.css";
import { projectSlug } from "./Projects.js";
import { WidgetRenderer } from "./WidgetRenderer.js";
import { isSacredProject } from "@/lib/sacred-projects.js";
import { SecurityTab } from "./SecurityTab.js";
import { MagicAppPicker } from "./MagicAppPicker.js";

export interface ProjectDetailProps {
  projects: ProjectInfo[];
  onUpdate: (params: { path: string; name?: string; tynnToken?: string | null; category?: string; type?: string; description?: string }) => Promise<void>;
  updating: boolean;
  onDelete: (params: { path: string; confirm: boolean }) => Promise<void>;
  deleting: boolean;
  onRefresh: () => void;
  onOpenChat: (context: string) => void;
  theme?: "light" | "dark";
  projectActivity?: Record<string, ProjectActivity | null>;
  hostingStatus?: HostingStatus | null;
  onHostingConfigure?: (params: { path: string; type?: string; hostname?: string; docRoot?: string; startCommand?: string }) => Promise<unknown>;
  onHostingRestart?: (path: string) => Promise<unknown>;
  onTunnelEnable?: (path: string) => Promise<unknown>;
  onTunnelDisable?: (path: string) => Promise<unknown>;
  hostingBusy?: boolean;
  onOpenEditor?: (path: string) => void;
  onToolExecute?: (projectPath: string, toolId: string) => Promise<{ ok: boolean; output?: string; error?: string }>;
  onOpenTerminal?: (path: string) => void;
  contributingEnabled?: boolean;
  onFixFinding?: (projectPath: string, finding: import("@/types").SecurityFinding) => void;
  onOpenMagicApp?: (appId: string, projectPath: string) => Promise<void>;
}

// s134 t517 slice 5b — Sub-surface pill class. Overrides react-fancy
// Tabs underline-variant defaults via tailwind-merge so the sub-surface
// row matches mockup B's `.sub-surface .sub` styling. Active state is
// driven by aria-selected which TabsTab sets on the underlying button.
const SUB_PILL_CLASS = "border-b-0 px-2 py-1 text-[12px] font-medium normal-case rounded transition-colors text-muted-foreground hover:text-foreground hover:bg-secondary/40 [&[aria-selected=true]]:bg-yellow [&[aria-selected=true]]:text-black [&[aria-selected=true]]:font-semibold [&[aria-selected=true]]:hover:bg-yellow [&[aria-selected=true]]:hover:text-black";

// s134 t517 slice 5c starter — Map active tab id to human-readable canvas
// section label. The Canvas header reads "Canvas · <label>" per mockup B
// (e.g. "Canvas · Editor", "Canvas · Hosting"). Plugin panels show their
// registered label; built-in tabs use the strip's display name.
const CANVAS_LABELS: Record<string, string> = {
  details: "Details",
  files: "Editor",
  repository: "Repository",
  environment: "Environment",
  hosting: "Hosting",
  "iterative-work": "Iterative Work",
  mcp: "MCP",
  "magic-apps": "MagicApps",
  taskmaster: "TaskMaster",
  security: "Security",
  activity: "Activity",
};

function tabIdToCanvasLabel(tabId: string, panels: PluginPanel[]): string {
  if (tabId.startsWith("plugin-")) {
    const panelId = tabId.slice("plugin-".length);
    const panel = panels.find((p) => p.id === panelId);
    return panel?.label ?? "Plugin";
  }
  return CANVAS_LABELS[tabId] ?? tabId;
}

export function ProjectDetail({
  projects, onUpdate, updating, onDelete, deleting, onRefresh, onOpenChat, theme,
  hostingStatus, onHostingConfigure, onHostingRestart,
  onTunnelEnable, onTunnelDisable, hostingBusy,
  onOpenEditor, onToolExecute, onOpenTerminal, contributingEnabled, onFixFinding,
  onOpenMagicApp,
}: ProjectDetailProps) {
  const { slug } = useParams<{ slug: string }>();
  const project = projects.find((p) => projectSlug(p.path) === slug);
  const isSacred = project ? (isSacredProject(project) || project.projectType?.id === "aionima") : false;
  const canViewSacred = Boolean(contributingEnabled);
  // Core fork = provisioned by Dev Mode into the `_aionima/` collection.
  // These get a drastically reduced UX — only Editor + Repository tabs.
  // No hosting, no environment, no taskmaster, no plugins — they are
  // source trees the owner submits PRs from, not deployables.
  const isCoreFork = project?.coreCollection === "aionima" || project?.projectType?.id === "aionima";

  const [editName, setEditName] = useState<string | null>(null);
  // s140 cycle-169 t591 — Tynn token state removed; token now lives in
  // the Tynn MCP plugin settings UX, not on the project Details tab.
  const [editProjectType, setEditProjectType] = useState<string | null>(null);
  // s150 t636 — free-form purpose textarea replaces the legacy Purpose select.
  // Bound to project.description (a top-level optional field already in the schema).
  const [editDescription, setEditDescription] = useState<string | null>(null);
  const [projectTypes, setProjectTypes] = useState<Array<{ id: string; label: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [cloneUrl, setCloneUrl] = useState("");
  const [repoSetupBusy, setRepoSetupBusy] = useState(false);
  const [repoSetupError, setRepoSetupError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("details");
  // s140 t592 cycle-176 — Details sub-tab (Identity / Configuration /
  // Lifecycle). Owner-chosen UX shape: tabbed sub-pages inside the
  // outer Details tab. Default to identity since that's the most-
  // common landing (rename, glance at path, see sacred state).
  const [detailsSubTab, setDetailsSubTab] = useState<"identity" | "configuration" | "lifecycle">("identity");
  // s140 t597 cycle-176 — primary repo selector (multi-repo projects only).
  // Owner: "selection for primary repo that is served on port 80 of that
  // container. If only 1 repo is found, don't show the select. And don't
  // show this for project types that don't serve repos."
  const [editPrimaryRepo, setEditPrimaryRepo] = useState<string | null>(null);
  const [savingPrimaryRepo, setSavingPrimaryRepo] = useState(false);
  // s134 t517 slice 2 (cycle 112) — workspace mode shell. The 4 modes
  // group the existing 11 tabs per the projects-ux-v2/project-workspace-
  // v2.html mockup. Default "develop" matches Editor as the most-common
  // landing. Mode → tabs map below; the TabsList filters by mode.
  const [currentMode, setCurrentMode] = useState<"develop" | "operate" | "coordinate" | "insight">("develop");
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  // s140 (cycle 156) — scope filter for the file tree. Owner asked to
  // surface k/, repos/, sandbox/ prominently in the project UX. Default
  // 'all' keeps the existing whole-tree view; the three pills above the
  // tree narrow the view to just one of the canonical s140 subtrees.
  const [treeScope, setTreeScope] = useState<"all" | "k" | "repos" | "sandbox">("all");
  const [pluginPanels, setPluginPanels] = useState<PluginPanel[]>([]);
  const [pluginActions, setPluginActions] = useState<PluginAction[]>([]);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState("");

  // Inline file editor state (Files tab)
  const [openFilePath, setOpenFilePath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState("");
  const [fileDraft, setFileDraft] = useState("");
  const [fileLoading, setFileLoading] = useState(false);
  const [fileSaving, setFileSaving] = useState(false);
  const [contextTargetPath, setContextTargetPath] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const fileDirty = openFilePath !== null && fileDraft !== fileContent;

  // Change detection: track a generation counter to trigger refreshes
  const [fileTreeGen, setFileTreeGen] = useState(0);
  const [showHiddenFiles, setShowHiddenFiles] = useState(false);
  const repoPanelRef = useRef<{ refresh: () => void } | null>(null);

  // Fetch plugin panels & actions for this project type
  useEffect(() => {
    const pt = project?.projectType?.id;
    if (!pt) return;
    fetchPluginPanels(pt).then(setPluginPanels).catch(() => {});
    fetchPluginActions("project", pt).then(setPluginActions).catch(() => {});
  }, [project?.projectType?.id]);

  // Fetch available project types for the type selector
  useEffect(() => {
    fetchProjectTypes()
      .then((data) => setProjectTypes(data.types.map((t) => ({ id: t.id, label: t.label }))))
      .catch(() => {});
  }, []);

  // s134 t517 slice 2 — mode → tab map. Each tab is assigned to one of
  // the 4 modes per the projects-ux-v2 mockup B pre-pick table. Plugin
  // panels default to Coordinate (safest fallback per the mockup README).
  // When the active mode changes, switch activeTab to the first tab in
  // the new mode so the user sees something immediately.
  const TAB_MODES: Record<string, "develop" | "operate" | "coordinate" | "insight"> = {
    "details": "develop",
    "files": "develop",
    "repository": "develop",
    "environment": "develop",
    "hosting": "operate",
    "iterative-work": "operate",
    "mcp": "operate",
    "magic-apps": "coordinate",
    "taskmaster": "coordinate",
    "security": "insight",
    "activity": "insight",
  };
  const tabBelongsToMode = (tabId: string): boolean => {
    if (tabId.startsWith("plugin-")) {
      const panelId = tabId.slice("plugin-".length);
      const panel = pluginPanels.find((p) => p.id === panelId);
      return ((panel?.mode ?? "coordinate") as string) === currentMode;
    }
    return TAB_MODES[tabId] === currentMode;
  };
  // Auto-switch activeTab when mode changes if the current tab is no
  // longer in the active mode.
  useEffect(() => {
    if (!tabBelongsToMode(activeTab)) {
      // Find first tab in current mode (prefer the canonical first one)
      const candidates = ["details", "files", "repository", "environment", "hosting", "iterative-work", "mcp", "magic-apps", "taskmaster", "security", "activity"];
      const firstInMode = candidates.find((id) => TAB_MODES[id] === currentMode);
      if (firstInMode) setActiveTab(firstInMode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentMode]);

  // s134 t517 slice 4 — auto-redirect when the default mode is hidden
  // by the project's category (literature/media/administration). Pick
  // the first visible mode for that category.
  useEffect(() => {
    const cat = project?.category ?? project?.projectType?.category;
    const hideDevelop = cat === "literature" || cat === "media" || cat === "administration";
    const hideOperate = cat === "literature" || cat === "media";
    if (currentMode === "develop" && hideDevelop) {
      setCurrentMode(hideOperate ? "coordinate" : "operate");
    } else if (currentMode === "operate" && hideOperate) {
      setCurrentMode("coordinate");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.category, project?.projectType?.category]);

  // Fetch file tree when Files tab is selected (or refresh triggered)
  useEffect(() => {
    if (activeTab !== "files" || !project) return;
    setTreeLoading(true);
    fetchProjectFileTree(project.path, showHiddenFiles)
      .then(setFileTree)
      .finally(() => setTreeLoading(false));
  }, [activeTab, project?.path, fileTreeGen, showHiddenFiles]);

  // Load file content when a file is selected
  useEffect(() => {
    if (!openFilePath) return;
    let cancelled = false;
    setFileLoading(true);
    setFileError(null);
    fetchProjectFile(openFilePath)
      .then((result) => {
        if (cancelled) return;
        setFileContent(result.content);
        setFileDraft(result.content);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setFileError(err.message);
        setFileContent("");
        setFileDraft("");
      })
      .finally(() => { if (!cancelled) setFileLoading(false); });
    return () => { cancelled = true; };
  }, [openFilePath]);

  // Initialize edit fields when project loads
  const name = editName ?? project?.name ?? "";
  const description = editDescription ?? project?.description ?? "";

  const handleSave = useCallback(async () => {
    if (!project) return;
    setSaving(true);
    try {
      // s140 cycle-169 t591 — params.tynnToken removed; token configuration
      // owned by the Tynn MCP plugin settings UX. The PUT route still
      // accepts a tynnToken body for back-compat callers, but the Details
      // tab no longer exposes it.
      const params: { path: string; name?: string; type?: string; description?: string } = { path: project.path };
      const trimmedName = name.trim();
      if (trimmedName && trimmedName !== project.name) params.name = trimmedName;
      // s150 t636 — free-form purpose textarea (Description). Empty string is
      // the canonical "cleared" value, so include it when it differs from the
      // currently-saved description.
      const trimmedDescription = description.trim();
      if (trimmedDescription !== (project.description ?? "")) {
        params.description = trimmedDescription;
      }
      // Include project type change — also trigger hosting reconfigure
      const selectedType = editProjectType;
      if (selectedType && selectedType !== (project.projectType?.id ?? "")) {
        params.type = selectedType;
      }
      await onUpdate(params);
      // If type changed, reconfigure hosting so container uses the new type
      if (params.type && onHostingConfigure) {
        await onHostingConfigure({ path: project.path, type: params.type });
      }
    } catch { /* error shown via hook */ } finally {
      setSaving(false);
    }
  }, [project, name, description, editProjectType, onUpdate, onHostingConfigure]);

  const handleFileSave = useCallback(async () => {
    if (!openFilePath || !fileDirty) return;
    setFileSaving(true);
    setFileError(null);
    try {
      await saveProjectFile(openFilePath, fileDraft);
      setFileContent(fileDraft);
    } catch (err: unknown) {
      setFileError(err instanceof Error ? err.message : String(err));
    } finally {
      setFileSaving(false);
    }
  }, [openFilePath, fileDraft, fileDirty]);

  // Cmd+S / Ctrl+S to save the active file
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        void handleFileSave();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleFileSave]);

  const handleSelectFile = useCallback((relPath: string) => {
    if (!project) return;
    setOpenFilePath(`${project.path}/${relPath}`);
  }, [project]);

  const handleRefreshFiles = useCallback(() => {
    setFileTreeGen((g) => g + 1);
    // Also reload the currently open file from disk
    if (openFilePath) {
      fetchProjectFile(openFilePath)
        .then((result) => {
          setFileContent(result.content);
          setFileDraft(result.content);
        })
        .catch(() => { /* file may have been deleted */ });
    }
  }, [openFilePath]);

  const handleRefreshRepo = useCallback(() => {
    repoPanelRef.current?.refresh();
  }, []);

  if (!project || (isSacred && !canViewSacred)) {
    return (
      <div>
        <Link to="/projects" className="inline-block mb-4 no-underline">
          <Button variant="outline" size="sm">Back to Projects</Button>
        </Link>
        <div className="text-center py-12 text-muted-foreground">
          {isSacred && !canViewSacred
            ? "Sacred projects are only visible in Contributing mode."
            : "Project not found."}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden p-3 md:p-6">
      {/* Header row */}
      <div className="flex items-center justify-between mb-6 shrink-0">
        <Link to="/projects" className="no-underline">
          <Button variant="outline" size="sm">Back to Projects</Button>
        </Link>
        <div className="flex gap-2">
          {/* The project-level (container) terminal lives in the Development tab > Terminal
              subtab. The host-level system terminal is now a global button in the dashboard
              header — see root.tsx. No Terminal button on the project page. */}
          <Button size="sm" data-testid="project-chat-button" onClick={() => onOpenChat(project.path)}>
            open chat
          </Button>
        </div>
      </div>

      {/* Project heading — extended per projects-ux-v2 mockup B (cycle 134):
          status dot + ⌗N repos count + category badge alongside the name. */}
      <div className="flex items-center gap-3 mb-6 shrink-0">
        {/* Status dot — green when container running, amber when stopped/error,
            grey when not hosting. */}
        {(() => {
          const s = project.hosting?.status;
          const enabled = project.hosting?.enabled;
          if (!enabled) return null;
          const cls = s === "running" ? "bg-green" : s === "error" ? "bg-red" : "bg-yellow";
          // s140 cycle-172 t594 — aria-label not title. title doesn't show
          // on touch devices and is inconsistently announced by screen
          // readers. aria-label is the durable a11y primitive for an
          // icon-only pill. role="status" so AT users perceive it as a
          // live state indicator, not a generic span.
          return (
            <span
              className={cn("inline-block w-2 h-2 rounded-full", cls)}
              role="status"
              aria-label={`Container ${s}`}
            />
          );
        })()}
        <h2 className="text-xl font-bold text-foreground">{project.name}</h2>
        <DevNotes title="Project workspace — dev notes">
          <DevNotes.Item kind="info" heading="Cycles 144-148 — Canvas + Chat split (slice 5c phases 1-3)">
            Mockup B's flyout-shell shape is in: Canvas section header reads `Canvas · {"{tab}"}`,
            tabs sit on the left (flex-1), chat aside sits on the right (280px, lg+ only). The
            aside shows iterative-work status (when eligible) + an Open chat CTA.
          </DevNotes.Item>
          <DevNotes.Item kind="todo" heading="Slice 5c phase 4 — chat content not yet in aside">
            The actual chat thread + composer is still rendered inside the cycle-87 floating
            ChatFlyout, NOT inside the workspace aside. Phase 4 moves that content into the
            right panel and adds collapsible AccordionFlyout chrome.
          </DevNotes.Item>
          <DevNotes.Item kind="warning" heading="Chat panel close button desync (cycle 149 owner-flagged)">
            Clicking X in the chat panel header collapses both AccordionFlyout sections to rail-only
            but leaves the header chat-button highlighted as active. The two close triggers need
            two-way binding via `onOpenChange`. Filed as comment on s134 t517.
          </DevNotes.Item>
          <DevNotes.Item kind="info" heading="Cycle 137 — sub-surface pill restyle (slice 5b)">
            Mode picker pill row uses tailwind arbitrary-attribute variant
            `[&[aria-selected=true]]` to override react-fancy underline-variant defaults via
            tailwind-merge. Yellow active fill, muted hover inactive.
          </DevNotes.Item>
          <DevNotes.Item kind="todo" heading="Cage indicator (t517 item 6)">
            Depends on s130 t515 phase B (chat-tool cage primitive — backlog). When chat is
            project-bound, a small "Tools caged to this project" pill appears in the chat header.
          </DevNotes.Item>
          <DevNotes.Item kind="warning" heading="Project folder restructure incoming (s140)">
            Each project will move to {"{k/, repos/, sandbox/}"} (with chat at k/chat/) at the project root with a
            single root `project.json` config (project- + repo-config combined). Stacks attach to
            individual repos, not to the project. Multi-repo single-container hosting UI extends
            with per-repo {"{config, start, dev, stack-actions}"} surfaces. Migration runs as a
            dry-run report first; no file moves until owner sign-off.
          </DevNotes.Item>
        </DevNotes>
        {project.category && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground uppercase tracking-wider font-medium" title={`Category: ${project.category}`}>
            {project.category}
          </span>
        )}
        {(() => {
          // ⌗N repos count — counts runtime repos + falls back to ⌗1 for
          // single-repo projects (matches Projects browser column convention)
          const repoCount = project.repos?.length ?? 0;
          const display = repoCount === 0 ? "⌗1" : `⌗${repoCount}`;
          const title = repoCount === 0 ? "Single-repo project" : `Multi-repo: ${(project.repos ?? []).map((r) => r.name).join(", ")}`;
          return (
            <span className="text-[11px] font-mono text-muted-foreground" title={title}>
              {display}
            </span>
          );
        })()}
        {isSacred && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow/15 text-yellow font-semibold">sacred</span>
        )}
        {project.hasGit && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-green/15 text-green font-semibold">git</span>
        )}
        {project.tynnTokenSet && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue/15 text-blue font-semibold">tynn</span>
        )}
        {project.hosting?.enabled && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-green/15 text-green font-semibold">hosted</span>
        )}
        {/*
          s140 cycle-171 t593 — header-level Restart affordance for ALL
          hosted projects, not just hasCode types. Pre-fix the only
          Restart button lived inside HostingPanel which is gated on
          project.projectType.hasCode — so MApp containers (hasCode=false)
          and ops projects had no way to nudge a stuck container without
          re-saving config. This button always renders when hosting is
          enabled + onHostingRestart is wired (i.e. when the dashboard
          is connected to a real gateway).
        */}
        {project.hosting?.enabled && onHostingRestart && (
          <Button
            size="sm"
            variant="outline"
            className="text-[10px] h-6 px-2"
            data-testid="project-header-restart"
            onClick={() => { void onHostingRestart(project.path).catch(() => { /* surfaced via toast */ }); }}
          >
            Restart
          </Button>
        )}
        {project.hosting?.enabled && project.hosting.url && project.hosting.status === "running" && (
          <a
            href={project.hosting.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[12px] text-blue underline ml-auto"
          >
            {project.hosting.url}
          </a>
        )}
        {project.hosting?.tunnelUrl && project.hosting.status === "running" && (
          <a
            href={project.hosting.tunnelUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[12px] text-green underline"
          >
            {project.hosting.tunnelUrl}
          </a>
        )}
      </div>

      {/* s134 t517 slice 1 (cycle 111) — persistent stack strip per the
          projects-ux-v2/project-workspace-v2.html mockup. Renders above
          the existing tab strip; visible across all modes (today: tabs;
          future: 4-mode picker per slice 2+). The strip is Aion-readable
          context — when iterative-work or plan reasoning fires, the
          stacks here scope what the agent can plan around (e.g. "you have
          postgres + redis, so a cache-invalidation step is feasible").
          Skipped for core forks (aionima collection) since they're
          source trees, not deployable services. */}
      {!isCoreFork && project.projectType?.hasCode && (
        <div
          className="flex items-center gap-2 px-3 py-2 mb-3 rounded-md bg-indigo-500/5 border border-indigo-500/20"
          data-testid="project-stack-strip"
        >
          <span className="text-[10px] font-semibold uppercase tracking-wider text-indigo-400">Stack</span>
          {project.attachedStacks && project.attachedStacks.length > 0 ? (
            project.attachedStacks.map((s) => {
              const label = s.stackId.replace(/^stack-/, "");
              return (
                <span
                  key={s.stackId}
                  className="text-[11px] px-2 py-0.5 rounded bg-indigo-500/15 text-indigo-300 font-mono font-medium"
                  title={s.stackId}
                >
                  ▣ {label}
                </span>
              );
            })
          ) : (
            <span className="text-[11px] text-muted-foreground/60 italic">
              No stacks attached
            </span>
          )}
          {/* + stack affordance per projects-ux-v2 mockup B (cycle 134).
              Clicking jumps to the Hosting tab where StackManager lets
              the owner attach a stack. */}
          <button
            type="button"
            onClick={() => setActiveTab("hosting")}
            className="text-[11px] px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-300/80 hover:bg-indigo-500/20 hover:text-indigo-200 cursor-pointer transition-colors"
            title="Add a stack (postgres / redis / etc) — jumps to Hosting tab"
            data-testid="project-stack-add"
          >
            + stack
          </button>
          <span className="text-[10px] text-muted-foreground/60 italic ml-auto">
            Aion's iterative-work + plan reasoning reads from here ↑
          </span>
        </div>
      )}

      {/* s134 t517 slice 2 (cycle 112) — 4-mode picker per the
          projects-ux-v2/project-workspace-v2.html mockup. Replaces
          the visual organization of the existing 11 tabs by grouping
          them into Develop / Operate / Coordinate / Insight modes.
          Tabs themselves are unchanged; the picker filters which
          ones show. Skipped for core forks (which already have a
          restricted tab set unsuitable for mode grouping).

          s134 t517 slice 4 (cycle 115) — category-shaped mode visibility:
          - literature/media (content projects): hide Develop + Operate
            (no code → no editor/hosting tabs)
          - administration: hide Develop (no code)
          - Otherwise (web/app/monorepo/ops): all 4 modes visible */}
      {!isCoreFork && (() => {
        const cat = project.category ?? project.projectType?.category;
        const hideDevelop = cat === "literature" || cat === "media" || cat === "administration";
        const hideOperate = cat === "literature" || cat === "media";
        const visibleModes = (["develop", "operate", "coordinate", "insight"] as const).filter((m) => {
          if (m === "develop" && hideDevelop) return false;
          if (m === "operate" && hideOperate) return false;
          return true;
        });
        return (
          <div className="flex items-center gap-1 mb-3 border-b border-border" data-testid="project-mode-picker">
            {visibleModes.map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setCurrentMode(mode)}
                className={cn(
                  "px-4 py-2 text-[13px] font-medium uppercase tracking-wider transition-colors cursor-pointer border-b-2",
                  currentMode === mode
                    ? "text-foreground border-yellow"
                    : "text-muted-foreground border-transparent hover:text-foreground",
                )}
                aria-pressed={currentMode === mode}
                data-testid={`project-mode-${mode}`}
              >
                {mode}
              </button>
            ))}
          </div>
        );
      })()}

      {/* s134 t517 slice 5b — Sub-surface pill restyle. Replaces the
          underline TabsList chrome with the mockup B `.sub-surface` pill
          row: 12px text, 4×8 padding, rounded-md, yellow active fill on
          black, muted inactive. Label `<Mode> ›` lives inline (no longer
          a separate row). Core forks fall back to the original
          underline TabsList because they have no mode picker.

          The active state styling uses tailwind arbitrary-attribute
          variants `[&[aria-selected=true]]:...` to override the
          react-fancy underline-variant defaults via tailwind-merge. */}
      {/* s134 t517 slice 5c phase 2 — flyout-shell wrap. Per mockup B, the
          workspace puts Canvas + Chat side-by-side. The chat panel renders
          as a fixed-width aside on lg+ viewports; on smaller screens it's
          hidden to keep the canvas usable. Phase 2 is a placeholder; the
          actual chat integration (project-scoped session + composer +
          history) lands in slice 5c phase 3+ when chat is moved out of
          the floating ChatFlyout into the workspace right panel. Skipped
          for core forks (no canvas/chat concept). */}
      <div className={cn("flex flex-1 min-h-0", !isCoreFork && "lg:flex-row gap-3")} data-testid="project-flyout-shell">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 min-w-0 min-h-0 flex flex-col">
        {isCoreFork ? (
          <TabsList>
            <TabsTrigger value="files">Editor</TabsTrigger>
            <TabsTrigger value="repository">Repository</TabsTrigger>
          </TabsList>
        ) : (
          <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border flex-wrap" data-testid="project-sub-surface">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold whitespace-nowrap pr-1" data-testid="project-sub-surface-label">{currentMode} ›</span>
            <TabsList className="border-b-0 gap-1 flex-wrap py-0">
              {tabBelongsToMode("details") && <TabsTrigger value="details" className={SUB_PILL_CLASS}>Details</TabsTrigger>}
              {tabBelongsToMode("files") && <TabsTrigger value="files" className={SUB_PILL_CLASS}>Editor</TabsTrigger>}
              {tabBelongsToMode("repository") && <TabsTrigger value="repository" className={SUB_PILL_CLASS}>Repository</TabsTrigger>}
              {tabBelongsToMode("hosting") && onHostingConfigure && onHostingRestart && project.projectType?.hasCode && (
                <TabsTrigger value="hosting" className={SUB_PILL_CLASS}>Hosting</TabsTrigger>
              )}
              {tabBelongsToMode("environment") && project.projectType?.hasCode && (
                <TabsTrigger value="environment" className={SUB_PILL_CLASS}>Environment</TabsTrigger>
              )}
              {tabBelongsToMode("magic-apps") && <TabsTrigger value="magic-apps" className={SUB_PILL_CLASS}>MagicApps</TabsTrigger>}
              {tabBelongsToMode("taskmaster") && <TabsTrigger value="taskmaster" className={SUB_PILL_CLASS}>TaskMaster</TabsTrigger>}
              {tabBelongsToMode("iterative-work") && (project.iterativeWorkEligible ?? project.projectType?.iterativeWorkEligible) && (
                <TabsTrigger value="iterative-work" className={SUB_PILL_CLASS}>Iterative Work</TabsTrigger>
              )}
              {tabBelongsToMode("mcp") && project.projectType?.hasCode && (
                <TabsTrigger value="mcp" className={SUB_PILL_CLASS}>MCP</TabsTrigger>
              )}
              {pluginPanels
                .filter((p) => (p.mode ?? "coordinate") === currentMode)
                .map((p) => (
                  <TabsTrigger key={p.id} value={`plugin-${p.id}`} className={SUB_PILL_CLASS}>{p.label}</TabsTrigger>
                ))}
              {tabBelongsToMode("security") && project.projectType?.hasCode && (
                <TabsTrigger value="security" className={SUB_PILL_CLASS}>Security</TabsTrigger>
              )}
              {tabBelongsToMode("activity") && (
                <TabsTrigger value="activity" className={SUB_PILL_CLASS} data-testid="project-tab-activity">Activity</TabsTrigger>
              )}
            </TabsList>
          </div>
        )}

        {/* Active sub-surface label. Was 'Canvas · {label}' per mockup B —
            owner clarified (cycle 157): there's only ONE Canvas (the
            AgentCanvas that opens with chat), so the 'Canvas · ' prefix
            is misleading on every project sub-tab. Drop the prefix; keep
            the label so owners still see which sub-surface is active. */}
        {!isCoreFork && (
          <h2
            className="text-[12px] uppercase tracking-wider text-muted-foreground/80 font-semibold mt-3 mb-2 px-1"
            data-testid="project-canvas-header"
          >
            {tabIdToCanvasLabel(activeTab, pluginPanels)}
          </h2>
        )}

        <TabsContent value="details" className="mt-4 flex-1 min-h-0 overflow-y-auto">
          {/*
            s140 t592 cycle-176 — Tabbed sub-pages: Identity /
            Configuration / Lifecycle. Owner-chosen shape (Q-14).
            Owner principle (cycle-176 clarification): "the details
            tab should not show stuff that other tabs are showing".
            So this tab carries the project-level metadata that
            doesn't fit into Editor (files), Repository (git), Hosting
            (container kind), Environment (env vars), MCP (servers),
            etc. Identity = name + path + sacred state. Configuration =
            project type + category (drives behavior). Lifecycle = the
            two destructive/structural actions (Save metadata + Delete).
          */}
          <div className="flex gap-1 mb-3 border-b border-border" data-testid="details-sub-tabs">
            {(["identity", "configuration", "lifecycle"] as const).map((sub) => (
              <button
                key={sub}
                type="button"
                data-testid={`details-sub-tab-${sub}`}
                onClick={() => setDetailsSubTab(sub)}
                className={cn(
                  "text-[12px] px-3 py-1.5 -mb-px border-b-2 transition-colors",
                  detailsSubTab === sub
                    ? "border-primary text-foreground font-semibold"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {sub === "identity" ? "Identity" : sub === "configuration" ? "Configuration" : "Lifecycle"}
              </button>
            ))}
          </div>

          {/* Identity sub-tab — the name + where it lives + sacred banner */}
          {detailsSubTab === "identity" && (
            <Card className="p-4" data-testid="details-sub-pane-identity">
              <div className="mb-3">
                <label className="block text-[11px] font-semibold text-muted-foreground mb-1">Name</label>
                <Input
                  type="text"
                  value={name}
                  onChange={(e) => setEditName(e.target.value)}
                  data-testid="project-name-input"
                  disabled={isSacred}
                />
              </div>
              <div className="mb-3">
                <label className="block text-[11px] font-semibold text-muted-foreground mb-1">Project path</label>
                <div className="text-[11px] text-muted-foreground font-mono select-all" data-testid="project-path-display">
                  {project.path}
                </div>
              </div>
              {isSacred && (
                <Callout color="amber" className="mt-3">
                  <h3 className="text-[13px] font-bold text-yellow mb-1">Sacred Project</h3>
                  <p className="text-[11px] text-muted-foreground">
                    Sacred projects are managed by the system — metadata edits + deletion are disabled.
                  </p>
                </Callout>
              )}
              <div className="mt-3">
                <Button
                  size="sm"
                  onClick={() => void handleSave()}
                  disabled={saving || updating || isSacred}
                  variant={saving || updating || isSacred ? "secondary" : "default"}
                  data-testid="details-identity-save"
                >
                  {saving || updating ? "Saving..." : isSacred ? "Locked" : "Save"}
                </Button>
              </div>
            </Card>
          )}

          {/* Configuration sub-tab — project type + purpose drive other-tab behavior */}
          {detailsSubTab === "configuration" && (
            <Card className="p-4" data-testid="details-sub-pane-configuration">
              <p className="text-[11px] text-muted-foreground mb-3">
                These settings control how Aion treats the project. Hosting, MCP servers, and
                environment vars live in their own tabs.
              </p>
              {/* s150 t636 — Project Type is the single classifier. The legacy
                  "Purpose" select (bound to category) is replaced by a free-form
                  Purpose textarea below (bound to project.description). category
                  itself is dropped from the data model in s150 t630/t632. */}
              <div className="mb-3">
                <label className="block text-[11px] font-semibold text-muted-foreground mb-1">Project Type</label>
                <Select
                  className="text-[13px]"
                  list={(() => {
                    const items = [];
                    if (project.projectType && !projectTypes.some((t) => t.id === project.projectType?.id)) {
                      items.push({ value: project.projectType.id, label: `${project.projectType.label} (detected)` });
                    }
                    for (const pt of projectTypes) {
                      items.push({ value: pt.id, label: `${pt.label}${pt.id === project.projectType?.id ? " (detected)" : ""}` });
                    }
                    return items;
                  })()}
                  value={editProjectType ?? project.projectType?.id ?? ""}
                  onValueChange={(v) => setEditProjectType(v || null)}
                  disabled={isSacred}
                />
              </div>
              <div className="mb-3">
                <label className="block text-[11px] font-semibold text-muted-foreground mb-1">
                  Purpose <span className="font-normal italic opacity-70">(free-form — what this project is for)</span>
                </label>
                <textarea
                  className="w-full rounded border border-input bg-background px-2 py-1.5 text-[13px] resize-y min-h-[60px] disabled:opacity-50"
                  value={description}
                  onChange={(e) => setEditDescription(e.target.value)}
                  placeholder="One or two lines describing what this project is for. Visible to Aion as project context."
                  disabled={isSacred}
                  rows={3}
                  data-testid="project-purpose-textarea"
                />
              </div>

              {/*
                s140 t597 cycle-176 — Primary repo selector. Owner:
                "selection for primary repo that is served on port 80
                of that container. If only 1 repo is found, don't show
                the select. And don't show this for project types that
                don't serve repos."

                Render gates:
                  - project.projectType?.hasCode === true (project type
                    actually serves repos)
                  - (project.repos ?? []).length > 1 (more than one repo)

                The schema (config/src/project-schema.ts:310) requires
                a port to be set before isDefault can be true. We
                expose ALL repos in the select but mark port-less ones
                as not-eligible — picking one without a port would
                fail the schema validation, so the disabled flag
                prevents a doomed PUT.
              */}
              {project.projectType?.hasCode && (project.repos ?? []).length > 1 && (
                <div className="mb-3" data-testid="primary-repo-select-wrapper">
                  <label className="block text-[11px] font-semibold text-muted-foreground mb-1">
                    Primary repo (served on port 80)
                  </label>
                  <Select
                    className="text-[13px]"
                    list={(project.repos ?? []).map((r) => ({
                      value: r.name,
                      label: r.port
                        ? `${r.name}${r.isDefault ? " (current)" : ""} — port ${String(r.port)}`
                        : `${r.name} — port not set (cannot be primary)`,
                    }))}
                    value={
                      editPrimaryRepo ??
                      (project.repos ?? []).find((r) => r.isDefault)?.name ??
                      ""
                    }
                    onValueChange={(v) => setEditPrimaryRepo(v || null)}
                    disabled={isSacred || savingPrimaryRepo}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-[11px] h-7 mt-2"
                    data-testid="primary-repo-save"
                    disabled={
                      isSacred ||
                      savingPrimaryRepo ||
                      editPrimaryRepo === null ||
                      editPrimaryRepo === (project.repos ?? []).find((r) => r.isDefault)?.name
                    }
                    onClick={async () => {
                      if (!editPrimaryRepo) return;
                      const chosen = (project.repos ?? []).find((r) => r.name === editPrimaryRepo);
                      if (!chosen?.port) {
                        // Schema would reject this — surface as a no-op
                        // instead of letting a 400 bubble up. Owner can
                        // set a port for the repo via the Repository
                        // tab first.
                        return;
                      }
                      setSavingPrimaryRepo(true);
                      try {
                        // Set isDefault on each repo: true for the
                        // chosen one, false for the rest. Sequential
                        // (not parallel) so we don't briefly violate
                        // the "at most one isDefault=true" constraint.
                        for (const r of project.repos ?? []) {
                          if (r.name === editPrimaryRepo) continue;
                          if (r.isDefault) {
                            await updateProjectRepo(project.path, r.name, { isDefault: false });
                          }
                        }
                        await updateProjectRepo(project.path, editPrimaryRepo, { isDefault: true });
                        setEditPrimaryRepo(null);
                        onRefresh();
                      } finally {
                        setSavingPrimaryRepo(false);
                      }
                    }}
                  >
                    {savingPrimaryRepo ? "Setting primary..." : "Set as primary"}
                  </Button>
                </div>
              )}

              <Button
                size="sm"
                onClick={() => void handleSave()}
                disabled={saving || updating || isSacred}
                variant={saving || updating || isSacred ? "secondary" : "default"}
                data-testid="details-configuration-save"
              >
                {saving || updating ? "Saving..." : isSacred ? "Locked" : "Save"}
              </Button>
            </Card>
          )}

          {/* Lifecycle sub-tab — destructive / structural actions */}
          {detailsSubTab === "lifecycle" && (
            <div data-testid="details-sub-pane-lifecycle">
              {!isSacred ? (
                <>
                  <Callout color="red">
                    <h3 className="text-[13px] font-bold text-red mb-1">Danger Zone</h3>
                    <p className="text-[11px] text-muted-foreground mb-3">
                      Permanently delete this project and all its files. This action cannot be undone.
                    </p>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => { setDeleteConfirmName(""); setDeleteDialogOpen(true); }}
                      disabled={deleting}
                      data-testid="details-lifecycle-delete"
                    >
                      {deleting ? "Deleting..." : "Delete Project"}
                    </Button>
                  </Callout>

                  {/* Delete confirmation dialog */}
                  <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Delete {project.name}?</DialogTitle>
                        <DialogDescription>
                          This will permanently delete the project directory at{" "}
                          <code className="text-[11px] bg-surface1 px-1 py-0.5 rounded">{project.path}</code>{" "}
                          and all its contents. If hosting is enabled, it will be stopped first.
                        </DialogDescription>
                      </DialogHeader>
                      <div>
                        <label className="block text-[11px] font-semibold text-muted-foreground mb-1">
                          Type <span className="text-foreground">{project.name}</span> to confirm
                        </label>
                        <Input
                          type="text"
                          value={deleteConfirmName}
                          onChange={(e) => setDeleteConfirmName(e.target.value)}
                          placeholder={project.name}
                          autoFocus
                        />
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
                          Cancel
                        </Button>
                        <Button
                          variant="destructive"
                          disabled={deleteConfirmName !== project.name || deleting}
                          onClick={() => {
                            void onDelete({ path: project.path, confirm: true }).then(() => {
                              setDeleteDialogOpen(false);
                            });
                          }}
                        >
                          {deleting ? "Deleting..." : "Delete"}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </>
              ) : (
                <Callout color="amber">
                  <h3 className="text-[13px] font-bold text-yellow mb-1">Sacred Project</h3>
                  <p className="text-[11px] text-muted-foreground">
                    Sacred projects are immutable and cannot be deleted.
                  </p>
                </Callout>
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="files" className="mt-4 flex-1 min-h-0 overflow-hidden">
          <Card className="overflow-hidden h-full flex flex-col">
            {/* Toolbar — s140 scope pills surface the canonical project
                subtrees (k/, repos/, sandbox/) as first-class views. 'All'
                shows the whole tree; the others narrow to one subtree. */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-border">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold text-muted-foreground">Editor</span>
                <div className="flex items-center gap-1 ml-2">
                  {([
                    { id: "all", label: "All" },
                    { id: "k", label: "Knowledge" },
                    { id: "repos", label: "Repos" },
                    { id: "sandbox", label: "Sandbox" },
                  ] as const).map((scope) => (
                    <button
                      key={scope.id}
                      type="button"
                      onClick={() => setTreeScope(scope.id)}
                      className={cn(
                        "text-[11px] h-6 px-2 rounded-full border transition-colors",
                        treeScope === scope.id
                          ? "bg-primary/10 border-primary/40 text-foreground"
                          : "border-border text-muted-foreground hover:bg-accent/40",
                      )}
                    >
                      {scope.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={showHiddenFiles}
                    onChange={(e) => setShowHiddenFiles(e.target.checked)}
                    className="w-3.5 h-3.5"
                  />
                  Show hidden
                </label>
                <Button size="sm" variant="outline" className="text-[11px] h-7" onClick={handleRefreshFiles}>
                  Refresh
                </Button>
              </div>
            </div>
            {/* Panes — CSS grid that fills the remaining flex space.
                Parent Card is now h-full flex-col, so 'flex: 1' here
                inherits the real available height instead of fighting
                against a fixed 100vh-N calc that didn't match the
                actual viewport-constrained tab content area. */}
            <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", flex: 1, minHeight: 0 }}>
              {/* TreeNav pane with context menu */}
              <div style={{ overflow: "auto", borderRight: "1px solid var(--border)" }}>
                <ContextMenu>
                  <ContextMenu.Trigger className="w-full min-h-full">
                    {(() => {
                      // s140 (cycle 156) — narrow the tree to the selected
                      // scope. 'all' passes through unchanged. The others
                      // pull just the matching top-level subtree's
                      // children up so the tree renders rooted at that
                      // scope (saves owner a click + keeps the visible
                      // tree focused).
                      const scopedTree = treeScope === "all"
                        ? fileTree
                        : (fileTree.find((n) => n.name === treeScope)?.children ?? []);
                      if (treeLoading) {
                        return <div className="text-[12px] text-muted-foreground p-4">Loading files...</div>;
                      }
                      if (scopedTree.length === 0) {
                        return (
                          <div className="text-[12px] text-muted-foreground p-4">
                            {treeScope === "all" ? "No files found." : `No files in ${treeScope}/ yet.`}
                          </div>
                        );
                      }
                      return (
                      <TreeNav
                        nodes={scopedTree.map(function mapNode(n: FileNode): { id: string; label: string; type: "file" | "folder"; ext?: string; children?: { id: string; label: string; type: "file" | "folder"; ext?: string; children?: unknown[] }[] } {
                          return { id: n.path.startsWith(project.path) ? n.path.slice(project.path.length + 1) : n.path, label: n.name, type: n.type === "dir" ? "folder" : "file", ext: n.ext, children: n.children?.map(mapNode) };
                        }) as never}
                        selectedId={openFilePath ? openFilePath.replace(`${project.path}/`, "") : undefined}
                        onSelect={(id: string, node: { type?: string }) => {
                          if (node.type === "file") handleSelectFile(id);
                        }}
                        onNodeContextMenu={(_e: React.MouseEvent, node: { id?: string }) => {
                          setContextTargetPath(typeof node.id === "string" ? node.id : "");
                        }}
                        showIcons
                        indentSize={14}
                      />
                      );
                    })()}
                  </ContextMenu.Trigger>
                  <ContextMenu.Content>
                    <ContextMenu.Item onClick={() => {
                      const name = prompt("File name:");
                      if (!name) return;
                      const dir = contextTargetPath && contextTargetPath.includes("/") ? contextTargetPath.replace(/\/[^/]+$/, "") : contextTargetPath;
                      const fullPath = `${project.path}/${dir ? dir + "/" : ""}${name}`;
                      void createProjectFile(fullPath, "file").then(() => void handleRefreshFiles());
                    }}>
                      New File
                    </ContextMenu.Item>
                    <ContextMenu.Item onClick={() => {
                      const name = prompt("Folder name:");
                      if (!name) return;
                      const dir = contextTargetPath && contextTargetPath.includes("/") ? contextTargetPath.replace(/\/[^/]+$/, "") : contextTargetPath;
                      const fullPath = `${project.path}/${dir ? dir + "/" : ""}${name}`;
                      void createProjectFile(fullPath, "directory").then(() => void handleRefreshFiles());
                    }}>
                      New Folder
                    </ContextMenu.Item>
                    {contextTargetPath && (
                      <>
                        <ContextMenu.Separator />
                        <ContextMenu.Item onClick={() => {
                          const newName = prompt("New name:", contextTargetPath.split("/").pop());
                          if (!newName) return;
                          const oldFull = `${project.path}/${contextTargetPath}`;
                          const dir = contextTargetPath.includes("/") ? contextTargetPath.replace(/\/[^/]+$/, "") : "";
                          const newFull = `${project.path}/${dir ? dir + "/" : ""}${newName}`;
                          void renameProjectFile(oldFull, newFull).then(() => void handleRefreshFiles());
                        }}>
                          Rename
                        </ContextMenu.Item>
                        <ContextMenu.Item danger onClick={() => {
                          if (!confirm(`Delete "${contextTargetPath}"?`)) return;
                          void deleteProjectFile(`${project.path}/${contextTargetPath}`).then(() => {
                            if (openFilePath === `${project.path}/${contextTargetPath}`) setOpenFilePath(null);
                            void handleRefreshFiles();
                          });
                        }}>
                          Delete
                        </ContextMenu.Item>
                      </>
                    )}
                  </ContextMenu.Content>
                </ContextMenu>
              </div>
              {/* CodeEditor pane */}
              {openFilePath ? (
                <div style={{ display: "grid", gridTemplateRows: "auto 1fr", overflow: "hidden" }}>
                  {/* Editor header */}
                  <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-mantle">
                    <span className="text-[13px] font-semibold text-foreground truncate">
                      {openFilePath.split("/").pop()}
                    </span>
                    <span className="text-[10px] font-mono text-muted-foreground truncate flex-1">
                      {openFilePath.replace(`${project.path}/`, "")}
                    </span>
                    {fileDirty && (
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-yellow/20 text-yellow shrink-0">
                        modified
                      </span>
                    )}
                    {fileDirty && (
                      <div className="flex gap-1 shrink-0">
                        <button
                          onClick={() => setFileDraft(fileContent)}
                          className="text-[11px] text-muted-foreground hover:text-foreground cursor-pointer bg-transparent border-none"
                        >
                          Discard
                        </button>
                        <Button size="sm" className="text-[11px] h-6" onClick={() => void handleFileSave()} disabled={fileSaving}>
                          {fileSaving ? "Saving..." : "Save"}
                        </Button>
                      </div>
                    )}
                    <button
                      onClick={() => setOpenFilePath(null)}
                      className="text-muted-foreground hover:text-foreground cursor-pointer bg-transparent border-none text-[16px] leading-none shrink-0 ml-1"
                    >
                      &times;
                    </button>
                  </div>
                  {/* Editor body */}
                  <div style={{ overflow: "hidden" }}>
                    {fileLoading ? (
                      <div className="p-4 text-[12px] text-muted-foreground">Loading...</div>
                    ) : fileError ? (
                      <div className="p-4 text-[12px] text-red">{fileError}</div>
                    ) : (
                      <CodeEditor
                        value={fileDraft}
                        onChange={setFileDraft}
                        language={(() => {
                          const ext = openFilePath.split(".").pop()?.toLowerCase();
                          const map: Record<string, string> = {
                            ts: "typescript", tsx: "typescript",
                            js: "javascript", jsx: "javascript",
                            html: "html", htm: "html",
                            css: "css", scss: "css",
                            json: "json",
                            md: "markdown", mdx: "markdown",
                            yaml: "yaml", yml: "yaml",
                            php: "php",
                            py: "python",
                            go: "go",
                            rs: "rust",
                            sql: "sql",
                            sh: "shell", bash: "shell",
                            toml: "toml",
                            xml: "html",
                            svg: "html",
                            env: "shell",
                          };
                          return map[ext ?? ""] ?? "plaintext";
                        })()}
                        theme="auto"
                        className="h-full"
                      >
                        <CodeEditor.Toolbar />
                        <CodeEditor.Panel />
                      </CodeEditor>
                    )}
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }} className="text-muted-foreground">
                  <div className="text-center">
                    <div className="text-3xl mb-2">{"</>"}</div>
                    <div className="text-sm">Select a file to edit</div>
                  </div>
                </div>
              )}
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="repository" className="mt-4 flex-1 min-h-0 overflow-y-auto">
          <Card className="p-4">
            {isCoreFork && project?.coreForkSlug ? (
              <CoreForkRepoPanel slug={project.coreForkSlug} />
            ) : project.hasGit ? (
              <>
                <div className="flex items-center justify-end mb-2">
                  <Button size="sm" variant="outline" className="text-[11px] h-7" onClick={handleRefreshRepo}>
                    Refresh
                  </Button>
                </div>
                <RepoPanel ref={repoPanelRef} projectPath={project.path} theme={theme} />
                {/* s130 t515 B6c — multi-repo manager mounts below the
                    primary RepoPanel. Hidden for core forks (above branch)
                    and projects without a primary repo (below branch). */}
                {!isCoreFork && (
                  <div className="mt-4">
                    <RepoManager projectPath={project.path} />
                  </div>
                )}
              </>
            ) : (
              <div className="p-3 rounded-lg border border-border bg-mantle">
                <div className="text-[12px] font-semibold text-card-foreground mb-2">Add Repository</div>
                <div className="flex gap-1.5 items-center mb-2">
                  <Input
                    type="text"
                    value={cloneUrl}
                    onChange={(e) => { setCloneUrl(e.target.value); setRepoSetupError(null); }}
                    placeholder="git@github.com:user/repo.git"
                    className="font-mono text-[12px]"
                  />
                  <Button
                    size="sm"
                    onClick={async () => {
                      if (!cloneUrl.trim() || repoSetupBusy) return;
                      setRepoSetupBusy(true);
                      setRepoSetupError(null);
                      try {
                        const r = await execGitAction(project.path, "clone", { url: cloneUrl.trim() });
                        if (r.exitCode !== 0) {
                          setRepoSetupError(r.error ?? r.stderr ?? "Clone failed");
                        } else {
                          setCloneUrl("");
                          onRefresh();
                        }
                      } catch (err) {
                        setRepoSetupError(err instanceof Error ? err.message : String(err));
                      } finally {
                        setRepoSetupBusy(false);
                      }
                    }}
                    disabled={repoSetupBusy || !cloneUrl.trim()}
                    className="shrink-0"
                  >
                    {repoSetupBusy ? "Cloning..." : "Clone"}
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-px bg-border" />
                  <span className="text-[10px] text-muted-foreground">or</span>
                  <div className="flex-1 h-px bg-border" />
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className={cn("mt-2", repoSetupBusy && "opacity-50")}
                  onClick={async () => {
                    if (repoSetupBusy) return;
                    setRepoSetupBusy(true);
                    setRepoSetupError(null);
                    try {
                      const r = await execGitAction(project.path, "init");
                      if (r.exitCode !== 0) {
                        setRepoSetupError(r.error ?? r.stderr ?? "Init failed");
                      } else {
                        onRefresh();
                      }
                    } catch (err) {
                      setRepoSetupError(err instanceof Error ? err.message : String(err));
                    } finally {
                      setRepoSetupBusy(false);
                    }
                  }}
                  disabled={repoSetupBusy}
                >
                  {repoSetupBusy ? "Initializing..." : "Init empty repo"}
                </Button>
                {repoSetupError && (
                  <div className="mt-1.5 text-[11px] text-red">{repoSetupError}</div>
                )}
              </div>
            )}
          </Card>
        </TabsContent>

        {onHostingConfigure && onHostingRestart && project.projectType?.hasCode && (
          <TabsContent value="hosting" className="mt-4 flex-1 min-h-0 overflow-y-auto">
            <Card className="p-4">
              <HostingPanel
                projectPath={project.path}
                hosting={project.hosting}
                detectedHosting={project.detectedHosting}
                infraReady={hostingStatus?.ready ?? false}
                onConfigure={onHostingConfigure}
                onRestart={onHostingRestart}
                onTunnelEnable={onTunnelEnable}
                onTunnelDisable={onTunnelDisable}
                busy={hostingBusy ?? false}
                baseDomain={hostingStatus?.baseDomain}
                tools={project.projectType?.tools}
                onToolExecute={onToolExecute}
                projectCategory={project.category}
                tabLabel="Hosting"
                availableTypes={projectTypes}
              />
            </Card>
          </TabsContent>
        )}

        {project.projectType?.hasCode && (
          <TabsContent value="environment" className="mt-4 flex-1 min-h-0 overflow-y-auto">
            <Card className="p-4">
              <EnvManager projectPath={project.path} />
            </Card>
          </TabsContent>
        )}

        <TabsContent value="taskmaster" className="mt-4 flex-1 min-h-0 overflow-y-auto">
          <Card className="p-4">
            <TaskmasterTab projectPath={project.path} />
          </Card>
        </TabsContent>

        {(project.iterativeWorkEligible ?? project.projectType?.iterativeWorkEligible) && (
          <TabsContent value="iterative-work" className="mt-4 flex-1 min-h-0 overflow-y-auto">
            <IterativeWorkTab project={project} />
          </TabsContent>
        )}

        {project.projectType?.hasCode && (
          <TabsContent value="mcp" className="mt-4 flex-1 min-h-0 overflow-y-auto">
            <MCPTab project={project} />
          </TabsContent>
        )}

        <TabsContent value="magic-apps" className="mt-4 flex-1 min-h-0 overflow-y-auto">
          <Card className="p-4">
            <MagicAppPicker
              project={project}
              onOpenApp={(appId, projectPath) => {
                if (onOpenMagicApp) void onOpenMagicApp(appId, projectPath);
              }}
              onRefresh={onRefresh}
            />
          </Card>
        </TabsContent>

        {pluginPanels.map((panel) => (
          <TabsContent key={panel.id} value={`plugin-${panel.id}`} className="mt-4">
            <Card className="p-4">
              <WidgetRenderer
                widgets={panel.widgets}
                actions={pluginActions}
                projectPath={project.path}
              />
            </Card>
          </TabsContent>
        ))}

        {project.projectType?.hasCode && (
          <TabsContent value="security" className="mt-4 flex-1 min-h-0 overflow-y-auto">
            <SecurityTab projectPath={project.path} onFixFinding={onFixFinding ? (f) => onFixFinding(project.path, f) : undefined} />
          </TabsContent>
        )}

        {!isCoreFork && (
          <TabsContent value="activity" className="mt-4 flex-1 min-h-0 overflow-y-auto">
            <ProjectActivityTab projectPath={project.path} />
          </TabsContent>
        )}
      </Tabs>
      {!isCoreFork && (
        <aside
          className="w-[280px] hidden lg:flex flex-col border-l border-border pl-3"
          data-testid="project-chat-aside"
          aria-label="Project chat panel"
        >
          <ProjectChatAside
            project={project}
            onOpenChat={() => onOpenChat(project.path)}
          />
        </aside>
      )}
      </div>
    </div>
  );
}

/**
 * Project chat aside (slice 5c phase 3 starter — cycle 147).
 *
 * Replaces the cycle-145 placeholder with useful project-scoped content
 * pending the heavier ChatFlyout-into-aside integration. Shows:
 *  - Iterative-work status (enabled / cron / next fire) when eligible
 *  - Progress bar (done/total tasks) sourced from the PM provider
 *  - "Open chat" CTA that mirrors the header button (talk about this project)
 *
 * Iterative-work data is fetched in parallel with progress; failures collapse
 * to a "no status available" hint without breaking the aside chrome.
 */
function ProjectChatAside({
  project,
  onOpenChat,
}: {
  project: ProjectInfo;
  onOpenChat: () => void;
}) {
  const eligible = (project.iterativeWorkEligible ?? project.projectType?.iterativeWorkEligible) === true;
  const [status, setStatus] = useState<IterativeWorkProjectStatus | null>(null);
  const [progress, setProgress] = useState<IterativeWorkProgress | null>(null);

  useEffect(() => {
    // Cycle 148 — reset state on project change so we don't briefly show
    // the previous project's status/progress while the new fetch lands.
    setStatus(null);
    setProgress(null);
    if (!eligible) return;
    let cancelled = false;
    void Promise.all([
      fetchIterativeWorkStatus(project.path).catch(() => null),
      fetchIterativeWorkProgress(project.path).catch(() => null),
    ]).then(([s, p]) => {
      if (cancelled) return;
      setStatus(s);
      setProgress(p);
    });
    return () => { cancelled = true; };
  }, [eligible, project.path]);

  return (
    <>
      <h2 className="text-[12px] uppercase tracking-wider text-muted-foreground/80 font-semibold mt-3 mb-2">
        Chat
      </h2>

      {eligible && (
        <Card className="p-3 mb-2 bg-secondary/10" data-testid="project-chat-aside-iterative">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold mb-1">Iterative work</div>
          <div className="text-[12px] text-foreground">
            {status === null ? "Loading…" : status.enabled ? "Enabled" : "Disabled"}
            {status?.inFlight && <span className="ml-1 text-yellow text-[10px]">· running</span>}
          </div>
          {status?.cron && (
            <div className="text-[11px] text-muted-foreground font-mono mt-0.5">{status.cron}</div>
          )}
          {progress !== null && progress.totalTasks > 0 && (
            <div className="mt-2">
              <div className="text-[11px] text-muted-foreground mb-1">
                {progress.doneTasks}/{progress.totalTasks} done · {progress.percentComplete}%
              </div>
              <div className="h-1.5 bg-secondary rounded overflow-hidden">
                <div
                  className="h-full bg-yellow transition-[width]"
                  style={{ width: `${String(progress.percentComplete)}%` }}
                />
              </div>
            </div>
          )}
        </Card>
      )}

      <Card className="p-3 flex-1 min-h-0 overflow-y-auto bg-secondary/10 border-dashed border-border/60">
        <p className="text-[11px] text-muted-foreground/80 leading-relaxed">
          Project-scoped chat panel — the heavy integration ships in slice 5c phase 4. Use Open chat to talk
          about this project today.
        </p>
        <Button
          size="sm"
          className="mt-3 w-full"
          onClick={onOpenChat}
          data-testid="project-chat-aside-open"
        >
          Open chat
        </Button>
      </Card>
    </>
  );
}
