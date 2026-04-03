/**
 * StackPicker — modal for selecting and adding stacks to a project.
 */

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { StackInfo, ProjectStackInstance } from "../types.js";
import { fetchStacks } from "../api.js";

export interface StackPickerProps {
  projectCategory?: string;
  installedStacks: ProjectStackInstance[];
  onAdd: (stackId: string) => void;
  onClose: () => void;
  adding?: string | null;
  addError?: string | null;
}

const CATEGORY_ORDER = ["database", "framework", "tooling", "workflow"] as const;

export function StackPicker({ projectCategory, installedStacks, onAdd, onClose, adding, addError }: StackPickerProps) {
  const [stacks, setStacks] = useState<StackInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const installedIds = new Set(installedStacks.map((s) => s.stackId));

  useEffect(() => {
    setLoading(true);
    fetchStacks(projectCategory)
      .then(setStacks)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [projectCategory]);

  // Group by category
  const grouped = new Map<string, StackInfo[]>();
  for (const stack of stacks) {
    const list = grouped.get(stack.category) ?? [];
    list.push(stack);
    grouped.set(stack.category, list);
  }

  // Build set of capabilities already provided by installed stacks
  const providedCapabilities = new Set<string>();
  for (const inst of installedStacks) {
    const installed = stacks.find((s) => s.id === inst.stackId);
    if (installed) {
      for (const req of installed.requirements) {
        if (req.type === "provided") providedCapabilities.add(req.id);
      }
    }
  }

  // Check for conflicts (two stacks providing the same requirement)
  function getConflicts(stack: StackInfo): string[] {
    return stack.requirements
      .filter((r) => r.type === "provided" && providedCapabilities.has(r.id))
      .map((r) => r.label);
  }

  // Find unmet dependencies — "expected" requirements not satisfied by installed stacks
  function getUnmetDeps(stack: StackInfo): { reqId: string; label: string; candidates: StackInfo[] }[] {
    return stack.requirements
      .filter((r) => r.type === "expected" && !providedCapabilities.has(r.id))
      .map((r) => ({
        reqId: r.id,
        label: r.label,
        candidates: stacks.filter((s) =>
          s.id !== stack.id && s.requirements.some((sr) => sr.type === "provided" && sr.id === r.id),
        ),
      }));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-background border border-border rounded-xl shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="font-medium text-foreground">Add Stack</h3>
          <Button variant="ghost" size="sm" onClick={onClose} className="text-muted-foreground">
            Close
          </Button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-4 space-y-4">
          {loading && <p className="text-sm text-muted-foreground">Loading stacks...</p>}
          {error && <p className="text-sm text-red">{error}</p>}
          {addError && (
            <div className="rounded-lg bg-red/10 border border-red/30 px-3 py-2 text-sm text-red">
              {addError}
            </div>
          )}

          {!loading && stacks.length === 0 && !error && (
            <p className="text-sm text-muted-foreground">
              No stacks available. Install stack plugins from the Marketplace first.
            </p>
          )}

          {CATEGORY_ORDER.map((cat) => {
            const items = grouped.get(cat);
            if (!items || items.length === 0) return null;
            return (
              <div key={cat}>
                <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                  {cat}
                </h4>
                <div className="space-y-2">
                  {items.map((stack) => {
                    const installed = installedIds.has(stack.id);
                    const conflicts = getConflicts(stack);
                    const unmetDeps = getUnmetDeps(stack);
                    const isAdding = adding === stack.id;

                    return (
                      <div
                        key={stack.id}
                        className={cn(
                          "rounded-lg border p-3 flex items-start justify-between gap-3",
                          installed
                            ? "border-surface1 bg-surface0/30 opacity-60"
                            : "border-border bg-mantle hover:border-surface1",
                        )}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm text-foreground">{stack.label}</div>
                          <p className="text-xs text-muted-foreground mt-0.5">{stack.description}</p>
                          {/* Requirements preview */}
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {stack.requirements.map((req) => (
                              <span
                                key={req.id}
                                className={cn(
                                  "text-[10px] px-1.5 py-0.5 rounded",
                                  req.type === "provided"
                                    ? "bg-green/10 text-green"
                                    : providedCapabilities.has(req.id)
                                      ? "bg-surface0 text-muted-foreground"
                                      : "bg-yellow/10 text-yellow",
                                )}
                              >
                                {req.label}{req.type === "expected" && !providedCapabilities.has(req.id) ? " (needed)" : ""}
                              </span>
                            ))}
                          </div>
                          {conflicts.length > 0 && (
                            <p className="text-[10px] text-yellow mt-1">
                              Conflicts with installed: {conflicts.join(", ")}
                            </p>
                          )}
                          {/* Dependency suggestions */}
                          {unmetDeps.length > 0 && (
                            <div className="mt-1.5 space-y-1">
                              {unmetDeps.map((dep) => (
                                <div key={dep.reqId} className="flex items-center gap-1.5 flex-wrap">
                                  <span className="text-[10px] text-yellow">Requires {dep.label}:</span>
                                  {dep.candidates.length > 0 ? (
                                    dep.candidates.map((c) => (
                                      <Button
                                        key={c.id}
                                        variant="outline"
                                        size="sm"
                                        className="text-[10px] h-5 px-2"
                                        disabled={installedIds.has(c.id) || adding !== null}
                                        onClick={() => onAdd(c.id)}
                                      >
                                        {installedIds.has(c.id) ? `${c.label} (installed)` : `Add ${c.label}`}
                                      </Button>
                                    ))
                                  ) : (
                                    <span className="text-[10px] text-muted-foreground">No matching stack available</span>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        <Button
                          size="sm"
                          variant={installed ? "outline" : "default"}
                          className="text-xs shrink-0"
                          disabled={installed || isAdding}
                          onClick={() => onAdd(stack.id)}
                        >
                          {installed ? "Installed" : isAdding ? "Adding..." : "Add"}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
