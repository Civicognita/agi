/**
 * DatasetStore — drizzle-based storage for installed HuggingFace datasets.
 *
 * Tracks dataset lifecycle state and file metadata.
 * Uses the unified agi_data database via @agi/db-schema.
 * Table renamed from model-runtime's old pg schema:
 *   agi.datasets → hf_datasets
 */

import { desc, eq, ne, sql } from "drizzle-orm";
import type { Db } from "@agi/db-schema/client";
import { hfDatasets } from "@agi/db-schema";
import type { InstalledDataset, DatasetStatus } from "./types.js";

// ---------------------------------------------------------------------------
// Row mapper
// ---------------------------------------------------------------------------

function mapRow(row: typeof hfDatasets.$inferSelect): InstalledDataset {
  return {
    id: row.id,
    revision: row.revision ?? "unknown",
    displayName: row.displayName ?? row.id,
    description: row.description ?? undefined,
    filePath: row.filePath ?? "",
    fileSizeBytes: Number(row.fileSizeBytes ?? 0),
    fileCount: row.fileCount ?? 0,
    status: row.status as DatasetStatus,
    downloadedAt: row.downloadedAt instanceof Date ? row.downloadedAt.toISOString() : String(row.downloadedAt ?? ""),
    tags: Array.isArray(row.tags) ? row.tags as string[] : [],
    error: row.error ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// DatasetStore
// ---------------------------------------------------------------------------

export class DatasetStore {
  constructor(private readonly db: Db) {}

  // ---------------------------------------------------------------------------
  // Dataset CRUD
  // ---------------------------------------------------------------------------

  async addDataset(dataset: InstalledDataset): Promise<void> {
    await this.db
      .insert(hfDatasets)
      .values({
        id: dataset.id,
        revision: dataset.revision,
        displayName: dataset.displayName,
        description: dataset.description ?? null,
        filePath: dataset.filePath,
        fileSizeBytes: dataset.fileSizeBytes,
        fileCount: dataset.fileCount,
        status: dataset.status,
        downloadedAt: dataset.downloadedAt ? new Date(dataset.downloadedAt) : null,
        tags: dataset.tags as unknown[] | null,
        error: dataset.error ?? null,
      })
      .onConflictDoNothing();
  }

  async updateStatus(id: string, status: DatasetStatus): Promise<void> {
    await this.db.update(hfDatasets).set({
      status,
      error: status !== "error" ? null : undefined,
    }).where(eq(hfDatasets.id, id));
  }

  async setError(id: string, error: string): Promise<void> {
    await this.db.update(hfDatasets).set({
      status: "error",
      error,
    }).where(eq(hfDatasets.id, id));
  }

  async getById(id: string): Promise<InstalledDataset | undefined> {
    const [row] = await this.db
      .select()
      .from(hfDatasets)
      .where(eq(hfDatasets.id, id));
    return row ? mapRow(row) : undefined;
  }

  async getAll(): Promise<InstalledDataset[]> {
    const rows = await this.db
      .select()
      .from(hfDatasets)
      .orderBy(desc(hfDatasets.downloadedAt));
    return rows.map(mapRow);
  }

  async remove(id: string): Promise<void> {
    await this.db.delete(hfDatasets).where(eq(hfDatasets.id, id));
  }

  // ---------------------------------------------------------------------------
  // Aggregates
  // ---------------------------------------------------------------------------

  async getTotalDiskUsage(): Promise<number> {
    const [row] = await this.db
      .select({
        total: sql<string>`COALESCE(SUM(${hfDatasets.fileSizeBytes}), 0)::TEXT`,
      })
      .from(hfDatasets)
      .where(ne(hfDatasets.status, "removing"));
    return Number(row?.total ?? 0);
  }
}
