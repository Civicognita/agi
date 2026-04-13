/**
 * ModelStore — PostgreSQL-backed storage for installed HuggingFace models.
 *
 * Tracks model lifecycle state, download progress, and container bindings.
 * Uses the ID service's PostgreSQL instance with data isolated in the `agi` schema.
 * Caller supplies a pg Pool; call initialize() before using any other methods.
 */

import type { Pool } from "pg";
import type { InstalledModel, ModelEndpoint, ModelStatus, ModelRuntimeType, DownloadProgress } from "./types.js";

// ---------------------------------------------------------------------------
// DB row types — snake_case as returned by pg
// ---------------------------------------------------------------------------

interface ModelRow {
  id: string;
  revision: string;
  display_name: string;
  pipeline_tag: string;
  runtime_type: string;
  file_path: string;
  model_filename: string | null;
  file_size_bytes: string; // pg returns BIGINT as string
  quantization: string | null;
  status: string;
  downloaded_at: string;
  last_used_at: string | null;
  error: string | null;
  container_id: string | null;
  container_port: number | null;
  container_name: string | null;
  container_image: string | null;
  source_repo: string | null;
  endpoints_json: string | null;
}

interface DownloadProgressRow {
  model_id: string;
  filename: string;
  total_bytes: string; // pg returns BIGINT as string
  downloaded_bytes: string; // pg returns BIGINT as string
  speed_bps: number;
  started_at: string;
}

// ---------------------------------------------------------------------------
// Schema SQL
// ---------------------------------------------------------------------------

const SCHEMA_SQL = `
CREATE SCHEMA IF NOT EXISTS agi;

CREATE TABLE IF NOT EXISTS agi.models (
  id TEXT PRIMARY KEY,
  revision TEXT NOT NULL,
  display_name TEXT NOT NULL,
  pipeline_tag TEXT NOT NULL,
  runtime_type TEXT NOT NULL,
  file_path TEXT NOT NULL,
  model_filename TEXT,
  file_size_bytes BIGINT NOT NULL DEFAULT 0,
  quantization TEXT,
  status TEXT NOT NULL DEFAULT 'downloading',
  downloaded_at TEXT NOT NULL,
  last_used_at TEXT,
  error TEXT,
  container_id TEXT,
  container_port INTEGER,
  container_name TEXT,
  container_image TEXT,
  source_repo TEXT,
  endpoints_json TEXT
);

CREATE TABLE IF NOT EXISTS agi.download_progress (
  model_id TEXT PRIMARY KEY REFERENCES agi.models(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  total_bytes BIGINT NOT NULL,
  downloaded_bytes BIGINT NOT NULL,
  speed_bps REAL NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL
);
`;

// ---------------------------------------------------------------------------
// ModelStore
// ---------------------------------------------------------------------------

export class ModelStore {
  constructor(private readonly pool: Pool) {}

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async initialize(): Promise<void> {
    await this.pool.query(SCHEMA_SQL);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  // ---------------------------------------------------------------------------
  // Row mapping
  // ---------------------------------------------------------------------------

  private mapRow(row: ModelRow): InstalledModel {
    let endpoints: ModelEndpoint[] | undefined;
    if (row.endpoints_json) {
      try {
        endpoints = JSON.parse(row.endpoints_json) as ModelEndpoint[];
      } catch {
        // Malformed JSON — treat as absent
      }
    }
    return {
      id: row.id,
      revision: row.revision,
      displayName: row.display_name,
      pipelineTag: row.pipeline_tag,
      runtimeType: row.runtime_type as ModelRuntimeType,
      filePath: row.file_path,
      modelFilename: row.model_filename ?? undefined,
      fileSizeBytes: Number(row.file_size_bytes),
      quantization: row.quantization ?? undefined,
      status: row.status as ModelStatus,
      downloadedAt: row.downloaded_at,
      lastUsedAt: row.last_used_at ?? undefined,
      error: row.error ?? undefined,
      containerId: row.container_id ?? undefined,
      containerPort: row.container_port ?? undefined,
      containerName: row.container_name ?? undefined,
      containerImage: row.container_image ?? undefined,
      sourceRepo: row.source_repo ?? undefined,
      endpoints,
    };
  }

  private mapProgressRow(row: DownloadProgressRow): DownloadProgress {
    const totalBytes = Number(row.total_bytes);
    const downloadedBytes = Number(row.downloaded_bytes);
    const remaining = totalBytes - downloadedBytes;
    const etaSeconds = row.speed_bps > 0 ? remaining / row.speed_bps : 0;
    return {
      modelId: row.model_id,
      filename: row.filename,
      totalBytes,
      downloadedBytes,
      speedBps: row.speed_bps,
      etaSeconds,
      startedAt: row.started_at,
    };
  }

  // ---------------------------------------------------------------------------
  // Model CRUD
  // ---------------------------------------------------------------------------

  async addModel(model: Omit<InstalledModel, "containerId" | "containerPort" | "containerName">): Promise<void> {
    await this.pool.query(
      `INSERT INTO agi.models (
        id, revision, display_name, pipeline_tag, runtime_type,
        file_path, model_filename, file_size_bytes, quantization,
        status, downloaded_at, last_used_at, error,
        container_image, source_repo, endpoints_json
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9,
        $10, $11, $12, $13,
        $14, $15, $16
      ) ON CONFLICT (id) DO NOTHING`,
      [
        model.id,
        model.revision,
        model.displayName,
        model.pipelineTag,
        model.runtimeType,
        model.filePath,
        model.modelFilename ?? null,
        model.fileSizeBytes,
        model.quantization ?? null,
        model.status,
        model.downloadedAt,
        model.lastUsedAt ?? null,
        model.error ?? null,
        model.containerImage ?? null,
        model.sourceRepo ?? null,
        model.endpoints ? JSON.stringify(model.endpoints) : null,
      ],
    );
  }

  async updateStatus(id: string, status: ModelStatus): Promise<void> {
    await this.pool.query(
      `UPDATE agi.models
       SET status = $1,
           error = CASE WHEN $1 != 'error' THEN NULL ELSE error END
       WHERE id = $2`,
      [status, id],
    );
  }

  async setError(id: string, error: string): Promise<void> {
    await this.pool.query(
      `UPDATE agi.models SET status = 'error', error = $1 WHERE id = $2`,
      [error, id],
    );
  }

  async bindContainer(id: string, containerId: string, port: number, containerName: string): Promise<void> {
    await this.pool.query(
      `UPDATE agi.models
       SET container_id = $1,
           container_port = $2,
           container_name = $3,
           status = 'running'
       WHERE id = $4`,
      [containerId, port, containerName, id],
    );
  }

  async unbindContainer(id: string): Promise<void> {
    await this.pool.query(
      `UPDATE agi.models
       SET container_id = NULL,
           container_port = NULL,
           container_name = NULL,
           status = 'ready'
       WHERE id = $1`,
      [id],
    );
  }

  async touchLastUsed(id: string): Promise<void> {
    await this.pool.query(
      `UPDATE agi.models SET last_used_at = $1 WHERE id = $2`,
      [new Date().toISOString(), id],
    );
  }

  async getById(id: string): Promise<InstalledModel | undefined> {
    const result = await this.pool.query<ModelRow>(
      `SELECT * FROM agi.models WHERE id = $1`,
      [id],
    );
    const row = result.rows[0];
    return row ? this.mapRow(row) : undefined;
  }

  async getAll(): Promise<InstalledModel[]> {
    const result = await this.pool.query<ModelRow>(
      `SELECT * FROM agi.models ORDER BY downloaded_at DESC`,
    );
    return result.rows.map((r) => this.mapRow(r));
  }

  async getByStatus(status: ModelStatus): Promise<InstalledModel[]> {
    const result = await this.pool.query<ModelRow>(
      `SELECT * FROM agi.models WHERE status = $1 ORDER BY downloaded_at DESC`,
      [status],
    );
    return result.rows.map((r) => this.mapRow(r));
  }

  async getByRuntimeType(type: ModelRuntimeType): Promise<InstalledModel[]> {
    const result = await this.pool.query<ModelRow>(
      `SELECT * FROM agi.models WHERE runtime_type = $1 ORDER BY downloaded_at DESC`,
      [type],
    );
    return result.rows.map((r) => this.mapRow(r));
  }

  async getRunning(): Promise<InstalledModel[]> {
    const result = await this.pool.query<ModelRow>(
      `SELECT * FROM agi.models WHERE status = 'running' ORDER BY downloaded_at DESC`,
    );
    return result.rows.map((r) => this.mapRow(r));
  }

  async remove(id: string): Promise<void> {
    await this.pool.query(`DELETE FROM agi.models WHERE id = $1`, [id]);
  }

  // ---------------------------------------------------------------------------
  // Download progress
  // ---------------------------------------------------------------------------

  async upsertDownloadProgress(progress: DownloadProgress): Promise<void> {
    await this.pool.query(
      `INSERT INTO agi.download_progress (model_id, filename, total_bytes, downloaded_bytes, speed_bps, started_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (model_id) DO UPDATE SET
         filename = EXCLUDED.filename,
         total_bytes = EXCLUDED.total_bytes,
         downloaded_bytes = EXCLUDED.downloaded_bytes,
         speed_bps = EXCLUDED.speed_bps,
         started_at = EXCLUDED.started_at`,
      [
        progress.modelId,
        progress.filename,
        progress.totalBytes,
        progress.downloadedBytes,
        progress.speedBps,
        progress.startedAt,
      ],
    );
  }

  async getDownloadProgress(modelId: string): Promise<DownloadProgress | undefined> {
    const result = await this.pool.query<DownloadProgressRow>(
      `SELECT * FROM agi.download_progress WHERE model_id = $1`,
      [modelId],
    );
    const row = result.rows[0];
    return row ? this.mapProgressRow(row) : undefined;
  }

  async clearDownloadProgress(modelId: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM agi.download_progress WHERE model_id = $1`,
      [modelId],
    );
  }

  // ---------------------------------------------------------------------------
  // Aggregates
  // ---------------------------------------------------------------------------

  async getTotalDiskUsage(): Promise<number> {
    const result = await this.pool.query<{ total: string }>(
      `SELECT COALESCE(SUM(file_size_bytes), 0)::TEXT AS total FROM agi.models WHERE status != 'removing'`,
    );
    return Number(result.rows[0]?.total ?? 0);
  }

  /**
   * Return installed models sorted by least recently used first.
   * Cumulative size is tracked as models are added to the result list.
   * Useful for LRU eviction when disk usage exceeds a budget.
   *
   * Only models with status "ready" (not running or downloading) are included
   * since evicting running/active models would break inference.
   *
   * @param budgetBytes Disk budget in bytes. Models are returned until their
   *   cumulative size exceeds budgetBytes above the limit.
   * @returns Array of models that are candidates for eviction, LRU-first.
   */
  async getModelsForEviction(budgetBytes: number): Promise<InstalledModel[]> {
    const totalUsage = await this.getTotalDiskUsage();
    if (totalUsage <= budgetBytes) return [];

    const result = await this.pool.query<ModelRow>(
      `SELECT * FROM agi.models
       WHERE status = 'ready'
       ORDER BY COALESCE(last_used_at, downloaded_at) ASC`,
    );

    const excess = totalUsage - budgetBytes;
    let accumulated = 0;
    const candidates: InstalledModel[] = [];

    for (const row of result.rows) {
      candidates.push(this.mapRow(row));
      accumulated += Number(row.file_size_bytes);
      if (accumulated >= excess) break;
    }

    return candidates;
  }
}
