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

import { rmSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import type {
  HardwareProfiler,
  HfHubClient,
  ModelStore,
  ModelContainerManager,
  CapabilityResolver,
  InferenceGateway,
} from "@aionima/model-runtime";
import type { ModelAgentBridge } from "@aionima/model-runtime";

// ---------------------------------------------------------------------------
// Deps shape
// ---------------------------------------------------------------------------

export interface HfApiDeps {
  hardwareProfiler: HardwareProfiler;
  hfClient: HfHubClient;
  modelStore: ModelStore;
  containerManager: ModelContainerManager;
  capabilityResolver: CapabilityResolver;
  inferenceGateway: InferenceGateway;
  agentBridge: ModelAgentBridge;
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
    containerManager,
    capabilityResolver,
    inferenceGateway,
    agentBridge,
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

        const model = await hfClient.getModelInfo(modelId);
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

      // Look up model info to populate display metadata
      const modelInfo = await hfClient.getModelInfo(id);
      const runtimeType = capabilityResolver.resolveRuntimeType(modelInfo);
      const estimate = capabilityResolver.estimateResources(modelInfo);

      const downloadedAt = new Date().toISOString();

      // Add to store immediately as "downloading"
      modelStore.addModel({
        id,
        revision,
        displayName: modelInfo.modelId ?? id,
        pipelineTag: modelInfo.pipeline_tag ?? "unknown",
        runtimeType,
        filePath: "", // will be set by download
        modelFilename: filename,
        fileSizeBytes: estimate.diskUsageBytes,
        status: "downloading",
        downloadedAt,
      });

      // Fire-and-forget download
      void hfClient
        .downloadFile({
          modelId: id,
          revision,
          filename,
          destPath: "", // HfHubClient resolves actual path internally
        })
        .then(() => {
          modelStore.updateStatus(id, "ready");
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          modelStore.setError(id, msg);
          modelStore.updateStatus(id, "error");
        });

      return reply.send({ ok: true, id, status: "downloading" });
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
        const containerState = await containerManager.start(model, containerConfig);

        modelStore.bindContainer(
          modelId,
          containerState.containerId,
          containerState.port,
          containerState.containerName,
        );
        modelStore.updateStatus(modelId, "running");

        return reply.send(containerState);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const modelId = decodeURIComponent(request.params.modelId);
        if (modelId) {
          modelStore.setError(modelId, msg);
          modelStore.updateStatus(modelId, "error");
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
}
