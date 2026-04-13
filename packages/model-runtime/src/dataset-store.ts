/**
 * DatasetStore — SQLite-backed storage for installed HuggingFace datasets.
 *
 * Tracks dataset lifecycle state, download progress, and file metadata.
 * Database lives at ~/.agi/datasets/index.db (caller supplies the path).
 */

import Database from "better-sqlite3";
import type { Database as DatabaseType, Statement } from "better-sqlite3";
import type { InstalledDataset, DatasetStatus } from "./types.js";

// ---------------------------------------------------------------------------
// DB row types — snake_case as returned by better-sqlite3
// ---------------------------------------------------------------------------

interface DatasetRow {
  id: string;
  revision: string;
  display_name: string;
  description: string | null;
  file_path: string;
  file_size_bytes: number;
  file_count: number;
  status: string;
  downloaded_at: string;
  tags_json: string;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Named-parameter shapes used by prepared statements
// ---------------------------------------------------------------------------

interface InsertDatasetParams {
  id: string;
  revision: string;
  display_name: string;
  description: string | null;
  file_path: string;
  file_size_bytes: number;
  file_count: number;
  status: string;
  downloaded_at: string;
  tags_json: string;
  error: string | null;
}

interface UpdateStatusParams {
  id: string;
  status: string;
}

interface UpdateErrorParams {
  id: string;
  error: string;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const SCHEMA = `
CREATE TABLE IF NOT EXISTS datasets (
  id TEXT PRIMARY KEY,
  revision TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT,
  file_path TEXT NOT NULL,
  file_size_bytes INTEGER NOT NULL DEFAULT 0,
  file_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'downloading' CHECK(status IN ('downloading', 'ready', 'error', 'removing')),
  downloaded_at TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]',
  error TEXT
);
`;

// ---------------------------------------------------------------------------
// DatasetStore
// ---------------------------------------------------------------------------

export class DatasetStore {
  private db: DatabaseType;
  private stmts: {
    insertDataset: Statement;
    updateStatus: Statement;
    updateError: Statement;
    getById: Statement;
    getAll: Statement;
    deleteDataset: Statement;
  };

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(SCHEMA);

    this.stmts = {
      insertDataset: this.db.prepare<[InsertDatasetParams]>(`
        INSERT INTO datasets (
          id, revision, display_name, description,
          file_path, file_size_bytes, file_count,
          status, downloaded_at, tags_json, error
        ) VALUES (
          @id, @revision, @display_name, @description,
          @file_path, @file_size_bytes, @file_count,
          @status, @downloaded_at, @tags_json, @error
        )
      `),

      updateStatus: this.db.prepare<[UpdateStatusParams]>(`
        UPDATE datasets
        SET status = @status,
            error = CASE WHEN @status != 'error' THEN NULL ELSE error END
        WHERE id = @id
      `),

      updateError: this.db.prepare<[UpdateErrorParams]>(`
        UPDATE datasets SET status = 'error', error = @error WHERE id = @id
      `),

      getById: this.db.prepare<[string], DatasetRow>(`
        SELECT * FROM datasets WHERE id = ?
      `),

      getAll: this.db.prepare<[], DatasetRow>(`
        SELECT * FROM datasets ORDER BY downloaded_at DESC
      `),

      deleteDataset: this.db.prepare<[string]>(`
        DELETE FROM datasets WHERE id = ?
      `),
    };
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
      fileSizeBytes: row.file_size_bytes,
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

  addDataset(dataset: InstalledDataset): void {
    this.stmts.insertDataset.run({
      id: dataset.id,
      revision: dataset.revision,
      display_name: dataset.displayName,
      description: dataset.description ?? null,
      file_path: dataset.filePath,
      file_size_bytes: dataset.fileSizeBytes,
      file_count: dataset.fileCount,
      status: dataset.status,
      downloaded_at: dataset.downloadedAt,
      tags_json: JSON.stringify(dataset.tags),
      error: dataset.error ?? null,
    });
  }

  updateStatus(id: string, status: DatasetStatus): void {
    this.stmts.updateStatus.run({ id, status });
  }

  setError(id: string, error: string): void {
    this.stmts.updateError.run({ id, error });
  }

  getById(id: string): InstalledDataset | undefined {
    const row = this.stmts.getById.get(id) as DatasetRow | undefined;
    return row ? this.mapRow(row) : undefined;
  }

  getAll(): InstalledDataset[] {
    const rows = this.stmts.getAll.all() as DatasetRow[];
    return rows.map((r) => this.mapRow(r));
  }

  remove(id: string): void {
    this.stmts.deleteDataset.run(id);
  }

  // ---------------------------------------------------------------------------
  // Aggregates
  // ---------------------------------------------------------------------------

  getTotalDiskUsage(): number {
    const row = this.db
      .prepare<[], { total: number }>(
        "SELECT COALESCE(SUM(file_size_bytes), 0) AS total FROM datasets WHERE status != 'removing'",
      )
      .get() as { total: number };
    return row.total;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  close(): void {
    this.db.close();
  }
}
