/**
 * SyncConflictsPanel — s155 t672 Phase 5b.
 *
 * Read + resolve view of the layered-PM-write conflict log. Reads
 * `/api/pm/sync-conflicts` (Phase 5a) and renders per-row descriptors
 * with a "Resolve" affordance that POSTs to .../resolve.
 *
 * Phase 5b scope (this slice):
 *   - Read-only list (no field-level diff explorer yet)
 *   - Resolve button removes from log (LWW resolution outside this UI;
 *     this just signals "owner reviewed it")
 *   - Empty + loading + error states
 *
 * Subsequent phases extend with:
 *   - Field-level diff explorer (Phase 5c)
 *   - "Accept primary" / "Accept lite" affordance (writes back to TynnLite)
 *   - Hard-conflict-only filter
 *
 * Note: resolution at this surface is a TRIAGE signal — the underlying
 * LWW resolution per the t669 ADR happens in the sync-replay worker
 * (Phase 6) when it writes back to TynnLite. This UI is for the operator
 * to mark "I've seen this and accepted whatever resolution happened."
 */

import { useEffect, useState } from "react";

interface SyncConflictEntry {
  id: string;
  ts: string;
  projectPath: string;
  entityType: string;
  entityId: string;
  field: string;
  primaryValue: unknown;
  liteValue: unknown;
  primaryUpdatedAt?: string;
  liteUpdatedAt?: string;
  hard: boolean;
}

interface ConflictsResponse {
  conflicts: SyncConflictEntry[];
}

function formatValue(v: unknown): string {
  if (v === null) return "(null)";
  if (v === undefined) return "(undefined)";
  if (typeof v === "string") return v.length > 80 ? `${v.slice(0, 77)}…` : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v).slice(0, 80);
}

export function SyncConflictsPanel() {
  const [conflicts, setConflicts] = useState<SyncConflictEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState<Set<string>>(new Set());

  const reload = async (): Promise<void> => {
    try {
      const r = await fetch("/api/pm/sync-conflicts");
      if (!r.ok) throw new Error(`HTTP ${String(r.status)}`);
      const body = (await r.json()) as ConflictsResponse;
      setConflicts(body.conflicts ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (cancelled) return;
      await reload();
    })();
    return () => { cancelled = true; };
  }, []);

  const onResolve = async (id: string): Promise<void> => {
    setResolving((prev) => new Set(prev).add(id));
    try {
      await fetch(`/api/pm/sync-conflicts/${id}/resolve`, { method: "POST" });
      await reload();
    } finally {
      setResolving((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  if (loading) {
    return <p className="text-[12px] text-muted-foreground">Loading conflicts…</p>;
  }
  if (error) {
    return <p className="text-[12px] text-destructive">Error loading conflicts: {error}</p>;
  }
  if (conflicts.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-[13px] text-muted-foreground">
          No conflicts yet. Conflicts surface when{" "}
          <code className="text-[12px] bg-secondary px-1 py-0.5 rounded">agent.pm.enableLayeredWrites</code>{" "}
          is on AND the sync-replay worker detects divergence between primary + TynnLite on read-back.
        </p>
      </div>
    );
  }

  const hardCount = conflicts.filter((c) => c.hard).length;

  return (
    <div className="space-y-4" data-testid="sync-conflicts-panel">
      <div className="text-[12px] text-muted-foreground">
        {String(conflicts.length)} conflict{conflicts.length === 1 ? "" : "s"}
        {hardCount > 0 && (
          <span className="ml-2 text-yellow-500">⚠ {String(hardCount)} hard</span>
        )}
      </div>
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left py-1 px-2 font-medium text-muted-foreground">When</th>
            <th className="text-left py-1 px-2 font-medium text-muted-foreground">Project</th>
            <th className="text-left py-1 px-2 font-medium text-muted-foreground">Entity</th>
            <th className="text-left py-1 px-2 font-medium text-muted-foreground">Field</th>
            <th className="text-left py-1 px-2 font-medium text-muted-foreground">Primary</th>
            <th className="text-left py-1 px-2 font-medium text-muted-foreground">Lite</th>
            <th className="text-left py-1 px-2 font-medium text-muted-foreground">Type</th>
            <th className="py-1 px-2"></th>
          </tr>
        </thead>
        <tbody>
          {conflicts.map((c) => (
            <tr
              key={c.id}
              className="border-b border-border/50"
              data-testid="conflict-row"
              data-conflict-hard={c.hard ? "true" : "false"}
            >
              <td className="py-1 px-2 text-muted-foreground">{c.ts.slice(11, 19)}</td>
              <td className="py-1 px-2 truncate max-w-[200px]">{c.projectPath}</td>
              <td className="py-1 px-2 font-mono">{c.entityType} {c.entityId}</td>
              <td className="py-1 px-2 font-medium">{c.field}</td>
              <td className="py-1 px-2 truncate max-w-[200px]">{formatValue(c.primaryValue)}</td>
              <td className="py-1 px-2 truncate max-w-[200px]">{formatValue(c.liteValue)}</td>
              <td className="py-1 px-2">
                {c.hard ? (
                  <span className="text-yellow-500">⚠ hard</span>
                ) : (
                  <span className="text-muted-foreground">soft</span>
                )}
              </td>
              <td className="py-1 px-2 text-right">
                <button
                  onClick={() => { void onResolve(c.id); }}
                  disabled={resolving.has(c.id)}
                  className="text-[11px] px-2 py-0.5 rounded border border-border hover:bg-secondary disabled:opacity-50"
                  data-testid="resolve-button"
                >
                  {resolving.has(c.id) ? "…" : "Resolve"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
