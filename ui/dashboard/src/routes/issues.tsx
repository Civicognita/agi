/**
 * Issues page — Wish #21 Slice 4 Phase 1.
 *
 * System-level aggregate view of all per-project issue registries.
 * Mirrors /reports's shape (PageScroll wrapper around a list panel).
 */

import type { ReactElement } from "react";
import { IssuesPanel } from "@/components/IssuesPanel.js";
import { PageScroll } from "@/components/PageScroll.js";

export default function IssuesPage(): ReactElement {
  return (
    <PageScroll>
      <div className="space-y-4">
        <div>
          <h1 className="text-[18px] font-semibold">Issues</h1>
          <p className="text-[12px] text-muted-foreground mt-1">
            Agent-curated registry of failures Aion (or Claude Code) hit when attempting
            expected actions. File via <code className="text-[11px] bg-secondary px-1 py-0.5 rounded">agi issue file</code> or
            via the <code className="text-[11px] bg-secondary px-1 py-0.5 rounded">issue</code> agent tool.
          </p>
        </div>
        <IssuesPanel />
      </div>
    </PageScroll>
  );
}
