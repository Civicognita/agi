/**
 * ProjectDetail — full project page with repo, hosting, and settings sections.
 * Route: /projects/:slug
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { cn } from "@/lib/utils";
import { computeVisibleModes, fallbackModeForCategory } from "@/lib/project-mode-narrowing";
import { Callout } from "@particle-academy/react-fancy";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { execGitAction, fetchProjectFileTree, fetchProjectFile, saveProjectFile, createProjectFile, deleteProjectFile, renameProjectFile, fetchPluginPanels, fetchPluginActions, fetchProjectTypes, updateProjectRepo } from "../api.js";
import type { FileNode } from "../api.js";
import { DevNotes } from "@/components/ui/dev-notes";
import { ProjHeader } from "@/components/ProjHeader.js";
import { StackStrip } from "@/components/StackStrip.js";
import type { PluginAction, PluginPanel, ProjectActivity, ProjectInfo } from "../types.js";
import { RepoPanel } from "./RepoPanel.js";
import { RepoManager } from "./RepoManager.js";
import { CoreForkRepoPanel } from "./CoreForkRepoPanel.js";
import { HostingPanel } from "./HostingPanel.js";
import { EnvManager } from "./EnvManager.js";
import { TaskmasterTab } from "./TaskmasterTab.js";
import { PmLitePanel } from "./PmLitePanel.js";
import { PmKanbanPanel } from "./PmKanbanPanel.js";
import { NotesPanel } from "./NotesPanel.js";
import { ChannelsPanel } from "./ChannelsPanel.js";
import { AgiProjectStatePanel } from "./AgiProjectStatePanel.js";
import { ScheduledJobsTab } from "./ScheduledJobsTab.js";
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
import { isDesktopServedType } from "@/lib/project-type-classifier";
import { AionimaSystemReposPanel } from "./AionimaSystemReposPanel.js";
import { AionimaContributePanel } from "./AionimaContributePanel.js";
import { AionimaIncomingPrsPanel } from "./AionimaIncomingPrsPanel.js";
import { AgiRepoCard } from "./AgiRepoCard.js";

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
  "iterative-work": "Scheduled Jobs",
  mcp: "MCP",
  // s150 t637 — "magic-apps" tab dropped; MApps config now lives inside the
  // Hosting tab when type is Desktop-served. Label removed from this map.
  taskmaster: "TaskMaster",
  // Wish #17 / s155 t671 — Plans tab. Always available file-based PM-Lite
  // surface with DONE/CURRENT/NEXT views.
  plans: "Plans",
  // s152 — Notes tab. Per-project markdown notepad surface; agent reads
  // these as project context.
  notes: "Notes",
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
  projectActivity,
  hostingStatus, onHostingConfigure, onHostingRestart,
  onTunnelEnable, onTunnelDisable, hostingBusy,
  onOpenEditor, onToolExecute, onOpenTerminal, contributingEnabled, onFixFinding,
  onOpenMagicApp,
}: ProjectDetailProps) {
  const { slug } = useParams<{ slug: string }>();
  const project = projects.find((p) => projectSlug(p.path) === slug);
  // s175 (2026-05-15): include "aionima-system" in the sacred check.
  // _aionima meta-project has type "aionima-system", not "aionima".
  const isSacred = project ? (
    isSacredProject(project) ||
    project.projectType?.id === "aionima" ||
    project.projectType?.id === "aionima-system"
  ) : false;
  // Owner directive 2026-05-13: _aionima (type "aionima-system") is always
  // viewable regardless of contributing mode. Contributing mode gates only
  // fork-population into _aionima/repos/, not card/detail visibility.
  const canViewSacred = project?.projectType?.id === "aionima-system" || Boolean(contributingEnabled);
  // Core fork = a fork provisioned by Dev Mode into _aionima/repos/. These
  // get reduced UX (Editor + Repository only — no hosting, env, plugins).
  // s175 fix: do NOT catch the _aionima container itself (coreCollection is
  // "aionima" on the container too, but only actual forks have
  // projectType "aionima"). Using only the type check avoids the false match.
  const isCoreFork = project?.projectType?.id === "aionima";
  // s179: the _aionima meta-project itself (type "aionima-system") gets a
  // dedicated Repos/Details/Editor tab set — no stack strip, no mode picker.
  const isAionimaContainer = project?.projectType?.id === "aionima-system";

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
    // s150 t637 — "magic-apps" tab dropped; MApps config now lives inside the
    // Hosting tab when type is Desktop-served.
    "taskmaster": "coordinate",
    // Wish #17 / s155 t671 — Plans tab in coordinate mode (PM workflow).
    "plans": "coordinate",
    // story #207 — Project tab: the .agi envelope config/knowledge-state surface.
    "project": "coordinate",
    // s152 — Notes tab in coordinate mode (knowledge capture for the project).
    "notes": "coordinate",
    // s139 t538 — PM kanban tab in coordinate mode. Reuses PmKanbanPanel
    // (the system-aggregate /pm/kanban view) — per-project filtering is a
    // future phase; today the tab shows the same all-tasks view.
    "pm": "coordinate",
    // s165 CHN-D slice 3a — Channels tab in coordinate mode (project↔room
    // bindings list; picker dialog lands in slice 3b).
    "channels": "coordinate",
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
  // s179: default to "repos" tab for the _aionima container project.
  useEffect(() => {
    if (isAionimaContainer && activeTab === "details") setActiveTab("repos");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAionimaContainer]);

  // Auto-switch activeTab when mode changes if the current tab is no
  // longer in the active mode.
  useEffect(() => {
    if (!tabBelongsToMode(activeTab)) {
      // Find first tab in current mode (prefer the canonical first one)
      const candidates = ["details", "files", "repository", "environment", "hosting", "iterative-work", "mcp", "taskmaster", "plans", "notes", "channels", "security", "activity"];
      const firstInMode = candidates.find((id) => TAB_MODES[id] === currentMode);
      if (firstInMode) setActiveTab(firstInMode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentMode]);

  // s134 t517 slice 4 — auto-redirect when the default mode is hidden
  // by the project's category. See lib/project-mode-narrowing.ts for
  // the rule (literature/media/administration hide develop; literature
  // and media also hide operate).
  useEffect(() => {
    const cat = project?.category ?? project?.projectType?.category;
    const fallback = fallbackModeForCategory(currentMode, cat);
    if (fallback !== null) setCurrentMode(fallback);
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
      <div className="flex items-center mb-6 shrink-0">
        <Link to="/projects" className="no-underline">
          <Button variant="outline" size="sm">Back to Projects</Button>
        </Link>
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
          const serving = project.hosting?.serving ?? false;
          const cls =
            s === "running" && serving ? "bg-green"
            : s === "running" ? "bg-yellow"
            : s === "error" ? "bg-red"
            : s === "stopped" ? "bg-red"
            : "bg-muted-foreground";
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
          <DevNotes.Item kind="info" heading="2026-06-10 — Coordinate → Project: .agi config/knowledge-state surface">
            New <strong>Project</strong> tab in Coordinate mode manages a <code>.agi</code> envelope as a
            config/knowledge-STATE surface — NOT a repo manager. An upgrade Wizard (git init +{" "}
            <code>{"{slug}.agi"}</code> remote, with <em>AGI auto-creates</em> OR <em>paste URL</em>)
            turns a project into an envelope; once wired, the panel shows ahead/behind + a reviewable
            diff of config/knowledge/submodule changes with <strong>Pull &amp; apply</strong> (runs{" "}
            <code>git submodule update --init --recursive</code>) and <strong>Push state</strong>. Chats
            (<code>.ai/chat/</code>), <code>sandbox/</code>, <code>.trash/</code> are excluded from sync.
            Backend: <code>agi-repo/{"{state,remote,pull,push}"}</code> (v0.4.921–922, story #207).
          </DevNotes.Item>
          <DevNotes.Item kind="info" heading="2026-06-09 — Knowledge dir renamed k/ → .ai/">
            Every project's knowledge layer (<code>plans/ knowledge/ pm/ memory/ chat/ issues/</code>)
            moved from <code>k/</code> to <code>.ai/</code> to match common AI-workflow conventions
            (<code>.cursor/</code>, <code>.aider/</code>). Existing projects auto-migrate on gateway
            boot (rename is atomic + never clobbers). <code>.ai/</code> is dot-hidden to <code>ls</code>
            but stays <strong>visible in the file browser</strong> here — the sibling <code>.agi/</code>
            config envelope is unchanged. New projects scaffold <code>.ai/</code> directly (v0.4.919).
          </DevNotes.Item>
          <DevNotes.Item kind="info" heading="2026-06-08 — Incoming PRs tab (review contributors' forks)">
            New <strong>Incoming</strong> tab on the _aionima container (Repos | Contribute |
            Incoming | Editor). Lists open PRs that contributors' personal forks — including
            forks-of-forks — have opened into upstream <code>dev</code>, grouped per core repo,
            with author, head fork (cross-fork flagged), and draft state. Merge happens on
            GitHub via <em>View on GitHub →</em> (an irreversible write we never automate). The
            <em>Test in VM</em> button hands you <code>agi test-vm pr agi &lt;n&gt;</code>, which
            fetches the PR head into a throwaway worktree, remounts the VM to it, and serves it at
            <code>test.ai.on</code> for live click-through — restoring your dev tree on exit
            (agi repo only; v0.4.915).
          </DevNotes.Item>
          <DevNotes.Item kind="info" heading="2026-06-08 — Upstream vs Personal forks + version-aware upgrades">
            Terminology + correctness. (1) The Repos panel header is now <strong>Personal forks</strong>
            ("tracked against Upstream (Civicognita)") instead of "Core Forks"; fork labels come from the
            API's <code>displayName</code> (single source of truth) rather than a stale hardcoded map that
            still listed the deprecated Local-ID and omitted the PAx repos. (2) The Upgrade Wizard now gates
            the <strong>Review →</strong> action on a version-aware <code>isUpgrade</code> flag, not raw commit
            topology. <code>upstream/main</code> trails your fork by merge bubbles, so it showed a phantom
            "4 commits available" despite being an older version (v0.4.906 vs v0.4.911) — it now renders as an
            <em>info row</em> ("older than your vX — nothing to pull"). Incoming-PR review/test tab is next.
          </DevNotes.Item>
          <DevNotes.Item kind="info" heading="2026-06-08 — Aionima page repaired: forks resolve + Details tab removed">
            Two fixes. (1) The Repos + Contribute panels were blank ("No forks provisioned" / "No repos in
            this group") because the backend looked for forks at <code>_aionima/&lt;slug&gt;</code> while the
            2026-05-13 restructure moved them to <code>_aionima/repos/&lt;slug&gt;</code>. A shared
            <code>coreForkDir()</code> resolver now prefers the nested layout (legacy flat still supported).
            (2) The meta-project tab set is now <strong>Repos | Contribute | Editor</strong> — the read-only
            Details tab was dropped (it duplicated what other tabs show). Regular projects keep their Details
            tab.
          </DevNotes.Item>
          <DevNotes.Item kind="info" heading="2026-06-07 — .agi monorepo envelope control (Details tab)">
            Regular projects' Details tab now carries an AgiRepoCard: initialize the project folder as a
            {" "}<code>{"{slug}.agi"}</code> git envelope, or import existing <code>repos/</code> as git
            submodules. First slice — explicit action only (no auto-init on create yet); Tynn handshake +
            remote auto-creation deferred. Excluded for the _aionima collection.
          </DevNotes.Item>
          <DevNotes.Item kind="info" heading="2026-06-07 — Contribute tab (outbound PRs) on _aionima">
            The aionima-system project gains a Contribute tab (Repos | Contribute | Details | Editor).
            It groups core forks into Learnings (→ PRIME) and Mechanics (→ agi, marketplaces, PAx) and
            opens cross-repo PRs to upstream/dev with an AI-drafted body. Mirror of the inbound merge
            path; PRs always target dev (never main). See CONTRIBUTING.md.
          </DevNotes.Item>
          <DevNotes.Item kind="info" heading="Cycle 2026-05-31 — 3-state status dot + TCP health probe">
            Status dot is now 3-state: green = container running AND TCP probe reached the port (app serving),
            yellow = container running but port not yet responding (starting up / internal crash),
            red = container stopped or error. Backend runs a 10-second TCP probe loop; frontend polls
            every 10s (was 120s). StackStrip fallback text simplified to "No active tasks".
          </DevNotes.Item>
          <DevNotes.Item kind="info" heading="s199 (2026-05-28) — ProjHeader + StackStrip + mode picker restyle">
            ProjHeader compact bar (name, category badge, primary repo URL, hosted URL, Chat button) added
            above mode picker. StackStrip shows Aion's live iterative-work task summary (from projectActivity)
            between ProjHeader and mode picker — pulses when work is in flight. Mode picker restyled from
            underline tabs to pill/segment (bg-secondary fill, rounded-md, no border-b-2).
          </DevNotes.Item>
          <DevNotes.Item kind="info" heading="s179 (2026-05-15) — Aionima-system container UX">
            aionima-system project type now gets a dedicated 3-tab view (Repos | Details | Editor)
            instead of the full mode-picker + all tabs. Stack strip and mode picker hidden.
            AionimaSystemReposPanel shows all five core forks with ahead/behind badges,
            a file browser toggle, and a Talk-to-project button.
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
      {!isCoreFork && !isAionimaContainer && project.projectType?.hasCode && (
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

      {/* s199 — ProjHeader: compact identity bar (name, category badge,
          repo URL, hosted URL, Chat action) above the mode picker.
          Skipped for core forks and aionima containers which have their
          own restricted view without the mode picker. */}
      {!isCoreFork && !isAionimaContainer && (
        <ProjHeader project={project} onOpenChat={onOpenChat} />
      )}

      {/* s199 — StackStrip: Aion's active iterative-work context bar.
          Distinct from the docker "project-stack-strip" above which shows
          attached postgres/redis stacks. This strip shows the live task
          summary from projectActivity and pulses when work is in flight. */}
      {!isCoreFork && !isAionimaContainer && project.projectType?.hasCode && (
        <StackStrip projectPath={project.path} projectActivity={projectActivity} />
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
          - Otherwise (web/app/monorepo/ops): all 4 modes visible

          s199 — mode picker restyled from underline tabs to pill/segment
          control (bg-secondary fill on active, rounded-md, no border-b). */}
      {!isCoreFork && !isAionimaContainer && (() => {
        const cat = project.category ?? project.projectType?.category;
        const visibleModes = computeVisibleModes(cat);
        return (
          <div className="flex items-center gap-1 mb-3 mt-2" data-testid="project-mode-picker">
            {visibleModes.map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setCurrentMode(mode)}
                className={cn(
                  "px-3 py-1.5 rounded-md text-[12px] font-medium uppercase tracking-wider transition-colors cursor-pointer",
                  currentMode === mode
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/60",
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
        ) : isAionimaContainer ? (
          // s179: _aionima meta-project — Repos | Contribute | Editor.
          // Details tab dropped 2026-06-08 (owner directive): for the meta-project
          // it was read-only metadata that duplicated what Repos/Editor already
          // show — no user-visible value. The details TabsContent below is kept
          // for regular projects; the redirect at ~L257 bounces any stray
          // activeTab="details" back to "repos" for this container.
          <TabsList>
            <TabsTrigger value="repos" data-testid="project-tab-repos">Repos</TabsTrigger>
            <TabsTrigger value="contribute" data-testid="project-tab-contribute">Contribute</TabsTrigger>
            <TabsTrigger value="incoming" data-testid="project-tab-incoming">Incoming</TabsTrigger>
            <TabsTrigger value="files">Editor</TabsTrigger>
          </TabsList>
        ) : (
          <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border flex-wrap" data-testid="project-sub-surface">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold whitespace-nowrap pr-1" data-testid="project-sub-surface-label">{currentMode} ›</span>
            <TabsList className="border-b-0 gap-1 flex-wrap py-0">
              {/*
                Cycle 263 — flat sub-tabs. The s150 t638 primary/secondary
                "More…" dropdown was hostile UX: every mode had ≤4 tabs
                anyway, so the dropdown only added a click. Nuked entirely.
                All sub-tabs render as flat TabsTriggers gated by
                tabBelongsToMode + per-tab visibility rules.
              */}
              {tabBelongsToMode("details") && <TabsTrigger value="details" className={SUB_PILL_CLASS}>Details</TabsTrigger>}
              {tabBelongsToMode("files") && <TabsTrigger value="files" className={SUB_PILL_CLASS}>Editor</TabsTrigger>}
              {tabBelongsToMode("repository") && <TabsTrigger value="repository" className={SUB_PILL_CLASS} data-testid="project-tab-repository">Repository</TabsTrigger>}
              {tabBelongsToMode("environment") && project.projectType?.hasCode && (
                <TabsTrigger value="environment" className={SUB_PILL_CLASS} data-testid="project-tab-environment">Environment</TabsTrigger>
              )}
              {tabBelongsToMode("hosting") && onHostingConfigure && onHostingRestart && (
                <TabsTrigger value="hosting" className={SUB_PILL_CLASS}>Hosting</TabsTrigger>
              )}
              {tabBelongsToMode("iterative-work")
                && (project.iterativeWorkEligible ?? project.projectType?.iterativeWorkEligible) && (
                <TabsTrigger value="iterative-work" className={SUB_PILL_CLASS} data-testid="project-tab-iterative-work">Scheduled Jobs</TabsTrigger>
              )}
              {tabBelongsToMode("project") && !isAionimaContainer && (
                <TabsTrigger value="project" className={SUB_PILL_CLASS} data-testid="project-tab-project">Project</TabsTrigger>
              )}
              {tabBelongsToMode("plans") && (
                <TabsTrigger value="plans" className={SUB_PILL_CLASS} data-testid="project-tab-plans">Plans</TabsTrigger>
              )}
              {tabBelongsToMode("pm") && (
                <TabsTrigger value="pm" className={SUB_PILL_CLASS} data-testid="project-tab-pm">PM</TabsTrigger>
              )}
              {tabBelongsToMode("notes") && (
                <TabsTrigger value="notes" className={SUB_PILL_CLASS} data-testid="project-tab-notes">Notes</TabsTrigger>
              )}
              {tabBelongsToMode("channels") && (
                <TabsTrigger value="channels" className={SUB_PILL_CLASS} data-testid="project-tab-channels">Channels</TabsTrigger>
              )}
              {tabBelongsToMode("taskmaster") && (
                <TabsTrigger value="taskmaster" className={SUB_PILL_CLASS} data-testid="project-tab-taskmaster">TaskMaster</TabsTrigger>
              )}
              {tabBelongsToMode("mcp") && project.projectType?.hasCode && (
                <TabsTrigger value="mcp" className={SUB_PILL_CLASS} data-testid="project-tab-mcp">MCP</TabsTrigger>
              )}
              {pluginPanels
                .filter((p) => (p.mode ?? "coordinate") === currentMode)
                .map((p) => (
                  <TabsTrigger
                    key={`plugin-${p.id}`}
                    value={`plugin-${p.id}`}
                    className={SUB_PILL_CLASS}
                    data-testid={`project-tab-plugin-${p.id}`}
                  >
                    {p.label}
                  </TabsTrigger>
                ))}
              {tabBelongsToMode("security") && project.projectType?.hasCode && (
                <TabsTrigger value="security" className={SUB_PILL_CLASS} data-testid="project-tab-security">Security</TabsTrigger>
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
          {/* {project}.agi monorepo envelope control (Phase 3). Excluded for the
              _aionima collection, which keeps its own collection.json convention. */}
          {!isAionimaContainer && (
            <div className="mb-4">
              <AgiRepoCard projectPath={project.path} />
            </div>
          )}
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

        {/* s179: _aionima container — repos overview panel */}
        <TabsContent value="repos" className="mt-4 flex-1 min-h-0 overflow-y-auto">
          <Card className="p-4">
            <AionimaSystemReposPanel
              projectPath={project.path}
              onOpenChat={() => onOpenChat(project.path)}
            />
          </Card>
        </TabsContent>

        <TabsContent value="contribute" className="mt-4 flex-1 min-h-0 overflow-y-auto">
          <Card className="p-4">
            <AionimaContributePanel />
          </Card>
        </TabsContent>

        <TabsContent value="incoming" className="mt-4 flex-1 min-h-0 overflow-y-auto">
          <Card className="p-4">
            <AionimaIncomingPrsPanel />
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

        {onHostingConfigure && onHostingRestart && (
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
            {/* s150 t637 — Desktop-served projects get the MagicApps picker inline
                under the hosting card. Replaces the standalone MagicApps tab. */}
            {isDesktopServedType(project.projectType?.id ?? project.hosting?.type) && (
              <Card className="p-4 mt-4" data-testid="hosting-magicapps-section">
                <h3 className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  MagicApps for this project
                </h3>
                <MagicAppPicker
                  project={project}
                  onOpenApp={(appId, projectPath) => {
                    if (onOpenMagicApp) void onOpenMagicApp(appId, projectPath);
                  }}
                  onRefresh={onRefresh}
                />
              </Card>
            )}
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

        {/* Wish #17 / s155 t671 — Plans tab (PM-Lite). Always available;
            DONE/CURRENT/NEXT views over the layered PM provider, plus a
            file-based plan list straight from <projectPath>/k/plans/. */}
        {/* story #207 — .agi envelope config/knowledge-state surface. */}
        <TabsContent value="project" className="mt-4 flex-1 min-h-0 overflow-y-auto">
          <AgiProjectStatePanel projectPath={project.path} projectName={project.name} />
        </TabsContent>

        <TabsContent value="plans" className="mt-4 flex-1 min-h-0 overflow-y-auto">
          <PmLitePanel projectPath={project.path} />
        </TabsContent>

        {/* s139 t538 — PM kanban sub-surface in coordinate mode. Reuses
            the system-aggregate PmKanbanPanel; per-project filtering
            (filter by task.projectPath) is a future phase. */}
        <TabsContent value="pm" className="mt-4 flex-1 min-h-0 overflow-y-auto">
          <PmKanbanPanel />
        </TabsContent>

        {/* s152 — Notes tab. Per-project markdown notepad surface. The
            global Notes page lands in the next slice (main nav). */}
        <TabsContent value="notes" className="mt-4 flex-1 min-h-0 overflow-y-auto">
          <NotesPanel projectPath={project.path} />
        </TabsContent>

        {/* s165 CHN-D slice 3a — Channels tab. Read-only listing of
            channel-room bindings for this project. Picker dialog lands
            in slice 3b. */}
        <TabsContent value="channels" className="mt-4 flex-1 min-h-0 overflow-y-auto">
          <ChannelsPanel projectPath={project.path} />
        </TabsContent>

        {(project.iterativeWorkEligible ?? project.projectType?.iterativeWorkEligible) && (
          <TabsContent value="iterative-work" className="mt-4 flex-1 min-h-0 overflow-y-auto">
            <ScheduledJobsTab project={project} />
          </TabsContent>
        )}

        {project.projectType?.hasCode && (
          <TabsContent value="mcp" className="mt-4 flex-1 min-h-0 overflow-y-auto">
            <MCPTab project={project} />
          </TabsContent>
        )}

        {/* s150 t637 — standalone MagicApps TabsContent removed; rendered inline
            under the Hosting tab when type is Desktop-served (above). */}

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
      </div>
    </div>
  );
}

