/**
 * HostingRepoGrid — s141 t554 Phase 1.
 *
 * Per-repo summary grid for multi-repo projects. Surfaces each repo
 * card with name / url / branch / port — the data t551 added to
 * project.json. Renders inside HostingPanel ABOVE the existing
 * single-stack section so legacy single-repo projects keep their
 * current UX while multi-repo projects get the new view.
 *
 * Phase 1 scope (this slice):
 *   - Read-only grid of repo cards
 *   - Empty state for single-repo projects
 *   - Default badge for the isDefault repo
 *
 * Subsequent phases (Phases 2-N of t554):
 *   - Per-repo attachedStacks badges (needs schema work to expose
 *     attachedStacks on ProjectRepo type — currently lives at the
 *     project level, not per-repo)
 *   - Per-repo stack assignment dropdown
 *   - Per-repo "Hosting" / "Editor" / "Logs" toggles
 *   - Drag-to-reorder
 *   - Mockup B fidelity (full pixel match — see kanban.png)
 */

import { useEffect, useState } from "react";
import { fetchProjectRepos } from "@/api.js";
import type { ProjectRepo } from "@/api.js";

interface HostingRepoGridProps {
  projectPath: string;
  className?: string;
}

export function HostingRepoGrid({ projectPath, className }: HostingRepoGridProps) {
  const [repos, setRepos] = useState<ProjectRepo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await fetchProjectRepos(projectPath);
        if (!cancelled) setRepos(result);
      } catch {
        if (!cancelled) setRepos([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [projectPath]);

  if (loading) return null;
  if (repos.length === 0) return null;
  if (repos.length === 1) return null; // Single-repo projects use the legacy single-stack panel

  return (
    <div
      className={`space-y-2 ${className ?? ""}`}
      data-testid="hosting-repo-grid"
    >
      <div className="text-[12px] font-medium text-foreground">
        Repos ({String(repos.length)})
      </div>
      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}
      >
        {repos.map((repo) => (
          <div
            key={repo.name}
            className="border border-border rounded-md p-3 bg-card text-[12px]"
            data-testid="hosting-repo-card"
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="font-semibold truncate">{repo.name}</span>
              {repo.isDefault === true && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow/15 text-yellow font-semibold">
                  default
                </span>
              )}
            </div>
            <div className="text-muted-foreground truncate text-[11px]">
              {repo.url}
            </div>
            <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground">
              {repo.branch !== undefined && repo.branch !== "" && (
                <span>branch: <code className="text-foreground">{repo.branch}</code></span>
              )}
              {repo.port !== undefined && (
                <span>port: <code className="text-foreground">{String(repo.port)}</code></span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
