import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CapabilityResolver } from "./capability-resolver.js";
import type { HardwareCapabilities, HfModelInfo, InstalledModel } from "./types.js";

let tmp: string;

const HARDWARE: HardwareCapabilities = {
  canRunLlm: true,
  canRunDiffusion: false,
  canRunEmbedding: true,
  canRunAudio: true,
  hasGpu: false,
  totalVramBytes: 0,
  maxModelSizeBytes: 8 * 1024 * 1024 * 1024,
  recommendedQuantization: "q4_k_m",
  tier: "standard",
  summary: "test hardware",
  capabilityMap: [],
};

function makeModel(overrides: Partial<InstalledModel> = {}): InstalledModel {
  return {
    id: "test/model",
    revision: "main",
    displayName: "Test Model",
    pipelineTag: "text-generation",
    runtimeType: "general",
    filePath: tmp,
    fileSizeBytes: 1024 * 1024,
    status: "ready",
    downloadedAt: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "agi-cap-resolver-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("detectExtraDeps", () => {
  it("returns empty array when no config.json exists", () => {
    const resolver = new CapabilityResolver(HARDWARE);
    const deps = resolver.detectExtraDeps(makeModel());
    expect(deps).toEqual([]);
  });

  it("detects FP8 quantization → accelerate", () => {
    writeFileSync(join(tmp, "config.json"), JSON.stringify({
      model_type: "llama",
      quantization_config: { quant_method: "fp8" },
    }));
    const resolver = new CapabilityResolver(HARDWARE);
    const deps = resolver.detectExtraDeps(makeModel());
    expect(deps).toContain("accelerate");
  });

  it("detects GPTQ quantization → auto-gptq + accelerate", () => {
    writeFileSync(join(tmp, "config.json"), JSON.stringify({
      model_type: "llama",
      quantization_config: { quant_method: "gptq" },
    }));
    const resolver = new CapabilityResolver(HARDWARE);
    const deps = resolver.detectExtraDeps(makeModel());
    expect(deps).toContain("auto-gptq");
    expect(deps).toContain("accelerate");
  });

  it("detects AWQ quantization → autoawq + accelerate", () => {
    writeFileSync(join(tmp, "config.json"), JSON.stringify({
      model_type: "llama",
      quantization_config: { quant_method: "awq" },
    }));
    const resolver = new CapabilityResolver(HARDWARE);
    const deps = resolver.detectExtraDeps(makeModel());
    expect(deps).toContain("autoawq");
    expect(deps).toContain("accelerate");
  });

  it("detects bitsandbytes quantization", () => {
    writeFileSync(join(tmp, "config.json"), JSON.stringify({
      quantization_config: { quant_method: "bitsandbytes" },
    }));
    const resolver = new CapabilityResolver(HARDWARE);
    const deps = resolver.detectExtraDeps(makeModel());
    expect(deps).toContain("bitsandbytes");
    expect(deps).toContain("accelerate");
  });

  it("returns empty when no quantization_config", () => {
    writeFileSync(join(tmp, "config.json"), JSON.stringify({
      model_type: "gpt2",
    }));
    const resolver = new CapabilityResolver(HARDWARE);
    const deps = resolver.detectExtraDeps(makeModel());
    expect(deps).toEqual([]);
  });

  it("reads requirements.txt from model dir", () => {
    writeFileSync(join(tmp, "config.json"), "{}");
    writeFileSync(join(tmp, "requirements.txt"), "scipy\nnumpy\n# comment\n\ntorch");
    const resolver = new CapabilityResolver(HARDWARE);
    const deps = resolver.detectExtraDeps(makeModel());
    expect(deps).toEqual(["scipy", "numpy", "torch"]);
  });

  it("deduplicates deps from config + requirements", () => {
    writeFileSync(join(tmp, "config.json"), JSON.stringify({
      quantization_config: { quant_method: "fp8" },
    }));
    writeFileSync(join(tmp, "requirements.txt"), "accelerate\ncustom-pkg");
    const resolver = new CapabilityResolver(HARDWARE);
    const deps = resolver.detectExtraDeps(makeModel());
    expect(deps).toContain("accelerate");
    expect(deps).toContain("custom-pkg");
    expect(deps.filter(d => d === "accelerate")).toHaveLength(1);
  });

  it("is case-insensitive for quant_method", () => {
    writeFileSync(join(tmp, "config.json"), JSON.stringify({
      quantization_config: { quant_method: "FP8" },
    }));
    const resolver = new CapabilityResolver(HARDWARE);
    const deps = resolver.detectExtraDeps(makeModel());
    expect(deps).toContain("accelerate");
  });
});

// ---------------------------------------------------------------------------
// assessCompatibility — GPU requirement detection
// ---------------------------------------------------------------------------

function makeHfModel(overrides: Partial<HfModelInfo> = {}): HfModelInfo {
  return {
    id: "test/model",
    modelId: "model",
    tags: [],
    downloads: 0,
    likes: 0,
    gated: false,
    private: false,
    disabled: false,
    pipeline_tag: "text-generation",
    library_name: "transformers",
    ...overrides,
  };
}

const CPU_HW: HardwareCapabilities = { ...HARDWARE, hasGpu: false };
const GPU_HW: HardwareCapabilities = { ...HARDWARE, hasGpu: true, totalVramBytes: 24 * 1024 * 1024 * 1024 };

describe("assessCompatibility — GPU-only quantization", () => {
  it("fp8 tag → incompatible on CPU-only hardware", () => {
    const resolver = new CapabilityResolver(CPU_HW);
    const { compatibility, reason } = resolver.assessCompatibility(makeHfModel({ tags: ["fp8"] }));
    expect(compatibility).toBe("incompatible");
    expect(reason).toMatch(/gpu/i);
    expect(reason).toMatch(/fp8/i);
  });

  it("awq tag → incompatible on CPU-only hardware", () => {
    const resolver = new CapabilityResolver(CPU_HW);
    const { compatibility, reason } = resolver.assessCompatibility(makeHfModel({ tags: ["awq"] }));
    expect(compatibility).toBe("incompatible");
    expect(reason).toMatch(/gpu/i);
    expect(reason).toMatch(/awq/i);
  });

  it("gptq tag → incompatible on CPU-only hardware", () => {
    const resolver = new CapabilityResolver(CPU_HW);
    const { compatibility, reason } = resolver.assessCompatibility(makeHfModel({ tags: ["gptq"] }));
    expect(compatibility).toBe("incompatible");
    expect(reason).toMatch(/gpu/i);
    expect(reason).toMatch(/gptq/i);
  });

  it("bitsandbytes tag → incompatible on CPU-only hardware", () => {
    const resolver = new CapabilityResolver(CPU_HW);
    const { compatibility } = resolver.assessCompatibility(makeHfModel({ tags: ["bitsandbytes"] }));
    expect(compatibility).toBe("incompatible");
  });

  it("eetq tag → incompatible on CPU-only hardware", () => {
    const resolver = new CapabilityResolver(CPU_HW);
    const { compatibility } = resolver.assessCompatibility(makeHfModel({ tags: ["eetq"] }));
    expect(compatibility).toBe("incompatible");
  });

  it("fp8 tag → not blocked on GPU hardware (may still be limited by size)", () => {
    const resolver = new CapabilityResolver(GPU_HW);
    // Small model — should NOT be "incompatible" just because of fp8 tag on GPU
    const { compatibility } = resolver.assessCompatibility(
      makeHfModel({ tags: ["fp8"] }),
      { sizeBytes: 1 * 1024 * 1024 * 1024 }, // 1 GB
    );
    expect(compatibility).not.toBe("incompatible");
  });

  it("gguf quantization tags do NOT trigger GPU-only flag (GGUF runs on CPU)", () => {
    const resolver = new CapabilityResolver(CPU_HW);
    // Q4_K_M is a GGUF quantization — should be "limited" not "incompatible"
    const { compatibility } = resolver.assessCompatibility(
      makeHfModel({ tags: ["gguf", "Q4_K_M"], pipeline_tag: "text-generation" }),
      { sizeBytes: 2 * 1024 * 1024 * 1024, quantization: "Q4_K_M" },
    );
    expect(compatibility).not.toBe("incompatible");
  });

  it("requires-gpu tag → incompatible on CPU-only hardware", () => {
    const resolver = new CapabilityResolver(CPU_HW);
    const { compatibility, reason } = resolver.assessCompatibility(
      makeHfModel({ tags: ["requires-gpu"] }),
    );
    expect(compatibility).toBe("incompatible");
    expect(reason).toMatch(/gpu/i);
  });
});

describe("buildContainerConfig injects EXTRA_PIP_DEPS", () => {
  it("sets EXTRA_PIP_DEPS env var for models with quant deps", () => {
    writeFileSync(join(tmp, "config.json"), JSON.stringify({
      model_type: "llama",
      quantization_config: { quant_method: "gptq" },
    }));
    const resolver = new CapabilityResolver(HARDWARE);
    const model = makeModel({ runtimeType: "general" });
    const config = resolver.buildContainerConfig(model);
    expect(config.env.EXTRA_PIP_DEPS).toBe("auto-gptq,accelerate");
  });

  it("does not set EXTRA_PIP_DEPS when no extra deps needed", () => {
    writeFileSync(join(tmp, "config.json"), JSON.stringify({ model_type: "gpt2" }));
    const resolver = new CapabilityResolver(HARDWARE);
    const model = makeModel({ runtimeType: "general" });
    const config = resolver.buildContainerConfig(model);
    expect(config.env.EXTRA_PIP_DEPS).toBeUndefined();
  });
});
