/**
 * Communications page — /system/comms
 *
 * Inbox-first layout matching the Aionima Channel design:
 * - Overview tab: CommsOverview stats
 * - Inbox tab: thread-card list (InboxView) with day navigator + source filter chips
 */

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { PageScroll } from "@/components/PageScroll.js";
import { DayNavigator } from "@/components/DayNavigator.js";
import { InboxView, SourceChip } from "@/components/InboxView.js";
import type { ThreadEntry } from "@/components/InboxView.js";
import { CommsOverview } from "@/components/CommsOverview.js";
import { useInspector } from "@/lib/inspector-context.js";
import { fetchCommsLog } from "@/api.js";
import type { CommsLogEntry } from "@/types.js";

const SOURCES = [
  { id: "all",      label: "All" },
  { id: "discord",  label: "Discord" },
  { id: "gmail",    label: "Gmail" },
  { id: "telegram", label: "Telegram" },
  { id: "signal",   label: "Signal" },
  { id: "whatsapp", label: "WhatsApp" },
] as const;

type SourceFilter = (typeof SOURCES)[number]["id"];

const SMART_VIEWS = [
  { id: "all",      label: "All" },
  { id: "inbound",  label: "Needs you" },
  { id: "outbound", label: "Drafted" },
] as const;

type SmartView = (typeof SMART_VIEWS)[number]["id"];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function filterEntries(entries: CommsLogEntry[], source: SourceFilter, view: SmartView): CommsLogEntry[] {
  return entries.filter((e) => {
    if (source !== "all" && e.channel !== source) return false;
    if (view === "inbound" && e.direction !== "inbound") return false;
    if (view === "outbound" && e.direction !== "outbound") return false;
    return true;
  });
}

export default function CommsPage() {
  const [tab, setTab] = useState<"overview" | "inbox">("inbox");
  const [source, setSource] = useState<SourceFilter>("all");
  const [view, setView] = useState<SmartView>("all");
  const [day, setDay] = useState(todayIso());
  const [entries, setEntries] = useState<CommsLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const { inspect } = useInspector();

  const handleSelect = useCallback((thread: ThreadEntry) => {
    inspect({ kind: "thread", thread });
  }, [inspect]);

  const loadMessages = useCallback(async (d: string) => {
    setLoading(true);
    try {
      const res = await fetchCommsLog({ limit: 300, date: d });
      setEntries(res.entries);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "inbox") {
      void loadMessages(day);
    }
  }, [tab, day, loadMessages]);

  const displayed = filterEntries(entries, source, view);

  return (
    <PageScroll>
      <div className="space-y-4">
        {/* Main tabs */}
        <div className="flex gap-1">
          {([["overview", "Overview"], ["inbox", "Inbox"]] as const).map(([t, label]) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "px-4 py-1.5 rounded-lg text-[12px] border-none cursor-pointer transition-colors font-medium",
                tab === t
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-foreground hover:bg-secondary/80",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "overview" && <CommsOverview />}

        {tab === "inbox" && (
          <div className="space-y-3">
            {/* Day navigator */}
            <DayNavigator date={day} onChange={setDay} />

            {/* Smart view tabs */}
            <div className="flex gap-1">
              {SMART_VIEWS.map((sv) => (
                <button
                  key={sv.id}
                  onClick={() => setView(sv.id)}
                  className={cn(
                    "px-3 py-1 rounded-lg text-[12px] cursor-pointer transition-colors border",
                    view === sv.id
                      ? "bg-primary/10 text-primary border-primary/25 font-semibold"
                      : "bg-transparent border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60",
                  )}
                >
                  {sv.label}
                </button>
              ))}
            </div>

            {/* Source filter chips */}
            <div className="flex gap-1.5 flex-wrap">
              {SOURCES.map((s) => {
                const active = source === s.id;
                if (s.id === "all") {
                  return (
                    <button
                      key={s.id}
                      onClick={() => setSource(s.id)}
                      className={cn(
                        "px-3 py-1 rounded-lg text-[12px] cursor-pointer transition-colors border",
                        active
                          ? "bg-violet-500/10 text-violet-600 dark:text-violet-300 border-violet-500/25 font-semibold"
                          : "bg-transparent border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60",
                      )}
                    >
                      All sources
                    </button>
                  );
                }
                return (
                  <button
                    key={s.id}
                    onClick={() => setSource(s.id)}
                    className={cn(
                      "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[12px] cursor-pointer transition-colors border",
                      active
                        ? "bg-primary/10 text-primary border-primary/25 font-semibold"
                        : "bg-transparent border-border text-foreground hover:bg-secondary/60",
                    )}
                  >
                    <SourceChip channel={s.id} />
                    <span>{s.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Thread list */}
            <div className="rounded-xl border border-border overflow-hidden min-h-[300px]">
              <InboxView entries={displayed} loading={loading} onSelect={handleSelect} />
            </div>
          </div>
        )}
      </div>
    </PageScroll>
  );
}
