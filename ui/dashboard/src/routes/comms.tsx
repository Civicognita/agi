/**
 * Communications page — /system/comms
 *
 * Displays a persistent log of all inbound/outbound messages crossing the channel gateway.
 * Includes channel filter tabs, direction filter, and paginated message list.
 */

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button.js";
import { Badge } from "@/components/ui/badge.js";
import { fetchCommsLog } from "@/api.js";
import type { CommsLogEntry } from "@/types.js";

const CHANNELS = ["All", "gmail", "telegram", "discord", "signal", "whatsapp"] as const;
const DIRECTIONS = ["All", "inbound", "outbound"] as const;
const PAGE_SIZE = 50;

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function channelColor(channel: string): string {
  switch (channel.toLowerCase()) {
    case "gmail": return "bg-blue";
    case "telegram": return "bg-sky";
    case "discord": return "bg-lavender";
    case "signal": return "bg-green";
    case "whatsapp": return "bg-teal";
    default: return "bg-overlay0";
  }
}

export default function CommsPage() {
  const [entries, setEntries] = useState<CommsLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [channel, setChannel] = useState<string>("All");
  const [direction, setDirection] = useState<string>("All");
  const [offset, setOffset] = useState(0);

  const loadEntries = useCallback(async (ch: string, dir: string, off: number) => {
    setLoading(true);
    try {
      const result = await fetchCommsLog({
        channel: ch === "All" ? undefined : ch,
        direction: dir === "All" ? undefined : dir,
        limit: PAGE_SIZE,
        offset: off,
      });
      setEntries(result.entries);
      setTotal(result.total);
    } catch {
      // Silently handle — page shows empty state
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadEntries(channel, direction, offset);
  }, [channel, direction, offset, loadEntries]);

  const hasMore = offset + PAGE_SIZE < total;

  return (
    <div className="space-y-4">
      {/* Channel filter tabs */}
      <div className="flex gap-1 flex-wrap">
        {CHANNELS.map((ch) => (
          <button
            key={ch}
            onClick={() => { setChannel(ch); setOffset(0); }}
            className={cn(
              "px-3 py-2 md:py-1 rounded-lg text-[12px] border-none cursor-pointer transition-colors",
              channel === ch
                ? "bg-primary text-primary-foreground font-semibold"
                : "bg-secondary text-foreground hover:bg-secondary/80",
            )}
          >
            {ch === "All" ? "All Channels" : ch.charAt(0).toUpperCase() + ch.slice(1)}
          </button>
        ))}
      </div>

      {/* Direction filter */}
      <div className="flex gap-1">
        {DIRECTIONS.map((dir) => (
          <button
            key={dir}
            onClick={() => { setDirection(dir); setOffset(0); }}
            className={cn(
              "px-3 py-2 md:py-1 rounded-lg text-[12px] border-none cursor-pointer transition-colors",
              direction === dir
                ? "bg-primary text-primary-foreground font-semibold"
                : "bg-secondary text-foreground hover:bg-secondary/80",
            )}
          >
            {dir === "All" ? "All" : dir.charAt(0).toUpperCase() + dir.slice(1)}
          </button>
        ))}
        <span className="text-[12px] text-muted-foreground ml-2 self-center">
          {total} message{total !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Message list */}
      <div className="overflow-x-auto -mx-3 px-3">
      <div className="min-w-[600px]">
      <div className="border border-border rounded-xl overflow-hidden">
        {/* Table header */}
        <div className="grid grid-cols-[100px_32px_80px_1fr_2fr] gap-2 px-3 py-2 bg-secondary text-[11px] text-muted-foreground font-semibold uppercase tracking-wider">
          <span>Time</span>
          <span></span>
          <span>Channel</span>
          <span>Sender</span>
          <span>Content</span>
        </div>

        {loading && entries.length === 0 ? (
          <div className="text-center text-[13px] text-muted-foreground py-12">
            Loading...
          </div>
        ) : entries.length === 0 ? (
          <div className="text-center text-[13px] text-muted-foreground py-12">
            No messages found
          </div>
        ) : (
          entries.map((entry) => (
            <div
              key={entry.id}
              className="grid grid-cols-[100px_32px_80px_1fr_2fr] gap-2 px-3 py-2 border-b border-border text-[12px] hover:bg-secondary/30 transition-colors items-center"
            >
              <span className="text-muted-foreground whitespace-nowrap">
                {formatTimestamp(entry.createdAt)}
              </span>
              <span className="text-center">
                {entry.direction === "inbound" ? (
                  <span title="Inbound" className="text-green">&#8594;</span>
                ) : (
                  <span title="Outbound" className="text-blue">&#8592;</span>
                )}
              </span>
              <Badge className={cn("text-[10px] text-background", channelColor(entry.channel))}>
                {entry.channel}
              </Badge>
              <span className="text-foreground truncate">
                {entry.senderName ?? entry.senderId}
              </span>
              <span className="text-foreground truncate">
                {entry.subject ? <span className="font-medium mr-1">{entry.subject}:</span> : null}
                {entry.preview}
              </span>
            </div>
          ))
        )}
      </div>
      </div>
      </div>

      {/* Pagination */}
      {(offset > 0 || hasMore) && (
        <div className="flex gap-2 justify-center">
          <Button
            variant="outline"
            size="sm"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
          >
            Previous
          </Button>
          <span className="text-[12px] text-muted-foreground self-center">
            {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={!hasMore}
            onClick={() => setOffset(offset + PAGE_SIZE)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
