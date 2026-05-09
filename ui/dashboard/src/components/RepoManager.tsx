import { useEffect, useState } from "react";
import { fetchProjectRepos, addProjectRepo, updateProjectRepo, removeProjectRepo, type ProjectRepo } from "../api.js";
import { Card } from "./ui/card.js";
import { Button } from "./ui/button.js";
import { Input } from "./ui/input.js";

/**
 * RepoManager — s130 t515 B6c — dashboard CRUD UI for project.repos[].
 *
 * Mounted under Develop mode > Repository in ProjectDetail.tsx.
 * Lists repos, allows add/edit/remove. Per-repo Start/Stop is B6b.
 */

type Props = { projectPath: string };

export function RepoManager({ projectPath }: Props) {
  const [repos, setRepos] = useState<ProjectRepo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const fetched = await fetchProjectRepos(projectPath);
      setRepos(fetched);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, [projectPath]);

  const handleDelete = async (name: string) => {
    if (!confirm(`Remove repo "${name}"? Its checkout will be moved to .trash/`)) return;
    try {
      await removeProjectRepo(projectPath, name);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (loading) return <Card className="p-4 text-sm text-muted-foreground">Loading repos…</Card>;

  return (
    <div className="space-y-4" data-testid="repo-manager">
      {error && (
        <Card className="p-3 text-sm text-destructive border-destructive/50" data-testid="repo-manager-error">
          {error}
        </Card>
      )}

      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold">Repositories</h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {repos.length} repo{repos.length === 1 ? "" : "s"} · multi-repo runs in one container with concurrently
            </p>
          </div>
          <Button size="sm" onClick={() => { setShowAddForm(true); setEditingName(null); }} data-testid="repo-manager-add">
            + Add repo
          </Button>
        </div>

        {repos.length === 0 && !showAddForm && (
          <div className="text-sm text-muted-foreground py-6 text-center">
            No repos configured. Click "+ Add repo" to set up multi-repo hosting.
          </div>
        )}

        {repos.length > 0 && (
          <table className="w-full text-[12px]" data-testid="repo-manager-table">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
                <th className="py-2 pr-2 font-medium">Name</th>
                <th className="py-2 pr-2 font-medium">URL</th>
                <th className="py-2 pr-2 font-medium">Port</th>
                <th className="py-2 pr-2 font-medium">External</th>
                <th className="py-2 pr-2 font-medium">Auto-run</th>
                <th className="py-2 pr-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {repos.map((r) => (
                <tr key={r.name} className="border-b border-border/40 hover:bg-secondary/30" data-testid={`repo-row-${r.name}`}>
                  <td className="py-2 pr-2 font-medium">
                    {r.name}
                    {r.isDefault && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-yellow/15 text-yellow font-semibold">default</span>}
                    {!r.port && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">code-only</span>}
                  </td>
                  <td className="py-2 pr-2 text-muted-foreground truncate max-w-xs">{r.url}</td>
                  <td className="py-2 pr-2">{r.port ?? "—"}</td>
                  <td className="py-2 pr-2 text-muted-foreground">{r.externalPath ?? (r.port ? "internal-only" : "—")}</td>
                  <td className="py-2 pr-2">{r.port ? (r.autoRun !== false ? "yes" : "no") : "—"}</td>
                  <td className="py-2 pr-2 text-right">
                    <Button size="sm" variant="ghost" onClick={() => { setEditingName(r.name); setShowAddForm(false); }} data-testid={`repo-edit-${r.name}`}>
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => void handleDelete(r.name)} data-testid={`repo-delete-${r.name}`}>
                      Delete
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {showAddForm && (
        <RepoForm
          mode="add"
          projectPath={projectPath}
          onCancel={() => setShowAddForm(false)}
          onSaved={async () => { setShowAddForm(false); await refresh(); }}
        />
      )}

      {editingName && (
        <RepoForm
          mode="edit"
          projectPath={projectPath}
          initial={repos.find((r) => r.name === editingName) ?? null}
          onCancel={() => setEditingName(null)}
          onSaved={async () => { setEditingName(null); await refresh(); }}
        />
      )}
    </div>
  );
}

type FormProps = {
  mode: "add" | "edit";
  projectPath: string;
  initial?: ProjectRepo | null;
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
};

function RepoForm({ mode, projectPath, initial, onCancel, onSaved }: FormProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [url, setUrl] = useState(initial?.url ?? "");
  const [branch, setBranch] = useState(initial?.branch ?? "");
  const [port, setPort] = useState(initial?.port ? String(initial.port) : "");
  const [startCommand, setStartCommand] = useState(initial?.startCommand ?? "");
  const [externalPath, setExternalPath] = useState(initial?.externalPath ?? "");
  const [isDefault, setIsDefault] = useState(initial?.isDefault ?? false);
  const [autoRun, setAutoRun] = useState(initial?.autoRun ?? true);
  const [writable, setWritable] = useState(initial?.writable ?? false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    const repo: ProjectRepo = { name, url };
    if (branch) repo.branch = branch;
    if (port) repo.port = parseInt(port, 10);
    if (startCommand) repo.startCommand = startCommand;
    if (externalPath) repo.externalPath = externalPath;
    if (isDefault && repo.port) repo.isDefault = true;
    if (repo.port) repo.autoRun = autoRun;
    if (writable) repo.writable = true;
    try {
      if (mode === "add") {
        await addProjectRepo(projectPath, repo);
      } else {
        await updateProjectRepo(projectPath, name, repo);
      }
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="p-4 border-blue/40" data-testid="repo-form">
      <h3 className="text-sm font-semibold mb-3">{mode === "add" ? "Add repo" : `Edit ${initial?.name}`}</h3>
      {error && <div className="mb-3 text-[12px] text-destructive">{error}</div>}
      <div className="grid grid-cols-2 gap-3 text-[12px]">
        <label className="space-y-1">
          <span className="block text-muted-foreground">Name</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} disabled={mode === "edit"} placeholder="web" data-testid="repo-form-name" />
        </label>
        <label className="space-y-1">
          <span className="block text-muted-foreground">Git URL</span>
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/owner/repo.git" data-testid="repo-form-url" />
        </label>
        <label className="space-y-1">
          <span className="block text-muted-foreground">Branch (optional)</span>
          <Input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="main" data-testid="repo-form-branch" />
        </label>
        <label className="space-y-1">
          <span className="block text-muted-foreground">Port (server repos)</span>
          <Input type="number" value={port} onChange={(e) => setPort(e.target.value)} placeholder="5173" data-testid="repo-form-port" />
        </label>
        <label className="col-span-2 space-y-1">
          <span className="block text-muted-foreground">Start command (required when port is set)</span>
          <Input value={startCommand} onChange={(e) => setStartCommand(e.target.value)} placeholder="pnpm dev" data-testid="repo-form-startcommand" />
        </label>
        <label className="col-span-2 space-y-1">
          <span className="block text-muted-foreground">External path (Caddy routing for non-default repos)</span>
          <Input value={externalPath} onChange={(e) => setExternalPath(e.target.value)} placeholder="/api" data-testid="repo-form-externalpath" />
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} disabled={!port} data-testid="repo-form-isdefault" />
          <span>Default repo (served on /)</span>
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={autoRun} onChange={(e) => setAutoRun(e.target.checked)} disabled={!port} data-testid="repo-form-autorun" />
          <span>Auto-run at container boot</span>
        </label>
        <label className="flex items-center gap-2 col-span-2">
          <input type="checkbox" checked={writable} onChange={(e) => setWritable(e.target.checked)} data-testid="repo-form-writable" />
          <span>Writable (gateway can push back; default read-only)</span>
        </label>
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="ghost" onClick={onCancel} disabled={submitting}>Cancel</Button>
        <Button onClick={() => void handleSubmit()} disabled={submitting || !name || !url} data-testid="repo-form-save">
          {submitting ? "Saving…" : mode === "add" ? "Add" : "Save"}
        </Button>
      </div>
    </Card>
  );
}
