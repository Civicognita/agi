/**
 * Logs — Real-time log stream viewer.
 *
 * Connects via WebSocket (log:subscribe / log:entry) to stream structured
 * log entries from the gateway. Supports level/component filtering,
 * auto-scroll, pause/resume, and clear.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import type { LogEntry } from "../types.js";

export interface LogsProps {
  entries: LogEntry[];
  connected: boolean;
  paused: boolean;
  onClear: () => void;
  onTogglePause: () => void;
  theme?: "light" | "dark";
}

const LEVELS = ["debug", "info", "warn", "error"] as const;

const levelClass: Record<string, string> = {
  debug: "text-muted-foreground",
  info: "text-blue",
  warn: "text-yellow",
  error: "text-red",
};

export function Logs({ entries, connected, paused, onClear, onTogglePause }: LogsProps) {
  const [levelFilter, setLevelFilter] = useState<Set<string>>(new Set(LEVELS));
  const [componentFilter, setComponentFilter] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);

  const listRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const toggleLevel = useCallback((level: string) => {
    setLevelFilter((prev) => {
      const next = new Set(prev);
      if (next.has(level)) {
        next.delete(level);
      } else {
        next.add(level);
      }
      return next;
    });
  }, []);

  const filteredEntries = useMemo(() => {
    const compLower = componentFilter.toLowerCase();
    return entries.filter((e) => {
      if (!levelFilter.has(e.level)) return false;
      if (compLower && !e.component.toLowerCase().includes(compLower)) return false;
      return true;
    });
  }, [entries, levelFilter, componentFilter]);

  // Track scroll position for auto-scroll
  const handleScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    setAutoScroll(atBottom);
  }, []);

  // Auto-scroll on new entries
  useEffect(() => {
    if (autoScroll) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [filteredEntries, autoScroll]);

  const formatTime = (ts: string) => {
    try {
      return new Date(ts).toLocaleTimeString(undefined, { hour12: false, fractionalSecondDigits: 3 });
    } catch {
      return ts;
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border bg-card flex-wrap">
        {/* Level checkboxes */}
        <div className="flex items-center gap-2">
          {LEVELS.map((lvl) => (
            <label
              key={lvl}
              className={cn(
                "flex items-center gap-1 cursor-pointer text-xs font-semibold select-none transition-opacity",
                levelFilter.has(lvl) ? levelClass[lvl] : "text-muted-foreground opacity-50",
              )}
            >
              <input
                type="checkbox"
                checked={levelFilter.has(lvl)}
                onChange={() => toggleLevel(lvl)}
                className="accent-current"
              />
              {lvl.toUpperCase()}
            </label>
          ))}
        </div>

        {/* Component filter */}
        <Input
          type="text"
          value={componentFilter}
          onChange={(e) => setComponentFilter(e.target.value)}
          placeholder="Filter component..."
          className="w-40 h-7 text-xs font-mono"
        />

        <div className="flex-1" />

        {/* Status indicator */}
        <Badge
          variant="outline"
          className={cn(
            "text-[11px]",
            connected
              ? paused
                ? "border-yellow text-yellow"
                : "border-green text-green"
              : "border-red text-red",
          )}
        >
          {connected ? (paused ? "Paused" : "Live") : "Disconnected"}
        </Badge>

        {/* Entry count */}
        <span className="text-[11px] text-muted-foreground">
          {filteredEntries.length} / {entries.length}
        </span>

        {/* Pause/Resume */}
        <Button
          size="xs"
          variant={paused ? "secondary" : "outline"}
          onClick={onTogglePause}
          className={cn(paused && "bg-yellow text-background hover:bg-yellow/90")}
        >
          {paused ? "Resume" : "Pause"}
        </Button>

        {/* Clear */}
        <Button size="xs" variant="outline" onClick={onClear}>
          Clear
        </Button>
      </div>

      {/* Log entries */}
      <div
        ref={listRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-2 font-mono text-xs leading-relaxed bg-background"
      >
        {filteredEntries.length === 0 && (
          <div className="py-12 text-center text-muted-foreground text-sm">
            {entries.length === 0 ? "Waiting for log entries..." : "No entries match current filters"}
          </div>
        )}

        {filteredEntries.map((entry, i) => (
          <div
            key={`${entry.timestamp}-${String(i)}`}
            className="whitespace-pre-wrap break-all py-px"
          >
            <span className="text-muted-foreground">{formatTime(entry.timestamp)}</span>
            {" "}
            <span
              className={cn(
                levelClass[entry.level],
                (entry.level === "error" || entry.level === "warn") && "font-bold",
              )}
            >
              [{entry.level.toUpperCase().padEnd(5)}]
            </span>
            {" "}
            <span className="text-blue">[{entry.component}]</span>
            {" "}
            <span className="text-foreground">{entry.message}</span>
          </div>
        ))}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}
