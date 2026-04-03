/**
 * StackManager — lists installed stacks with add/remove capabilities.
 */

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { StackInfo, ProjectStackInstance } from "../types.js";
import { fetchProjectStacks, fetchStacks, addStack, removeStack } from "../api.js";
import { StackCard } from "./StackCard.js";
import { StackPicker } from "./StackPicker.js";

export interface StackManagerProps {
  projectPath: string;
  projectCategory?: string;
  suggestedStacks?: string[];
  onToolExecute?: (projectPath: string, toolId: string) => Promise<{ ok: boolean; output?: string; error?: string }>;
}

export function StackManager({ projectPath, projectCategory, suggestedStacks, onToolExecute }: StackManagerProps) {
  const [stacks, setStacks] = useState<ProjectStackInstance[]>([]);
  const [stackDefs, setStackDefs] = useState<StackInfo[]>([]);
  const [showPicker, setShowPicker] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    fetchProjectStacks(projectPath).then(setStacks).catch(() => {});
    fetchStacks().then((defs) => setStackDefs(defs.filter((d) => d.category !== "runtime"))).catch(() => {});
  }, [projectPath]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleAdd(stackId: string) {
    setAdding(stackId);
    setError(null);
    try {
      await addStack(projectPath, stackId);
      refresh();
      setShowPicker(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAdding(null);
    }
  }

  async function handleRemove(stackId: string) {
    setRemoving(stackId);
    setError(null);
    try {
      await removeStack(projectPath, stackId);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRemoving(null);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Stacks</h4>
        <Button
          variant="outline"
          size="sm"
          className="text-xs h-6"
          onClick={() => setShowPicker(true)}
        >
          Add Stack
        </Button>
      </div>

      {/* Suggested stacks — includes detected suggestions + their dependency stacks */}
      {(() => {
        const installedIds = new Set(stacks.map((s) => s.stackId));
        const installedProvides = new Set<string>();
        for (const inst of stacks) {
          const def = stackDefs.find((d) => d.id === inst.stackId);
          if (def) {
            for (const req of def.requirements) {
              if (req.type === "provided") installedProvides.add(req.id);
            }
          }
        }

        // Start with direct suggestions
        const directSuggestions = (suggestedStacks ?? [])
          .filter((id) => !installedIds.has(id))
          .map((id) => stackDefs.find((d) => d.id === id))
          .filter((d): d is StackInfo => d !== undefined);

        // Find dependency stacks: if a suggested stack has "expected" requirements
        // that aren't installed, suggest stacks that provide them
        const depIds = new Set<string>();
        for (const s of directSuggestions) {
          for (const req of s.requirements) {
            if (req.type === "expected" && !installedProvides.has(req.id)) {
              const provider = stackDefs.find((d) =>
                d.id !== s.id && !installedIds.has(d.id) &&
                d.requirements.some((r) => r.type === "provided" && r.id === req.id),
              );
              if (provider) depIds.add(provider.id);
            }
          }
        }

        const allSuggestions = [
          ...stackDefs.filter((d) => depIds.has(d.id)),
          ...directSuggestions,
        ];

        if (allSuggestions.length === 0) return null;
        return (
          <div className="rounded-lg border border-blue/20 bg-blue/5 p-2.5 space-y-1.5">
            <p className="text-[10px] font-semibold text-blue uppercase tracking-wider">Suggested</p>
            {allSuggestions.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="text-xs font-medium">{s.label}</span>
                  <span className="text-[10px] text-muted-foreground ml-1.5">
                    {depIds.has(s.id) ? `Required by suggested stacks` : s.description}
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-[10px] h-5 px-2 shrink-0"
                  onClick={() => void handleAdd(s.id)}
                  disabled={adding === s.id}
                >
                  {adding === s.id ? "Adding..." : "Add"}
                </Button>
              </div>
            ))}
          </div>
        );
      })()}

      {error && (
        <p className="text-xs text-red">{error}</p>
      )}

      {stacks.length === 0 ? (
        <p className="text-xs text-muted-foreground">No stacks installed. Add a stack to configure runtime, database, or tooling.</p>
      ) : (
        <div className="space-y-2">
          {stacks.map((instance) => {
            const def = stackDefs.find((d) => d.id === instance.stackId);
            if (!def) return null;
            return (
              <StackCard
                key={instance.stackId}
                stack={def}
                instance={instance}
                onRemove={handleRemove}
                onToolExecute={onToolExecute}
                projectPath={projectPath}
                removing={removing === instance.stackId}
              />
            );
          })}
        </div>
      )}

      {showPicker && (
        <StackPicker
          projectCategory={projectCategory}
          installedStacks={stacks}
          onAdd={handleAdd}
          onClose={() => { setShowPicker(false); setError(null); }}
          adding={adding}
          addError={error}
        />
      )}
    </div>
  );
}
