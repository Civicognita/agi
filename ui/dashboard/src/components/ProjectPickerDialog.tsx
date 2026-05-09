/**
 * ProjectPickerDialog — modal for selecting a project before opening a MagicApp.
 * MagicApps are always project-anchored.
 *
 * When an `app` is provided, projects are filtered to only show those
 * compatible with the MApp's declared projectTypes/projectCategories.
 *
 * s142 t559 — refactored from a hand-rolled `fixed inset-0` overlay to
 * `@particle-academy/react-fancy` Modal. Gains focus trap, body-scroll
 * lock, ARIA `role="dialog"` + `aria-modal="true"`, and ESC-to-close
 * for free. (Replaces the keyboard-tab-out-of-modal bug surface caught
 * by the t557 audit.)
 */

import { useState } from "react";
import { Modal, Input } from "@particle-academy/react-fancy";
import { Button } from "@/components/ui/button.js";
import type { MagicAppInfo, ProjectInfo } from "@/types.js";

export interface ProjectPickerDialogProps {
  open: boolean;
  onSelect: (projectPath: string) => void;
  onClose: () => void;
  projects: ProjectInfo[];
  title?: string;
  /** When provided, filters projects to those compatible with this MApp. */
  app?: MagicAppInfo | null;
}

export function ProjectPickerDialog({ open, onSelect, onClose, projects, title, app }: ProjectPickerDialogProps) {
  const [filter, setFilter] = useState("");

  // Filter by MApp compatibility when an app is specified
  let compatible = projects;
  if (app) {
    compatible = projects.filter((p) => {
      if (app.projectTypes?.length && !app.projectTypes.includes(p.projectType?.id ?? "")) return false;
      if (app.projectCategories?.length && !app.projectCategories.includes(p.category ?? p.projectType?.category ?? "")) return false;
      return true;
    });
  }

  const filtered = filter
    ? compatible.filter((p) => p.name.toLowerCase().includes(filter.toLowerCase()) || p.path.toLowerCase().includes(filter.toLowerCase()))
    : compatible;

  return (
    <Modal open={open} onClose={onClose} size="sm">
      <Modal.Header>
        <div>
          <h3 className="text-sm font-semibold text-foreground">{title ?? "Select a Project"}</h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">MagicApps are project-anchored — choose which project to open this app for.</p>
          {/* s142 t561 — PAx Input. Brings consistent focus styles +
              affix-slot scaffolding (leading/trailing) for free + a
              proper onValueChange callback shape. */}
          <Input
            type="search"
            placeholder="Search projects..."
            value={filter}
            onValueChange={setFilter}
            className="mt-2 w-full"
            autoFocus
          />
        </div>
      </Modal.Header>
      <Modal.Body className="max-h-[400px] overflow-y-auto p-2">
        {filtered.length === 0 && (
          <div className="text-center py-6 text-muted-foreground text-xs">
            {app && compatible.length === 0
              ? "No compatible projects for this app"
              : "No projects found"}
          </div>
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
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
      </Modal.Footer>
    </Modal>
  );
}
