/**
 * CommsOverview — stats dashboard + recent messages for the Communications Overview tab.
 */

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { fetchCommsStats, fetchCommsLog } from "@/api.js";
import { SourceChip } from "@/components/InboxView.js";
import type { CommsStats, CommsLogEntry } from "@/types.js";

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function CommsOverview() {
  const [stats, setStats] = useState<CommsStats | null>(null);
  const [recent, setRecent] = useState<CommsLogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, r] = await Promise.all([
        fetchCommsStats(),
        fetchCommsLog({ limit: 20 }),
      ]);
      setStats(s);
      setRecent(r.entries);
    } catch {
      // empty state on error
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-[13px] text-muted-foreground">
        Loading…
      </div>
    );
  }

  const channelEntries = stats
    ? Object.entries(stats.byChannel).sort((a, b) => b[1].today - a[1].today)
    : [];

  const inboundToday = recent.filter((e) => e.direction === "inbound").length;
  const outboundToday = recent.filter((e) => e.direction === "outbound").length;

  return (
    <div className="space-y-5">
      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
        <div className="rounded-xl border border-border bg-card p-3.5">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-1.5">Today</div>
          <div className="text-[24px] font-bold text-foreground leading-none">{stats?.todayTotal ?? 0}</div>
          <div className="text-[10.5px] text-muted-foreground mt-1 flex items-center gap-2">
            <span className="text-sky-400">{inboundToday} in</span>
            <span className="text-muted-foreground/40">·</span>
            <span className="text-violet-400">{outboundToday} out</span>
          </div>
        </div>
        {channelEntries.map(([ch, counts]) => (
          <div key={ch} className="rounded-xl border border-border bg-card p-3.5">
            <div className="flex items-center gap-1.5 mb-1.5">
              <SourceChip channel={ch} />
              <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground capitalize">{ch}</span>
            </div>
            <div className="text-[24px] font-bold text-foreground leading-none">{counts.today}</div>
            <div className="text-[10.5px] text-muted-foreground mt-1">{counts.total} total</div>
          </div>
        ))}
      </div>

      {/* Recent messages */}
      <div>
        <div className="text-[10.5px] text-muted-foreground font-semibold uppercase tracking-wider mb-2 px-1">
          Recent Messages
        </div>
        {recent.length === 0 ? (
          <div className="text-[13px] text-muted-foreground py-6 text-center">No messages yet</div>
        ) : (
          <div className="rounded-xl border border-border overflow-hidden">
            {recent.map((entry, i) => (
              <div
                key={entry.id}
                className={cn(
                  "flex gap-3 items-start px-3.5 py-2.5",
                  i !== 0 && "border-t border-border/60",
                  entry.direction === "outbound" ? "bg-primary/5" : "bg-transparent",
                )}
              >
                {/* Time */}
                <div className="shrink-0 text-[10.5px] font-mono text-muted-foreground pt-0.5 w-[44px] text-right">
                  {formatTimestamp(entry.createdAt)}
                </div>

                {/* Source chip */}
                <SourceChip channel={entry.channel} className="shrink-0 mt-0.5" />

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <span className={cn(
                    "text-[12.5px] font-semibold mr-1.5",
                    entry.direction === "outbound" ? "text-amber-400" : "text-foreground",
                  )}>
                    {entry.direction === "outbound" ? "Aion" : (entry.senderName ?? entry.senderId)}
                  </span>
                  {entry.subject !== null && (
                    <span className="text-[12px] font-medium text-foreground mr-1">{entry.subject}:</span>
                  )}
                  <span className="text-[12px] text-foreground/70 break-words">
                    {entry.preview}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
