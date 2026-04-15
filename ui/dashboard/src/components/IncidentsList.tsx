/**
 * IncidentsList — renders recent crash/incident reports stored in
 * ~/.agi/incidents/. Clicking an entry expands the markdown inline.
 */

import { useState } from "react";
import { useAdminIncidents, useAdminIncidentMarkdown } from "@/hooks";

export function IncidentsList() {
  const { data: incidents, isLoading } = useAdminIncidents();
  const [openId, setOpenId] = useState<string | null>(null);
  const { data: markdown } = useAdminIncidentMarkdown(openId);

  if (isLoading) {
    return (
      <div className="text-[12px] text-muted-foreground">Loading incidents…</div>
    );
  }

  if (incidents === undefined || incidents.length === 0) {
    return (
      <div className="text-[12px] text-muted-foreground">
        No incidents recorded. Reports appear here when the gateway detects a crash on boot.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {incidents.map((inc) => {
        const isOpen = openId === inc.id;
        return (
          <div
            key={inc.id}
            className="rounded border border-border bg-surface0"
          >
            <button
              onClick={() => setOpenId(isOpen ? null : inc.id)}
              className="w-full text-left px-3 py-2 flex items-center justify-between hover:bg-surface1"
            >
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-semibold text-card-foreground truncate">
                  {inc.createdAt}
                </div>
                <div className="text-[11px] text-muted-foreground truncate">
                  {inc.summary}
                </div>
              </div>
              <div className="text-[10px] text-muted-foreground ml-3 shrink-0">
                {(inc.size / 1024).toFixed(1)} KB
              </div>
            </button>
            {isOpen && markdown !== undefined ? (
              <pre className="px-3 py-2 text-[11px] text-card-foreground overflow-auto max-h-96 whitespace-pre-wrap border-t border-border">
                {markdown}
              </pre>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
