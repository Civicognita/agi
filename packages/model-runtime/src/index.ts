/**
 * @agi/model-runtime — HuggingFace Model Runtime
 *
 * Download, serve, and manage HuggingFace ML models via Podman containers.
 * Provides hardware-adaptive capability detection and dynamic agent tool
 * registration for running models.
 */

// Types
export type {
  // Hardware
  GpuInfo,
  HardwareProfile,
  HardwareCapabilities,
  CapabilityEntry,
  CapabilityStatus,
  // HF Hub
  HfModelInfo,
  HfModelSearchResult,
  HfSearchParams,
  HfFileSibling,
  ModelResourceEstimate,
  // Variants
  ModelFormat,
  GgufQuantization,
  ModelVariant,
  // Installed models
  InstalledModel,
  ModelStatus,
  ModelRuntimeType,
  DownloadProgress,
  // Custom runtimes
  CustomRuntimeDefinition,
  ModelEndpoint,
  // Containers
  ModelContainerConfig,
  ModelContainerState,
  // Inference
  ChatCompletionRequest,
  ChatCompletionResponse,
  EmbeddingRequest,
  EmbeddingResponse,
  ImageGenerationRequest,
  ImageGenerationResponse,
  TranscriptionRequest,
  TranscriptionResponse,
  ClassificationRequest,
  ClassificationResponse,
  // Agent bridge
  ModelRuntimeEvents,
  ModelRuntimeEventEmitter,
  // Config
  HfRuntimeConfig,
  // Datasets
  HfDatasetInfo,
  HfDatasetSearchParams,
  DatasetStatus,
  InstalledDataset,
} from "./types.js";

export { PIPELINE_TAG_TO_TOOL, LLM_PIPELINE_TAGS } from "./types.js";

// Hardware Profiler
export { HardwareProfiler } from "./hardware-profiler.js";

// HuggingFace Hub Client
export { HfHubClient } from "./hf-hub-client.js";

// Model Store
export { ModelStore } from "./model-store.js";

// Dataset Store
export { DatasetStore } from "./dataset-store.js";

// Model Container Manager
export { ModelContainerManager } from "./model-container-manager.js";

// Capability Resolver
export { CapabilityResolver } from "./capability-resolver.js";

// Inference Gateway
export { InferenceGateway } from "./inference-gateway.js";

// Known-Models Registry
export { KnownModelsRegistry } from "./known-models-registry.js";

// Custom Container Builder
export { CustomContainerBuilder, getBuildLog, clearBuildLog } from "./custom-container-builder.js";

// Agent Bridge
export { ModelAgentBridge } from "./agent-bridge.js";
