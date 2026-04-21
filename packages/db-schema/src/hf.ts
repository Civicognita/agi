/**
 * HuggingFace runtime tables.
 *
 * Tracks installed HF models (not the HF hub catalog — that's queried live
 * at search time). `hf_installed` replaces model-runtime's existing `models`
 * table; `hf_download_progress` and `hf_datasets` keep their existing shapes
 * with rename + type conversion to Postgres primitives.
 *
 * No `hf_marketplace` catalog table — HF hub is queried live; local catalog
 * caching isn't part of this design.
 */

import {
  bigint,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * Installed HF model. One row per (model, variant). Tracks local file
 * location, container binding, and runtime status.
 */
export const hfInstalled = pgTable(
  "hf_installed",
  {
    id: text("id").primaryKey(),
    revision: text("revision"),
    displayName: text("display_name"),
    pipelineTag: text("pipeline_tag"),
    runtimeType: text("runtime_type"),
    filePath: text("file_path"),
    modelFilename: text("model_filename"),
    fileSizeBytes: bigint("file_size_bytes", { mode: "number" }),
    quantization: text("quantization"),
    status: text("status").notNull().default("ready"),
    downloadedAt: timestamp("downloaded_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    error: text("error"),
    containerId: text("container_id"),
    containerPort: integer("container_port"),
    containerName: text("container_name"),
    containerImage: text("container_image"),
    sourceRepo: text("source_repo"),
    endpoints: jsonb("endpoints"),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    statusIdx: index("hf_installed_status_idx").on(t.status),
    pipelineIdx: index("hf_installed_pipeline_idx").on(t.pipelineTag),
  }),
);

/** Chunked model download state — resumption tracking. */
export const hfDownloadProgress = pgTable("hf_download_progress", {
  modelId: text("model_id").primaryKey(),
  filename: text("filename").notNull(),
  totalBytes: bigint("total_bytes", { mode: "number" }).notNull(),
  downloadedBytes: bigint("downloaded_bytes", { mode: "number" }).notNull(),
  speedBps: doublePrecision("speed_bps"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Installed HF datasets — for fine-tuning workflows. */
export const hfDatasets = pgTable(
  "hf_datasets",
  {
    id: text("id").primaryKey(),
    revision: text("revision"),
    displayName: text("display_name"),
    description: text("description"),
    filePath: text("file_path"),
    fileSizeBytes: bigint("file_size_bytes", { mode: "number" }),
    fileCount: integer("file_count"),
    status: text("status").notNull().default("ready"),
    downloadedAt: timestamp("downloaded_at", { withTimezone: true }),
    tags: jsonb("tags"),
    error: text("error"),
  },
  (t) => ({
    statusIdx: index("hf_datasets_status_idx").on(t.status),
  }),
);
