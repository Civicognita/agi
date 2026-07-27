/**
 * ChannelAmbientLog — per-channel daily message log.
 *
 * Logs ALL non-bot messages from configured channels (monitor + respond) so
 * Aion can wake up with today's conversation context when mentioned. Files
 * roll over automatically by date; no cleanup or cron needed.
 *
 * File layout: {dataDir}/channels/{channelId}/ambient-YYYY-MM-DD.jsonl
 * Each line is a JSON-encoded AmbientEntry.
 */

import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface AmbientEntry {
  ts: string;
  authorId: string;
  displayName: string;
  text: string;
  roomId: string;
  /** True when this message was sent by the owner entity (resolved at log time). */
  isOwner?: boolean;
}

export class ChannelAmbientLog {
  constructor(private readonly dataDir: string) {}

  private todayDate(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private filePath(channelId: string, date: string): string {
    return join(this.dataDir, "channels", channelId, `ambient-${date}.jsonl`);
  }

  log(channelId: string, entry: AmbientEntry): void {
    try {
      const dir = join(this.dataDir, "channels", channelId);
      mkdirSync(dir, { recursive: true });
      appendFileSync(this.filePath(channelId, this.todayDate()), JSON.stringify(entry) + "\n", "utf8");
    } catch {
      // Non-critical — logging failures must not interrupt message delivery.
    }
  }

  /**
   * @param roomId  When set, return only entries from that room. The log is
   *   provider-keyed (one daily file per channel provider, e.g. all Discord
   *   channels share one file), so callers that inject "today's conversation"
   *   into a specific room MUST pass roomId — otherwise one channel's messages
   *   bleed into another channel's prompt. Filtering happens BEFORE the limit
   *   slice, so a busy provider can't crowd out the target room's history.
   */
  getTodayContext(channelId: string, limit = 50, roomId?: string): AmbientEntry[] {
    return this.getDateContext(channelId, this.todayDate(), limit, roomId);
  }

  getDateContext(channelId: string, date: string, limit = 50, roomId?: string): AmbientEntry[] {
    try {
      const raw = readFileSync(this.filePath(channelId, date), "utf8");
      const lines = raw.split("\n").filter((l) => l.trim().length > 0);
      const entries: AmbientEntry[] = [];
      for (const line of lines) {
        try {
          entries.push(JSON.parse(line) as AmbientEntry);
        } catch {
          // Skip malformed lines.
        }
      }
      const scoped = roomId !== undefined ? entries.filter((e) => e.roomId === roomId) : entries;
      return scoped.slice(-limit);
    } catch {
      return [];
    }
  }

  formatAsContext(entries: AmbientEntry[]): string {
    return entries
      .map((e) => {
        const time = new Date(e.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        return `${time} ${e.displayName}: ${e.text}`;
      })
      .join("\n");
  }
}
