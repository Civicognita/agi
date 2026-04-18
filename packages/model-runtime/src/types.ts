/**
 * HuggingFace Model Runtime — Type Definitions
 *
 * Core types for hardware detection, model lifecycle, container management,
 * and inference routing. Used by all model-runtime modules and the gateway
 * HF API layer.
 */

import type { EventEmitter } from "node:events";

// ---------------------------------------------------------------------------
// Hardware detection
// ---------------------------------------------------------------------------

export interface GpuInfo {
  index: number;
  name: string;
  vendor: "nvidia" | "amd" | "intel";
  vramBytes: number;
  cudaVersion?: string;
  rocmVersion?: string;
  driverVersion?: string;
  computeCapability?: string;
}

export interface HardwareProfile {
  cpu: {
    cores: number;
    threads: number;
    model: string;
    arch: string;
    avx2: boolean;
    avx512: boolean;
  };
  ram: {
    totalBytes: number;
    availableBytes: number;
  };
  gpu: GpuInfo[];
  disk: {
    modelCachePath: string;
    availableBytes: number;
    totalBytes: number;
  };
  podman: {
    available: boolean;
    version?: string;
    gpuRuntime: boolean;
  };
  capabilities: HardwareCapabilities;
  /** ISO timestamp of last scan. */
  scannedAt: string;
}

export type CapabilityStatus = "on" | "limited" | "off";

export interface CapabilityEntry {
  /** Machine-readable ID, e.g. "small-llm", "image-gen", "concurrent-models". */
  id: string;
  /** Human-readable label. */
  label: string;
  /** Description of what this capability enables. */
  description: string;
  /** Current status based on detected hardware. */
  status: CapabilityStatus;
  /** Why this status (e.g. "16GB RAM detected, sufficient for 7B models"). */
  reason: string;
  /** What hardware upgrade would change the status. */
  unlockHint?: string;
  /** Minimum hardware requirement description. */
  hardwareRequired: string;
  /** Whether user has force-overridden this capability. */
  userOverride?: boolean;
}

export interface HardwareCapabilities {
  /** Has enough RAM for any LLM (>= 4GB). */
  canRunLlm: boolean;
  /** Has GPU with enough VRAM for diffusion models (>= 4GB VRAM). */
  canRunDiffusion: boolean;
  /** Can run embedding models (always true with >= 2GB RAM). */
  canRunEmbedding: boolean;
  /** Can run audio models (STT/TTS, >= 4GB RAM). */
  canRunAudio: boolean;
  /** Has GPU available for acceleration. */
  hasGpu: boolean;
  /** Total GPU VRAM across all GPUs. */
  totalVramBytes: number;
  /** Estimated max model size that can fit in memory. */
  maxModelSizeBytes: number;
  /** Recommended quantization level based on available resources. */
  recommendedQuantization: "q2_k" | "q3_k_m" | "q4_0" | "q4_k_m" | "q5_0" | "q5_k_m" | "q6_k" | "q8_0" | "f16" | "f32";
  /** Hardware tier for UI presentation. */
  tier: "minimal" | "standard" | "accelerated" | "pro";
  /** Human-readable summary for display. */
  summary: string;
  /** Detailed per-capability breakdown for the settings UI. */
  capabilityMap: CapabilityEntry[];
}

// ---------------------------------------------------------------------------
// HuggingFace Hub API types
// ---------------------------------------------------------------------------

export interface HfFileSibling {
  rfilename: string;
  size?: number;
  blobId?: string;
  lfs?: {
    sha256: string;
    size: number;
    pointerSize: number;
  };
}

export interface HfModelInfo {
  /** Full model ID, e.g. "meta-llama/Llama-3.1-8B-Instruct". */
  id: string;
  /** Model ID without org prefix. */
  modelId: string;
  author?: string;
  sha?: string;
  lastModified?: string;
  /** ML task, e.g. "text-generation", "text-to-image". */
  pipeline_tag?: string;
  tags: string[];
  downloads: number;
  likes: number;
  /** Which library produced this model, e.g. "transformers", "diffusers". */
  library_name?: string;
  /** Whether the model is gated (requires approval). */
  gated: boolean | "auto" | "manual";
  private: boolean;
  disabled: boolean;
  /** Files in the repository. */
  siblings?: HfFileSibling[];
  /** Safetensors metadata including parameter count. */
  safetensors?: {
    total: number;
    [key: string]: unknown;
  };
  /** Model card content (markdown). */
  cardData?: Record<string, unknown>;
}

export interface HfSearchParams {
  search?: string;
  pipeline_tag?: string;
  library?: string;
  sort?: "downloads" | "likes" | "trending" | "lastModified";
  direction?: "asc" | "desc";
  limit?: number;
  offset?: number;
  filter?: string;
}

export interface HfModelSearchResult extends HfModelInfo {
  /** Compatibility with local hardware. */
  compatibility: "compatible" | "limited" | "incompatible";
  /** Why this compatibility was assigned. */
  compatibilityReason: string;
  /** Resource estimates for running this model locally. */
  estimate: ModelResourceEstimate;
}

export interface ModelResourceEstimate {
  /** Estimated tokens per second (null if not an LLM). */
  tokensPerSec: number | null;
  /** Estimated RAM usage in bytes. */
  ramUsageBytes: number;
  /** Estimated VRAM usage in bytes (null if CPU-only). */
  vramUsageBytes: number | null;
  /** Disk space for model files in bytes. */
  diskUsageBytes: number;
  /** Estimated model load time in seconds (null if unknown). */
  loadTimeSeconds: number | null;
}

// ---------------------------------------------------------------------------
// Model variants (format/quantization choices)
// ---------------------------------------------------------------------------

export type ModelFormat = "gguf" | "safetensors" | "pytorch" | "onnx" | "tensorflow";

export type GgufQuantization =
  | "Q2_K" | "Q3_K_S" | "Q3_K_M" | "Q3_K_L"
  | "Q4_0" | "Q4_K_S" | "Q4_K_M"
  | "Q5_0" | "Q5_K_S" | "Q5_K_M"
  | "Q6_K" | "Q8_0"
  | "F16" | "F32";

export interface ModelVariant {
  /** Filename in the HF repo. */
  filename: string;
  /** Model format. */
  format: ModelFormat;
  /** Quantization level (GGUF only). */
  quantization: GgufQuantization | null;
  /** File size in bytes. */
  sizeBytes: number;
  /** Compatibility with local hardware. */
  compatibility: "compatible" | "limited" | "incompatible";
  /** Why this compatibility was assigned. */
  compatibilityReason?: string;
  /** Resource estimates for this specific variant. */
  estimate: ModelResourceEstimate;
}

// ---------------------------------------------------------------------------
// Installed model lifecycle
// ---------------------------------------------------------------------------

export type ModelStatus = "downloading" | "ready" | "starting" | "running" | "stopping" | "error" | "removing";

export type ModelRuntimeType = "llm" | "diffusion" | "general" | "custom";

// ---------------------------------------------------------------------------
// Custom runtime definitions
// ---------------------------------------------------------------------------

/**
 * Describes how to build and run a custom (non-standard HF) model container.
 * Stored in the known-models registry and in user JSON files.
 */
export interface CustomRuntimeDefinition {
  /** Unique identifier, typically the HF model ID. */
  id: string;
  /** Human-readable label for display. */
  label: string;
  /** What this runtime does. */
  description: string;
  /** Git repository to clone for custom model code. */
  sourceRepo?: string;
  /** Git ref (branch/tag/sha) to checkout from sourceRepo. */
  sourceRef?: string;
  /** Pre-built container image to use instead of building from sourceRepo. */
  image?: string;
  /** Dockerfile template string (overrides default if provided). */
  dockerfileTemplate?: string;
  /** Port the container's HTTP server listens on internally. */
  internalPort: number;
  /** Path to poll for container readiness. */
  healthCheckPath: string;
  /** Named endpoints exposed by this runtime (name → path). */
  endpoints: Record<string, string>;
  /** Extra environment variables to inject into the container. */
  env: Record<string, string>;
  /** Additional pip packages to install beyond the repo requirements. */
  extraPipDeps?: string[];
  /** HF model IDs this runtime is compatible with. */
  hfModels?: string[];
}

/**
 * Describes a single HTTP endpoint exposed by a custom model container.
 */
export interface ModelEndpoint {
  /** URL path relative to container root, e.g. "/predict". */
  path: string;
  /** HTTP method. */
  method: "GET" | "POST" | "PUT";
  /** Human-readable description of what this endpoint does. */
  description: string;
  /** JSON schema describing the request body (optional, for tooling). */
  requestSchema?: Record<string, unknown>;
}

export interface InstalledModel {
  /** Full model ID, e.g. "meta-llama/Llama-3.1-8B-Instruct". */
  id: string;
  /** Git revision (commit SHA). */
  revision: string;
  /** Display name for UI. */
  displayName: string;
  /** Pipeline tag from HF Hub. */
  pipelineTag: string;
  /** Which runtime type to use. */
  runtimeType: ModelRuntimeType;
  /** Absolute path to model files on disk. */
  filePath: string;
  /** Specific file within the model directory (for single-file GGUF). */
  modelFilename?: string;
  /** Total size of model files in bytes. */
  fileSizeBytes: number;
  /** Quantization level (GGUF models). */
  quantization?: string;
  /** Current status. */
  status: ModelStatus;
  /** ISO timestamp of download completion. */
  downloadedAt: string;
  /** ISO timestamp of last inference request. */
  lastUsedAt?: string;
  /** Error message if status is "error". */
  error?: string;

  // Container binding (populated when running)
  containerId?: string;
  containerPort?: number;
  containerName?: string;

  // Custom runtime fields (populated for "custom" runtimeType)
  /** Pre-built or builder-produced container image tag. */
  containerImage?: string;
  /** Source repository that was cloned to build this model's container. */
  sourceRepo?: string;
  /** Declared endpoints for this model's container API. */
  endpoints?: ModelEndpoint[];
}

export interface DownloadProgress {
  modelId: string;
  filename: string;
  totalBytes: number;
  downloadedBytes: number;
  /** Bytes per second. */
  speedBps: number;
  /** Estimated time remaining in seconds. */
  etaSeconds: number;
  startedAt: string;
}

// ---------------------------------------------------------------------------
// Container configuration
// ---------------------------------------------------------------------------

export interface ModelContainerConfig {
  runtimeType: ModelRuntimeType;
  /** Container image to use. */
  image: string;
  /** Port inside the container. */
  internalPort: number;
  /** Path to model files on host. */
  modelHostPath: string;
  /** Mount path inside container. */
  modelContainerPath: string;
  /** Specific model filename within the mount (for GGUF). */
  modelFilename?: string;
  /** Environment variables. */
  env: Record<string, string>;
  /** Whether to pass GPU through to container. */
  gpuPassthrough: boolean;
  /** Memory limit for container (e.g. "8g"). */
  memoryLimit?: string;
  /** Additional runtime args (e.g. --ctx-size 4096). */
  runtimeArgs: string[];
  /** Estimated RAM required in bytes (used for budget enforcement). */
  estimatedRamBytes?: number;
}

export interface ModelContainerState {
  modelId: string;
  containerId: string;
  containerName: string;
  port: number;
  runtimeType: ModelRuntimeType;
  startedAt: string;
  status: "running" | "stopped" | "error";
  healthCheckPassed: boolean;
  /** Estimated RAM committed by this container (for budget tracking). */
  estimatedRamBytes?: number;
}

// ---------------------------------------------------------------------------
// Inference gateway
// ---------------------------------------------------------------------------

/** OpenAI-compatible chat completion request. */
export interface ChatCompletionRequest {
  model?: string;
  messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }>;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  stop?: string | string[];
}

/** OpenAI-compatible chat completion response. */
export interface ChatCompletionResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: { role: "assistant"; content: string };
    finish_reason: "stop" | "length" | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface EmbeddingRequest {
  input: string | string[];
  model?: string;
}

export interface EmbeddingResponse {
  object: "list";
  data: Array<{
    object: "embedding";
    index: number;
    embedding: number[];
  }>;
  model: string;
  usage: { prompt_tokens: number; total_tokens: number };
}

export interface ImageGenerationRequest {
  prompt: string;
  negative_prompt?: string;
  width?: number;
  height?: number;
  num_inference_steps?: number;
  guidance_scale?: number;
}

export interface ImageGenerationResponse {
  images: Array<{
    /** Base64-encoded image data. */
    b64_json: string;
    /** Revised prompt (if applicable). */
    revised_prompt?: string;
  }>;
}

export interface TranscriptionRequest {
  /** Base64-encoded audio data. */
  audio: string;
  /** Audio format: "wav", "mp3", "flac", etc. */
  format: string;
  language?: string;
}

export interface TranscriptionResponse {
  text: string;
  language?: string;
  duration?: number;
}

export interface ClassificationRequest {
  text: string;
}

export interface ClassificationResponse {
  labels: Array<{
    label: string;
    score: number;
  }>;
}

// ---------------------------------------------------------------------------
// Agent bridge
// ---------------------------------------------------------------------------

/** Map of pipeline tags to agent tool names. */
export const PIPELINE_TAG_TO_TOOL: Record<string, string> = {
  "feature-extraction": "hf_embed_text",
  "text-to-image": "hf_generate_image",
  "automatic-speech-recognition": "hf_transcribe_audio",
  "text-classification": "hf_classify_text",
  "summarization": "hf_summarize",
  "translation": "hf_translate",
  "object-detection": "hf_detect_objects",
  "image-classification": "hf_classify_image",
  "text-to-speech": "hf_text_to_speech",
};

/** Pipeline tags that register as LLM providers rather than tools. */
export const LLM_PIPELINE_TAGS = new Set([
  "text-generation",
  "text2text-generation",
  "conversational",
]);

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export interface ModelRuntimeEvents {
  "model:downloading": (modelId: string, progress: DownloadProgress) => void;
  "model:downloaded": (modelId: string) => void;
  "model:starting": (modelId: string) => void;
  "model:started": (modelId: string, port: number) => void;
  "model:stopping": (modelId: string) => void;
  "model:stopped": (modelId: string) => void;
  "model:error": (modelId: string, error: string) => void;
  "model:removed": (modelId: string) => void;
}

export type ModelRuntimeEventEmitter = EventEmitter & {
  emit<K extends keyof ModelRuntimeEvents>(event: K, ...args: Parameters<ModelRuntimeEvents[K]>): boolean;
  on<K extends keyof ModelRuntimeEvents>(event: K, listener: ModelRuntimeEvents[K]): ModelRuntimeEventEmitter;
  off<K extends keyof ModelRuntimeEvents>(event: K, listener: ModelRuntimeEvents[K]): ModelRuntimeEventEmitter;
};

// ---------------------------------------------------------------------------
// HuggingFace Dataset types
// ---------------------------------------------------------------------------

export interface HfDatasetInfo {
  id: string;
  author?: string;
  sha?: string;
  lastModified?: string;
  description?: string;
  tags: string[];
  downloads: number;
  likes: number;
  gated: boolean | "auto" | "manual";
  private: boolean;
  cardData?: Record<string, unknown>;
  siblings?: HfFileSibling[];
}

export interface HfDatasetSearchParams {
  search?: string;
  sort?: "downloads" | "likes" | "trendingScore" | "lastModified";
  direction?: "asc" | "desc";
  limit?: number;
  offset?: number;
  filter?: string;
}

export type DatasetStatus = "downloading" | "ready" | "error" | "removing";

export interface InstalledDataset {
  id: string;
  revision: string;
  displayName: string;
  description?: string;
  filePath: string;
  fileSizeBytes: number;
  fileCount: number;
  status: DatasetStatus;
  downloadedAt: string;
  tags: string[];
  error?: string;
}

// ---------------------------------------------------------------------------
// Configuration (mirrors HfConfigSchema from @agi/config)
// ---------------------------------------------------------------------------

export interface HfRuntimeConfig {
  enabled: boolean;
  apiToken?: string;
  cacheDir: string;
  portRangeStart: number;
  maxConcurrentModels: number;
  ramBudgetBytes: number;
  autoStart: string[];
  inferenceTimeoutMs: number;
  gpuMode: "auto" | "nvidia" | "amd" | "cpu-only";
  images?: {
    llm?: string;
    diffusion?: string;
    general?: string;
  };
}
