/**
 * /comms/discord — Dedicated Discord channel page.
 *
 * s192: Dedicated Discord UX — guild header, text-channel selector,
 * day-navigated ConversationView. Falls back gracefully when Discord
 * isn't connected or guild state isn't available.
 */

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { PageScroll } from "@/components/PageScroll.js";
import { DayNavigator } from "@/components/DayNavigator.js";
import { ConversationView } from "@/components/ConversationView.js";
import { fetchChannelState, fetchCommsLog, fetchAmbientLog, fetchChannelConfig } from "@/api.js";
import { ChannelModeBadge } from "@/components/ChannelModeBadge.js";
import type { DiscordChannelMode } from "@/components/ChannelModeBadge.js";
import type { DiscordGuildDescriptor, ConversationEntry, CommsLogEntry, AmbientLogEntry } from "@/types.js";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function mergeEntries(comms: CommsLogEntry[], ambient: AmbientLogEntry[]): ConversationEntry[] {
  const result: ConversationEntry[] = [];
  for (const e of comms) {
    if (e.direction === "outbound") {
      result.push({ kind: "comms-out", id: e.id, ts: e.createdAt, text: e.preview, channel: e.channel });
    } else {
      result.push({ kind: "comms-in", id: e.id, ts: e.createdAt, senderName: e.senderName, text: e.preview, channel: e.channel });
    }
  }
  const commsInTimes = result.filter((e) => e.kind === "comms-in").map((e) => new Date(e.ts).getTime());
  for (const a of ambient) {
    const t = new Date(a.ts).getTime();
    if (!commsInTimes.some((ct) => Math.abs(ct - t) < 2000)) {
      result.push({ kind: "ambient", ts: a.ts, authorId: a.authorId, displayName: a.displayName, text: a.text });
    }
  }
  return result.sort((a, b) => a.ts.localeCompare(b.ts));
}

export default function CommsDiscordPage() {
  const [guilds, setGuilds] = useState<DiscordGuildDescriptor[]>([]);
  const [connected, setConnected] = useState(false);
  const [day, setDay] = useState(todayIso());
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [entries, setEntries] = useState<ConversationEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [channelModes, setChannelModes] = useState<Record<string, DiscordChannelMode>>({});

  // Load guild state + channel mode config once on mount
  useEffect(() => {
    fetchChannelState("discord")
      .then((state) => {
        setConnected(state.connected);
        setGuilds(state.guilds);
      })
      .catch(() => {});
    fetchChannelConfig("discord")
      .then((cfg) => {
        const modeJson = cfg.config["channelModes"];
        if (modeJson && typeof modeJson === "string") {
          try {
            setChannelModes(JSON.parse(modeJson) as Record<string, DiscordChannelMode>);
          } catch { /* ignore */ }
        } else {
          // Legacy fallback
          const modes: Record<string, DiscordChannelMode> = {};
          const allowed = String(cfg.config["allowedChannelIds"] ?? "").split(",").filter(Boolean);
          const presence = String(cfg.config["presenceChannelIds"] ?? "").split(",").filter(Boolean);
          for (const id of allowed) modes[id] = "respond";
          for (const id of presence) if (!modes[id]) modes[id] = "monitor";
          setChannelModes(modes);
        }
      })
      .catch(() => {});
  }, []);

  // All text channels across all guilds for the channel selector
  const textChannels = guilds.flatMap((g) =>
    g.channels
      .filter((ch) => ch.kind === "text")
      .map((ch) => ({ ...ch, guildId: g.id, guildName: g.name })),
  );

  const loadDay = useCallback(async (d: string, channelId: string | null) => {
    setLoading(true);
    try {
      const [comms, ambient] = await Promise.all([
        fetchCommsLog({ channel: "discord", date: d, limit: 200 }),
        fetchAmbientLog({ channelId: "discord", date: d, limit: 200 }),
      ]);
      // Filter ambient entries by Discord sub-channel roomId when one is selected.
      // roomId for Discord messages is "${guildId}:${channelId}".
      const ambientEntries = channelId !== null
        ? ambient.entries.filter((a) => typeof a.roomId === "string" && a.roomId.endsWith(`:${channelId}`))
        : ambient.entries;
      setEntries(mergeEntries(comms.entries, ambientEntries));
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadDay(day, selectedChannelId); }, [day, selectedChannelId, loadDay]);

  const primaryGuild = guilds[0];

  return (
    <PageScroll>
      <div className="space-y-4">
        {/* Guild header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-[15px] font-semibold text-foreground">
                {primaryGuild?.name ?? "Discord"}
              </h2>
              {guilds.length > 1 && (
                <span className="text-[11px] text-muted-foreground">+{guilds.length - 1} more</span>
              )}
              {/* Show active channel mode badge when a channel is selected */}
              {selectedChannelId !== null && channelModes[selectedChannelId] && (
                <ChannelModeBadge mode={channelModes[selectedChannelId]!} size="sm" />
              )}
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span
                className={cn(
                  "inline-block w-1.5 h-1.5 rounded-full shrink-0",
                  connected ? "bg-emerald-500" : "bg-muted-foreground",
                )}
              />
              <span className="text-[11px] text-muted-foreground">
                {connected ? "Connected" : "Disconnected"}
                {primaryGuild?.memberCount !== undefined && ` · ${primaryGuild.memberCount.toLocaleString()} members`}
              </span>
            </div>
          </div>
          <DayNavigator date={day} onChange={setDay} />
        </div>

        {/* Text channel selector with mode badges */}
        {textChannels.length > 0 && (
          <div className="flex gap-1.5 flex-wrap">
            <button
              onClick={() => setSelectedChannelId(null)}
              className={cn(
                "px-3 py-1 rounded-lg text-[12px] border cursor-pointer transition-colors",
                selectedChannelId === null
                  ? "bg-violet-500/10 text-violet-600 dark:text-violet-300 border-violet-500/25 font-semibold"
                  : "bg-transparent border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60",
              )}
            >
              All channels
            </button>
            {textChannels.map((ch) => {
              const mode = channelModes[ch.id] ?? "off";
              const active = selectedChannelId === ch.id;
              return (
                <button
                  key={ch.id}
                  onClick={() => setSelectedChannelId(ch.id === selectedChannelId ? null : ch.id)}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[12px] border cursor-pointer transition-colors",
                    active
                      ? "bg-primary/10 text-primary border-primary/25 font-semibold"
                      : mode === "off"
                        ? "bg-transparent border-dashed border-border/50 text-muted-foreground/60 hover:text-muted-foreground hover:border-border"
                        : "bg-transparent border-border text-foreground hover:bg-secondary/60",
                  )}
                >
                  <span className="text-muted-foreground/60 select-none">
                    {ch.kind === "forum" ? "§" : "#"}
                  </span>
                  <span>{ch.name}</span>
                  {mode !== "off" && <ChannelModeBadge mode={mode} size="xs" showDot={false} />}
                </button>
              );
            })}
          </div>
        )}

        {/* Conversation */}
        <div className="rounded-xl border border-border min-h-[400px] px-4 py-2">
          <ConversationView entries={entries} loading={loading} />
        </div>
      </div>
    </PageScroll>
  );
}
