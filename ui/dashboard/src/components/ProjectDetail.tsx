/**
 * ProjectDetail — full project page with repo, hosting, and settings sections.
 * Route: /projects/:slug
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { execGitAction, fetchProjectFileTree, fetchProjectFile, saveProjectFile, fetchPluginPanels, fetchPluginActions, fetchProjectTypes } from "../api.js";
import type { FileNode } from "../api.js";
import type { PluginAction, PluginPanel, ProjectActivity, ProjectInfo } from "../types.js";
import { RepoPanel } from "./RepoPanel.js";
import { HostingPanel } from "./HostingPanel.js";
import { ProjectManagement } from "./ProjectManagement.js";
import type { HostingStatus } from "../api.js";
import { TreeNav } from "@particle-academy/react-fancy";
import { CodeEditor } from "@particle-academy/fancy-code";
import "@particle-academy/fancy-code/styles.css";
import { projectSlug } from "./Projects.js";
import { WidgetRenderer } from "./WidgetRenderer.js";
import { isSacredProject } from "@/lib/sacred-projects.js";
import { SecurityTab } from "./SecurityTab.js";
import { MagicAppPicker } from "./MagicAppPicker.js";

export interface ProjectDetailProps {
  projects: ProjectInfo[];
  onUpdate: (params: { path: string; name?: string; tynnToken?: string | null; category?: string; type?: string }) => Promise<void>;
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

  const [editName, setEditName] = useState<string | null>(null);
  const [editTynnToken, setEditTynnToken] = useState<string | null>(null);
  const [editCategory, setEditCategory] = useState<string | null>(null);
  const [editProjectType, setEditProjectType] = useState<string | null>(null);
  const [projectTypes, setProjectTypes] = useState<Array<{ id: string; label: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [cloneUrl, setCloneUrl] = useState("");
  const [repoSetupBusy, setRepoSetupBusy] = useState(false);
  const [repoSetupError, setRepoSetupError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("details");
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
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
  const tynnToken = editTynnToken ?? project?.tynnToken ?? "";
  const category = editCategory ?? project?.category ?? project?.projectType?.category ?? "";

  const handleSave = useCallback(async () => {
    if (!project) return;
    setSaving(true);
    try {
      const params: { path: string; name?: string; tynnToken?: string | null; category?: string; type?: string } = { path: project.path };
      const trimmedName = name.trim();
      if (trimmedName && trimmedName !== project.name) params.name = trimmedName;
      const trimmedToken = tynnToken.trim();
      if (trimmedToken !== (project.tynnToken ?? "")) {
        params.tynnToken = trimmedToken.length > 0 ? trimmedToken : null;
      }
      if (category && category !== (project.category ?? project.projectType?.category ?? "")) {
        params.category = category;
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
  }, [project, name, tynnToken, category, editProjectType, onUpdate]);

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
  }, []);

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
    <div>
      {/* Header row */}
      <div className="flex items-center justify-between mb-6">
        <Link to="/projects" className="no-underline">
          <Button variant="outline" size="sm">Back to Projects</Button>
        </Link>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => onOpenTerminal?.(project.path)}>
            Terminal
          </Button>
          <Button size="sm" onClick={() => onOpenChat(project.path)}>
            Talk about this project
          </Button>
        </div>
      </div>

      {/* Project heading */}
      <div className="flex items-center gap-3 mb-6">
        <h2 className="text-xl font-bold text-foreground">{project.name}</h2>
        {isSacred && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow/15 text-yellow font-semibold">sacred</span>
        )}
        {project.hasGit && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-green/15 text-green font-semibold">git</span>
        )}
        {project.tynnToken !== null && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue/15 text-blue font-semibold">tynn</span>
        )}
        {project.hosting?.enabled && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-green/15 text-green font-semibold">hosted</span>
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

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList variant="line">
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="files">Editor</TabsTrigger>
          <TabsTrigger value="repository">Repository</TabsTrigger>
          {onHostingConfigure && onHostingRestart && project.projectType?.hasCode && (
            <TabsTrigger value="hosting">Development</TabsTrigger>
          )}
          <TabsTrigger value="magic-apps">MagicApps</TabsTrigger>
          {pluginPanels.map((p) => (
            <TabsTrigger key={p.id} value={`plugin-${p.id}`}>{p.label}</TabsTrigger>
          ))}
          {project.projectType?.hasCode && (
            <TabsTrigger value="security">Security</TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="details" className="mt-4">
          <div className="rounded-xl bg-card border border-border p-4">
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-[11px] font-semibold text-muted-foreground mb-1">Name</label>
                <Input
                  type="text"
                  value={name}
                  onChange={(e) => setEditName(e.target.value)}
                  data-testid="project-name-input"
                  disabled={isSacred}
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-muted-foreground mb-1">Tynn Token</label>
                <Input
                  type="text"
                  value={tynnToken}
                  onChange={(e) => setEditTynnToken(e.target.value)}
                  placeholder="rpk_..."
                  data-testid="project-token-input"
                  disabled={isSacred}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-[11px] font-semibold text-muted-foreground mb-1">Purpose</label>
                <select
                  value={category}
                  onChange={(e) => setEditCategory(e.target.value)}
                  disabled={isSacred}
                  className="w-full h-9 px-3 rounded-md border border-border bg-background text-foreground text-[13px]"
                >
                  <option value="">Auto-detect</option>
                  <option value="literature">Literature</option>
                  <option value="app">App</option>
                  <option value="web">Web</option>
                  <option value="media">Media</option>
                  <option value="administration">Administration</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-muted-foreground mb-1">Project Type</label>
                <select
                  value={editProjectType ?? project.projectType?.id ?? ""}
                  onChange={(e) => setEditProjectType(e.target.value || null)}
                  disabled={isSacred}
                  className="w-full h-9 px-3 rounded-md border border-border bg-background text-foreground text-[13px]"
                >
                  {project.projectType && !projectTypes.some((t) => t.id === project.projectType?.id) && (
                    <option value={project.projectType.id}>{project.projectType.label} (detected)</option>
                  )}
                  {projectTypes.map((pt) => (
                    <option key={pt.id} value={pt.id}>
                      {pt.label}{pt.id === project.projectType?.id ? " (detected)" : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="text-[11px] text-muted-foreground font-mono mb-3">{project.path}</div>
            {isSacred && (
              <div className="text-[11px] text-muted-foreground mb-3">
                Sacred projects are managed by the system. Metadata edits are disabled.
              </div>
            )}
            <Button
              size="sm"
              onClick={() => void handleSave()}
              disabled={saving || updating || isSacred}
              variant={saving || updating || isSacred ? "secondary" : "default"}
            >
              {saving || updating ? "Saving..." : isSacred ? "Locked" : "Save"}
            </Button>
          </div>

          {/* Danger Zone */}
          {!isSacred ? (
            <>
              <div className="mt-6 rounded-xl border border-red/30 bg-red/5 p-4">
                <h3 className="text-[13px] font-bold text-red mb-1">Danger Zone</h3>
                <p className="text-[11px] text-muted-foreground mb-3">
                  Permanently delete this project and all its files. This action cannot be undone.
                </p>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => { setDeleteConfirmName(""); setDeleteDialogOpen(true); }}
                  disabled={deleting}
                >
                  {deleting ? "Deleting..." : "Delete Project"}
                </Button>
              </div>

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
            <div className="mt-6 rounded-xl border border-yellow/30 bg-yellow/10 p-4">
              <h3 className="text-[13px] font-bold text-yellow mb-1">Sacred Project</h3>
              <p className="text-[11px] text-muted-foreground">
                Sacred projects are immutable and cannot be deleted.
              </p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="files" className="mt-4">
          <div className="rounded-xl bg-card border border-border overflow-hidden">
            {/* Toolbar */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-border">
              <span className="text-[11px] font-semibold text-muted-foreground">Editor</span>
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
            {/* Panes — CSS grid with fixed height; both columns always visible */}
            <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", height: "clamp(400px, calc(100vh - 16rem), calc(100vh - 16rem))" }}>
              {/* TreeNav pane */}
              <div style={{ overflow: "auto", borderRight: "1px solid var(--border)" }}>
                {treeLoading ? (
                  <div className="text-[12px] text-muted-foreground p-4">Loading files...</div>
                ) : fileTree.length === 0 ? (
                  <div className="text-[12px] text-muted-foreground p-4">No files found.</div>
                ) : (
                  <TreeNav
                    nodes={fileTree.map(function mapNode(n: FileNode): { id: string; label: string; type: "file" | "folder"; ext?: string; children?: { id: string; label: string; type: "file" | "folder"; ext?: string; children?: unknown[] }[] } {
                      return { id: n.path.startsWith(project.path) ? n.path.slice(project.path.length + 1) : n.path, label: n.name, type: n.type === "dir" ? "folder" : "file", ext: n.ext, children: n.children?.map(mapNode) };
                    }) as never}
                    selectedId={openFilePath ? openFilePath.replace(`${project.path}/`, "") : undefined}
                    onSelect={(id: string, node: { type?: string }) => {
                      if (node.type === "file") handleSelectFile(id);
                    }}
                    showIcons
                    indentSize={14}
                  />
                )}
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
                          if (ext === "ts" || ext === "tsx") return "typescript";
                          if (ext === "js" || ext === "jsx") return "javascript";
                          if (ext === "html" || ext === "htm") return "html";
                          if (ext === "php") return "php";
                          return "javascript";
                        })()}
                        theme="auto"
                      >
                        <CodeEditor.Toolbar />
                        <CodeEditor.Panel />
                        <CodeEditor.StatusBar />
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
          </div>
        </TabsContent>

        <TabsContent value="repository" className="mt-4">
          <div className="rounded-xl bg-card border border-border p-4">
            {project.hasGit ? (
              <>
                <div className="flex items-center justify-end mb-2">
                  <Button size="sm" variant="outline" className="text-[11px] h-7" onClick={handleRefreshRepo}>
                    Refresh
                  </Button>
                </div>
                <RepoPanel ref={repoPanelRef} projectPath={project.path} theme={theme} />
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
          </div>
        </TabsContent>

        {onHostingConfigure && onHostingRestart && project.projectType?.hasCode && (
          <TabsContent value="hosting" className="mt-4">
            <div className="rounded-xl bg-card border border-border p-4">
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
                tabLabel="Development"
                availableTypes={projectTypes}
              />
            </div>
          </TabsContent>
        )}

        <TabsContent value="magic-apps" className="mt-4">
          <div className="rounded-xl bg-card border border-border p-4">
            <MagicAppPicker
              project={project}
              onOpenApp={(appId, projectPath) => {
                if (onOpenMagicApp) void onOpenMagicApp(appId, projectPath);
              }}
              onRefresh={onRefresh}
            />
          </div>
        </TabsContent>

        {pluginPanels.map((panel) => (
          <TabsContent key={panel.id} value={`plugin-${panel.id}`} className="mt-4">
            <div className="rounded-xl bg-card border border-border p-4">
              <WidgetRenderer
                widgets={panel.widgets}
                actions={pluginActions}
                projectPath={project.path}
              />
            </div>
          </TabsContent>
        ))}

        {project.projectType?.hasCode && (
          <TabsContent value="security" className="mt-4">
            <SecurityTab projectPath={project.path} onFixFinding={onFixFinding ? (f) => onFixFinding(project.path, f) : undefined} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
