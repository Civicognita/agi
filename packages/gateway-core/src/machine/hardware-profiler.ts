/**
 * HardwareProfiler — Detects local hardware capabilities for ML model selection.
 *
 * Runs system commands (lscpu, nvidia-smi, rocm-smi, podman) to build a
 * HardwareProfile and derives a HardwareCapabilities summary for the UI and
 * model compatibility checks. All command invocations degrade gracefully on
 * failure — the profiler never throws.
 */

import { readFileSync, statfsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import type {
  GpuInfo,
  HardwareProfile,
  HardwareCapabilities,
  CapabilityEntry,
} from "@agi/model-runtime";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GB = 1024 * 1024 * 1024;
const EXEC_OPTS = { stdio: "pipe", timeout: 10_000 } as const;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Parse a single key=value-style line from lscpu output. */
function lscpuField(output: string, label: string): string {
  const re = new RegExp(`^${label}\\s*:\\s*(.+)$`, "m");
  const m = re.exec(output);
  return m?.[1]?.trim() ?? "";
}

/** Parse NVIDIA CSV line: index,name,memory.total,driver_version,compute_cap */
function parseNvidiaCsvLine(line: string): GpuInfo | null {
  const parts = line.split(",").map((p) => p.trim());
  if (parts.length < 5) return null;
  const indexStr = parts[0] ?? "";
  const name = parts[1] ?? "Unknown NVIDIA GPU";
  const memStr = parts[2] ?? "0";
  const driverVersion = parts[3];
  const computeCapability = parts[4];
  const index = parseInt(indexStr, 10);
  const vramBytes = parseFloat(memStr) * 1024 * 1024; // MiB → bytes
  if (!Number.isFinite(index) || !Number.isFinite(vramBytes)) return null;
  return {
    index,
    name: name ?? "Unknown NVIDIA GPU",
    vendor: "nvidia",
    vramBytes,
    driverVersion,
    computeCapability,
  };
}

/** Parse rocm-smi JSON output into GpuInfo array. */
function parseRocmJson(raw: string): GpuInfo[] {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return [];
  }

  const gpus: GpuInfo[] = [];
  // rocm-smi --json produces keys like "card0", "card1", ...
  let index = 0;
  for (const [key, value] of Object.entries(data)) {
    if (!key.startsWith("card")) continue;
    if (typeof value !== "object" || value === null) continue;
    const card = value as Record<string, unknown>;

    // Product name may appear under different keys across rocm-smi versions
    const name =
      String(card["Card series"] ?? card["Card Series"] ?? card["GPU"] ?? "Unknown AMD GPU");

    // VRAM: "VRAM Total Memory (B)" or "Total VRAM Memory" in bytes
    const vramRaw =
      card["VRAM Total Memory (B)"] ?? card["Total VRAM Memory (B)"] ?? card["vram_total"];
    const vramBytes = typeof vramRaw === "number" ? vramRaw : parseFloat(String(vramRaw ?? "0"));

    // rocmVersion may appear as a top-level field
    const rocmVersion =
      typeof card["Driver version"] === "string" ? card["Driver version"] : undefined;

    gpus.push({
      index,
      name,
      vendor: "amd",
      vramBytes: Number.isFinite(vramBytes) ? vramBytes : 0,
      rocmVersion,
    });
    index++;
  }
  return gpus;
}

// ---------------------------------------------------------------------------
// HardwareProfiler
// ---------------------------------------------------------------------------

export class HardwareProfiler {
  private cachedProfile: HardwareProfile | null = null;

  constructor(private readonly modelCachePath: string) {}

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Run hardware detection. Caches result — call rescan() to force refresh. */
  scan(): HardwareProfile {
    if (this.cachedProfile) return this.cachedProfile;
    this.cachedProfile = this.runScan();
    return this.cachedProfile;
  }

  /** Force a fresh hardware detection, ignoring any cached profile. */
  rescan(): HardwareProfile {
    this.cachedProfile = null;
    return this.scan();
  }

  /** Return cached profile, or scan if not yet cached. */
  getProfile(): HardwareProfile {
    return this.scan();
  }

  // -------------------------------------------------------------------------
  // Core scan
  // -------------------------------------------------------------------------

  private runScan(): HardwareProfile {
    const cpu = this.detectCpu();
    const ram = this.detectRam();
    const gpu = this.detectGpu();
    const disk = this.detectDisk();
    const podman = this.detectPodman();

    // Build partial profile so computeCapabilities can reference it
    const partial = { cpu, ram, gpu, disk, podman } as Omit<HardwareProfile, "capabilities" | "scannedAt">;
    const capabilities = this.computeCapabilities(partial as HardwareProfile);

    return {
      ...partial,
      capabilities,
      scannedAt: new Date().toISOString(),
    };
  }

  // -------------------------------------------------------------------------
  // CPU detection
  // -------------------------------------------------------------------------

  private detectCpu(): HardwareProfile["cpu"] {
    const defaults = {
      cores: 1,
      threads: 1,
      model: "Unknown",
      arch: "x86_64",
      avx2: false,
      avx512: false,
    };

    try {
      const raw = execFileSync("lscpu", [], EXEC_OPTS).toString();

      const coresPerSocket = parseInt(lscpuField(raw, "Core\\(s\\) per socket"), 10) || 1;
      const sockets = parseInt(lscpuField(raw, "Socket\\(s\\)"), 10) || 1;
      const threads = parseInt(lscpuField(raw, "CPU\\(s\\)"), 10) || 1;
      const model = lscpuField(raw, "Model name") || "Unknown CPU";
      const arch = lscpuField(raw, "Architecture") || "x86_64";
      const flags = lscpuField(raw, "Flags").toLowerCase();

      return {
        cores: coresPerSocket * sockets,
        threads,
        model,
        arch,
        avx2: flags.includes("avx2"),
        avx512: flags.includes("avx512"),
      };
    } catch {
      return defaults;
    }
  }

  // -------------------------------------------------------------------------
  // RAM detection
  // -------------------------------------------------------------------------

  private detectRam(): HardwareProfile["ram"] {
    try {
      const meminfo = readFileSync("/proc/meminfo", "utf8");

      const totalKb = parseInt(
        (/^MemTotal:\s+(\d+)\s+kB/m.exec(meminfo) ?? [])[1] ?? "0",
        10,
      );
      const availableKb = parseInt(
        (/^MemAvailable:\s+(\d+)\s+kB/m.exec(meminfo) ?? [])[1] ?? "0",
        10,
      );

      return {
        totalBytes: totalKb * 1024,
        availableBytes: availableKb * 1024,
      };
    } catch {
      return { totalBytes: 0, availableBytes: 0 };
    }
  }

  // -------------------------------------------------------------------------
  // GPU detection
  // -------------------------------------------------------------------------

  private detectGpu(): GpuInfo[] {
    // Try NVIDIA first
    const nvidia = this.detectNvidiaGpus();
    if (nvidia.length > 0) return nvidia;

    // Fall back to AMD
    const amd = this.detectAmdGpus();
    if (amd.length > 0) return amd;

    return [];
  }

  private detectNvidiaGpus(): GpuInfo[] {
    try {
      const raw = execFileSync(
        "nvidia-smi",
        [
          "--query-gpu=index,name,memory.total,driver_version,compute_cap",
          "--format=csv,noheader,nounits",
        ],
        EXEC_OPTS,
      ).toString();

      return raw
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map(parseNvidiaCsvLine)
        .filter((g): g is GpuInfo => g !== null);
    } catch {
      return [];
    }
  }

  private detectAmdGpus(): GpuInfo[] {
    try {
      const raw = execFileSync(
        "rocm-smi",
        ["--showproductname", "--showmeminfo", "vram", "--json"],
        EXEC_OPTS,
      ).toString();

      return parseRocmJson(raw);
    } catch {
      return [];
    }
  }

  // -------------------------------------------------------------------------
  // Disk detection
  // -------------------------------------------------------------------------

  private detectDisk(): HardwareProfile["disk"] {
    try {
      const stats = statfsSync(this.modelCachePath);
      // statfs returns sizes in blocks; bsize is block size in bytes
      const totalBytes = stats.blocks * stats.bsize;
      const availableBytes = stats.bavail * stats.bsize;
      return { modelCachePath: this.modelCachePath, availableBytes, totalBytes };
    } catch {
      return { modelCachePath: this.modelCachePath, availableBytes: 0, totalBytes: 0 };
    }
  }

  // -------------------------------------------------------------------------
  // Podman detection
  // -------------------------------------------------------------------------

  private detectPodman(): HardwareProfile["podman"] {
    try {
      const version = execFileSync(
        "podman",
        ["version", "--format", "{{.Client.Version}}"],
        EXEC_OPTS,
      )
        .toString()
        .trim();

      const gpuRuntime = this.detectPodmanGpuRuntime();
      return { available: true, version, gpuRuntime };
    } catch {
      return { available: false, gpuRuntime: false };
    }
  }

  private detectPodmanGpuRuntime(): boolean {
    // Check whether the nvidia CDI device (or nvidia hooks) is present via
    // `podman info`. We look for "nvidia" in the CDI devices list.
    try {
      const info = execFileSync(
        "podman",
        ["info", "--format", "{{.Host.Devices}}"],
        EXEC_OPTS,
      )
        .toString()
        .toLowerCase();
      return info.includes("nvidia");
    } catch {
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Capability computation
  // -------------------------------------------------------------------------

  computeCapabilities(profile: HardwareProfile): HardwareCapabilities {
    const totalRam = profile.ram.totalBytes;
    const gpus = profile.gpu;
    const hasGpu = gpus.length > 0;
    const totalVramBytes = gpus.reduce((sum, g) => sum + g.vramBytes, 0);
    const maxVramGpu = gpus.reduce((max, g) => (g.vramBytes > max ? g.vramBytes : max), 0);

    const canRunLlm = totalRam >= 4 * GB;
    const canRunDiffusion = gpus.some((g) => g.vramBytes >= 4 * GB);
    const canRunEmbedding = totalRam >= 2 * GB;
    const canRunAudio = totalRam >= 4 * GB;

    // maxModelSizeBytes: usable RAM (minus 4 GB reserved) + total VRAM
    const usableRam = Math.max(0, totalRam - 4 * GB);
    const maxModelSizeBytes = usableRam + totalVramBytes;

    const recommendedQuantization = this.pickQuantization(totalRam, maxVramGpu);
    const tier = this.pickTier(totalRam, maxVramGpu);
    const summary = this.buildSummary(tier, totalRam, maxVramGpu, canRunLlm);
    const capabilityMap = this.buildCapabilityMap(
      totalRam,
      maxVramGpu,
      hasGpu,
      canRunDiffusion,
    );

    return {
      canRunLlm,
      canRunDiffusion,
      canRunEmbedding,
      canRunAudio,
      hasGpu,
      totalVramBytes,
      maxModelSizeBytes,
      recommendedQuantization,
      tier,
      summary,
      capabilityMap,
    };
  }

  // -------------------------------------------------------------------------
  // Quantization / tier helpers
  // -------------------------------------------------------------------------

  private pickQuantization(
    totalRam: number,
    maxVramBytes: number,
  ): HardwareCapabilities["recommendedQuantization"] {
    const ramGb = totalRam / GB;
    const vramGb = maxVramBytes / GB;

    if (vramGb >= 24 || ramGb >= 64) return "f16";
    if (vramGb >= 8 || ramGb >= 32) return "q8_0";
    if (ramGb >= 16) return "q5_k_m";
    if (ramGb >= 8) return "q4_k_m";
    return "q4_0";
  }

  private pickTier(totalRam: number, maxVramBytes: number): HardwareCapabilities["tier"] {
    const ramGb = totalRam / GB;
    const vramGb = maxVramBytes / GB;

    if (vramGb >= 24 || ramGb >= 64) return "pro";
    if (vramGb > 0 && vramGb < 24) return "accelerated";
    if (ramGb > 16 && ramGb <= 48) return "standard";
    return "minimal";
  }

  private buildSummary(
    tier: HardwareCapabilities["tier"],
    totalRam: number,
    maxVramBytes: number,
    canRunLlm: boolean,
  ): string {
    const ramGb = Math.round(totalRam / GB);
    const vramGb = Math.round(maxVramBytes / GB);

    if (!canRunLlm) {
      return `Your setup has ${ramGb} GB RAM — upgrade to at least 4 GB to run language models.`;
    }

    switch (tier) {
      case "pro":
        return vramGb >= 24
          ? `Your setup can run 70B+ language models and full-precision diffusion at ~20-40 tok/s with ${vramGb} GB VRAM.`
          : `Your setup can run 70B+ language models at high quality with ${ramGb} GB RAM.`;
      case "accelerated":
        return `Your setup can run 7-13B language models GPU-accelerated at ~15-30 tok/s with ${vramGb} GB VRAM.`;
      case "standard":
        return `Your setup can run 13B language models at ~3-5 tok/s with ${ramGb} GB RAM.`;
      default:
        return `Your setup can run 7B language models at ~1-3 tok/s with ${ramGb} GB RAM.`;
    }
  }

  // -------------------------------------------------------------------------
  // Capability map
  // -------------------------------------------------------------------------

  private buildCapabilityMap(
    totalRam: number,
    maxVramBytes: number,
    hasGpu: boolean,
    canRunDiffusion: boolean,
  ): CapabilityEntry[] {
    const ramGb = totalRam / GB;
    const vramGb = maxVramBytes / GB;

    return [
      this.smallLlmEntry(ramGb, vramGb, hasGpu),
      this.mediumLlmEntry(ramGb, vramGb, hasGpu),
      this.largeLlmEntry(ramGb, vramGb, hasGpu),
      this.frontierLlmEntry(ramGb, vramGb, hasGpu),
      this.imageGenEntry(vramGb, canRunDiffusion),
      this.audioEntry(ramGb),
      this.embeddingEntry(ramGb),
      this.concurrentModelsEntry(ramGb, vramGb, hasGpu),
      this.fineTuningEntry(ramGb, vramGb, hasGpu),
    ];
  }

  private smallLlmEntry(ramGb: number, vramGb: number, hasGpu: boolean): CapabilityEntry {
    // 7B model: needs ~4 GB RAM (q4) or ~4 GB VRAM (GPU)
    const capable = hasGpu ? vramGb >= 4 : ramGb >= 4;
    const limited = !capable && ramGb >= 4;
    return {
      id: "small-llm",
      label: "7B Language Models",
      description: "Run 7B parameter language models like Llama 3.1, Mistral 7B, and Phi-3.",
      status: capable ? "on" : limited ? "limited" : "off",
      reason: hasGpu
        ? `${Math.round(vramGb)} GB VRAM detected${capable ? ", sufficient for 7B models" : " — 4 GB required for GPU acceleration"}`
        : `${Math.round(ramGb)} GB RAM detected${capable ? ", sufficient for 7B models (q4)" : " — 4 GB required"}`,
      hardwareRequired: "4 GB RAM or 4 GB VRAM",
      unlockHint: capable ? undefined : "Add a GPU with 4+ GB VRAM for fast inference.",
    };
  }

  private mediumLlmEntry(ramGb: number, vramGb: number, hasGpu: boolean): CapabilityEntry {
    // 13B model: needs ~8 GB RAM (q4) or ~8 GB VRAM
    const capable = hasGpu ? vramGb >= 8 : ramGb >= 8;
    const limited = !capable && ramGb >= 6;
    return {
      id: "medium-llm",
      label: "13B Language Models",
      description: "Run 13B parameter models like Llama 3.1 13B and Mistral NeMo.",
      status: capable ? "on" : limited ? "limited" : "off",
      reason: hasGpu
        ? `${Math.round(vramGb)} GB VRAM detected${capable ? ", sufficient for 13B models" : " — 8 GB required"}`
        : `${Math.round(ramGb)} GB RAM detected${capable ? ", sufficient for 13B models (q4)" : " — 8 GB required"}`,
      hardwareRequired: "8 GB RAM or 8 GB VRAM",
      unlockHint: capable ? undefined : "Upgrade to 16 GB RAM or a GPU with 8+ GB VRAM.",
    };
  }

  private largeLlmEntry(ramGb: number, vramGb: number, hasGpu: boolean): CapabilityEntry {
    // 30B model: needs ~16 GB RAM (q4) or ~16 GB VRAM
    const capable = hasGpu ? vramGb >= 16 : ramGb >= 16;
    return {
      id: "large-llm",
      label: "30B Language Models",
      description: "Run 30B+ parameter models like Llama 3 30B and CodeLlama 34B.",
      status: capable ? "on" : "off",
      reason: hasGpu
        ? `${Math.round(vramGb)} GB VRAM detected${capable ? "" : " — 16 GB required"}`
        : `${Math.round(ramGb)} GB RAM detected${capable ? "" : " — 16 GB required"}`,
      hardwareRequired: "16 GB RAM or 16 GB VRAM",
      unlockHint: capable ? undefined : "Upgrade to 32 GB RAM or a GPU with 16+ GB VRAM.",
    };
  }

  private frontierLlmEntry(ramGb: number, vramGb: number, hasGpu: boolean): CapabilityEntry {
    // 70B model: needs ~40 GB RAM (q4) or 24+ GB VRAM (multi-GPU)
    const capable = hasGpu ? vramGb >= 24 : ramGb >= 40;
    return {
      id: "frontier-llm",
      label: "70B+ Language Models",
      description: "Run 70B parameter models like Llama 3.1 70B — frontier open-weight performance.",
      status: capable ? "on" : "off",
      reason: hasGpu
        ? `${Math.round(vramGb)} GB VRAM detected${capable ? "" : " — 24 GB required"}`
        : `${Math.round(ramGb)} GB RAM detected${capable ? "" : " — 40 GB required"}`,
      hardwareRequired: "40 GB RAM or 24 GB VRAM",
      unlockHint: capable
        ? undefined
        : "A GPU with 24+ GB VRAM (e.g. RTX 3090, A5000) unlocks frontier models.",
    };
  }

  private imageGenEntry(vramGb: number, canRunDiffusion: boolean): CapabilityEntry {
    return {
      id: "image-generation",
      label: "Image Generation",
      description: "Generate images locally with Stable Diffusion and FLUX models.",
      status: canRunDiffusion ? "on" : "off",
      reason: canRunDiffusion
        ? `${Math.round(vramGb)} GB VRAM detected — sufficient for SDXL and FLUX.`
        : `${Math.round(vramGb)} GB VRAM detected — a GPU with 4+ GB VRAM required.`,
      hardwareRequired: "GPU with 4 GB VRAM",
      unlockHint: canRunDiffusion
        ? undefined
        : "Add a GPU with 4+ GB VRAM to enable local image generation.",
    };
  }

  private audioEntry(ramGb: number): CapabilityEntry {
    const capable = ramGb >= 4;
    return {
      id: "audio-processing",
      label: "Audio Processing",
      description: "Transcribe audio (Whisper) and synthesize speech (Kokoro, XTTS) locally.",
      status: capable ? "on" : "off",
      reason: `${Math.round(ramGb)} GB RAM detected${capable ? " — sufficient for Whisper and TTS" : " — 4 GB required"}.`,
      hardwareRequired: "4 GB RAM",
      unlockHint: capable ? undefined : "Upgrade to 4 GB RAM to enable audio processing.",
    };
  }

  private embeddingEntry(ramGb: number): CapabilityEntry {
    const capable = ramGb >= 2;
    return {
      id: "embeddings",
      label: "Embeddings",
      description: "Generate text embeddings for RAG pipelines and semantic search.",
      status: capable ? "on" : "off",
      reason: `${Math.round(ramGb)} GB RAM detected${capable ? " — sufficient for embedding models" : " — 2 GB required"}.`,
      hardwareRequired: "2 GB RAM",
      unlockHint: capable ? undefined : "Upgrade to 2 GB RAM to enable embeddings.",
    };
  }

  private concurrentModelsEntry(
    ramGb: number,
    vramGb: number,
    hasGpu: boolean,
  ): CapabilityEntry {
    // Running 2+ models simultaneously: 16 GB RAM or 16 GB VRAM
    const capable = hasGpu ? vramGb >= 16 : ramGb >= 16;
    const limited = !capable && ramGb >= 8;
    return {
      id: "concurrent-models",
      label: "Concurrent Models",
      description: "Keep multiple models loaded simultaneously for instant switching.",
      status: capable ? "on" : limited ? "limited" : "off",
      reason: hasGpu
        ? `${Math.round(vramGb)} GB VRAM — ${capable ? "can keep multiple models hot" : "limited to one model at a time"}`
        : `${Math.round(ramGb)} GB RAM — ${capable ? "can keep multiple models hot" : "limited to one model at a time"}`,
      hardwareRequired: "16 GB RAM or 16 GB VRAM",
      unlockHint: capable ? undefined : "Upgrade to 32 GB RAM to keep two 7B models loaded at once.",
    };
  }

  private fineTuningEntry(ramGb: number, vramGb: number, hasGpu: boolean): CapabilityEntry {
    // Fine-tuning (LoRA / QLoRA): needs 24+ GB VRAM or 64+ GB RAM
    const capable = hasGpu ? vramGb >= 24 : ramGb >= 64;
    return {
      id: "fine-tuning",
      label: "Model Fine-Tuning",
      description: "Fine-tune models with LoRA / QLoRA adapters on your own data.",
      status: capable ? "on" : "off",
      reason: hasGpu
        ? `${Math.round(vramGb)} GB VRAM detected${capable ? " — sufficient for LoRA fine-tuning" : " — 24 GB required"}`
        : `${Math.round(ramGb)} GB RAM detected${capable ? " — sufficient for CPU fine-tuning" : " — 24 GB VRAM or 64 GB RAM required"}`,
      hardwareRequired: "24 GB VRAM or 64 GB RAM",
      unlockHint: capable
        ? undefined
        : "A GPU with 24+ GB VRAM (e.g. RTX 3090, RTX 4090) enables LoRA fine-tuning.",
    };
  }
}
