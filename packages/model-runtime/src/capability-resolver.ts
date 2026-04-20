/**
 * CapabilityResolver — Maps HuggingFace model metadata to runtime configuration.
 *
 * Determines the correct runtime type for a model, estimates resource requirements
 * based on hardware capabilities, assesses local compatibility, resolves available
 * variants from model file listings, and builds container configurations.
 *
 * No npm dependencies — uses only sibling modules and native Node.js.
 */

import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import type {
  HfModelInfo,
  HardwareCapabilities,
  InstalledModel,
  ModelRuntimeType,
  ModelResourceEstimate,
  ModelVariant,
  ModelContainerConfig,
  ModelFormat,
  GgufQuantization,
} from "./types.js";
import type { KnownModelsRegistry } from "./known-models-registry.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Known model file extensions and their format mappings. */
const FORMAT_EXT_MAP: Record<string, ModelFormat> = {
  ".gguf": "gguf",
  ".safetensors": "safetensors",
  ".bin": "pytorch",
  ".onnx": "onnx",
};

/** Pipeline tags that indicate an LLM runtime. */
const LLM_PIPELINE_TAGS = new Set([
  "text-generation",
  "text2text-generation",
  "conversational",
]);

/** Pipeline tags that indicate a diffusion runtime. */
const DIFFUSION_PIPELINE_TAGS = new Set([
  "text-to-image",
  "image-to-image",
]);

/** Quantization methods that need extra pip packages. */
const QUANT_METHOD_DEPS: Record<string, string[]> = {
  fp8: ["accelerate"],
  gptq: ["auto-gptq", "accelerate"],
  awq: ["autoawq", "accelerate"],
  bnb: ["bitsandbytes", "accelerate"],
  bitsandbytes: ["bitsandbytes", "accelerate"],
  eetq: ["eetq", "accelerate"],
  hqq: ["hqq", "accelerate"],
};

/** HuggingFace model ID → Ollama model name mapping. */
const HF_TO_OLLAMA: Record<string, string> = {
  "Qwen/Qwen2.5-1.5B-Instruct": "qwen2.5:1.5b-instruct",
  "Qwen/Qwen2.5-Coder-1.5B-Instruct": "qwen2.5-coder:1.5b-instruct",
  "Qwen/Qwen2.5-0.5B-Instruct": "qwen2.5:0.5b-instruct",
  "Qwen/Qwen2.5-7B-Instruct": "qwen2.5:7b-instruct",
  "Qwen/Qwen2.5-3B-Instruct": "qwen2.5:3b-instruct",
  "Qwen/Qwen2.5-Coder-7B-Instruct": "qwen2.5-coder:7b-instruct",
  "meta-llama/Llama-3.1-8B-Instruct": "llama3.1:8b-instruct",
  "meta-llama/Llama-3.2-1B-Instruct": "llama3.2:1b",
  "meta-llama/Llama-3.2-3B-Instruct": "llama3.2:3b",
  "HuggingFaceTB/SmolLM2-135M-Instruct": "smollm2:135m",
  "HuggingFaceTB/SmolLM2-360M-Instruct": "smollm2:360m",
  "HuggingFaceTB/SmolLM2-1.7B-Instruct": "smollm2:1.7b",
  "microsoft/Phi-3.5-mini-instruct": "phi3.5:3.8b",
  "google/gemma-2-2b-it": "gemma2:2b",
  "mistralai/Mistral-7B-Instruct-v0.3": "mistral:7b-instruct",
};

function ollamaAvailable(): boolean {
  try {
    execFileSync("which", ["ollama"], { stdio: "pipe", timeout: 3_000 });
    return true;
  } catch { return false; }
}

/** Bytes per gigabyte. */
const GB = 1024 * 1024 * 1024;

/** Estimated SSD read speed in bytes/sec for load time estimation. */
const SSD_READ_BPS = 500 * 1024 * 1024;

/** Container load overhead in seconds beyond raw file read time. */
const LOAD_OVERHEAD_SECONDS = 5;

/** Known GGUF quantization patterns, ordered from highest to lowest quality. */
const GGUF_QUANT_NAMES: GgufQuantization[] = [
  "F32", "F16",
  "Q8_0",
  "Q6_K",
  "Q5_K_M", "Q5_K_S", "Q5_0",
  "Q4_K_M", "Q4_K_S", "Q4_0",
  "Q3_K_L", "Q3_K_M", "Q3_K_S",
  "Q2_K",
];

// ---------------------------------------------------------------------------
// Default container images
// ---------------------------------------------------------------------------

const DEFAULT_IMAGES: Record<ModelRuntimeType, string> = {
  llm: "ghcr.io/civicognita/transformers-server:latest",
  diffusion: "ghcr.io/civicognita/diffusion-server:latest",
  general: "ghcr.io/civicognita/transformers-server:latest",
  custom: "",
  ollama: "",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the file extension from a filename, including the leading dot.
 * Returns empty string if no extension is found.
 */
function fileExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot).toLowerCase() : "";
}

/**
 * Check if a filename is an actual model file (not tokenizer, config, optimizer, etc.).
 * Filters out auxiliary files that share model extensions.
 */
function isModelFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  const base = lower.split("/").pop() ?? lower;

  // Exclude known non-model files
  const EXCLUDE_PATTERNS = [
    "tokenizer", "vocab", "merges", "special_tokens",
    "optimizer", "scheduler", "training_args",
    "rust_model", "tf_model", "flax_model",
    "sentencepiece", "spiece",
  ];
  for (const pattern of EXCLUDE_PATTERNS) {
    if (base.includes(pattern)) return false;
  }

  // For .bin files, only accept model/pytorch_model patterns
  if (base.endsWith(".bin")) {
    return base === "pytorch_model.bin" || base.startsWith("pytorch_model-") || base.startsWith("model-") || base === "model.bin";
  }

  // For .safetensors, accept model.safetensors and model-NNNNN-of-NNNNN.safetensors (shards)
  if (base.endsWith(".safetensors")) {
    return true; // safetensors files are almost always actual model weights
  }

  // GGUF files are always model files
  if (base.endsWith(".gguf")) return true;

  // ONNX files — accept model.onnx and similar, skip auxiliary onnx files
  if (base.endsWith(".onnx")) {
    return base.startsWith("model") || base.startsWith("decoder") || base.startsWith("encoder");
  }

  return true;
}

/**
 * Extract a GGUF quantization label from a filename.
 * Matches patterns like "model-Q4_K_M.gguf" → "Q4_K_M".
 * Returns null if no known quantization is found in the name.
 */
function extractGgufQuantization(filename: string): GgufQuantization | null {
  const upper = filename.toUpperCase();
  for (const quant of GGUF_QUANT_NAMES) {
    if (upper.includes(quant)) return quant;
  }
  return null;
}

/**
 * Determine whether a quantization string indicates a 4-bit quantization,
 * which uses ~0.5 bytes per parameter rather than 2 bytes (fp16).
 */
function isQ4Quantization(quantization: string | undefined | null): boolean {
  if (!quantization) return false;
  return quantization.toUpperCase().startsWith("Q4") ||
    quantization.toUpperCase().startsWith("Q3") ||
    quantization.toUpperCase().startsWith("Q2");
}

/**
 * Format a byte count as a container memory limit string (e.g. "8g", "512m").
 * Rounds up to the next whole gigabyte for values >= 1 GB, otherwise megabyte.
 */
function formatMemoryLimit(bytes: number): string {
  if (bytes >= GB) {
    return `${String(Math.ceil(bytes / GB))}g`;
  }
  const mb = 1024 * 1024;
  return `${String(Math.ceil(bytes / mb))}m`;
}

/**
 * Estimate parameter count in billions from a model's tags or safetensors total.
 * Returns null if no estimate can be made.
 */
function estimateParamCountFromTags(tags: string[]): number | null {
  for (const tag of tags) {
    // Match patterns like "7b", "13b", "70b", "1.5b", "0.5b"
    const m = /^(\d+(?:\.\d+)?)[bB]$/.exec(tag);
    if (m?.[1]) {
      const billions = parseFloat(m[1]);
      if (Number.isFinite(billions) && billions > 0) {
        return billions * 1e9;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// CapabilityResolver
// ---------------------------------------------------------------------------

export class CapabilityResolver {
  constructor(
    private readonly capabilities: HardwareCapabilities,
    private readonly knownModels?: KnownModelsRegistry,
  ) {}

  // ---------------------------------------------------------------------------
  // detectExtraDeps — read model config to find required pip packages
  // ---------------------------------------------------------------------------

  detectExtraDeps(model: InstalledModel): string[] {
    const deps: string[] = [];
    try {
      const configPath = join(model.filePath, "config.json");
      if (existsSync(configPath)) {
        const config = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
        const qc = config.quantization_config as Record<string, unknown> | undefined;
        if (qc?.quant_method && typeof qc.quant_method === "string") {
          const method = qc.quant_method.toLowerCase();
          deps.push(...(QUANT_METHOD_DEPS[method] ?? []));
        }
      }
      const reqPath = join(model.filePath, "requirements.txt");
      if (existsSync(reqPath)) {
        const lines = readFileSync(reqPath, "utf8").split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith("#")) deps.push(trimmed);
        }
      }
    } catch { /* model files may not be accessible */ }
    return [...new Set(deps)];
  }

  // ---------------------------------------------------------------------------
  // resolveRuntimeType
  // ---------------------------------------------------------------------------

  /**
   * Determine which runtime type to use for a model based on its pipeline tag
   * and file contents.
   *
   * - Known-models registry match → "custom"
   * - LLM tags with GGUF files → "llm" (uses llama.cpp server)
   * - LLM tags with transformers library → "general"
   * - Diffusion tags → "diffusion"
   * - Everything else → "general"
   */
  resolveRuntimeType(model: HfModelInfo): ModelRuntimeType {
    // Check known-models registry first — custom models take priority
    if (this.knownModels?.lookup(model.id)) {
      return "custom";
    }

    const tag = model.pipeline_tag ?? "";

    if (LLM_PIPELINE_TAGS.has(tag)) {
      const hasGguf = model.siblings?.some(
        (s) => fileExtension(s.rfilename) === ".gguf",
      ) ?? false;

      if (hasGguf) return "llm";
      if (ollamaAvailable() && HF_TO_OLLAMA[model.id]) return "ollama";
      if (model.library_name === "transformers") return "general";
      return "llm";
    }

    if (DIFFUSION_PIPELINE_TAGS.has(tag)) {
      return "diffusion";
    }

    return "general";
  }

  // ---------------------------------------------------------------------------
  // estimateResources
  // ---------------------------------------------------------------------------

  /**
   * Estimate resource requirements for a model.
   *
   * When a variant is provided, its sizeBytes is used as the ground truth for
   * RAM and disk estimates. Otherwise, parameter count from safetensors metadata
   * or tags is used to derive approximate sizes.
   */
  estimateResources(
    model: HfModelInfo,
    variant?: { sizeBytes: number; quantization?: string },
  ): ModelResourceEstimate {
    const tag = model.pipeline_tag ?? "";
    const isLlm = LLM_PIPELINE_TAGS.has(tag);
    const quantization = variant?.quantization ?? model.tags.find(
      (t) => GGUF_QUANT_NAMES.some((q) => t.toUpperCase() === q),
    );

    let ramUsageBytes: number;
    let diskUsageBytes: number;

    if (variant?.sizeBytes) {
      ramUsageBytes = variant.sizeBytes;
      diskUsageBytes = variant.sizeBytes;
    } else {
      // Estimate from parameter count
      const paramCount = model.safetensors?.total ?? estimateParamCountFromTags(model.tags);
      if (paramCount && paramCount > 0) {
        const bytesPerParam = isQ4Quantization(quantization) ? 0.5 : 2;
        ramUsageBytes = paramCount * bytesPerParam;
        diskUsageBytes = ramUsageBytes;
      } else {
        // Fallback: sum sibling sizes, or use a generic 4 GB estimate
        const siblingTotal = model.siblings?.reduce(
          (sum, s) => sum + (s.size ?? s.lfs?.size ?? 0),
          0,
        ) ?? 0;
        ramUsageBytes = siblingTotal > 0 ? siblingTotal : 4 * GB;
        diskUsageBytes = ramUsageBytes;
      }
    }

    // VRAM: same as RAM if GPU is available, null for CPU-only
    const vramUsageBytes = this.capabilities.hasGpu ? ramUsageBytes : null;

    // Tokens per second: only meaningful for LLMs
    let tokensPerSec: number | null = null;
    if (isLlm) {
      tokensPerSec = this.estimateTokensPerSec(ramUsageBytes, quantization);
    }

    // Load time: file read + overhead
    const loadTimeSeconds = diskUsageBytes > 0
      ? Math.ceil(diskUsageBytes / SSD_READ_BPS) + LOAD_OVERHEAD_SECONDS
      : null;

    return {
      tokensPerSec,
      ramUsageBytes,
      vramUsageBytes,
      diskUsageBytes,
      loadTimeSeconds,
    };
  }

  // ---------------------------------------------------------------------------
  // assessCompatibility
  // ---------------------------------------------------------------------------

  /**
   * Assess whether the model can run on the detected hardware.
   *
   * Returns "compatible", "limited", or "incompatible" along with a human-readable
   * reason explaining the assessment.
   */
  assessCompatibility(
    model: HfModelInfo,
    variant?: { sizeBytes: number; quantization?: string },
  ): { compatibility: "compatible" | "limited" | "incompatible"; reason: string } {
    const estimate = this.estimateResources(model, variant);
    const runtimeType = this.resolveRuntimeType(model);

    // Hard cap: model won't fit in available memory at all
    if (estimate.ramUsageBytes > this.capabilities.maxModelSizeBytes) {
      const modelGb = Math.round(estimate.ramUsageBytes / GB);
      const maxGb = Math.round(this.capabilities.maxModelSizeBytes / GB);
      return {
        compatibility: "incompatible",
        reason: `Model requires ~${String(modelGb)} GB but only ~${String(maxGb)} GB is available.`,
      };
    }

    // Diffusion models require a GPU with sufficient VRAM
    if (runtimeType === "diffusion" && !this.capabilities.hasGpu) {
      return {
        compatibility: "incompatible",
        reason: "Image generation models require a GPU with 4+ GB VRAM.",
      };
    }

    // LLMs without a GPU are limited (CPU inference is slow)
    if (runtimeType === "llm" && !this.capabilities.hasGpu) {
      const ratio = estimate.ramUsageBytes / this.capabilities.maxModelSizeBytes;
      if (ratio > 0.8) {
        return {
          compatibility: "limited",
          reason: "Model fits in RAM but leaves little headroom; CPU inference only — expect slow generation.",
        };
      }
      return {
        compatibility: "limited",
        reason: "No GPU detected — model will run on CPU only, which is significantly slower.",
      };
    }

    // Model fits but uses more than 80% of available memory
    const ratio = estimate.ramUsageBytes / this.capabilities.maxModelSizeBytes;
    if (ratio > 0.8) {
      const pct = Math.round(ratio * 100);
      return {
        compatibility: "limited",
        reason: `Model uses ~${String(pct)}% of available memory — other models cannot run concurrently.`,
      };
    }

    return {
      compatibility: "compatible",
      reason: `Model fits comfortably in available memory.`,
    };
  }

  // ---------------------------------------------------------------------------
  // resolveVariants
  // ---------------------------------------------------------------------------

  /**
   * List available model variants from the model's file siblings.
   *
   * Filters for known model file extensions, extracts quantization info for GGUF
   * files, computes per-variant compatibility, and sorts: compatible first, then
   * by size ascending (smallest compatible first).
   */
  resolveVariants(model: HfModelInfo): ModelVariant[] {
    const siblings = model.siblings ?? [];

    const variants: ModelVariant[] = [];

    for (const sibling of siblings) {
      const name = sibling.rfilename;
      const ext = fileExtension(name);
      const format = FORMAT_EXT_MAP[ext];
      if (!format) continue;

      // Filter out non-model files that happen to share model extensions
      if (!isModelFile(name)) continue;

      // Prefer LFS size, then direct size — skip files with no known size
      const sizeBytes = sibling.lfs?.size ?? sibling.size ?? 0;
      if (sizeBytes === 0) continue;

      const quantization: GgufQuantization | null =
        format === "gguf" ? extractGgufQuantization(name) : null;

      const variantInput = { sizeBytes, quantization: quantization ?? undefined };
      const estimate = this.estimateResources(model, variantInput);
      const { compatibility, reason } = this.assessCompatibility(model, variantInput);

      variants.push({
        filename: name,
        format,
        quantization,
        sizeBytes,
        compatibility,
        compatibilityReason: reason,
        estimate,
      });
    }

    // Deduplicate: if we have both model.safetensors and pytorch_model.bin
    // (same model, different formats), prefer safetensors > gguf > onnx > pytorch
    const FORMAT_PRIORITY: Record<ModelFormat, number> = {
      safetensors: 0, gguf: 1, onnx: 2, pytorch: 3, tensorflow: 4,
    };
    const seen = new Map<string, ModelVariant>();
    for (const v of variants) {
      // Group key: quantization level (for GGUF) or format (for others)
      const key = v.quantization ?? v.format;
      const existing = seen.get(key);
      if (!existing || FORMAT_PRIORITY[v.format] < FORMAT_PRIORITY[existing.format]) {
        seen.set(key, v);
      }
    }
    const deduped = [...seen.values()];

    // Sort: compatible first, then limited, then incompatible; within each tier by size ascending
    const ORDER = { compatible: 0, limited: 1, incompatible: 2 } as const;
    deduped.sort((a, b) => {
      const tierDiff = ORDER[a.compatibility] - ORDER[b.compatibility];
      if (tierDiff !== 0) return tierDiff;
      return a.sizeBytes - b.sizeBytes;
    });

    return deduped;
  }

  // ---------------------------------------------------------------------------
  // buildContainerConfig
  // ---------------------------------------------------------------------------

  /**
   * Build the container configuration for launching a model.
   *
   * Selects the appropriate image, port, mount paths, and runtime arguments
   * based on the model's runtime type. GPU passthrough is enabled when hardware
   * capabilities include a GPU.
   */
  buildContainerConfig(
    model: InstalledModel,
    images?: { llm?: string; diffusion?: string; general?: string },
  ): ModelContainerConfig {
    const gpuPassthrough = this.capabilities.hasGpu;
    const RUNTIME_OVERHEAD = 512 * 1024 * 1024; // Python + transformers baseline
    const memoryBytes = Math.max(model.fileSizeBytes * 1.5 + RUNTIME_OVERHEAD, RUNTIME_OVERHEAD);
    const memoryLimit = formatMemoryLimit(memoryBytes);
    const extraDeps = model.runtimeType !== "custom" ? this.detectExtraDeps(model) : [];

    switch (model.runtimeType) {
      case "llm": {
        const image = images?.llm ?? DEFAULT_IMAGES.llm;
        const cpuCores = this.resolveCpuCores();
        const threads = String(Math.max(cpuCores - 2, 2));
        const modelRef = model.modelFilename
          ? `/models/${model.modelFilename}`
          : "/models";
        const llmEnv: Record<string, string> = {};
        if (extraDeps.length > 0) llmEnv.EXTRA_PIP_DEPS = extraDeps.join(",");

        return {
          runtimeType: "llm",
          image,
          internalPort: 8080,
          modelHostPath: model.filePath,
          modelContainerPath: "/models",
          modelFilename: model.modelFilename,
          env: llmEnv,
          gpuPassthrough,
          memoryLimit,
          runtimeArgs: [
            "--model", modelRef,
            "--host", "0.0.0.0",
            "--port", "8080",
            "--ctx-size", "4096",
            "--threads", threads,
          ],
        };
      }

      case "diffusion": {
        const image = images?.diffusion ?? DEFAULT_IMAGES.diffusion;
        const diffEnv: Record<string, string> = {
          HF_TASK: model.pipelineTag,
          MODEL_PATH: "/models",
        };
        if (extraDeps.length > 0) diffEnv.EXTRA_PIP_DEPS = extraDeps.join(",");
        return {
          runtimeType: "diffusion",
          image,
          internalPort: 8000,
          modelHostPath: model.filePath,
          modelContainerPath: "/models",
          modelFilename: model.modelFilename,
          env: diffEnv,
          gpuPassthrough,
          memoryLimit,
          runtimeArgs: [],
        };
      }

      case "custom": {
        // Resolve the known-models definition for this model.
        // Falls back to a minimal config if the model is somehow not in the registry.
        const def = this.knownModels?.lookup(model.id);
        const image = model.containerImage ?? def?.image ?? "";
        const internalPort = def?.internalPort ?? 8000;
        const env: Record<string, string> = {
          MODEL_ID: model.id,
          MODEL_PATH: "/models",
          ...(def?.env ?? {}),
        };

        return {
          runtimeType: "custom",
          image,
          internalPort,
          modelHostPath: model.filePath,
          modelContainerPath: "/models",
          modelFilename: model.modelFilename,
          env,
          gpuPassthrough,
          memoryLimit,
          runtimeArgs: [],
        };
      }

      case "ollama": {
        const ollamaName = HF_TO_OLLAMA[model.id] ?? model.id.toLowerCase().replace("/", ":");
        return {
          runtimeType: "ollama",
          image: "",
          internalPort: 11434,
          modelHostPath: "",
          modelContainerPath: "",
          ollamaModelName: ollamaName,
          env: {},
          gpuPassthrough: false,
          runtimeArgs: [],
        };
      }

      default: {
        const image = images?.general ?? DEFAULT_IMAGES.general;
        const extraDeps = this.detectExtraDeps(model);
        const env: Record<string, string> = {
          HF_TASK: model.pipelineTag,
          MODEL_PATH: "/models",
        };
        if (extraDeps.length > 0) env.EXTRA_PIP_DEPS = extraDeps.join(",");
        return {
          runtimeType: "general",
          image,
          internalPort: 8000,
          modelHostPath: model.filePath,
          modelContainerPath: "/models",
          modelFilename: model.modelFilename,
          env,
          gpuPassthrough,
          memoryLimit,
          runtimeArgs: [],
        };
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Estimate tokens per second for an LLM based on model size and hardware.
   *
   * These are intentionally conservative estimates based on real-world benchmarks.
   * GPU estimates assume efficient VRAM-resident inference; CPU estimates assume
   * a Q4 quantized model on a modern multi-core processor.
   */
  private estimateTokensPerSec(
    modelSizeBytes: number,
    quantization?: string | null,
  ): number {
    const isQ4 = isQ4Quantization(quantization);

    // Rough parameter count back-calculation from size
    const bytesPerParam = isQ4 ? 0.5 : 2;
    const paramCount = modelSizeBytes / bytesPerParam;
    const paramBillions = paramCount / 1e9;

    if (this.capabilities.hasGpu) {
      // GPU fp16 / quantized inference
      if (paramBillions <= 8) return 50;
      if (paramBillions <= 14) return 25;
      if (paramBillions <= 35) return 12;
      return 6;
    }

    // CPU-only inference
    if (isQ4) {
      if (paramBillions <= 8) return 6;
      if (paramBillions <= 14) return 3;
      return 1;
    }

    // CPU + fp16 (slow)
    if (paramBillions <= 8) return 2;
    return 1;
  }

  /**
   * Resolve the number of physical CPU cores from the capabilities tier,
   * used for setting --threads in llama.cpp. Provides a conservative estimate
   * when precise hardware info is not available via HardwareCapabilities alone.
   */
  private resolveCpuCores(): number {
    switch (this.capabilities.tier) {
      case "pro":         return 16;
      case "accelerated": return 8;
      case "standard":    return 8;
      default:            return 4;
    }
  }
}
