/**
 * DatasetStore — PostgreSQL-backed storage for installed HuggingFace datasets.
 *
 * Tracks dataset lifecycle state and file metadata.
 * Uses the ID service's PostgreSQL instance with data isolated in the `agi` schema.
 * Caller supplies a pg Pool; call initialize() before using any other methods.
 * The agi schema is created by ModelStore.initialize() — DatasetStore.initialize()
 * only creates its own table.
 */

import type { Pool } from "pg";
import type { InstalledDataset, DatasetStatus } from "./types.js";

// ---------------------------------------------------------------------------
// DB row types — snake_case as returned by pg
// ---------------------------------------------------------------------------

interface DatasetRow {
  id: string;
  revision: string;
  display_name: string;
  description: string | null;
  file_path: string;
  file_size_bytes: string; // pg returns BIGINT as string
  file_count: number;
  status: string;
  downloaded_at: string;
  tags_json: string;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Schema SQL
// ---------------------------------------------------------------------------

const TABLE_SQL = `
CREATE TABLE IF NOT EXISTS agi.datasets (
  id TEXT PRIMARY KEY,
  revision TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT,
  file_path TEXT NOT NULL,
  file_size_bytes BIGINT NOT NULL DEFAULT 0,
  file_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'downloading',
  downloaded_at TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]',
  error TEXT
);
`;

// ---------------------------------------------------------------------------
// DatasetStore
// ---------------------------------------------------------------------------

export class DatasetStore {
  constructor(private readonly pool: Pool) {}

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async initialize(): Promise<void> {
    // Ensure agi schema exists (ModelStore.initialize() also does this, but be safe)
    await this.pool.query(`CREATE SCHEMA IF NOT EXISTS agi`);
    await this.pool.query(TABLE_SQL);
  }

  async close(): Promise<void> {
    // Pool is shared with ModelStore — callers should call pgPool.end() directly
    // or close via ModelStore.close(). This is a no-op to avoid double-ending.
  }

  // ---------------------------------------------------------------------------
  // Row mapping
  // ---------------------------------------------------------------------------

  private mapRow(row: DatasetRow): InstalledDataset {
    let tags: string[] = [];
    try {
      tags = JSON.parse(row.tags_json) as string[];
    } catch {
      tags = [];
    }
    return {
      id: row.id,
      revision: row.revision,
      displayName: row.display_name,
      description: row.description ?? undefined,
      filePath: row.file_path,
      fileSizeBytes: Number(row.file_size_bytes),
      fileCount: row.file_count,
      status: row.status as DatasetStatus,
      downloadedAt: row.downloaded_at,
      tags,
      error: row.error ?? undefined,
    };
  }

  // ---------------------------------------------------------------------------
  // Dataset CRUD
  // ---------------------------------------------------------------------------

  async addDataset(dataset: InstalledDataset): Promise<void> {
    await this.pool.query(
      `INSERT INTO agi.datasets (
        id, revision, display_name, description,
        file_path, file_size_bytes, file_count,
        status, downloaded_at, tags_json, error
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, $7,
        $8, $9, $10, $11
      ) ON CONFLICT (id) DO NOTHING`,
      [
        dataset.id,
        dataset.revision,
        dataset.displayName,
        dataset.description ?? null,
        dataset.filePath,
        dataset.fileSizeBytes,
        dataset.fileCount,
        dataset.status,
        dataset.downloadedAt,
        JSON.stringify(dataset.tags),
        dataset.error ?? null,
      ],
    );
  }

  async updateStatus(id: string, status: DatasetStatus): Promise<void> {
    await this.pool.query(
      `UPDATE agi.datasets
       SET status = $1,
           error = CASE WHEN $1 != 'error' THEN NULL ELSE error END
       WHERE id = $2`,
      [status, id],
    );
  }

  async setError(id: string, error: string): Promise<void> {
    await this.pool.query(
      `UPDATE agi.datasets SET status = 'error', error = $1 WHERE id = $2`,
      [error, id],
    );
  }

  async getById(id: string): Promise<InstalledDataset | undefined> {
    const result = await this.pool.query<DatasetRow>(
      `SELECT * FROM agi.datasets WHERE id = $1`,
      [id],
    );
    const row = result.rows[0];
    return row ? this.mapRow(row) : undefined;
  }

  async getAll(): Promise<InstalledDataset[]> {
    const result = await this.pool.query<DatasetRow>(
      `SELECT * FROM agi.datasets ORDER BY downloaded_at DESC`,
    );
    return result.rows.map((r) => this.mapRow(r));
  }

  async remove(id: string): Promise<void> {
    await this.pool.query(`DELETE FROM agi.datasets WHERE id = $1`, [id]);
  }

  // ---------------------------------------------------------------------------
  // Aggregates
  // ---------------------------------------------------------------------------

  async getTotalDiskUsage(): Promise<number> {
    const result = await this.pool.query<{ total: string }>(
      `SELECT COALESCE(SUM(file_size_bytes), 0)::TEXT AS total FROM agi.datasets WHERE status != 'removing'`,
    );
    return Number(result.rows[0]?.total ?? 0);
  }
}
