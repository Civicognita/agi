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

  getTodayContext(channelId: string, limit = 50): AmbientEntry[] {
    return this.getDateContext(channelId, this.todayDate(), limit);
  }

  getDateContext(channelId: string, date: string, limit = 50): AmbientEntry[] {
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
      return entries.slice(-limit);
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
