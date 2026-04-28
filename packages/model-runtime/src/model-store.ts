/**
 * ModelStore — drizzle-based storage for installed HuggingFace models.
 *
 * Tracks model lifecycle state, download progress, and container bindings.
 * Uses the unified agi_data database via @agi/db-schema.
 * Tables renamed from model-runtime's old pg schema:
 *   models → hf_installed
 *   download_progress → hf_download_progress
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { asc, desc, eq, ne, sql } from "drizzle-orm";
import type { Db } from "@agi/db-schema/client";
import { hfInstalled, hfDownloadProgress } from "@agi/db-schema";
import type {
  InstalledModel,
  ModelEndpoint,
  ModelStatus,
  ModelRuntimeType,
  DownloadProgress,
} from "./types.js";

// ---------------------------------------------------------------------------
// Row mapper
// ---------------------------------------------------------------------------

function mapRow(row: typeof hfInstalled.$inferSelect): InstalledModel {
  const endpoints = Array.isArray(row.endpoints) ? row.endpoints as unknown as ModelEndpoint[] : undefined;
  return {
    id: row.id,
    revision: row.revision ?? "unknown",
    displayName: row.displayName ?? row.id,
    pipelineTag: row.pipelineTag ?? "unknown",
    runtimeType: (row.runtimeType ?? "general") as ModelRuntimeType,
    filePath: row.filePath ?? "",
    modelFilename: row.modelFilename ?? undefined,
    fileSizeBytes: Number(row.fileSizeBytes ?? 0),
    quantization: row.quantization ?? undefined,
    status: row.status as ModelStatus,
    downloadedAt: row.downloadedAt instanceof Date ? row.downloadedAt.toISOString() : String(row.downloadedAt ?? ""),
    lastUsedAt: row.lastUsedAt
      ? (row.lastUsedAt instanceof Date ? row.lastUsedAt.toISOString() : String(row.lastUsedAt))
      : undefined,
    error: row.error ?? undefined,
    containerId: row.containerId ?? undefined,
    containerPort: row.containerPort ?? undefined,
    containerName: row.containerName ?? undefined,
    containerImage: row.containerImage ?? undefined,
    sourceRepo: row.sourceRepo ?? undefined,
    endpoints,
    statusChangedAt: row.statusChangedAt
      ? (row.statusChangedAt instanceof Date ? row.statusChangedAt.toISOString() : String(row.statusChangedAt))
      : undefined,
  };
}

function mapProgressRow(row: typeof hfDownloadProgress.$inferSelect): DownloadProgress {
  const totalBytes = Number(row.totalBytes);
  const downloadedBytes = Number(row.downloadedBytes);
  const remaining = totalBytes - downloadedBytes;
  const speedBps = row.speedBps ?? 0;
  const etaSeconds = speedBps > 0 ? remaining / speedBps : 0;
  return {
    modelId: row.modelId,
    filename: row.filename,
    totalBytes,
    downloadedBytes,
    speedBps,
    etaSeconds,
    startedAt: row.startedAt instanceof Date ? row.startedAt.toISOString() : String(row.startedAt),
  };
}

// ---------------------------------------------------------------------------
// ModelStore
// ---------------------------------------------------------------------------

export class ModelStore {
  constructor(private readonly db: Db) {}

  // ---------------------------------------------------------------------------
  // Model CRUD
  // ---------------------------------------------------------------------------

  async addModel(
    model: Omit<InstalledModel, "containerId" | "containerPort" | "containerName">,
  ): Promise<void> {
    await this.db
      .insert(hfInstalled)
      .values({
        id: model.id,
        revision: model.revision,
        displayName: model.displayName,
        pipelineTag: model.pipelineTag,
        runtimeType: model.runtimeType,
        filePath: model.filePath,
        modelFilename: model.modelFilename ?? null,
        fileSizeBytes: model.fileSizeBytes,
        quantization: model.quantization ?? null,
        status: model.status,
        downloadedAt: model.downloadedAt ? new Date(model.downloadedAt) : null,
        lastUsedAt: model.lastUsedAt ? new Date(model.lastUsedAt) : null,
        error: model.error ?? null,
        containerImage: model.containerImage ?? null,
        sourceRepo: model.sourceRepo ?? null,
        endpoints: (model.endpoints ?? null) as unknown[] | null,
        statusChangedAt: new Date(),
      })
      .onConflictDoNothing();
  }

  async updateStatus(id: string, status: ModelStatus): Promise<void> {
    await this.db.update(hfInstalled).set({
      status,
      // Clear error when transitioning out of error state
      error: status !== "error" ? null : undefined,
      statusChangedAt: new Date(),
    }).where(eq(hfInstalled.id, id));
  }

  async updateFilePath(id: string, filePath: string): Promise<void> {
    await this.db.update(hfInstalled).set({ filePath }).where(eq(hfInstalled.id, id));
  }

  async updateContainerImage(id: string, containerImage: string): Promise<void> {
    await this.db.update(hfInstalled).set({ containerImage }).where(eq(hfInstalled.id, id));
  }

  async setError(id: string, error: string): Promise<void> {
    await this.db.update(hfInstalled).set({
      status: "error",
      error,
      statusChangedAt: new Date(),
    }).where(eq(hfInstalled.id, id));
  }

  async bindContainer(
    id: string,
    containerId: string,
    port: number,
    containerName: string,
  ): Promise<void> {
    await this.db.update(hfInstalled).set({
      containerId,
      containerPort: port,
      containerName,
      status: "running",
      statusChangedAt: new Date(),
    }).where(eq(hfInstalled.id, id));
  }

  async unbindContainer(id: string): Promise<void> {
    await this.db.update(hfInstalled).set({
      containerId: null,
      containerPort: null,
      containerName: null,
      status: "ready",
    }).where(eq(hfInstalled.id, id));
  }

  async touchLastUsed(id: string): Promise<void> {
    await this.db
      .update(hfInstalled)
      .set({ lastUsedAt: new Date() })
      .where(eq(hfInstalled.id, id));
  }

  async getById(id: string): Promise<InstalledModel | undefined> {
    const [row] = await this.db
      .select()
      .from(hfInstalled)
      .where(eq(hfInstalled.id, id));
    return row ? mapRow(row) : undefined;
  }

  async getAll(): Promise<InstalledModel[]> {
    const rows = await this.db
      .select()
      .from(hfInstalled)
      .orderBy(desc(hfInstalled.downloadedAt));
    return rows.map(mapRow);
  }

  async getByStatus(status: ModelStatus): Promise<InstalledModel[]> {
    const rows = await this.db
      .select()
      .from(hfInstalled)
      .where(eq(hfInstalled.status, status))
      .orderBy(desc(hfInstalled.downloadedAt));
    return rows.map(mapRow);
  }

  async getByRuntimeType(type: ModelRuntimeType): Promise<InstalledModel[]> {
    const rows = await this.db
      .select()
      .from(hfInstalled)
      .where(eq(hfInstalled.runtimeType, type))
      .orderBy(desc(hfInstalled.downloadedAt));
    return rows.map(mapRow);
  }

  async getRunning(): Promise<InstalledModel[]> {
    const rows = await this.db
      .select()
      .from(hfInstalled)
      .where(eq(hfInstalled.status, "running"))
      .orderBy(desc(hfInstalled.downloadedAt));
    return rows.map(mapRow);
  }

  async remove(id: string): Promise<void> {
    await this.db.delete(hfInstalled).where(eq(hfInstalled.id, id));
  }

  // ---------------------------------------------------------------------------
  // Download progress
  // ---------------------------------------------------------------------------

  async upsertDownloadProgress(progress: DownloadProgress): Promise<void> {
    await this.db
      .insert(hfDownloadProgress)
      .values({
        modelId: progress.modelId,
        filename: progress.filename,
        totalBytes: progress.totalBytes,
        downloadedBytes: progress.downloadedBytes,
        speedBps: progress.speedBps,
        startedAt: new Date(progress.startedAt),
      })
      .onConflictDoUpdate({
        target: hfDownloadProgress.modelId,
        set: {
          filename: progress.filename,
          totalBytes: progress.totalBytes,
          downloadedBytes: progress.downloadedBytes,
          speedBps: progress.speedBps,
          startedAt: new Date(progress.startedAt),
        },
      });
  }

  async getDownloadProgress(modelId: string): Promise<DownloadProgress | undefined> {
    const [row] = await this.db
      .select()
      .from(hfDownloadProgress)
      .where(eq(hfDownloadProgress.modelId, modelId));
    return row ? mapProgressRow(row) : undefined;
  }

  async clearDownloadProgress(modelId: string): Promise<void> {
    await this.db
      .delete(hfDownloadProgress)
      .where(eq(hfDownloadProgress.modelId, modelId));
  }

  // ---------------------------------------------------------------------------
  // Aggregates
  // ---------------------------------------------------------------------------

  async getTotalDiskUsage(): Promise<number> {
    const [row] = await this.db
      .select({
        total: sql<string>`COALESCE(SUM(${hfInstalled.fileSizeBytes}), 0)::TEXT`,
      })
      .from(hfInstalled)
      .where(ne(hfInstalled.status, "removing"));
    return Number(row?.total ?? 0);
  }

  async getModelsForEviction(budgetBytes: number): Promise<InstalledModel[]> {
    const totalUsage = await this.getTotalDiskUsage();
    if (totalUsage <= budgetBytes) return [];

    const rows = await this.db
      .select()
      .from(hfInstalled)
      .where(eq(hfInstalled.status, "ready"))
      .orderBy(asc(sql`COALESCE(${hfInstalled.lastUsedAt}, ${hfInstalled.downloadedAt})`));

    const excess = totalUsage - budgetBytes;
    let accumulated = 0;
    const candidates: InstalledModel[] = [];

    for (const row of rows) {
      candidates.push(mapRow(row));
      accumulated += Number(row.fileSizeBytes ?? 0);
      if (accumulated >= excess) break;
    }

    return candidates;
  }

  // ---------------------------------------------------------------------------
  // Disk reconciliation
  // ---------------------------------------------------------------------------

  async reconcileFromDisk(
    cacheDir: string,
    fetchModelInfo?: (
      modelId: string,
    ) => Promise<{
      pipeline_tag?: string;
      author?: string;
      siblings?: Array<{ rfilename: string; size?: number }>;
    } | null>,
  ): Promise<number> {
    const hubDir = join(cacheDir, "hub");
    if (!existsSync(hubDir)) return 0;

    let dirs: string[];
    try {
      dirs = readdirSync(hubDir).filter((d) => d.startsWith("models--"));
    } catch {
      return 0;
    }

    let reconciled = 0;

    for (const dir of dirs) {
      const withoutPrefix = dir.slice("models--".length);
      const parts = withoutPrefix.split("--");
      if (parts.length < 2) continue;
      const modelId = parts.join("/");

      const existing = await this.getById(modelId);
      if (existing && existing.pipelineTag !== "unknown") {
        // Fix stale filePath: if it points to the HF cache wrapper instead of the snapshot dir
        if (existing.filePath && !existing.filePath.includes("/snapshots/")) {
          const snapshotsCheck = join(existing.filePath, "snapshots");
          if (existsSync(snapshotsCheck)) {
            try {
              const refs = readdirSync(snapshotsCheck).filter(
                (r) => statSync(join(snapshotsCheck, r)).isDirectory(),
              );
              if (refs.length > 0) {
                const corrected = join(snapshotsCheck, refs[0]!);
                await this.updateFilePath(modelId, corrected);
                reconciled++;
              }
            } catch { /* ignore */ }
          }
        }
        continue;
      }
      if (existing) {
        await this.remove(modelId);
      }

      const displayName = parts[parts.length - 1] ?? modelId;

      const modelCacheDir = join(hubDir, dir);
      const snapshotsDir = join(modelCacheDir, "snapshots");
      let filePath = modelCacheDir;
      if (existsSync(snapshotsDir)) {
        try {
          const refs = readdirSync(snapshotsDir).filter(
            (r) => statSync(join(snapshotsDir, r)).isDirectory(),
          );
          if (refs.length > 0) {
            filePath = join(snapshotsDir, refs[0]!);
          }
        } catch { /* fall back to cache dir */ }
      }

      let fileSizeBytes = 0;
      try {
        const files = readdirSync(filePath, { recursive: true, withFileTypes: true });
        for (const f of files) {
          if (f.isFile()) {
            try {
              const stat = statSync(join(f.parentPath ?? f.path, f.name));
              fileSizeBytes += stat.size;
            } catch { /* skip unreadable files */ }
          }
        }
      } catch { /* directory not readable */ }

      let pipelineTag = "unknown";
      let runtimeType: string = "general";
      if (fetchModelInfo) {
        try {
          const info = await fetchModelInfo(modelId);
          if (info?.pipeline_tag) {
            pipelineTag = info.pipeline_tag;
            const LLM_TAGS = new Set(["text-generation", "text2text-generation", "conversational"]);
            const DIFFUSION_TAGS = new Set(["text-to-image", "image-to-image"]);
            if (LLM_TAGS.has(pipelineTag)) runtimeType = "llm";
            else if (DIFFUSION_TAGS.has(pipelineTag)) runtimeType = "diffusion";
            else runtimeType = "general";
          }
        } catch { /* HF API unavailable — use defaults */ }
      }

      await this.addModel({
        id: modelId,
        revision: "unknown",
        displayName,
        pipelineTag,
        runtimeType: runtimeType as "llm" | "general" | "diffusion" | "custom",
        filePath,
        fileSizeBytes,
        status: "ready",
        downloadedAt: new Date().toISOString(),
      });

      reconciled++;
    }

    return reconciled;
  }
}
