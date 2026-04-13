/**
 * HuggingFace API Routes — REST endpoints for local HF model management.
 *
 * Provides:
 * - Hardware profiling + capability inspection
 * - HF Hub search and model info (with local compatibility enrichment)
 * - Model install, lifecycle (start/stop/status), and removal
 * - Inference forwarding (chat, embed, image generation)
 * - HF Hub auth status
 * - Agent tool and provider introspection
 */

import { rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type {
  HardwareProfiler,
  HfHubClient,
  ModelStore,
  DatasetStore,
  ModelContainerManager,
  CapabilityResolver,
  InferenceGateway,
  KnownModelsRegistry,
  CustomContainerBuilder,
} from "@aionima/model-runtime";
import type { ModelAgentBridge } from "@aionima/model-runtime";
import type { FineTuneManager } from "./finetune-manager.js";

// ---------------------------------------------------------------------------
// Deps shape
// ---------------------------------------------------------------------------

export interface HfApiDeps {
  hardwareProfiler: HardwareProfiler;
  hfClient: HfHubClient;
  modelStore: ModelStore;
  datasetStore: DatasetStore;
  containerManager: ModelContainerManager;
  capabilityResolver: CapabilityResolver;
  inferenceGateway: InferenceGateway;
  agentBridge: ModelAgentBridge;
  knownModelsRegistry: KnownModelsRegistry;
  customContainerBuilder: CustomContainerBuilder;
  fineTuneManager: FineTuneManager;
  /** Returns true if hf.enabled is set in the current (hot-reloaded) config. */
  isEnabled?: () => boolean;
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerHfRoutes(
  fastify: FastifyInstance,
  deps: HfApiDeps,
): void {
  const {
    hardwareProfiler,
    hfClient,
    modelStore,
    datasetStore,
    containerManager,
    capabilityResolver,
    inferenceGateway,
    agentBridge,
    knownModelsRegistry,
    customContainerBuilder,
    fineTuneManager,
    isEnabled,
  } = deps;

  // Prehandler hook: return 503 for non-hardware HF routes when disabled
  fastify.addHook("onRequest", async (request, reply) => {
    const url = request.url;
    if (!url.startsWith("/api/hf/")) return;
    // Hardware + capabilities routes always work (local system info)
    if (url.startsWith("/api/hf/hardware") || url.startsWith("/api/hf/capabilities")) return;
    // Everything else requires hf.enabled
    if (isEnabled !== undefined && !isEnabled()) {
      return reply.code(503).send({ error: "HF Marketplace is not enabled. Enable it in Settings > HF Marketplace." });
    }
  });

  // -------------------------------------------------------------------------
  // Hardware (always available — reads local system, no HF dependency)
  // -------------------------------------------------------------------------

  fastify.get("/api/hf/hardware", async (_request, reply) => {
    try {
      const profile = hardwareProfiler.getProfile();
      return reply.send(profile);
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  fastify.post("/api/hf/hardware/rescan", async (_request, reply) => {
    try {
      const profile = await hardwareProfiler.rescan();
      return reply.send(profile);
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  fastify.get("/api/hf/capabilities", async (_request, reply) => {
    try {
      const profile = hardwareProfiler.getProfile();
      return reply.send(profile.capabilities.capabilityMap);
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // -------------------------------------------------------------------------
  // Model browsing (HF Hub proxy)
  // -------------------------------------------------------------------------

  fastify.get("/api/hf/search", async (request, reply) => {
    try {
      const query = request.query as {
        q?: string;
        pipeline_tag?: string;
        library?: string;
        sort?: "downloads" | "likes" | "trending" | "lastModified";
        limit?: string;
        offset?: string;
      };

      const models = await hfClient.searchModels({
        search: query.q,
        pipeline_tag: query.pipeline_tag,
        library: query.library,
        sort: query.sort,
        limit: query.limit !== undefined ? Number(query.limit) : undefined,
        offset: query.offset !== undefined ? Number(query.offset) : undefined,
      });

      const enriched = models.map((model) => {
        const { compatibility, reason } = capabilityResolver.assessCompatibility(model);
        const estimate = capabilityResolver.estimateResources(model);
        return {
          ...model,
          compatibility,
          compatibilityReason: reason,
          estimate,
        };
      });

      return reply.send(enriched);
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  fastify.get<{ Params: { modelId: string } }>(
    "/api/hf/models/detail/:modelId",
    async (request, reply) => {
      try {
        const modelId = decodeURIComponent(request.params.modelId);

        if (!modelId) {
          return reply.code(400).send({ error: "modelId is required" });
        }

        const [model, treeFiles] = await Promise.all([
          hfClient.getModelInfo(modelId),
          hfClient.getModelFiles(modelId).catch(() => []),
        ]);

        // Merge file sizes from tree API into siblings (model info doesn't include sizes)
        if (model.siblings && treeFiles.length > 0) {
          const sizeMap = new Map(treeFiles.map((f) => [f.rfilename, f.size ?? 0]));
          for (const sib of model.siblings) {
            if (sib.size === undefined || sib.size === 0) {
              sib.size = sizeMap.get(sib.rfilename);
            }
          }
        } else if (!model.siblings && treeFiles.length > 0) {
          model.siblings = treeFiles;
        }

        const { compatibility, reason } = capabilityResolver.assessCompatibility(model);
        const estimate = capabilityResolver.estimateResources(model);
        const variants = capabilityResolver.resolveVariants(model);

        return reply.send({
          ...model,
          compatibility,
          compatibilityReason: reason,
          estimate,
          variants,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("404") || msg.toLowerCase().includes("not found")) {
          return reply.code(404).send({ error: msg });
        }
        return reply.code(500).send({ error: msg });
      }
    },
  );

  // -------------------------------------------------------------------------
  // Model management
  // -------------------------------------------------------------------------

  fastify.post("/api/hf/models/install", async (request, reply) => {
    try {
      const body = request.body as { id?: string; revision?: string; filename?: string } | undefined;

      if (!body?.id || !body?.filename) {
        return reply.code(400).send({ error: "id and filename are required" });
      }

      const { id, revision = "main", filename } = body;

      // Build download destination: ~/.agi/models/hub/models--{org}--{name}/snapshots/{revision}/
      const cacheDir = hardwareProfiler.getProfile().disk.modelCachePath;
      const safeId = id.replace(/\//g, "--");
      const modelDir = join(cacheDir, "hub", `models--${safeId}`, "snapshots", revision);
      const destPath = join(modelDir, filename);
      mkdirSync(modelDir, { recursive: true });

      // Look up model info to populate display metadata
      const modelInfo = await hfClient.getModelInfo(id);
      const runtimeType = capabilityResolver.resolveRuntimeType(modelInfo);

      // Get actual file size from tree API
      const treeFiles = await hfClient.getModelFiles(id, revision).catch(() => []);
      const fileEntry = treeFiles.find((f) => f.rfilename === filename);
      const fileSizeBytes = fileEntry?.size ?? 0;

      const downloadedAt = new Date().toISOString();

      // Add to store immediately as "downloading"
      modelStore.addModel({
        id,
        revision,
        displayName: modelInfo.modelId ?? id,
        pipelineTag: modelInfo.pipeline_tag ?? "unknown",
        runtimeType,
        filePath: modelDir,
        modelFilename: filename,
        fileSizeBytes,
        status: "downloading",
        downloadedAt,
      });

      // Fire-and-forget download — download main model file + all small support files
      // (config.json, tokenizer.json, etc. that transformers needs to load the model)
      const SUPPORT_FILE_MAX_SIZE = 10 * 1024 * 1024; // 10 MB — anything smaller is a support file
      const supportFiles = treeFiles.filter((f) => {
        if (f.rfilename === filename) return false; // skip the main model file
        if (!f.size || f.size > SUPPORT_FILE_MAX_SIZE) return false; // skip large files
        const ext = f.rfilename.split(".").pop()?.toLowerCase() ?? "";
        // Include config, tokenizer, and metadata files
        return ["json", "txt", "model", "md"].includes(ext) || f.rfilename.includes("tokenizer") || f.rfilename.includes("config") || f.rfilename.includes("vocab") || f.rfilename.includes("merges");
      });

      void (async () => {
        try {
          // Download support files first (small, fast)
          for (const sf of supportFiles) {
            await hfClient.downloadFile({
              modelId: id,
              revision,
              filename: sf.rfilename,
              destPath: join(modelDir, sf.rfilename),
            });
          }
          // Download the main model file
          await hfClient.downloadFile({
            modelId: id,
            revision,
            filename,
            destPath,
          });
          modelStore.updateStatus(id, "ready");

          // Check if total disk usage exceeds the available disk space (warn only — no auto-delete)
          const totalUsage = modelStore.getTotalDiskUsage();
          const diskInfo = hardwareProfiler.getProfile().disk;
          if (diskInfo.availableBytes > 0 && totalUsage > diskInfo.availableBytes * 0.9) {
            const usedGB = (totalUsage / (1024 ** 3)).toFixed(1);
            const availGB = (diskInfo.availableBytes / (1024 ** 3)).toFixed(1);
            fastify.log.warn(`HF model cache (${usedGB} GB) is using >90% of available disk space (${availGB} GB free). Consider removing unused models.`);
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          modelStore.setError(id, msg);
        }
      })();

      return reply.send({ ok: true, id, status: "downloading", fileSizeBytes });
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  fastify.delete<{ Params: { modelId: string } }>(
    "/api/hf/models/:modelId",
    async (request, reply) => {
      try {
        const modelId = decodeURIComponent(request.params.modelId);

        if (!modelId) {
          return reply.code(400).send({ error: "modelId is required" });
        }

        const model = modelStore.getById(modelId);
        if (!model) {
          return reply.code(404).send({ error: `Model not found: ${modelId}` });
        }

        // Stop container if running
        const containerState = containerManager.getStatus(modelId);
        if (containerState && containerState.status === "running") {
          await containerManager.stop(modelId);
        }

        // Remove model files from disk
        if (model.filePath) {
          rmSync(model.filePath, { recursive: true, force: true });
        }

        // Remove from store
        modelStore.remove(modelId);

        return reply.send({ ok: true });
      } catch (err) {
        return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  fastify.get("/api/hf/models", async (_request, reply) => {
    try {
      const models = modelStore.getAll();
      return reply.send(models);
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  fastify.post<{ Params: { modelId: string } }>(
    "/api/hf/models/:modelId/start",
    async (request, reply) => {
      try {
        const modelId = decodeURIComponent(request.params.modelId);

        if (!modelId) {
          return reply.code(400).send({ error: "modelId is required" });
        }

        const model = modelStore.getById(modelId);
        if (!model) {
          return reply.code(404).send({ error: `Model not found: ${modelId}` });
        }

        const containerConfig = capabilityResolver.buildContainerConfig(model);

        modelStore.updateStatus(modelId, "starting");

        // Fire-and-forget: container start may take minutes (image pull + model load)
        void containerManager
          .start(model, containerConfig)
          .then((containerState) => {
            modelStore.bindContainer(
              modelId,
              containerState.containerId,
              containerState.port,
              containerState.containerName,
            );
          })
          .catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            modelStore.setError(modelId, msg);
          });

        return reply.send({ ok: true, status: "starting" });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const modelId = decodeURIComponent(request.params.modelId);
        if (modelId) {
          modelStore.setError(modelId, msg);
        }
        return reply.code(500).send({ error: msg });
      }
    },
  );

  fastify.post<{ Params: { modelId: string } }>(
    "/api/hf/models/:modelId/stop",
    async (request, reply) => {
      try {
        const modelId = decodeURIComponent(request.params.modelId);

        if (!modelId) {
          return reply.code(400).send({ error: "modelId is required" });
        }

        const model = modelStore.getById(modelId);
        if (!model) {
          return reply.code(404).send({ error: `Model not found: ${modelId}` });
        }

        modelStore.updateStatus(modelId, "stopping");
        await containerManager.stop(modelId);
        modelStore.unbindContainer(modelId);
        modelStore.updateStatus(modelId, "ready");

        return reply.send({ ok: true });
      } catch (err) {
        return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  fastify.get<{ Params: { modelId: string } }>(
    "/api/hf/models/:modelId/status",
    async (request, reply) => {
      try {
        const modelId = decodeURIComponent(request.params.modelId);

        if (!modelId) {
          return reply.code(400).send({ error: "modelId is required" });
        }

        const model = modelStore.getById(modelId);
        if (!model) {
          return reply.code(404).send({ error: `Model not found: ${modelId}` });
        }

        const containerStatus = containerManager.getStatus(modelId);
        return reply.send({ model, containerStatus: containerStatus ?? null });
      } catch (err) {
        return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  // -------------------------------------------------------------------------
  // Model update detection
  // -------------------------------------------------------------------------

  fastify.get<{ Params: { modelId: string } }>(
    "/api/hf/models/:modelId/check-update",
    async (request, reply) => {
      try {
        const modelId = decodeURIComponent(request.params.modelId);

        if (!modelId) {
          return reply.code(400).send({ error: "modelId is required" });
        }

        const model = modelStore.getById(modelId);
        if (!model) {
          return reply.code(404).send({ error: `Model not found: ${modelId}` });
        }

        // Fetch the latest model info from HF Hub — sha is the latest commit revision
        const remoteInfo = await hfClient.getModelInfo(modelId);
        const latestRevision = remoteInfo.sha ?? "unknown";
        const installedRevision = model.revision;

        // A revision of "main" means we downloaded from the default branch
        // without pinning — we cannot reliably compare it, so just return false
        const updateAvailable =
          installedRevision !== "main" &&
          latestRevision !== "unknown" &&
          latestRevision !== installedRevision;

        return reply.send({ updateAvailable, installedRevision, latestRevision });
      } catch (err) {
        return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  fastify.get("/api/hf/running", async (_request, reply) => {
    try {
      const running = containerManager.getRunning();
      return reply.send(running);
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // -------------------------------------------------------------------------
  // Inference
  // -------------------------------------------------------------------------

  fastify.post<{ Params: { modelId: string } }>(
    "/api/hf/inference/:modelId/chat",
    async (request, reply) => {
      try {
        const modelId = decodeURIComponent(request.params.modelId);

        if (!modelId) {
          return reply.code(400).send({ error: "modelId is required" });
        }

        const body = request.body as Parameters<InferenceGateway["chatCompletion"]>[1];
        const result = await inferenceGateway.chatCompletion(modelId, body);
        return reply.send(result);
      } catch (err) {
        return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  fastify.post<{ Params: { modelId: string } }>(
    "/api/hf/inference/:modelId/embed",
    async (request, reply) => {
      try {
        const modelId = decodeURIComponent(request.params.modelId);

        if (!modelId) {
          return reply.code(400).send({ error: "modelId is required" });
        }

        const body = request.body as Parameters<InferenceGateway["embedText"]>[1];
        const result = await inferenceGateway.embedText(modelId, body);
        return reply.send(result);
      } catch (err) {
        return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  fastify.post<{ Params: { modelId: string } }>(
    "/api/hf/inference/:modelId/generate",
    async (request, reply) => {
      try {
        const modelId = decodeURIComponent(request.params.modelId);

        if (!modelId) {
          return reply.code(400).send({ error: "modelId is required" });
        }

        const body = request.body as Parameters<InferenceGateway["generateImage"]>[1];
        const result = await inferenceGateway.generateImage(modelId, body);
        return reply.send(result);
      } catch (err) {
        return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  // -------------------------------------------------------------------------
  // Custom model proxy + endpoints
  // -------------------------------------------------------------------------

  /**
   * Generic proxy route for custom model containers.
   * Forwards any path and body to the model's running container.
   *
   * Example: POST /api/hf/models/NeoQuasar%2FKronos-base/proxy/predict
   *   → forwards to http://localhost:{port}/predict
   */
  fastify.post<{ Params: { modelId: string; "*": string } }>(
    "/api/hf/models/:modelId/proxy/*",
    async (request, reply) => {
      try {
        const modelId = decodeURIComponent(request.params.modelId);
        const proxyPath = `/${request.params["*"] ?? ""}`;

        if (!modelId) {
          return reply.code(400).send({ error: "modelId is required" });
        }

        const model = modelStore.getById(modelId);
        if (!model) {
          return reply.code(404).send({ error: `Model not found: ${modelId}` });
        }

        const result = await inferenceGateway.proxyRequest(modelId, proxyPath, request.body);
        return reply.send(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("not running")) return reply.code(409).send({ error: msg });
        if (msg.includes("not found")) return reply.code(404).send({ error: msg });
        return reply.code(500).send({ error: msg });
      }
    },
  );

  /**
   * Return the declared endpoints for a custom model.
   * Returns an empty array for standard (non-custom) models.
   */
  fastify.get<{ Params: { modelId: string } }>(
    "/api/hf/models/:modelId/endpoints",
    async (request, reply) => {
      try {
        const modelId = decodeURIComponent(request.params.modelId);

        if (!modelId) {
          return reply.code(400).send({ error: "modelId is required" });
        }

        const model = modelStore.getById(modelId);
        if (!model) {
          return reply.code(404).send({ error: `Model not found: ${modelId}` });
        }

        return reply.send(model.endpoints ?? []);
      } catch (err) {
        return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  // -------------------------------------------------------------------------
  // Dataset browsing (HF Hub proxy)
  // -------------------------------------------------------------------------

  fastify.get("/api/hf/datasets/search", async (request, reply) => {
    try {
      const query = request.query as {
        q?: string;
        sort?: "downloads" | "likes" | "trendingScore" | "lastModified";
        limit?: string;
        offset?: string;
        filter?: string;
      };

      const datasets = await hfClient.searchDatasets({
        search: query.q,
        sort: query.sort,
        limit: query.limit !== undefined ? Number(query.limit) : undefined,
        offset: query.offset !== undefined ? Number(query.offset) : undefined,
        filter: query.filter,
      });

      return reply.send(datasets);
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  fastify.get<{ Params: { datasetId: string } }>(
    "/api/hf/datasets/detail/:datasetId",
    async (request, reply) => {
      try {
        const datasetId = decodeURIComponent(request.params.datasetId);

        if (!datasetId) {
          return reply.code(400).send({ error: "datasetId is required" });
        }

        const [dataset, treeFiles] = await Promise.all([
          hfClient.getDatasetInfo(datasetId),
          hfClient.getDatasetFiles(datasetId).catch(() => []),
        ]);

        // Merge file listing into siblings
        if (!dataset.siblings && treeFiles.length > 0) {
          dataset.siblings = treeFiles;
        }

        return reply.send({ ...dataset, files: treeFiles });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("404") || msg.toLowerCase().includes("not found")) {
          return reply.code(404).send({ error: msg });
        }
        return reply.code(500).send({ error: msg });
      }
    },
  );

  // -------------------------------------------------------------------------
  // Dataset management
  // -------------------------------------------------------------------------

  fastify.post("/api/hf/datasets/install", async (request, reply) => {
    try {
      const body = request.body as { id?: string; revision?: string } | undefined;

      if (!body?.id) {
        return reply.code(400).send({ error: "id is required" });
      }

      const { id, revision = "main" } = body;

      // Check if already installed
      const existing = datasetStore.getById(id);
      if (existing && existing.status !== "error") {
        return reply.code(409).send({ error: `Dataset already installed: ${id}` });
      }

      // Fetch dataset info and file listing from HF Hub
      const [datasetInfo, treeFiles] = await Promise.all([
        hfClient.getDatasetInfo(id),
        hfClient.getDatasetFiles(id, revision).catch(() => []),
      ]);

      // Build download destination: ~/.agi/datasets/hub/datasets--{safeId}/snapshots/{revision}/
      const hfCacheDir = hardwareProfiler.getProfile().disk.modelCachePath;
      const datasetsBaseDir = join(hfCacheDir, "..", "datasets");
      const safeId = id.replace(/\//g, "--");
      const datasetDir = join(datasetsBaseDir, "hub", `datasets--${safeId}`, "snapshots", revision);
      mkdirSync(datasetDir, { recursive: true });

      const totalSize = treeFiles.reduce((acc, f) => acc + (f.size ?? f.lfs?.size ?? 0), 0);
      const downloadedAt = new Date().toISOString();

      const displayName = id.includes("/") ? id.split("/").pop() ?? id : id;

      // Add to store as "downloading"
      const datasetEntry = {
        id,
        revision,
        displayName,
        description: datasetInfo.description,
        filePath: datasetDir,
        fileSizeBytes: totalSize,
        fileCount: treeFiles.length,
        status: "downloading" as const,
        downloadedAt,
        tags: datasetInfo.tags ?? [],
      };

      if (existing) {
        // Re-install after error — remove stale entry first
        datasetStore.remove(id);
      }
      datasetStore.addDataset(datasetEntry);

      // Fire-and-forget: download ALL dataset files
      void (async () => {
        try {
          for (const file of treeFiles) {
            const destPath = join(datasetDir, file.rfilename);
            // Create any subdirectories inside the dataset dir
            mkdirSync(join(datasetDir, file.rfilename).replace(/\/[^/]+$/, ""), { recursive: true });
            await hfClient.downloadFile({
              modelId: id,
              revision,
              filename: file.rfilename,
              destPath,
            });
          }
          datasetStore.updateStatus(id, "ready");
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          datasetStore.setError(id, msg);
        }
      })();

      return reply.send({ ok: true, id, status: "downloading", fileCount: treeFiles.length, fileSizeBytes: totalSize });
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  fastify.get("/api/hf/datasets", async (_request, reply) => {
    try {
      const datasets = datasetStore.getAll();
      return reply.send(datasets);
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  fastify.delete<{ Params: { datasetId: string } }>(
    "/api/hf/datasets/:datasetId",
    async (request, reply) => {
      try {
        const datasetId = decodeURIComponent(request.params.datasetId);

        if (!datasetId) {
          return reply.code(400).send({ error: "datasetId is required" });
        }

        const dataset = datasetStore.getById(datasetId);
        if (!dataset) {
          return reply.code(404).send({ error: `Dataset not found: ${datasetId}` });
        }

        datasetStore.updateStatus(datasetId, "removing");

        // Remove dataset files from disk
        if (dataset.filePath) {
          rmSync(dataset.filePath, { recursive: true, force: true });
        }

        // Remove from store
        datasetStore.remove(datasetId);

        return reply.send({ ok: true });
      } catch (err) {
        return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  // -------------------------------------------------------------------------
  // Auth
  // -------------------------------------------------------------------------

  fastify.get("/api/hf/auth/status", async (_request, reply) => {
    try {
      const status = await hfClient.getAuthStatus();
      return reply.send(status);
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // -------------------------------------------------------------------------
  // Agent tools
  // -------------------------------------------------------------------------

  fastify.get("/api/hf/agent/tools", async (_request, reply) => {
    try {
      const tools = agentBridge.getRegisteredTools();
      // Convert Map to plain object for JSON serialization
      const result: Record<string, string[]> = {};
      for (const [modelId, toolNames] of tools) {
        result[modelId] = toolNames;
      }
      return reply.send(result);
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  fastify.get("/api/hf/agent/providers", async (_request, reply) => {
    try {
      const providers = agentBridge.getRegisteredProviders();
      // Convert Map to plain object for JSON serialization
      const result: Record<string, { label: string }> = {};
      for (const [modelId, info] of providers) {
        result[modelId] = info;
      }
      return reply.send(result);
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // -------------------------------------------------------------------------
  // Wizard API — multi-step model install
  // -------------------------------------------------------------------------

  /**
   * POST /api/hf/models/wizard/analyze
   * Combines model info + variant resolution + runtime detection + hardware compat
   * into a single call for the install wizard frontend.
   */
  fastify.post("/api/hf/models/wizard/analyze", async (request, reply) => {
    try {
      const body = request.body as { modelId?: string } | undefined;

      if (!body?.modelId) {
        return reply.code(400).send({ error: "modelId is required" });
      }

      const { modelId } = body;

      const [modelInfo, treeFiles] = await Promise.all([
        hfClient.getModelInfo(modelId),
        hfClient.getModelFiles(modelId).catch(() => []),
      ]);

      // Merge file sizes from tree API
      if (modelInfo.siblings && treeFiles.length > 0) {
        const sizeMap = new Map(treeFiles.map((f) => [f.rfilename, f.size ?? 0]));
        for (const sib of modelInfo.siblings) {
          if (sib.size === undefined || sib.size === 0) {
            sib.size = sizeMap.get(sib.rfilename);
          }
        }
      } else if (!modelInfo.siblings && treeFiles.length > 0) {
        modelInfo.siblings = treeFiles;
      }

      // Resolve runtime type and check for known custom definition
      const runtimeType = capabilityResolver.resolveRuntimeType(modelInfo);
      const customDefinition = knownModelsRegistry.lookup(modelId) ?? null;
      const isCustom = runtimeType === "custom" || customDefinition !== null;

      const variants = capabilityResolver.resolveVariants(modelInfo);
      const { compatibility, reason } = capabilityResolver.assessCompatibility(modelInfo);
      const estimatedResources = capabilityResolver.estimateResources(modelInfo);

      return reply.send({
        model: {
          ...modelInfo,
          compatibility,
          compatibilityReason: reason,
          estimate: estimatedResources,
          variants,
        },
        runtimeType: isCustom ? "custom" : runtimeType,
        isCustom,
        customDefinition: customDefinition ? (customDefinition as unknown as Record<string, unknown>) : null,
        variants,
        hardwareCompatibility: { compatibility, reason },
        estimatedResources,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("404") || msg.toLowerCase().includes("not found")) {
        return reply.code(404).send({ error: msg });
      }
      return reply.code(500).send({ error: msg });
    }
  });

  /**
   * POST /api/hf/models/wizard/install
   * Full install endpoint used by the wizard — supports custom models via container build.
   */
  fastify.post("/api/hf/models/wizard/install", async (request, reply) => {
    try {
      const body = request.body as {
        modelId?: string;
        revision?: string;
        filename?: string;
        runtimeType?: string;
        containerImage?: string;
        customConfig?: Record<string, unknown>;
      } | undefined;

      if (!body?.modelId) {
        return reply.code(400).send({ error: "modelId is required" });
      }

      const { modelId, revision = "main", filename, containerImage } = body;

      const modelInfo = await hfClient.getModelInfo(modelId);
      const runtimeType = capabilityResolver.resolveRuntimeType(modelInfo);
      const customDefinition = knownModelsRegistry.lookup(modelId);
      const isCustom = runtimeType === "custom" || customDefinition !== null;

      // For custom models without a specific file, trigger container build then install
      if (isCustom && customDefinition && !filename) {
        const cacheDir = hardwareProfiler.getProfile().disk.modelCachePath;

        // Add a placeholder entry with "building" status
        const downloadedAt = new Date().toISOString();
        modelStore.addModel({
          id: modelId,
          revision,
          displayName: customDefinition.label,
          pipelineTag: modelInfo.pipeline_tag ?? "custom",
          runtimeType: "custom",
          filePath: cacheDir,
          modelFilename: undefined,
          fileSizeBytes: 0,
          status: "downloading",
          downloadedAt,
          containerImage: containerImage ?? undefined,
          sourceRepo: customDefinition.sourceRepo ?? undefined,
        });

        // Fire-and-forget: build container image
        void (async () => {
          try {
            const imageTag = await customContainerBuilder.build(modelId, customDefinition);
            modelStore.updateStatus(modelId, "ready");
            // Store the built image tag so container manager uses it
            const existing = modelStore.getById(modelId);
            if (existing) {
              modelStore.addModel({
                ...existing,
                containerImage: imageTag,
                status: "ready",
              });
            }
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            modelStore.setError(modelId, msg);
          }
        })();

        return reply.send({ ok: true, status: "building" });
      }

      // Standard install — requires filename
      if (!filename) {
        return reply.code(400).send({ error: "filename is required for non-custom models" });
      }

      const cacheDir = hardwareProfiler.getProfile().disk.modelCachePath;
      const safeId = modelId.replace(/\//g, "--");
      const modelDir = join(cacheDir, "hub", `models--${safeId}`, "snapshots", revision);
      const destPath = join(modelDir, filename);
      mkdirSync(modelDir, { recursive: true });

      const treeFiles = await hfClient.getModelFiles(modelId, revision).catch(() => []);
      const fileEntry = treeFiles.find((f) => f.rfilename === filename);
      const fileSizeBytes = fileEntry?.size ?? 0;
      const downloadedAt = new Date().toISOString();

      const resolvedRuntime = (body.runtimeType as "llm" | "general" | "diffusion" | "custom" | undefined) ?? runtimeType;

      modelStore.addModel({
        id: modelId,
        revision,
        displayName: modelInfo.modelId ?? modelId,
        pipelineTag: modelInfo.pipeline_tag ?? "unknown",
        runtimeType: resolvedRuntime,
        filePath: modelDir,
        modelFilename: filename,
        fileSizeBytes,
        status: "downloading",
        downloadedAt,
        containerImage: containerImage ?? undefined,
      });

      const SUPPORT_FILE_MAX_SIZE = 10 * 1024 * 1024;
      const supportFiles = treeFiles.filter((f) => {
        if (f.rfilename === filename) return false;
        if (!f.size || f.size > SUPPORT_FILE_MAX_SIZE) return false;
        const ext = f.rfilename.split(".").pop()?.toLowerCase() ?? "";
        return ["json", "txt", "model", "md"].includes(ext) || f.rfilename.includes("tokenizer") || f.rfilename.includes("config") || f.rfilename.includes("vocab") || f.rfilename.includes("merges");
      });

      void (async () => {
        try {
          for (const sf of supportFiles) {
            await hfClient.downloadFile({
              modelId,
              revision,
              filename: sf.rfilename,
              destPath: join(modelDir, sf.rfilename),
            });
          }
          await hfClient.downloadFile({ modelId, revision, filename, destPath });
          modelStore.updateStatus(modelId, "ready");
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          modelStore.setError(modelId, msg);
        }
      })();

      return reply.send({ ok: true, status: "downloading" });
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // -------------------------------------------------------------------------
  // Fine-Tune API
  // -------------------------------------------------------------------------

  fastify.post("/api/hf/finetune/start", async (request, reply) => {
    try {
      const body = request.body as Parameters<FineTuneManager["startJob"]>[0] | undefined;
      if (!body?.baseModelId || !body?.datasetId || !body?.outputName) {
        return reply.code(400).send({ error: "baseModelId, datasetId, and outputName are required" });
      }
      const job = await fineTuneManager.startJob(body);
      return reply.send(job);
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  fastify.get("/api/hf/finetune", async (_request, reply) => {
    try {
      const jobs = fineTuneManager.listJobs();
      return reply.send(jobs);
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  fastify.get<{ Params: { jobId: string } }>(
    "/api/hf/finetune/:jobId",
    async (request, reply) => {
      try {
        const { jobId } = request.params;
        const job = fineTuneManager.getJob(jobId);
        if (!job) {
          return reply.code(404).send({ error: `Fine-tune job not found: ${jobId}` });
        }

        // Poll container for live training status if the job is running
        if (job.status === "training" && job.containerPort) {
          try {
            const res = await fetch(`http://127.0.0.1:${job.containerPort}/finetune/status`);
            if (res.ok) {
              const containerStatus = await res.json() as Record<string, unknown>;
              return reply.send({ ...job, containerStatus });
            }
          } catch {
            // Container not reachable — return job without live status
          }
        }

        return reply.send(job);
      } catch (err) {
        return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  fastify.post<{ Params: { jobId: string } }>(
    "/api/hf/finetune/:jobId/stop",
    async (request, reply) => {
      try {
        const { jobId } = request.params;
        const job = fineTuneManager.getJob(jobId);
        if (!job) {
          return reply.code(404).send({ error: `Fine-tune job not found: ${jobId}` });
        }
        await fineTuneManager.stopJob(jobId);
        return reply.send({ ok: true });
      } catch (err) {
        return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );
}
