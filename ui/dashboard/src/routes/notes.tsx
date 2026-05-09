/**
 * Global Notes page (s152, 2026-05-09).
 *
 * Reuses the same NotesPanel component used per-project, but scoped to
 * `projectPath: null` for project-less ideas/todos/context. Owner directive
 * ("notes for ideas/todos/context that aren't project-bound") shipped here
 * via the main-nav "Notes" entry.
 */

import type { ReactElement } from "react";
import { NotesPanel } from "@/components/NotesPanel.js";

export default function NotesPage(): ReactElement {
  return (
    <div className="flex flex-col gap-3 h-full">
      <header className="flex items-baseline gap-2">
        <h1 className="text-[16px] font-semibold tracking-tight">Notes</h1>
        <span className="text-[11px] text-muted-foreground/70">
          Global scope — ideas + todos + context not bound to any one project
        </span>
      </header>
      <div className="flex-1 min-h-0">
        <NotesPanel projectPath={null} />
      </div>
    </div>
  );
}
