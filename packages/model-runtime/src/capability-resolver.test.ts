import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CapabilityResolver } from "./capability-resolver.js";
import type { HardwareCapabilities, InstalledModel } from "./types.js";

let tmp: string;

const HARDWARE: HardwareCapabilities = {
  cpuModel: "test",
  cpuCores: 4,
  totalRamBytes: 8 * 1024 * 1024 * 1024,
  availableRamBytes: 6 * 1024 * 1024 * 1024,
  totalDiskBytes: 100 * 1024 * 1024 * 1024,
  availableDiskBytes: 50 * 1024 * 1024 * 1024,
  hasGpu: false,
  gpuModel: null,
  gpuVramBytes: null,
  tier: "standard",
  maxModelSizeBytes: 8 * 1024 * 1024 * 1024,
  disk: { modelCachePath: "/tmp/models" },
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
