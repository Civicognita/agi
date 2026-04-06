/**
 * ProjectPickerDialog — modal for selecting a project before opening a MagicApp.
 * MagicApps are always project-anchored.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button.js";
import type { ProjectInfo } from "@/types.js";

export interface ProjectPickerDialogProps {
  open: boolean;
  onSelect: (projectPath: string) => void;
  onClose: () => void;
  projects: ProjectInfo[];
  title?: string;
}

export function ProjectPickerDialog({ open, onSelect, onClose, projects, title }: ProjectPickerDialogProps) {
  const [filter, setFilter] = useState("");

  if (!open) return null;

  const filtered = filter
    ? projects.filter((p) => p.name.toLowerCase().includes(filter.toLowerCase()) || p.path.toLowerCase().includes(filter.toLowerCase()))
    : projects;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-xl shadow-2xl w-[420px] max-h-[500px] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">{title ?? "Select a Project"}</h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">MagicApps are project-anchored — choose which project to open this app for.</p>
          <input
            type="text"
            placeholder="Search projects..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="mt-2 w-full px-2.5 py-1.5 rounded-md border border-border bg-background text-foreground text-xs"
            autoFocus
          />
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {filtered.length === 0 && (
            <div className="text-center py-6 text-muted-foreground text-xs">No projects found</div>
          )}
          {filtered.map((p) => (
            <button
              key={p.path}
              onClick={() => onSelect(p.path)}
              className="w-full text-left px-3 py-2 rounded-lg hover:bg-accent/10 transition-colors flex items-center gap-2"
            >
              <div className="flex-1">
                <div className="text-sm font-medium text-foreground">{p.name}</div>
                <div className="text-[10px] text-muted-foreground font-mono">{p.path}</div>
              </div>
              {p.hosting?.hostname && (
                <span className="text-[10px] text-blue">{p.hosting.hostname}.ai.on</span>
              )}
            </button>
          ))}
        </div>
        <div className="px-4 py-2 border-t border-border flex justify-end">
          <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}
