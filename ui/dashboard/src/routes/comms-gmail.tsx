/**
 * /comms/gmail — Dedicated Gmail page.
 *
 * s192: Email-optimized thread list view. Shows email subject, sender,
 * snippet, and timestamp — not a chat-bubble layout. Thread rows expand
 * inline on click to show the full preview.
 */

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { PageScroll } from "@/components/PageScroll.js";
import { DayNavigator } from "@/components/DayNavigator.js";
import { fetchCommsLog } from "@/api.js";
import type { CommsLogEntry } from "@/types.js";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

interface ThreadRowProps {
  entry: CommsLogEntry;
}

function ThreadRow({ entry }: ThreadRowProps) {
  const [expanded, setExpanded] = useState(false);
  const isOutbound = entry.direction === "outbound";
  const sender = isOutbound ? "Aion (sent)" : (entry.senderName ?? entry.senderId);
  const subject = entry.subject ?? "(no subject)";

  return (
    <button
      type="button"
      onClick={() => setExpanded((v) => !v)}
      className={cn(
        "w-full text-left rounded-lg px-3 py-2.5 transition-colors border cursor-pointer",
        isOutbound
          ? "bg-primary/5 border-primary/15 hover:bg-primary/10"
          : "bg-card border-border hover:bg-secondary/50",
      )}
    >
      <div className="flex items-start gap-3">
        {/* Direction indicator */}
        <div className="shrink-0 mt-0.5">
          <span className={cn(
            "text-[10px] font-semibold px-1.5 py-0.5 rounded",
            isOutbound ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground",
          )}>
            {isOutbound ? "SENT" : "IN"}
          </span>
        </div>

        {/* Thread info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[13px] font-semibold text-foreground truncate">{subject}</span>
            <span className="text-[11px] text-muted-foreground shrink-0">{formatTimestamp(entry.createdAt)}</span>
          </div>
          <div className="text-[12px] text-muted-foreground truncate mt-0.5">{sender}</div>
          <div className={cn(
            "text-[12px] text-foreground/70 mt-1",
            expanded ? "whitespace-pre-wrap break-words" : "truncate",
          )}>
            {entry.preview}
          </div>
        </div>
      </div>
    </button>
  );
}

export default function CommsGmailPage() {
  const [day, setDay] = useState(todayIso());
  const [entries, setEntries] = useState<CommsLogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const loadDay = useCallback(async (d: string) => {
    setLoading(true);
    try {
      const result = await fetchCommsLog({ channel: "gmail", date: d, limit: 100 });
      // Sort newest-first for email thread list
      setEntries([...result.entries].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadDay(day); }, [day, loadDay]);

  return (
    <PageScroll>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-foreground">Gmail</h2>
          <DayNavigator date={day} onChange={setDay} />
        </div>

        {/* Thread list */}
        {loading ? (
          <div className="flex items-center justify-center py-12 text-[13px] text-muted-foreground">
            Loading…
          </div>
        ) : entries.length === 0 ? (
          <div className="rounded-xl border border-border py-12 text-center text-[13px] text-muted-foreground">
            No emails on this day
          </div>
        ) : (
          <div className="space-y-1.5">
            {entries.map((entry) => (
              <ThreadRow key={entry.id} entry={entry} />
            ))}
          </div>
        )}
      </div>
    </PageScroll>
  );
}
