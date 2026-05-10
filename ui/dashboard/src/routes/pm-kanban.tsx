/**
 * PM Kanban page — s139 t536 Phase 1.
 *
 * System-aggregate kanban view of the active PM provider's tasks.
 * Mirrors the /issues + /sync-conflicts page shape.
 */

import { PmKanbanPanel } from "@/components/PmKanbanPanel.js";
import { PageScroll } from "@/components/PageScroll.js";

export default function PmKanbanPage(): JSX.Element {
  return (
    <PageScroll>
      <div className="space-y-4">
        <div>
          <h1 className="text-[18px] font-semibold">PM Kanban</h1>
          <p className="text-[12px] text-muted-foreground mt-1">
            Tasks from the active PM provider bucketed into the canonical 6-column board
            (To do / Now / QA / Done + hidden Blocked / Archived). Drag-drop persistence,
            card editor, and per-project view land in subsequent slices.
          </p>
        </div>
        <PmKanbanPanel />
      </div>
    </PageScroll>
  );
}
