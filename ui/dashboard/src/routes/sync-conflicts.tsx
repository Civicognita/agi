/**
 * Sync Conflicts page — s155 t672 Phase 5b.
 *
 * System-level view of the layered-PM-write conflict log populated by
 * the SyncReplayWorker. Mirror of /issues's shape.
 */

import type { ReactElement } from "react";
import { SyncConflictsPanel } from "@/components/SyncConflictsPanel.js";
import { PageScroll } from "@/components/PageScroll.js";

export default function SyncConflictsPage(): ReactElement {
  return (
    <PageScroll>
      <div className="space-y-4">
        <div>
          <h1 className="text-[18px] font-semibold">Sync Conflicts</h1>
          <p className="text-[12px] text-muted-foreground mt-1">
            Divergences detected between primary PM and TynnLite by the sync-replay worker.
            Soft conflicts auto-resolve via per-field LWW; hard conflicts (status state-graph
            violations) require operator review. See{" "}
            <code className="text-[11px] bg-secondary px-1 py-0.5 rounded">agi/docs/agents/adr-layered-pm-conflict-resolution.md</code>.
          </p>
        </div>
        <SyncConflictsPanel />
      </div>
    </PageScroll>
  );
}
