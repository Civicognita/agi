/**
 * BackupManager — automated SQLite database backups with retention.
 *
 * Compliance: UCS-BCM-01 (GDPR Art 32 restore, SOC 2 availability).
 */

import { existsSync, mkdirSync, readdirSync, unlinkSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "better-sqlite3";
import { createComponentLogger } from "./logger.js";
import type { Logger } from "./logger.js";

export interface BackupManagerOptions {
  backupDir: string;
  databases: { name: string; db: Database }[];
  retentionDays?: number;
  logger?: Logger;
}

export class BackupManager {
  private readonly backupDir: string;
  private readonly databases: { name: string; db: Database }[];
  private readonly retentionDays: number;
  private readonly log;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor(opts: BackupManagerOptions) {
    this.backupDir = opts.backupDir;
    this.databases = opts.databases;
    this.retentionDays = opts.retentionDays ?? 30;
    this.log = createComponentLogger(opts.logger, "backup");

    if (!existsSync(this.backupDir)) {
      mkdirSync(this.backupDir, { recursive: true });
    }
  }

  /** Run a backup of all registered databases. */
  backup(): { ok: boolean; files: string[]; errors: string[] } {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const files: string[] = [];
    const errors: string[] = [];

    for (const { name, db } of this.databases) {
      const filename = `${name}-${timestamp}.db`;
      const filepath = join(this.backupDir, filename);
      try {
        db.backup(filepath);
        files.push(filepath);
        this.log.info(`backup: ${name} → ${filename}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${name}: ${msg}`);
        this.log.error(`backup failed for ${name}: ${msg}`);
      }
    }

    return { ok: errors.length === 0, files, errors };
  }

  /** Remove backups older than retentionDays. */
  cleanup(): number {
    const cutoff = Date.now() - this.retentionDays * 24 * 60 * 60 * 1000;
    let removed = 0;

    try {
      const entries = readdirSync(this.backupDir);
      for (const entry of entries) {
        if (!entry.endsWith(".db")) continue;
        const filepath = join(this.backupDir, entry);
        try {
          const stat = statSync(filepath);
          if (stat.mtimeMs < cutoff) {
            unlinkSync(filepath);
            removed++;
          }
        } catch { /* skip unreadable files */ }
      }
    } catch { /* backup dir may not exist */ }

    if (removed > 0) {
      this.log.info(`cleanup: removed ${String(removed)} old backup(s)`);
    }
    return removed;
  }

  /** Start scheduled daily backups. */
  startSchedule(intervalMs = 24 * 60 * 60 * 1000): void {
    if (this.intervalId) return;
    // Run initial backup
    this.backup();
    this.cleanup();
    // Schedule recurring
    this.intervalId = setInterval(() => {
      this.backup();
      this.cleanup();
    }, intervalMs);
    this.log.info(`scheduled: daily backups to ${this.backupDir}`);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /** List existing backups. */
  listBackups(): { name: string; size: number; created: string }[] {
    if (!existsSync(this.backupDir)) return [];
    return readdirSync(this.backupDir)
      .filter((f) => f.endsWith(".db"))
      .map((f) => {
        const filepath = join(this.backupDir, f);
        const stat = statSync(filepath);
        return { name: f, size: stat.size, created: stat.mtime.toISOString() };
      })
      .sort((a, b) => b.created.localeCompare(a.created));
  }
}
