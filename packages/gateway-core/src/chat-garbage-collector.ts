/**
 * ChatGarbageCollector — scheduled cleanup for old chat sessions and orphaned images.
 *
 * Runs periodically (typically daily at 2 AM) to:
 *   1. Delete chat sessions older than the configured retention period
 *   2. Delete associated image blobs for expired sessions
 *   3. Clean up orphaned image directories with no matching session
 *
 * Retention period is hot-read from config on each sweep (configurable
 * at config.chat.retentionDays, default 30 days).
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ChatPersistence } from "./chat-persistence.js";
import type { ImageBlobStore } from "./image-blob-store.js";

export interface ChatGCDeps {
  chatPersistence: ChatPersistence;
  imageBlobStore: ImageBlobStore;
  /** Path to aionima.json for hot-reading config.chat.retentionDays. */
  configPath?: string;
}

export interface GCStats {
  sessionsScanned: number;
  sessionsDeleted: number;
  orphanedImageDirsDeleted: number;
  durationMs: number;
  errors: string[];
}

export class ChatGarbageCollector {
  private readonly chatPersistence: ChatPersistence;
  private readonly imageBlobStore: ImageBlobStore;
  private readonly configPath: string;

  constructor(deps: ChatGCDeps) {
    this.chatPersistence = deps.chatPersistence;
    this.imageBlobStore = deps.imageBlobStore;
    this.configPath = deps.configPath ?? join(homedir(), ".agi", "aionima.json");
  }

  /** Run the garbage collection sweep. */
  async collect(): Promise<GCStats> {
    const start = Date.now();
    const errors: string[] = [];
    let sessionsScanned = 0;
    let sessionsDeleted = 0;
    let orphanedImageDirsDeleted = 0;

    const retentionDays = this.getRetentionDays();
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

    // Phase 1: Delete expired chat sessions + their images
    try {
      const sessions = this.chatPersistence.list();
      sessionsScanned = sessions.length;

      for (const session of sessions) {
        try {
          const updatedAt = new Date(session.updatedAt).getTime();
          if (isNaN(updatedAt) || updatedAt < cutoff) {
            this.chatPersistence.delete(session.id);
            this.imageBlobStore.deleteSession(session.id);
            sessionsDeleted++;
          }
        } catch (err) {
          errors.push(`Failed to delete session ${session.id}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    } catch (err) {
      errors.push(`Failed to list sessions: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Phase 2: Clean up orphaned image directories
    try {
      const imageDirs = this.imageBlobStore.listSessionDirs();
      const sessionIds = new Set(this.chatPersistence.list().map((s) => s.id));

      for (const dirName of imageDirs) {
        // Skip the dedicated screengrabs directory
        if (dirName === "_screengrabs") continue;

        if (!sessionIds.has(dirName)) {
          try {
            this.imageBlobStore.deleteSession(dirName);
            orphanedImageDirsDeleted++;
          } catch (err) {
            errors.push(`Failed to delete orphaned image dir ${dirName}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }
    } catch (err) {
      errors.push(`Failed to scan for orphaned images: ${err instanceof Error ? err.message : String(err)}`);
    }

    return {
      sessionsScanned,
      sessionsDeleted,
      orphanedImageDirsDeleted,
      durationMs: Date.now() - start,
      errors,
    };
  }

  /** Hot-read retention days from config. */
  private getRetentionDays(): number {
    try {
      if (existsSync(this.configPath)) {
        const raw = readFileSync(this.configPath, "utf-8");
        const config = JSON.parse(raw) as { chat?: { retentionDays?: number } };
        const days = config?.chat?.retentionDays;
        if (typeof days === "number" && days > 0) return days;
      }
    } catch {
      // Config read failed — use default
    }
    return 30;
  }
}
