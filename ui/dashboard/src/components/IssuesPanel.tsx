/**
 * IssuesPanel — Wish #21 Slice 4 Phase 1.
 *
 * System-level aggregate view of the per-project issue registry. Reads
 * from `/api/issues` (Slice 1's GET aggregate) and renders an unstyled
 * table per row: id / project / title / status / occurrences /
 * last_occurrence.
 *
 * Phase 1 scope:
 *   - Read-only list (no filters, no detail view, no filing form)
 *   - Empty + loading + error states
 *   - Grouped-by-project layout
 *
 * Subsequent phases extend with:
 *   - Phase 2: filter strip (by tag, status, project)
 *   - Phase 3: click-row → detail panel (uses /api/projects/issues/:id)
 *   - Phase 4: file-issue button + form modal
 *   - Phase 5: search bar (uses Slice 2's /api/projects/issues/search)
 *   - Phase 6: raw-tier promote affordance (uses Slice 5 routes)
 */

import { useEffect, useMemo, useState } from "react";

interface IssueIndexEntry {
  id: string;
  status: string;
  symptom_hash: string;
  tags: string[];
  title: string;
  occurrences: number;
  last_occurrence: string;
  /** Project the issue lives in — present on the aggregate /api/issues response. */
  project?: string;
}

interface AggregateResponse {
  issues: IssueIndexEntry[];
}

const STATUS_OPTIONS = ["all", "open", "known", "fixed", "wont-fix"] as const;
type StatusFilter = typeof STATUS_OPTIONS[number];

export function IssuesPanel() {
  const [issues, setIssues] = useState<IssueIndexEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // s4 Phase 2 — filter state
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [tagFilter, setTagFilter] = useState<string>("all");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch("/api/issues");
        if (!r.ok) throw new Error(`HTTP ${String(r.status)}`);
        const body = (await r.json()) as AggregateResponse;
        if (!cancelled) {
          setIssues(body.issues ?? []);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Compute available projects + tags from the loaded issues
  const projectOptions = useMemo(() => {
    const set = new Set<string>();
    for (const i of issues) if (i.project) set.add(i.project);
    return ["all", ...[...set].sort()];
  }, [issues]);

  const tagOptions = useMemo(() => {
    const set = new Set<string>();
    for (const i of issues) for (const t of i.tags) set.add(t);
    return ["all", ...[...set].sort()];
  }, [issues]);

  // Apply filters
  const filteredIssues = useMemo(() => {
    return issues.filter((i) => {
      if (statusFilter !== "all" && i.status !== statusFilter) return false;
      if (projectFilter !== "all" && i.project !== projectFilter) return false;
      if (tagFilter !== "all" && !i.tags.includes(tagFilter)) return false;
      return true;
    });
  }, [issues, statusFilter, projectFilter, tagFilter]);

  if (loading) {
    return <p className="text-[12px] text-muted-foreground">Loading issues…</p>;
  }
  if (error) {
    return <p className="text-[12px] text-destructive">Error loading issues: {error}</p>;
  }
  if (issues.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-[13px] text-muted-foreground">
          No issues yet. Issues are filed via{" "}
          <code className="text-[12px] bg-secondary px-1 py-0.5 rounded">agi issue file</code>{" "}
          or by the agent when an expected action fails.
        </p>
      </div>
    );
  }

  // Group filteredIssues by project (entries without a `project` field group under "(unknown)")
  const groups = new Map<string, IssueIndexEntry[]>();
  for (const issue of filteredIssues) {
    const key = issue.project ?? "(unknown)";
    const existing = groups.get(key) ?? [];
    existing.push(issue);
    groups.set(key, existing);
  }

  return (
    <div className="space-y-6" data-testid="issues-panel">
      {/* s4 Phase 2 — filter strip */}
      <div className="flex flex-wrap items-center gap-3" data-testid="issues-filters">
        <label className="flex items-center gap-1 text-[12px] text-muted-foreground">
          Status:
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value as StatusFilter); }}
            className="bg-secondary text-foreground border border-border rounded-md px-2 py-1 text-[12px]"
            data-testid="filter-status"
          >
            {STATUS_OPTIONS.map((s) => (<option key={s} value={s}>{s}</option>))}
          </select>
        </label>
        <label className="flex items-center gap-1 text-[12px] text-muted-foreground">
          Project:
          <select
            value={projectFilter}
            onChange={(e) => { setProjectFilter(e.target.value); }}
            className="bg-secondary text-foreground border border-border rounded-md px-2 py-1 text-[12px]"
            data-testid="filter-project"
          >
            {projectOptions.map((p) => (<option key={p} value={p}>{p}</option>))}
          </select>
        </label>
        <label className="flex items-center gap-1 text-[12px] text-muted-foreground">
          Tag:
          <select
            value={tagFilter}
            onChange={(e) => { setTagFilter(e.target.value); }}
            className="bg-secondary text-foreground border border-border rounded-md px-2 py-1 text-[12px]"
            data-testid="filter-tag"
          >
            {tagOptions.map((t) => (<option key={t} value={t}>{t}</option>))}
          </select>
        </label>
      </div>
      <div className="text-[12px] text-muted-foreground">
        Showing {String(filteredIssues.length)} of {String(issues.length)} issue{issues.length === 1 ? "" : "s"} across {String(groups.size)} project{groups.size === 1 ? "" : "s"}
      </div>
      {[...groups.entries()].map(([project, projectIssues]) => (
        <section key={project} data-project={project}>
          <h3 className="text-[14px] font-semibold mb-2">{project}</h3>
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-1 px-2 font-medium text-muted-foreground">ID</th>
                <th className="text-left py-1 px-2 font-medium text-muted-foreground">Title</th>
                <th className="text-left py-1 px-2 font-medium text-muted-foreground">Status</th>
                <th className="text-right py-1 px-2 font-medium text-muted-foreground">×</th>
                <th className="text-left py-1 px-2 font-medium text-muted-foreground">Last seen</th>
              </tr>
            </thead>
            <tbody>
              {projectIssues.map((issue) => (
                <tr key={`${project}/${issue.id}`} className="border-b border-border/50" data-testid="issue-row">
                  <td className="py-1 px-2 font-mono text-muted-foreground">{issue.id}</td>
                  <td className="py-1 px-2">{issue.title}</td>
                  <td className="py-1 px-2">
                    <span
                      className={
                        issue.status === "fixed" ? "text-green-500" :
                        issue.status === "wont-fix" ? "text-muted-foreground" :
                        issue.status === "known" ? "text-yellow-500" :
                        ""
                      }
                    >
                      {issue.status}
                    </span>
                  </td>
                  <td className="py-1 px-2 text-right tabular-nums">{String(issue.occurrences)}</td>
                  <td className="py-1 px-2 text-muted-foreground">{issue.last_occurrence.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
