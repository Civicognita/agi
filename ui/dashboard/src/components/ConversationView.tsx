/**
 * ConversationView — Discord-style conversation renderer.
 *
 * All messages are left-aligned (operator reading mode, not perspective-split).
 * Aion messages use the amber/gold avatar and name to distinguish from humans.
 * Layout: [avatar] [name · time] [message text]
 */

import { cn } from "@/lib/utils";
import type { ConversationEntry } from "@/types.js";

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function senderLabel(entry: ConversationEntry): string {
  if (entry.kind === "comms-out") return "Aion";
  if (entry.kind === "comms-in") return entry.senderName ?? "Unknown";
  return entry.displayName;
}

function messageText(entry: ConversationEntry): string {
  return entry.text;
}

function entryTs(entry: ConversationEntry): string {
  return entry.ts;
}

// Deterministic avatar color from a seed string — matches design's av.{v,s,e,r,a,z} system.
function avatarColor(seed: string): string {
  const palette = ["violet", "sky", "emerald", "rose", "amber", "zinc"];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) & 0xffff;
  return palette[h % palette.length]!;
}

const COLOR_CLASSES: Record<string, string> = {
  violet:  "bg-gradient-to-br from-violet-500 to-indigo-600",
  sky:     "bg-gradient-to-br from-sky-500 to-blue-600",
  emerald: "bg-gradient-to-br from-emerald-500 to-emerald-700",
  rose:    "bg-gradient-to-br from-rose-500 to-rose-600",
  amber:   "bg-gradient-to-br from-amber-500 to-orange-600",
  zinc:    "bg-gradient-to-br from-zinc-500 to-zinc-700",
};

const AI_AVATAR_CLASS = "bg-gradient-to-br from-amber-400 to-amber-600";

interface AvatarProps {
  initial: string;
  isAi: boolean;
  seed: string;
}

function Avatar({ initial, isAi, seed }: AvatarProps) {
  const cls = isAi ? AI_AVATAR_CLASS : (COLOR_CLASSES[avatarColor(seed)] ?? COLOR_CLASSES.zinc!);
  return (
    <div
      className={cn(
        "w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-[12px] font-semibold mt-0.5",
        isAi ? "text-zinc-950" : "text-white",
        cls,
      )}
    >
      {initial.toUpperCase()}
    </div>
  );
}

export interface ConversationViewProps {
  entries: ConversationEntry[];
  loading: boolean;
  emptyText?: string;
}

export function ConversationView({ entries, loading, emptyText }: ConversationViewProps) {
  if (loading && entries.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-[13px] text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-[13px] text-muted-foreground">
        {emptyText ?? "No messages on this day"}
      </div>
    );
  }

  // Group consecutive messages from the same sender to avoid repeated avatars.
  type MsgMeta = { ts: string; text: string; isAmbient: boolean; confidence?: number; latencyMs?: number; model?: string };
  type Group = { key: string; isAi: boolean; seed: string; label: string; messages: MsgMeta[] };
  const groups: Group[] = [];
  for (const entry of entries) {
    const label = senderLabel(entry);
    const isAi = entry.kind === "comms-out";
    const isAmbient = entry.kind === "ambient";
    const key = isAi ? "__aion__" : label;
    const meta: MsgMeta = {
      ts: entryTs(entry),
      text: messageText(entry),
      isAmbient,
      ...(entry.kind === "comms-out" ? {
        confidence: entry.confidence,
        latencyMs: entry.latencyMs,
        model: entry.model,
      } : {}),
    };
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.messages.push(meta);
    } else {
      groups.push({ key, isAi, seed: label, label, messages: [meta] });
    }
  }

  return (
    <div className="flex flex-col gap-3 py-2">
      {groups.map((group, gi) => (
        <div key={gi} className="flex gap-2.5 px-1 py-0.5 hover:bg-secondary/20 rounded-lg transition-colors">
          <Avatar initial={group.label.slice(0, 1)} isAi={group.isAi} seed={group.seed} />
          <div className="flex-1 min-w-0">
            {/* Sender header */}
            <div className="flex items-baseline gap-2 mb-0.5">
              <span
                className={cn(
                  "text-[13.5px] font-semibold",
                  group.isAi ? "text-amber-500 dark:text-amber-400" : "text-foreground",
                )}
              >
                {group.label}
              </span>
              {group.isAi && (
                <span className="inline-flex items-center gap-1 text-[9.5px] font-semibold rounded-full border px-1.5 py-0 bg-violet-500/10 text-violet-600 dark:text-violet-300 border-violet-500/25">
                  bot
                </span>
              )}
              <span className="text-[10.5px] text-muted-foreground font-mono">
                {formatTime(group.messages[0]!.ts)}
              </span>
            </div>
            {/* Message lines */}
            <div className="flex flex-col gap-1">
              {group.messages.map((msg, mi) => (
                <div key={mi}>
                  <p
                    className={cn(
                      "text-[13px] leading-relaxed whitespace-pre-wrap break-words m-0",
                      msg.isAmbient ? "text-muted-foreground/80" : "text-foreground",
                    )}
                  >
                    {msg.text}
                  </p>
                  {/* AI observability — confidence bar + metadata row (renders only when data is present) */}
                  {group.isAi && msg.confidence !== undefined && (
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="aio-conf flex-1 max-w-[120px]">
                        <span style={{ width: `${Math.round(msg.confidence * 100)}%` }} />
                      </div>
                      <span className="text-[10px] font-mono text-muted-foreground/70">
                        {Math.round(msg.confidence * 100)}%
                      </span>
                      {msg.latencyMs !== undefined && (
                        <span className="text-[10px] font-mono text-muted-foreground/60">
                          {msg.latencyMs >= 1000
                            ? `${(msg.latencyMs / 1000).toFixed(1)}s`
                            : `${msg.latencyMs}ms`}
                        </span>
                      )}
                      {msg.model !== undefined && (
                        <span className="text-[10px] font-mono text-muted-foreground/50 truncate">
                          {msg.model}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
