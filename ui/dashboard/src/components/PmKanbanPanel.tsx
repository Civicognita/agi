/**
 * PmKanbanPanel — s139 t536 Phase 1.
 *
 * MVP kanban board: read tasks from `/api/pm/find-tasks`, bucket by
 * status into the 6-column tynn-shape board (todo/now/qa/done +
 * hidden blocked/archived), render via @particle-academy/react-fancy
 * Kanban primitive.
 *
 * Phase 1 scope:
 *   - Read-only render (no drag-drop persistence yet — onCardMove is
 *     a no-op; column drag uses Kanban's built-in optimistic state)
 *   - Tasks fetched once on mount; no realtime updates yet
 *   - Hidden columns (blocked / archived) collapsed under a toggle
 *
 * Subsequent phases extend with:
 *   - Phase 2: drag-drop persistence (call setTaskStatus on move)
 *   - Phase 3: card editor modal
 *   - Phase 4: filter strip (priority / labels / overdue)
 *   - Phase 5: realtime updates via WS subscription
 *   - Phase 6: per-project kanban embedding (this slice is system-aggregate)
 */

import { useEffect, useMemo, useState } from "react";
import { Kanban, Modal } from "@particle-academy/react-fancy";

interface PmTask {
  id: string;
  number: number;
  storyId: string;
  title: string;
  status: string;
  description?: string;
  verificationSteps?: string[];
  codeArea?: string;
}

interface FindTasksResponse {
  tasks: PmTask[];
}

/** Mirrors DEFAULT_TYNN_KANBAN_CONFIG from @agi/sdk's define-pm-provider.ts. */
const COLUMNS: { id: string; name: string; statuses: string[]; hiddenByDefault?: boolean }[] = [
  { id: "todo", name: "To do", statuses: ["backlog"] },
  { id: "now", name: "Now", statuses: ["starting", "doing"] },
  { id: "qa", name: "QA", statuses: ["testing"] },
  { id: "done", name: "Done", statuses: ["finished"] },
  { id: "blocked", name: "Blocked", statuses: ["blocked"], hiddenByDefault: true },
  { id: "archived", name: "Archived", statuses: ["archived"], hiddenByDefault: true },
];

type ViewMode = "kanban" | "list";

export function PmKanbanPanel() {
  const [tasks, setTasks] = useState<PmTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  // s139 t537 — list-view toggle. Defaults to kanban; swaps to table
  // when the user wants a denser scannable view.
  const [viewMode, setViewMode] = useState<ViewMode>("kanban");
  // s139 t539 Phase 1 — card detail modal. Click a card → see its full
  // body (title / description / status / codeArea / verificationSteps).
  // Read-only; edit functionality + missing-field schema work (priority
  // / points / due / assignee / subtasks) follow in Phase 2+.
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch("/api/pm/find-tasks?limit=200");
        if (!r.ok) throw new Error(`HTTP ${String(r.status)}`);
        const body = (await r.json()) as FindTasksResponse;
        if (!cancelled) {
          setTasks(body.tasks ?? []);
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

  // Bucket tasks by column. A task whose status doesn't match any
  // column lands in the first column with no statuses (catch-all);
  // none in the default config — those tasks are silently dropped
  // (unusual; defensive in case future PmStatus values appear).
  const tasksByColumn = useMemo(() => {
    const map = new Map<string, PmTask[]>();
    for (const col of COLUMNS) map.set(col.id, []);
    for (const task of tasks) {
      for (const col of COLUMNS) {
        if (col.statuses.includes(task.status)) {
          (map.get(col.id) ?? []).push(task);
          break;
        }
      }
    }
    return map;
  }, [tasks]);

  if (loading) return <p className="text-[12px] text-muted-foreground">Loading kanban…</p>;
  if (error) return <p className="text-[12px] text-destructive">Error loading tasks: {error}</p>;

  const visibleColumns = COLUMNS.filter((col) => showHidden || !col.hiddenByDefault);
  const totalCards = tasks.length;

  return (
    <div className="space-y-3" data-testid="pm-kanban-panel">
      <div className="flex items-center gap-3">
        <span className="text-[12px] text-muted-foreground">{String(totalCards)} task{totalCards === 1 ? "" : "s"}</span>
        <label className="flex items-center gap-1 text-[12px] text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={showHidden}
            onChange={(e) => { setShowHidden(e.target.checked); }}
            className="cursor-pointer"
          />
          Show blocked + archived
        </label>
        {/* s139 t537 — view mode toggle */}
        <div className="ml-auto flex items-center gap-1 text-[11px]" data-testid="view-mode-toggle">
          <button
            onClick={() => { setViewMode("kanban"); }}
            className={`px-2 py-0.5 rounded border ${
              viewMode === "kanban"
                ? "border-yellow bg-yellow/15 text-yellow"
                : "border-border text-muted-foreground hover:bg-secondary"
            }`}
            data-testid="view-mode-kanban"
          >
            Kanban
          </button>
          <button
            onClick={() => { setViewMode("list"); }}
            className={`px-2 py-0.5 rounded border ${
              viewMode === "list"
                ? "border-yellow bg-yellow/15 text-yellow"
                : "border-border text-muted-foreground hover:bg-secondary"
            }`}
            data-testid="view-mode-list"
          >
            List
          </button>
        </div>
      </div>

      {viewMode === "list" && (
        <table className="w-full border-collapse text-[12px]" data-testid="pm-kanban-list">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-1 px-2 font-medium text-muted-foreground">#</th>
              <th className="text-left py-1 px-2 font-medium text-muted-foreground">Title</th>
              <th className="text-left py-1 px-2 font-medium text-muted-foreground">Column</th>
              <th className="text-left py-1 px-2 font-medium text-muted-foreground">Status</th>
            </tr>
          </thead>
          <tbody>
            {visibleColumns.flatMap((col) =>
              (tasksByColumn.get(col.id) ?? []).map((task) => (
                <tr key={task.id} className="border-b border-border/50" data-testid="pm-kanban-list-row">
                  <td className="py-1 px-2 font-mono text-muted-foreground tabular-nums">#{String(task.number)}</td>
                  <td className="py-1 px-2 truncate max-w-[400px]">{task.title}</td>
                  <td className="py-1 px-2">{col.name}</td>
                  <td className="py-1 px-2 text-muted-foreground">{task.status}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      )}

      {viewMode === "kanban" && (
      <Kanban
        onCardMove={(cardId, fromColumn, toColumn) => {
          // s139 t536 Phase 2 — persist column moves via setTaskStatus.
          // Map target column to its first canonical status (per
          // DEFAULT_TYNN_KANBAN_CONFIG buckets); within-column moves
          // (fromColumn === toColumn) skip the API call.
          if (fromColumn === toColumn) return;
          const target = COLUMNS.find((c) => c.id === toColumn);
          if (!target || target.statuses.length === 0) return;
          const newStatus = target.statuses[0];
          // Optimistic update
          setTasks((prev) => prev.map((t) => (t.id === cardId ? { ...t, status: newStatus! } : t)));
          // Persist; on error, revert (pull tasks fresh from API)
          void (async () => {
            try {
              const r = await fetch(`/api/pm/tasks/${cardId}/status`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: newStatus }),
              });
              if (!r.ok) throw new Error(`HTTP ${String(r.status)}`);
            } catch {
              // Revert: refetch
              try {
                const r = await fetch("/api/pm/find-tasks?limit=200");
                if (r.ok) {
                  const body = (await r.json()) as FindTasksResponse;
                  setTasks(body.tasks ?? []);
                }
              } catch { /* swallow */ }
            }
          })();
        }}
      >
        {visibleColumns.map((col) => {
          const columnTasks = tasksByColumn.get(col.id) ?? [];
          return (
            <Kanban.Column key={col.id} id={col.id}>
              <Kanban.ColumnHandle>
                <div className="px-2 py-1 text-[12px] font-semibold flex items-center justify-between">
                  <span>{col.name}</span>
                  <span className="text-muted-foreground tabular-nums">{String(columnTasks.length)}</span>
                </div>
              </Kanban.ColumnHandle>
              {columnTasks.map((task) => (
                <Kanban.Card key={task.id} id={task.id}>
                  <div
                    className="text-[11px] p-2 border border-border rounded bg-card cursor-pointer hover:border-yellow"
                    data-testid="kanban-card"
                    onClick={() => { setSelectedTaskId(task.id); }}
                  >
                    <div className="font-medium truncate">{task.title}</div>
                    <div className="text-muted-foreground text-[10px] mt-1">
                      #{String(task.number)} · {task.status}
                    </div>
                  </div>
                </Kanban.Card>
              ))}
            </Kanban.Column>
          );
        })}
      </Kanban>
      )}

      {/* s139 t539 Phase 1 — card detail modal */}
      {selectedTaskId !== null && (() => {
        const task = tasks.find((t) => t.id === selectedTaskId);
        if (!task) return null;
        return (
          <Modal open onClose={() => { setSelectedTaskId(null); }} size="md">
            <Modal.Title>
              <div className="flex items-center gap-2 text-[14px]">
                <span className="font-mono text-muted-foreground">#{String(task.number)}</span>
                <span className="font-semibold">{task.title}</span>
              </div>
            </Modal.Title>
            <Modal.Body>
              <div className="space-y-3 text-[12px]" data-testid="kanban-card-modal">
                <div>
                  <div className="text-muted-foreground text-[11px] mb-0.5">Status</div>
                  <div>{task.status}</div>
                </div>
                {task.description !== undefined && task.description.length > 0 && (
                  <div>
                    <div className="text-muted-foreground text-[11px] mb-0.5">Description</div>
                    <div className="whitespace-pre-wrap">{task.description}</div>
                  </div>
                )}
                {task.codeArea !== undefined && task.codeArea.length > 0 && (
                  <div>
                    <div className="text-muted-foreground text-[11px] mb-0.5">Code area</div>
                    <code className="text-[11px]">{task.codeArea}</code>
                  </div>
                )}
                {task.verificationSteps !== undefined && task.verificationSteps.length > 0 && (
                  <div>
                    <div className="text-muted-foreground text-[11px] mb-0.5">Verification steps</div>
                    <ul className="list-disc pl-5 space-y-0.5">
                      {task.verificationSteps.map((step, i) => (
                        <li key={i}>{step}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </Modal.Body>
            <Modal.Footer>
              <button
                onClick={() => { setSelectedTaskId(null); }}
                className="text-[12px] px-3 py-1 rounded border border-border hover:bg-secondary"
              >
                Close
              </button>
            </Modal.Footer>
          </Modal>
        );
      })()}
    </div>
  );
}
