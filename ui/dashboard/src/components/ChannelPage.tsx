/**
 * ChannelPage — reusable per-channel page component.
 *
 * Shows channel status, Start/Stop/Restart controls, and a filtered message log.
 */

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button.js";
import { Badge } from "@/components/ui/badge.js";
import { fetchChannelDetail, startChannel, stopChannel, restartChannel, fetchCommsLog } from "@/api.js";
import type { ChannelDetail, CommsLogEntry } from "@/types.js";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ChannelPageProps {
  channelId: string;
  channelName: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PAGE_SIZE = 50;
const DIRECTIONS = ["All", "inbound", "outbound"] as const;

function statusBadgeClass(status: ChannelDetail["status"]): string {
  switch (status) {
    case "running": return "bg-green";
    case "starting":
    case "stopping": return "bg-yellow";
    case "stopped": return "bg-overlay0";
    case "error": return "bg-red";
    case "registered": return "bg-blue";
    default: return "bg-overlay0";
  }
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    d.toLocaleDateString([], { month: "short", day: "numeric" }) +
    " " +
    d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ChannelPage({ channelId, channelName }: ChannelPageProps) {
  const [detail, setDetail] = useState<ChannelDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [entries, setEntries] = useState<CommsLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [logLoading, setLogLoading] = useState(true);
  const [direction, setDirection] = useState<string>("All");
  const [offset, setOffset] = useState(0);

  // -------------------------------------------------------------------------
  // Load channel detail
  // -------------------------------------------------------------------------

  const loadDetail = useCallback(() => {
    fetchChannelDetail(channelId)
      .then(setDetail)
      .catch((err: unknown) => setDetailError(err instanceof Error ? err.message : String(err)));
  }, [channelId]);

  useEffect(() => { loadDetail(); }, [loadDetail]);

  // -------------------------------------------------------------------------
  // Load message log
  // -------------------------------------------------------------------------

  const loadLog = useCallback(async (dir: string, off: number) => {
    setLogLoading(true);
    try {
      const result = await fetchCommsLog({
        channel: channelId,
        direction: dir === "All" ? undefined : dir,
        limit: PAGE_SIZE,
        offset: off,
      });
      setEntries(result.entries);
      setTotal(result.total);
    } catch {
      // Silently handle — page shows empty state
    } finally {
      setLogLoading(false);
    }
  }, [channelId]);

  useEffect(() => { void loadLog(direction, offset); }, [direction, offset, loadLog]);

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  async function handleAction(action: "start" | "stop" | "restart") {
    setBusy(true);
    try {
      if (action === "start") await startChannel(channelId);
      else if (action === "stop") await stopChannel(channelId);
      else await restartChannel(channelId);
      loadDetail();
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const hasMore = offset + PAGE_SIZE < total;

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* Status header */}
      <div className="rounded-xl bg-card border border-border p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            {detail ? (
              <Badge className={cn("text-[10px] text-background capitalize", statusBadgeClass(detail.status))}>
                {detail.status}
              </Badge>
            ) : detailError ? (
              <Badge className="text-[10px] text-background bg-overlay0">unknown</Badge>
            ) : (
              <Badge className="text-[10px] text-background bg-overlay0">loading...</Badge>
            )}
            <span className="text-[13px] font-semibold text-foreground">{channelName}</span>
          </div>
          <div className="flex gap-1.5">
            {detail?.status === "stopped" || detail?.status === "registered" || detail?.status === "error" ? (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void handleAction("start")}
                className="text-[11px] h-7"
              >
                Start
              </Button>
            ) : detail?.status === "running" ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void handleAction("restart")}
                  className="text-[11px] h-7"
                >
                  Restart
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void handleAction("stop")}
                  className="text-[11px] h-7"
                >
                  Stop
                </Button>
              </>
            ) : null}
          </div>
        </div>

        {/* Error message */}
        {detail?.error && (
          <div className="text-[11px] text-red mt-1">Error: {detail.error}</div>
        )}
        {detailError && !detail && (
          <div className="text-[11px] text-muted-foreground mt-1">
            Channel not registered (no plugin loaded for {channelName})
          </div>
        )}

        {/* Config summary — capabilities */}
        {detail?.capabilities && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {Object.entries(detail.capabilities).map(([cap, enabled]) => (
              <span
                key={cap}
                className={cn(
                  "text-[10px] px-1.5 py-0.5 rounded font-medium capitalize",
                  enabled
                    ? "bg-green/15 text-green"
                    : "bg-overlay0/30 text-muted-foreground line-through",
                )}
              >
                {cap}
              </span>
            ))}
          </div>
        )}

        {/* Registered at */}
        {detail?.registeredAt && (
          <div className="text-[10px] text-muted-foreground mt-2">
            Registered {formatTimestamp(detail.registeredAt)}
          </div>
        )}
      </div>

      {/* Message log */}
      <div className="space-y-3">
        {/* Direction filter */}
        <div className="flex gap-1 items-center">
          {DIRECTIONS.map((dir) => (
            <button
              key={dir}
              onClick={() => { setDirection(dir); setOffset(0); }}
              className={cn(
                "px-3 py-1 rounded-lg text-[12px] border-none cursor-pointer transition-colors",
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

        {/* Table */}
        <div className="border border-border rounded-xl overflow-hidden">
          <div className="grid grid-cols-[100px_32px_1fr_2fr] gap-2 px-3 py-2 bg-secondary text-[11px] text-muted-foreground font-semibold uppercase tracking-wider">
            <span>Time</span>
            <span></span>
            <span>Sender</span>
            <span>Content</span>
          </div>

          {logLoading && entries.length === 0 ? (
            <div className="text-center text-[13px] text-muted-foreground py-12">Loading...</div>
          ) : entries.length === 0 ? (
            <div className="text-center text-[13px] text-muted-foreground py-12">
              No messages found
            </div>
          ) : (
            entries.map((entry) => (
              <div
                key={entry.id}
                className="grid grid-cols-[100px_32px_1fr_2fr] gap-2 px-3 py-2 border-b border-border text-[12px] hover:bg-secondary/30 transition-colors items-center"
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
    </div>
  );
}
