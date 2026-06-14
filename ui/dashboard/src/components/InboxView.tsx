/**
 * InboxView — thread-card list for the unified communications inbox.
 *
 * Groups CommsLogEntry items into pseudo-threads by senderId+channel,
 * showing the most recent message per group as a thread card.
 * Matches the Aionima Channel design (inbox.jsx artboard).
 */

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import type { CommsLogEntry } from "@/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

// ---------------------------------------------------------------------------
// Source chip — color-coded badge with branded icon per channel
// ---------------------------------------------------------------------------

const SOURCE_STYLE: Record<string, string> = {
  discord:  "bg-indigo-500/15 text-indigo-400 border-indigo-500/30",
  gmail:    "bg-red-500/15 text-red-400 border-red-500/30",
  email:    "bg-red-500/15 text-red-400 border-red-500/30",
  telegram: "bg-sky-500/15 text-sky-400 border-sky-500/30",
  signal:   "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  whatsapp: "bg-green-500/15 text-green-400 border-green-500/30",
  sms:      "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
};

function SourceIcon({ channel }: { channel: string }) {
  switch (channel) {
    case "discord":
      return (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M19.3 5.4a18 18 0 0 0-4.5-1.4l-.2.4a16.4 16.4 0 0 0-5.2 0 9 9 0 0 0-.2-.4 18 18 0 0 0-4.5 1.4A19 19 0 0 0 1.5 16a18 18 0 0 0 5.5 2.8l.6-1a13 13 0 0 1-2-.9l.5-.4a13 13 0 0 0 11 0l.5.4a13 13 0 0 1-2 1l.6 1A18 18 0 0 0 22.5 16a19 19 0 0 0-3.2-10.6zM8.5 13.7c-1 0-1.8-.9-1.8-2s.9-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2zm7 0c-1 0-1.8-.9-1.8-2s.9-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2z"/>
        </svg>
      );
    case "gmail":
    case "email":
      return (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>
        </svg>
      );
    case "telegram":
      return (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m21 4-9 10-4-2L21 4l-4 16-5-5"/>
        </svg>
      );
    case "signal":
      return (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3 4 6v6c0 5 3.5 8.5 8 9 4.5-.5 8-4 8-9V6z"/>
        </svg>
      );
    case "whatsapp":
    case "sms":
      return (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3-8.6A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.6a2 2 0 0 1-.4 2.1L7.9 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.8.3 1.7.5 2.6.6a2 2 0 0 1 1.7 2z"/>
        </svg>
      );
    default:
      return <span className="text-[9px] font-mono font-bold">{channel.slice(0, 2).toUpperCase()}</span>;
  }
}

export function SourceChip({ channel, className }: { channel: string; className?: string }) {
  const style = SOURCE_STYLE[channel] ?? "bg-violet-500/15 text-violet-400 border-violet-500/30";
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded border shrink-0",
        "w-[22px] h-[18px]",
        style,
        className,
      )}
      title={channel}
    >
      <SourceIcon channel={channel} />
    </span>
  );
}

// ---------------------------------------------------------------------------
// Thread grouping — deduplicate by senderId+channel, keep latest
// ---------------------------------------------------------------------------

export interface ThreadEntry {
  id: string;
  channel: string;
  senderId: string;
  senderName: string | null;
  subject: string | null;
  preview: string;
  latestAt: string;
  count: number;
  direction: "inbound" | "outbound";
  hasOutbound: boolean;
}

function groupAsThreads(entries: CommsLogEntry[]): ThreadEntry[] {
  const sorted = [...entries].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const seen = new Map<string, ThreadEntry>();
  const order: string[] = [];

  for (const e of sorted) {
    const key = `${e.channel}:${e.senderId}`;
    const existing = seen.get(key);
    if (existing) {
      existing.count++;
      if (e.direction === "outbound") existing.hasOutbound = true;
    } else {
      const t: ThreadEntry = {
        id: e.id,
        channel: e.channel,
        senderId: e.senderId,
        senderName: e.senderName,
        subject: e.subject,
        preview: e.preview,
        latestAt: e.createdAt,
        count: 1,
        direction: e.direction,
        hasOutbound: e.direction === "outbound",
      };
      seen.set(key, t);
      order.push(key);
    }
  }

  return order.map((k) => seen.get(k)!);
}

// ---------------------------------------------------------------------------
// ThreadCard
// ---------------------------------------------------------------------------

function ThreadCard({ thread, onSelect }: { thread: ThreadEntry; onSelect?: (t: ThreadEntry) => void }) {
  const displayName = thread.senderName ?? thread.senderId;
  const title = thread.subject ?? thread.preview.slice(0, 80);
  const isInbound = thread.direction === "inbound";

  return (
    <div
      data-testid="thread-card"
      className="px-4 py-3 border-b border-border/60 cursor-pointer transition-colors hover:bg-secondary/30 group"
      onClick={() => onSelect?.(thread)}
    >
      {/* Row 1: source chip · channel · message count · time */}
      <div className="flex items-center gap-1.5 mb-1.5 min-w-0">
        <SourceChip channel={thread.channel} />
        <span className="text-[11px] font-mono text-muted-foreground truncate flex-1 min-w-0">
          {thread.channel}
        </span>
        {thread.count > 1 && (
          <span className="text-[10px] font-mono text-muted-foreground/60 shrink-0">{thread.count}</span>
        )}
        <span className="text-[10.5px] font-mono text-muted-foreground shrink-0">
          {relTime(thread.latestAt)}
        </span>
      </div>

      {/* Row 2: sender */}
      <div className="flex items-center gap-1.5 mb-1 min-w-0">
        <span className="text-[12px] font-medium text-foreground truncate min-w-0 flex-1">
          {displayName}
        </span>
        {!isInbound && (
          <span className="text-[10.5px] text-muted-foreground shrink-0">← Aion</span>
        )}
        {thread.hasOutbound && isInbound && (
          <span className="text-[10.5px] text-violet-400/70 shrink-0">draft</span>
        )}
      </div>

      {/* Row 3: title */}
      <div className="text-[13px] font-semibold text-foreground leading-snug mb-1.5 line-clamp-1">
        {title}
      </div>

      {/* Row 4: AI-style preview */}
      <div className="flex items-start gap-1.5">
        <span className="text-muted-foreground/60 text-[10px] shrink-0 mt-0.5 select-none">✦</span>
        <span className="text-[11.5px] text-muted-foreground leading-relaxed line-clamp-2">
          {thread.preview}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// InboxView — exported component
// ---------------------------------------------------------------------------

export interface InboxViewProps {
  entries: CommsLogEntry[];
  loading: boolean;
  emptyText?: string;
  onSelect?: (thread: ThreadEntry) => void;
}

export function InboxView({ entries, loading, emptyText, onSelect }: InboxViewProps) {
  const threads = useMemo(() => groupAsThreads(entries), [entries]);

  if (loading && entries.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-[13px] text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (threads.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-[13px] text-muted-foreground">
        {emptyText ?? "No messages on this day"}
      </div>
    );
  }

  return (
    <div className="flex flex-col divide-y divide-border/0">
      {/* Compact header */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border/60 bg-secondary/20">
        <span className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
          {threads.length} thread{threads.length !== 1 ? "s" : ""}
        </span>
        <span className="flex-1" />
        <span className="text-[10.5px] font-mono text-muted-foreground/60">
          {threads.filter((t) => t.direction === "inbound").length} inbound ·{" "}
          {threads.filter((t) => t.direction === "outbound" || t.hasOutbound).length} with reply
        </span>
      </div>
      {threads.map((t) => (
        <ThreadCard key={t.id} thread={t} onSelect={onSelect} />
      ))}
    </div>
  );
}
