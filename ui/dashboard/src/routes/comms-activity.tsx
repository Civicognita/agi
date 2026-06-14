/**
 * Activity Feed — /comms/activity
 *
 * Structured agent event feed matching the Aionima Channel design (activity.jsx).
 * Events are sourced from outbound comms log entries (kind="respond") today;
 * future pipeline hooks will add tool/memory/route/escalate kinds.
 */

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { PageScroll } from "@/components/PageScroll.js";
import { DayNavigator } from "@/components/DayNavigator.js";
import { SourceChip } from "@/components/InboxView.js";
import { useInspector } from "@/lib/inspector-context.js";
import { fetchAgentEvents } from "@/api.js";
import type { AgentEventEntry, AgentEventKind } from "@/types.js";

// ---------------------------------------------------------------------------
// KindBadge — maps AgentEventKind to the design-system mode chip styles
// ---------------------------------------------------------------------------

const KIND_BADGE: Record<AgentEventKind, { label: string; cls: string }> = {
  respond:  { label: "respond",  cls: "bg-violet-500/10 text-violet-600 border-violet-500/25 dark:text-violet-300" },
  tool:     { label: "tool",     cls: "bg-sky-500/10 text-sky-600 border-sky-500/25 dark:text-sky-300" },
  memory:   { label: "memory",   cls: "bg-violet-500/10 text-violet-600 border-violet-500/25 dark:text-violet-300" },
  route:    { label: "route",    cls: "bg-sky-500/10 text-sky-600 border-sky-500/25 dark:text-sky-300" },
  escalate: { label: "escalate", cls: "bg-amber-500/10 text-amber-600 border-amber-500/25 dark:text-amber-300" },
  approval: { label: "approval", cls: "bg-rose-500/10 text-rose-600 border-rose-500/25 dark:text-rose-300" },
  mod:      { label: "mod",      cls: "bg-amber-500/10 text-amber-600 border-amber-500/25 dark:text-amber-300" },
  skip:     { label: "skip",     cls: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20 dark:text-zinc-400" },
};

function KindBadge({ kind }: { kind: AgentEventKind }) {
  const m = KIND_BADGE[kind];
  return (
    <span
      className={cn(
        "inline-flex items-center h-[18px] rounded-full border px-1.5 font-semibold tracking-wide shrink-0",
        "text-[9.5px] uppercase",
        m.cls,
      )}
    >
      {m.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Kind filter
// ---------------------------------------------------------------------------

const KIND_FILTERS: { id: AgentEventKind | "all"; label: string }[] = [
  { id: "all",      label: "All" },
  { id: "respond",  label: "Respond" },
  { id: "tool",     label: "Tool" },
  { id: "memory",   label: "Memory" },
  { id: "route",    label: "Route" },
  { id: "escalate", label: "Escalate" },
  { id: "approval", label: "Approval" },
  { id: "mod",      label: "Mod" },
  { id: "skip",     label: "Skip" },
];

// ---------------------------------------------------------------------------
// Event row
// ---------------------------------------------------------------------------

function formatTs(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function EventRow({ event, onSelect }: { event: AgentEventEntry; onSelect?: (e: AgentEventEntry) => void }) {
  return (
    <div
      data-testid="event-row"
      className="grid grid-cols-[80px_auto_1fr_auto] gap-2.5 px-4 py-2.5 border-b border-border/60 hover:bg-secondary/20 transition-colors cursor-pointer group"
      onClick={() => onSelect?.(event)}
    >
      {/* Timestamp */}
      <div className="text-[10.5px] font-mono text-muted-foreground/60 pt-0.5 tabular-nums">
        {formatTs(event.ts)}
      </div>

      {/* Agent avatar */}
      <div className="w-6 h-6 rounded-full shrink-0 flex items-center justify-center text-[10px] font-semibold mt-0.5 bg-gradient-to-br from-amber-400 to-amber-600 text-zinc-950">
        A
      </div>

      {/* Main content */}
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap mb-1">
          <span className="text-[12.5px] font-semibold text-amber-500 dark:text-amber-400">
            {event.agentLabel}
          </span>
          <KindBadge kind={event.kind} />
          <SourceChip channel={event.channel} />
          <span className="text-[11px] font-mono text-muted-foreground/60">→</span>
          <span className="text-[11px] font-mono text-foreground/80 truncate max-w-[160px]">
            {event.target}
          </span>
        </div>
        <p className="text-[12px] text-muted-foreground leading-relaxed line-clamp-2">
          {event.summary}
        </p>
      </div>

      {/* Right: confidence + latency */}
      <div className="flex flex-col items-end gap-1 text-[10px] font-mono text-muted-foreground/60 shrink-0">
        {event.confidence !== undefined && (
          <div className="flex items-center gap-1.5">
            <div className="aio-conf w-[36px] h-[4px]">
              <span style={{ width: `${Math.round(event.confidence * 100)}%` }} />
            </div>
            <span>{Math.round(event.confidence * 100)}%</span>
          </div>
        )}
        {event.latencyMs !== undefined && (
          <span>
            {event.latencyMs >= 1000
              ? `${(event.latencyMs / 1000).toFixed(1)}s`
              : `${event.latencyMs}ms`}
          </span>
        )}
        {event.model !== undefined && (
          <span className="text-muted-foreground/40 truncate max-w-[80px]">{event.model}</span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ActivityFeedView
// ---------------------------------------------------------------------------

interface ActivityFeedViewProps {
  events: AgentEventEntry[];
  loading: boolean;
  kindFilter: AgentEventKind | "all";
  total: number;
  onSelect?: (event: AgentEventEntry) => void;
}

function ActivityFeedView({ events, loading, kindFilter, total, onSelect }: ActivityFeedViewProps) {
  const filtered = kindFilter === "all" ? events : events.filter((e) => e.kind === kindFilter);

  if (loading && events.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-[13px] text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (filtered.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-2">
        <span className="text-muted-foreground/40 text-[28px]">✦</span>
        <p className="text-[13px] text-muted-foreground">No activity on this day</p>
        <p className="text-[11px] text-muted-foreground/50">
          Activity is recorded when Aion sends a reply via any channel
        </p>
      </div>
    );
  }

  return (
    <>
      {/* KPI strip */}
      <div className="grid grid-cols-3 border-b border-border/60">
        <div className="px-4 py-2.5 border-r border-border/60">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1">
            Events
          </div>
          <span className="text-[18px] font-semibold tracking-tight text-foreground">{total}</span>
          {kindFilter !== "all" && (
            <span className="text-[11px] text-muted-foreground/60 ml-2">showing {filtered.length}</span>
          )}
        </div>
        <div className="px-4 py-2.5 border-r border-border/60">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1">
            Respond
          </div>
          <span className="text-[18px] font-semibold tracking-tight text-violet-500 dark:text-violet-400">
            {events.filter((e) => e.kind === "respond").length}
          </span>
        </div>
        <div className="px-4 py-2.5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1">
            Channels
          </div>
          <span className="text-[18px] font-semibold tracking-tight text-foreground">
            {new Set(events.map((e) => e.channel)).size}
          </span>
        </div>
      </div>

      {/* Event rows */}
      <div className="flex flex-col">
        {filtered.map((event) => (
          <EventRow key={event.id} event={event} onSelect={onSelect} />
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function CommsActivityPage() {
  const [day, setDay] = useState(todayIso());
  const [events, setEvents] = useState<AgentEventEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [kindFilter, setKindFilter] = useState<AgentEventKind | "all">("all");
  const { inspect } = useInspector();

  const handleSelect = useCallback((event: AgentEventEntry) => {
    inspect({ kind: "agent-event", event });
  }, [inspect]);

  const loadDay = useCallback(async (d: string) => {
    setLoading(true);
    try {
      const res = await fetchAgentEvents({ date: d, limit: 200 });
      setEvents(res.events);
      setTotal(res.total);
    } catch {
      setEvents([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadDay(day); }, [day, loadDay]);

  return (
    <PageScroll>
      <div className="flex flex-col min-h-full">
        {/* Page header */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-border/60">
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
          <div>
            <h1 className="text-[15px] font-semibold tracking-tight leading-none">Activity feed</h1>
            <p className="text-[11.5px] text-muted-foreground mt-0.5">
              Agent actions across all channels
            </p>
          </div>
          <div className="flex-1" />
          <DayNavigator day={day} onChange={setDay} />
        </div>

        {/* Kind filter strip */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/60 overflow-x-auto">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 shrink-0 mr-1">
            Kind
          </span>
          {KIND_FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setKindFilter(f.id)}
              className={cn(
                "inline-flex items-center px-2.5 py-0.5 rounded-full border text-[11.5px] font-medium shrink-0 transition-colors",
                kindFilter === f.id
                  ? "bg-violet-500/15 text-violet-600 border-violet-500/30 dark:text-violet-300"
                  : "border-border/60 text-muted-foreground hover:text-foreground hover:border-border",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Feed */}
        <ActivityFeedView
          events={events}
          loading={loading}
          kindFilter={kindFilter}
          total={total}
          onSelect={handleSelect}
        />
      </div>
    </PageScroll>
  );
}
