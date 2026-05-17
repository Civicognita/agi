/**
 * WorkflowDesigner — FlowEditor + workflow list sidebar.
 *
 * Renders a two-panel layout:
 *   - Left: saved workflow list + "New" button
 *   - Right: fancy-flow FlowEditor for the selected workflow
 *
 * Auto-saves the graph on every onChange (debounced 800ms).
 * s176 first slice — no executor / run integration yet.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { FlowEditor } from "@particle-academy/fancy-flow";
import type { FlowGraph } from "@particle-academy/fancy-flow";
import { Button } from "@/components/ui/button.js";
import { Card } from "@/components/ui/card.js";
import { Badge } from "@/components/ui/badge.js";
import {
  listWorkflows,
  createWorkflow,
  getWorkflow,
  updateWorkflow,
  deleteWorkflow,
  type WorkflowSummary,
} from "@/api.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WorkflowDesignerProps {
  /** Pixel height for the editor panel. Default 620. */
  height?: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function WorkflowDesigner({ height = 620 }: WorkflowDesignerProps) {
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [graph, setGraph] = useState<FlowGraph | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [showNewInput, setShowNewInput] = useState(false);

  // Debounce timer for auto-save
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load workflow list on mount
  useEffect(() => {
    void loadList();
  }, []);

  async function loadList() {
    try {
      const list = await listWorkflows();
      setWorkflows(list);
    } catch {
      // Non-fatal — empty list is fine on first use
    }
  }

  async function selectWorkflow(id: string) {
    if (id === selectedId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const record = await getWorkflow(id);
      setSelectedId(id);
      setGraph(record.graph as unknown as FlowGraph);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load workflow");
    } finally {
      setLoading(false);
    }
  }

  const handleChange = useCallback((g: FlowGraph) => {
    setGraph(g);
    if (!selectedId) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      setSaving(true);
      void updateWorkflow(selectedId, { graph: g as unknown as Record<string, unknown> })
        .catch(() => { /* silent auto-save failure */ })
        .finally(() => setSaving(false));
    }, 800);
  }, [selectedId]);

  async function handleCreate() {
    const name = newName.trim() || "Untitled workflow";
    try {
      const record = await createWorkflow(name);
      await loadList();
      setNewName("");
      setShowNewInput(false);
      setSelectedId(record.id);
      setGraph(record.graph as unknown as FlowGraph);
    } catch {
      // ignore
    }
  }

  async function handleDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await deleteWorkflow(id);
      if (selectedId === id) {
        setSelectedId(null);
        setGraph(undefined);
      }
      await loadList();
    } catch {
      // ignore
    }
  }

  return (
    <div className="flex gap-3 items-start" data-testid="workflow-designer">
      {/* Left panel — workflow list */}
      <div className="w-56 shrink-0 flex flex-col gap-2">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wide">Workflows</span>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-[11px]"
            onClick={() => setShowNewInput((v) => !v)}
          >
            + New
          </Button>
        </div>

        {showNewInput && (
          <div className="flex flex-col gap-1">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void handleCreate(); }}
              placeholder="Workflow name…"
              autoFocus
              className="h-7 rounded-md border border-border bg-background px-2 text-[12px] outline-none focus:ring-1 focus:ring-ring"
              data-testid="workflow-name-input"
            />
            <div className="flex gap-1">
              <Button size="sm" className="h-6 px-2 text-[11px] flex-1" onClick={() => void handleCreate()}>
                Create
              </Button>
              <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => setShowNewInput(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {workflows.length === 0 && !showNewInput && (
          <p className="text-[11px] text-muted-foreground/60 px-1">No workflows yet. Create one to get started.</p>
        )}

        <div className="flex flex-col gap-1">
          {workflows.map((wf) => (
            <Card
              key={wf.id}
              data-testid={`workflow-item-${wf.id}`}
              className={`p-2 cursor-pointer flex items-center justify-between gap-1 hover:bg-muted/50 transition-colors ${selectedId === wf.id ? "border-ring bg-muted/30" : ""}`}
              onClick={() => void selectWorkflow(wf.id)}
            >
              <span className="text-[12px] truncate flex-1 min-w-0">{wf.name}</span>
              <button
                type="button"
                onClick={(e) => void handleDelete(wf.id, e)}
                className="text-muted-foreground/40 hover:text-destructive transition-colors text-[10px] shrink-0 cursor-pointer bg-transparent border-none"
                aria-label={`Delete ${wf.name}`}
              >
                ×
              </button>
            </Card>
          ))}
        </div>
      </div>

      {/* Right panel — editor or empty state */}
      <div className="flex-1 min-w-0">
        {loading && (
          <div className="flex items-center justify-center rounded-lg border border-border bg-muted/20" style={{ height }}>
            <span className="text-[12px] text-muted-foreground">Loading…</span>
          </div>
        )}

        {loadError && !loading && (
          <div className="flex items-center justify-center rounded-lg border border-destructive/30 bg-destructive/5" style={{ height }}>
            <span className="text-[12px] text-destructive">{loadError}</span>
          </div>
        )}

        {!loading && !loadError && selectedId === null && (
          <div
            className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-muted/10 text-center"
            style={{ height }}
            data-testid="workflow-empty-state"
          >
            <p className="text-[13px] text-muted-foreground">Select or create a workflow to start designing.</p>
            <Button
              variant="outline"
              size="sm"
              className="text-[12px]"
              onClick={() => setShowNewInput(true)}
            >
              + New Workflow
            </Button>
          </div>
        )}

        {!loading && !loadError && selectedId !== null && (
          <div className="relative">
            {saving && (
              <Badge
                variant="outline"
                className="absolute top-2 right-2 z-10 text-[10px] text-muted-foreground"
              >
                Saving…
              </Badge>
            )}
            <FlowEditor
              key={selectedId}
              value={graph}
              onChange={handleChange}
              showFeed={false}
              height={height}
            />
          </div>
        )}
      </div>
    </div>
  );
}
