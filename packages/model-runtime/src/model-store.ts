/**
 * ModelStore — SQLite-backed storage for installed HuggingFace models.
 *
 * Tracks model lifecycle state, download progress, and container bindings.
 * Database lives at ~/.agi/models/index.db (caller supplies the path).
 */

import Database from "better-sqlite3";
import type { Database as DatabaseType, Statement } from "better-sqlite3";
import type { InstalledModel, ModelStatus, ModelRuntimeType, DownloadProgress } from "./types.js";

// ---------------------------------------------------------------------------
// DB row types — snake_case as returned by better-sqlite3
// ---------------------------------------------------------------------------

interface ModelRow {
  id: string;
  revision: string;
  display_name: string;
  pipeline_tag: string;
  runtime_type: string;
  file_path: string;
  model_filename: string | null;
  file_size_bytes: number;
  quantization: string | null;
  status: string;
  downloaded_at: string;
  last_used_at: string | null;
  error: string | null;
  container_id: string | null;
  container_port: number | null;
  container_name: string | null;
}

interface DownloadProgressRow {
  model_id: string;
  filename: string;
  total_bytes: number;
  downloaded_bytes: number;
  speed_bps: number;
  started_at: string;
}

// ---------------------------------------------------------------------------
// Named-parameter shapes used by prepared statements
// ---------------------------------------------------------------------------

interface InsertModelParams {
  id: string;
  revision: string;
  display_name: string;
  pipeline_tag: string;
  runtime_type: string;
  file_path: string;
  model_filename: string | null;
  file_size_bytes: number;
  quantization: string | null;
  status: string;
  downloaded_at: string;
  last_used_at: string | null;
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

interface BindContainerParams {
  id: string;
  container_id: string;
  container_port: number;
  container_name: string;
}

interface UpsertProgressParams {
  model_id: string;
  filename: string;
  total_bytes: number;
  downloaded_bytes: number;
  speed_bps: number;
  started_at: string;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const SCHEMA = `
CREATE TABLE IF NOT EXISTS models (
  id TEXT PRIMARY KEY,
  revision TEXT NOT NULL,
  display_name TEXT NOT NULL,
  pipeline_tag TEXT NOT NULL,
  runtime_type TEXT NOT NULL CHECK(runtime_type IN ('llm', 'diffusion', 'general')),
  file_path TEXT NOT NULL,
  model_filename TEXT,
  file_size_bytes INTEGER NOT NULL,
  quantization TEXT,
  status TEXT NOT NULL DEFAULT 'downloading' CHECK(status IN ('downloading', 'ready', 'starting', 'running', 'stopping', 'error', 'removing')),
  downloaded_at TEXT NOT NULL,
  last_used_at TEXT,
  error TEXT,
  container_id TEXT,
  container_port INTEGER,
  container_name TEXT
);

CREATE TABLE IF NOT EXISTS download_progress (
  model_id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  total_bytes INTEGER NOT NULL,
  downloaded_bytes INTEGER NOT NULL,
  speed_bps REAL NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  FOREIGN KEY (model_id) REFERENCES models(id) ON DELETE CASCADE
);
`;

// ---------------------------------------------------------------------------
// ModelStore
// ---------------------------------------------------------------------------

export class ModelStore {
  private db: DatabaseType;
  private stmts: {
    insertModel: Statement;
    updateStatus: Statement;
    updateError: Statement;
    bindContainer: Statement;
    unbindContainer: Statement;
    updateLastUsed: Statement;
    getById: Statement;
    getAll: Statement;
    getByStatus: Statement;
    getByRuntimeType: Statement;
    getRunning: Statement;
    deleteModel: Statement;
    upsertProgress: Statement;
    getProgress: Statement;
    deleteProgress: Statement;
  };

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(SCHEMA);

    this.stmts = {
      insertModel: this.db.prepare<[InsertModelParams]>(`
        INSERT INTO models (
          id, revision, display_name, pipeline_tag, runtime_type,
          file_path, model_filename, file_size_bytes, quantization,
          status, downloaded_at, last_used_at, error
        ) VALUES (
          @id, @revision, @display_name, @pipeline_tag, @runtime_type,
          @file_path, @model_filename, @file_size_bytes, @quantization,
          @status, @downloaded_at, @last_used_at, @error
        )
      `),

      updateStatus: this.db.prepare<[UpdateStatusParams]>(`
        UPDATE models
        SET status = @status,
            error = CASE WHEN @status != 'error' THEN NULL ELSE error END
        WHERE id = @id
      `),

      updateError: this.db.prepare<[UpdateErrorParams]>(`
        UPDATE models SET status = 'error', error = @error WHERE id = @id
      `),

      bindContainer: this.db.prepare<[BindContainerParams]>(`
        UPDATE models
        SET container_id = @container_id,
            container_port = @container_port,
            container_name = @container_name,
            status = 'running'
        WHERE id = @id
      `),

      unbindContainer: this.db.prepare<[{ id: string }]>(`
        UPDATE models
        SET container_id = NULL,
            container_port = NULL,
            container_name = NULL,
            status = 'ready'
        WHERE id = @id
      `),

      updateLastUsed: this.db.prepare<[{ id: string; last_used_at: string }]>(`
        UPDATE models SET last_used_at = @last_used_at WHERE id = @id
      `),

      getById: this.db.prepare<[string], ModelRow>(`
        SELECT * FROM models WHERE id = ?
      `),

      getAll: this.db.prepare<[], ModelRow>(`
        SELECT * FROM models ORDER BY downloaded_at DESC
      `),

      getByStatus: this.db.prepare<[string], ModelRow>(`
        SELECT * FROM models WHERE status = ? ORDER BY downloaded_at DESC
      `),

      getByRuntimeType: this.db.prepare<[string], ModelRow>(`
        SELECT * FROM models WHERE runtime_type = ? ORDER BY downloaded_at DESC
      `),

      getRunning: this.db.prepare<[], ModelRow>(`
        SELECT * FROM models WHERE status = 'running' ORDER BY downloaded_at DESC
      `),

      deleteModel: this.db.prepare<[string]>(`
        DELETE FROM models WHERE id = ?
      `),

      upsertProgress: this.db.prepare<[UpsertProgressParams]>(`
        INSERT INTO download_progress (model_id, filename, total_bytes, downloaded_bytes, speed_bps, started_at)
        VALUES (@model_id, @filename, @total_bytes, @downloaded_bytes, @speed_bps, @started_at)
        ON CONFLICT (model_id) DO UPDATE SET
          filename = excluded.filename,
          total_bytes = excluded.total_bytes,
          downloaded_bytes = excluded.downloaded_bytes,
          speed_bps = excluded.speed_bps,
          started_at = excluded.started_at
      `),

      getProgress: this.db.prepare<[string], DownloadProgressRow>(`
        SELECT * FROM download_progress WHERE model_id = ?
      `),

      deleteProgress: this.db.prepare<[string]>(`
        DELETE FROM download_progress WHERE model_id = ?
      `),
    };
  }

  // ---------------------------------------------------------------------------
  // Row mapping
  // ---------------------------------------------------------------------------

  private mapRow(row: ModelRow): InstalledModel {
    return {
      id: row.id,
      revision: row.revision,
      displayName: row.display_name,
      pipelineTag: row.pipeline_tag,
      runtimeType: row.runtime_type as ModelRuntimeType,
      filePath: row.file_path,
      modelFilename: row.model_filename ?? undefined,
      fileSizeBytes: row.file_size_bytes,
      quantization: row.quantization ?? undefined,
      status: row.status as ModelStatus,
      downloadedAt: row.downloaded_at,
      lastUsedAt: row.last_used_at ?? undefined,
      error: row.error ?? undefined,
      containerId: row.container_id ?? undefined,
      containerPort: row.container_port ?? undefined,
      containerName: row.container_name ?? undefined,
    };
  }

  private mapProgressRow(row: DownloadProgressRow): DownloadProgress {
    const remaining = row.total_bytes - row.downloaded_bytes;
    const etaSeconds = row.speed_bps > 0 ? remaining / row.speed_bps : 0;
    return {
      modelId: row.model_id,
      filename: row.filename,
      totalBytes: row.total_bytes,
      downloadedBytes: row.downloaded_bytes,
      speedBps: row.speed_bps,
      etaSeconds,
      startedAt: row.started_at,
    };
  }

  // ---------------------------------------------------------------------------
  // Model CRUD
  // ---------------------------------------------------------------------------

  addModel(model: Omit<InstalledModel, "containerId" | "containerPort" | "containerName">): void {
    this.stmts.insertModel.run({
      id: model.id,
      revision: model.revision,
      display_name: model.displayName,
      pipeline_tag: model.pipelineTag,
      runtime_type: model.runtimeType,
      file_path: model.filePath,
      model_filename: model.modelFilename ?? null,
      file_size_bytes: model.fileSizeBytes,
      quantization: model.quantization ?? null,
      status: model.status,
      downloaded_at: model.downloadedAt,
      last_used_at: model.lastUsedAt ?? null,
      error: model.error ?? null,
    });
  }

  updateStatus(id: string, status: ModelStatus): void {
    this.stmts.updateStatus.run({ id, status });
  }

  setError(id: string, error: string): void {
    this.stmts.updateError.run({ id, error });
  }

  bindContainer(id: string, containerId: string, port: number, containerName: string): void {
    this.stmts.bindContainer.run({
      id,
      container_id: containerId,
      container_port: port,
      container_name: containerName,
    });
  }

  unbindContainer(id: string): void {
    this.stmts.unbindContainer.run({ id });
  }

  touchLastUsed(id: string): void {
    this.stmts.updateLastUsed.run({ id, last_used_at: new Date().toISOString() });
  }

  getById(id: string): InstalledModel | undefined {
    const row = this.stmts.getById.get(id) as ModelRow | undefined;
    return row ? this.mapRow(row) : undefined;
  }

  getAll(): InstalledModel[] {
    const rows = this.stmts.getAll.all() as ModelRow[];
    return rows.map((r) => this.mapRow(r));
  }

  getByStatus(status: ModelStatus): InstalledModel[] {
    const rows = this.stmts.getByStatus.all(status) as ModelRow[];
    return rows.map((r) => this.mapRow(r));
  }

  getByRuntimeType(type: ModelRuntimeType): InstalledModel[] {
    const rows = this.stmts.getByRuntimeType.all(type) as ModelRow[];
    return rows.map((r) => this.mapRow(r));
  }

  getRunning(): InstalledModel[] {
    const rows = this.stmts.getRunning.all() as ModelRow[];
    return rows.map((r) => this.mapRow(r));
  }

  remove(id: string): void {
    this.stmts.deleteModel.run(id);
  }

  // ---------------------------------------------------------------------------
  // Download progress
  // ---------------------------------------------------------------------------

  upsertDownloadProgress(progress: DownloadProgress): void {
    this.stmts.upsertProgress.run({
      model_id: progress.modelId,
      filename: progress.filename,
      total_bytes: progress.totalBytes,
      downloaded_bytes: progress.downloadedBytes,
      speed_bps: progress.speedBps,
      started_at: progress.startedAt,
    });
  }

  getDownloadProgress(modelId: string): DownloadProgress | undefined {
    const row = this.stmts.getProgress.get(modelId) as DownloadProgressRow | undefined;
    return row ? this.mapProgressRow(row) : undefined;
  }

  clearDownloadProgress(modelId: string): void {
    this.stmts.deleteProgress.run(modelId);
  }

  // ---------------------------------------------------------------------------
  // Aggregates
  // ---------------------------------------------------------------------------

  getTotalDiskUsage(): number {
    const row = this.db
      .prepare<[], { total: number }>(
        "SELECT COALESCE(SUM(file_size_bytes), 0) AS total FROM models WHERE status != 'removing'",
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
