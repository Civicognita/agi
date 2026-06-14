/**
 * ChannelPage — per-channel conversation history page.
 *
 * s190: Replaced the status-header+table layout with a day-navigated
 * chat-bubble conversation view. Start/Stop/Restart controls moved to
 * Settings — this page is for reading channel history, not managing the bot.
 */

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { cn } from "@/lib/utils";
import { DayNavigator } from "@/components/DayNavigator.js";
import { ConversationView } from "@/components/ConversationView.js";
import { fetchCommsLog, fetchAmbientLog, fetchChannelDetail } from "@/api.js";
import type { ConversationEntry, CommsLogEntry, AmbientLogEntry } from "@/types.js";

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

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function mergeEntries(commsEntries: CommsLogEntry[], ambientEntries: AmbientLogEntry[]): ConversationEntry[] {
  const result: ConversationEntry[] = [];

  for (const e of commsEntries) {
    if (e.direction === "outbound") {
      result.push({ kind: "comms-out", id: e.id, ts: e.createdAt, text: e.preview, channel: e.channel });
    } else {
      result.push({ kind: "comms-in", id: e.id, ts: e.createdAt, senderName: e.senderName, text: e.preview, channel: e.channel });
    }
  }

  const commsInTimes = result.filter((e) => e.kind === "comms-in").map((e) => new Date(e.ts).getTime());
  for (const a of ambientEntries) {
    const t = new Date(a.ts).getTime();
    const isDup = commsInTimes.some((ct) => Math.abs(ct - t) < 2000);
    if (!isDup) {
      result.push({ kind: "ambient", ts: a.ts, authorId: a.authorId, displayName: a.displayName, text: a.text });
    }
  }

  return result.sort((a, b) => a.ts.localeCompare(b.ts));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ChannelPage({ channelId, channelName }: ChannelPageProps) {
  const [day, setDay] = useState(todayIso());
  const [entries, setEntries] = useState<ConversationEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [channelStatus, setChannelStatus] = useState<string | null>(null);

  useEffect(() => {
    fetchChannelDetail(channelId)
      .then((d) => setChannelStatus(d.status))
      .catch(() => setChannelStatus("not_found"));
  }, [channelId]);

  const loadDay = useCallback(async (d: string) => {
    setLoading(true);
    try {
      const [comms, ambient] = await Promise.all([
        fetchCommsLog({ channel: channelId, date: d, limit: 200 }),
        fetchAmbientLog({ channelId, date: d, limit: 200 }),
      ]);
      setEntries(mergeEntries(comms.entries, ambient.entries));
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [channelId]);

  useEffect(() => { void loadDay(day); }, [day, loadDay]);

  const notConnected = !loading && entries.length === 0 && channelStatus !== "running";

  return (
    <div className="space-y-4">
      {/* Channel header */}
      <div className="flex items-center justify-between">
        <h2 className={cn("text-[15px] font-semibold text-foreground capitalize")}>{channelName}</h2>
        <DayNavigator date={day} onChange={setDay} />
      </div>

      {/* Conversation or not-configured state */}
      <div className="rounded-xl border border-border min-h-[400px] px-4 py-2">
        {notConnected ? (
          <div className="flex flex-col items-center justify-center h-[360px] gap-3">
            <span className="text-3xl text-muted-foreground/20">⊘</span>
            <p className="text-[13px] font-medium text-foreground">{channelName} is not connected</p>
            <p className="text-[12px] text-muted-foreground text-center max-w-[280px]">
              Connect {channelName} to start receiving messages from your team's{" "}
              {channelName} workspace.
            </p>
            <Link
              to="/settings/channels"
              className="mt-1 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Configure in Settings → Channels
            </Link>
          </div>
        ) : (
          <ConversationView entries={entries} loading={loading} />
        )}
      </div>
    </div>
  );
}
