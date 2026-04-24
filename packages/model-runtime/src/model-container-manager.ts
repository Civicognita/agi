/**
 * ModelContainerManager — Podman container lifecycle for HuggingFace model runtimes.
 *
 * Starts, stops, and monitors Podman containers that serve local ML models.
 * Port allocation mirrors HostingManager's pattern (allocatedPorts Set + ss probe).
 * State is persisted to ~/.agi/model-containers.json so containers can be
 * re-verified on gateway restart.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import type {
  InstalledModel,
  ModelContainerConfig,
  ModelContainerState,
  ModelRuntimeEventEmitter,
  ModelRuntimeType,
} from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PORT_POOL_SIZE = 100;
const HEALTH_CHECK_INTERVAL_MS = 2_000;
const HEALTH_CHECK_TIMEOUT_MS = 120_000;

const DEFAULT_IMAGES: Record<ModelRuntimeType, string> = {
  llm: "ghcr.io/civicognita/transformers-server:latest",
  diffusion: "ghcr.io/civicognita/diffusion-server:latest",
  general: "ghcr.io/civicognita/transformers-server:latest",
  custom: "",
  ollama: "",
};

const INTERNAL_PORTS: Record<ModelRuntimeType, number> = {
  llm: 8080,
  diffusion: 8000,
  general: 8000,
  custom: 8000,
  ollama: 11434,
};

// ---------------------------------------------------------------------------
// Config shape
// ---------------------------------------------------------------------------

interface ManagerConfig {
  portRangeStart: number;
  maxConcurrentModels: number;
  gpuMode: "auto" | "nvidia" | "amd" | "cpu-only";
  images?: { llm?: string; diffusion?: string; general?: string };
  statePath: string;
  /** RAM budget in bytes. 0 = unlimited. */
  ramBudgetBytes?: number;
}

// ---------------------------------------------------------------------------
// Persisted state shape
// ---------------------------------------------------------------------------

interface PersistedState {
  containers: ModelContainerState[];
}

// ---------------------------------------------------------------------------
// ModelContainerManager
// ---------------------------------------------------------------------------

export class ModelContainerManager {
  private readonly config: ManagerConfig;
  private readonly events: ModelRuntimeEventEmitter;

  /** Active containers keyed by modelId. */
  private readonly activeContainers = new Map<string, ModelContainerState>();

  /** Ports currently reserved by this manager. */
  private readonly allocatedPorts = new Set<number>();

  constructor(
    config: {
      portRangeStart: number;
      maxConcurrentModels: number;
      gpuMode: "auto" | "nvidia" | "amd" | "cpu-only";
      images?: { llm?: string; diffusion?: string; general?: string };
      statePath: string;
      /** RAM budget in bytes. 0 = unlimited. */
      ramBudgetBytes?: number;
    },
    events: ModelRuntimeEventEmitter,
  ) {
    this.config = config;
    this.events = events;
    this.loadState();
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Start a Podman container for the given model and return its running state.
   * Waits up to 120 s for the container's /health endpoint to respond.
   * On ImportError crash, retries once with the missing package added.
   */
  async start(model: InstalledModel, containerConfig: ModelContainerConfig, retryCount = 0): Promise<ModelContainerState> {
    if (this.activeContainers.size >= this.config.maxConcurrentModels) {
      throw new Error(
        `Cannot start model "${model.id}": maxConcurrentModels limit (${String(this.config.maxConcurrentModels)}) reached`,
      );
    }

    // RAM budget enforcement — skip when ramBudgetBytes is 0 (unlimited)
    const ramBudget = this.config.ramBudgetBytes ?? 0;
    if (ramBudget > 0) {
      // Sum RAM already committed by running containers (each estimated as its memory limit or 4 GB fallback)
      const usedBytes = Array.from(this.activeContainers.values()).reduce((acc, state) => {
        // We don't store the memory limit on the state — use fileSizeBytes as a proxy (model in memory ≈ file size)
        return acc + (state.estimatedRamBytes ?? 4 * 1024 * 1024 * 1024);
      }, 0);
      const newModelRam = containerConfig.estimatedRamBytes ?? model.fileSizeBytes ?? 4 * 1024 * 1024 * 1024;
      if (usedBytes + newModelRam > ramBudget) {
        const usedGB = (usedBytes / (1024 ** 3)).toFixed(1);
        const limitGB = (ramBudget / (1024 ** 3)).toFixed(1);
        throw new Error(
          `Cannot start model: would exceed RAM budget (${usedGB} GB used of ${limitGB} GB limit)`,
        );
      }
    }

    // Ollama runtime — no container, model served by Ollama daemon
    if (containerConfig.runtimeType === "ollama" && containerConfig.ollamaModelName) {
      const ollamaModel = containerConfig.ollamaModelName;
      this.events.emit("model:starting", model.id);
      try {
        execFileSync("ollama", ["pull", ollamaModel], { stdio: "pipe", timeout: 600_000 });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.events.emit("model:error", model.id, `Ollama pull failed: ${msg}`);
        throw new Error(`Failed to pull Ollama model "${ollamaModel}": ${msg}`);
      }

      const state: ModelContainerState = {
        modelId: model.id,
        containerId: `ollama-${ollamaModel}`,
        containerName: `ollama-${ollamaModel}`,
        port: 11434,
        runtimeType: "ollama",
        startedAt: new Date().toISOString(),
        status: "running",
        healthCheckPassed: true,
        estimatedRamBytes: containerConfig.estimatedRamBytes ?? model.fileSizeBytes,
      };
      this.activeContainers.set(model.id, state);
      this.persistState();
      this.events.emit("model:started", model.id, 11434);
      return state;
    }

    const port = this.allocatePort();

    const containerName = `agi-model-${this.sanitizeContainerName(model.id)}`;

    // Remove any stale container with the same name before starting
    try {
      execFileSync("podman", ["rm", "-f", containerName], {
        stdio: "pipe",
        timeout: 10_000,
      });
    } catch {
      // Container did not exist — that's fine
    }

    const internalPort = containerConfig.internalPort || INTERNAL_PORTS[containerConfig.runtimeType] || 8000;
    // Custom models store their built image in the DB — use it.
    // Standard models always resolve the image from CapabilityResolver at start
    // time so DEFAULT_IMAGES updates take effect without re-downloading.
    let image = containerConfig.runtimeType === "custom"
      ? (model.containerImage ?? (containerConfig.image || DEFAULT_IMAGES[containerConfig.runtimeType]))
      : (containerConfig.image || DEFAULT_IMAGES[containerConfig.runtimeType]);

    // Check for cached derivative image (has extra pip deps baked in)
    const cachedTag = this.getCachedImageTag(model.id);
    if (containerConfig.runtimeType !== "custom" && this.cachedImageExists(cachedTag)) {
      image = cachedTag;
      delete containerConfig.env.EXTRA_PIP_DEPS;
    }
    const modelContainerPath = containerConfig.modelContainerPath;
    const modelFilename = containerConfig.modelFilename ?? model.modelFilename ?? "";

    // Ensure container image is available — pull if not present
    try {
      execFileSync("podman", ["image", "exists", image], { stdio: "pipe", timeout: 10_000 });
    } catch {
      // Image not present locally — pull it
      this.events.emit("model:starting", model.id);
      try {
        execFileSync("podman", ["pull", image], { stdio: "pipe", timeout: 300_000 });
      } catch (pullErr) {
        this.allocatedPorts.delete(port);
        const msg = pullErr instanceof Error ? pullErr.message : String(pullErr);
        const errorMsg = `Container image "${image}" is not available and could not be pulled. ${msg}`;
        this.events.emit("model:error", model.id, errorMsg);
        throw new Error(errorMsg);
      }
    }

    // Build environment from config, plus mandatory HF_TASK and MODEL_PATH
    const envArgs: string[] = [
      "-e", `HF_TASK=${model.pipelineTag}`,
      "-e", `MODEL_PATH=${modelContainerPath}/${modelFilename}`,
    ];
    for (const [key, value] of Object.entries(containerConfig.env)) {
      envArgs.push("-e", `${key}=${value}`);
    }

    const gpuFlags = this.getGpuFlags();

    const args: string[] = [
      "run", "-d",
      "--name", containerName,
      // Explicit `127.0.0.1:` prefix so these model servers aren't exposed
      // on the LAN. Previously bound to all interfaces (0.0.0.0) which is
      // a security regression — the inference API is unauthenticated. The
      // gateway (host process) reaches these via loopback. When gateway is
      // eventually containerized on aionima (story #100 follow-up), drop
      // the `-p` entirely and reach the model by container DNS instead.
      "-p", `127.0.0.1:${String(port)}:${String(internalPort)}`,
      "-v", `${containerConfig.modelHostPath}:${modelContainerPath}:ro`,
      ...(containerConfig.memoryLimit ? ["--memory", containerConfig.memoryLimit] : []),
      "--restart", "on-failure:3",
      "--label", "agi.model=true",
      "--label", `agi.model.id=${model.id}`,
      "--label", `agi.model.runtime=${containerConfig.runtimeType}`,
      ...envArgs,
      ...gpuFlags,
      image,
      ...containerConfig.runtimeArgs,
    ];

    let containerId: string;
    try {
      containerId = execFileSync("podman", args, {
        stdio: "pipe",
        timeout: 60_000,
      }).toString().trim();
    } catch (err) {
      this.allocatedPorts.delete(port);
      const message = err instanceof Error ? err.message : String(err);
      this.events.emit("model:error", model.id, `Failed to start container: ${message}`);
      throw new Error(`Failed to start container for model "${model.id}": ${message}`);
    }

    this.events.emit("model:starting", model.id);

    const healthy = await this.waitForHealth(port, HEALTH_CHECK_TIMEOUT_MS);

    // Self-repair: if unhealthy and retry budget remains, check for missing pip packages
    if (!healthy && retryCount < 1) {
      const missingPkg = this.extractMissingPackage(this.getContainerLogs(containerName));
      if (missingPkg) {
        this.events.emit("model:starting", model.id);
        try { execFileSync("podman", ["rm", "-f", containerName], { stdio: "pipe", timeout: 10_000 }); } catch { /* ignore */ }
        this.allocatedPorts.delete(port);
        this.clearCachedImage(model.id);
        const existing = containerConfig.env.EXTRA_PIP_DEPS ?? "";
        const deps = existing ? existing.split(",") : [];
        if (!deps.includes(missingPkg)) deps.push(missingPkg);
        containerConfig.env.EXTRA_PIP_DEPS = deps.join(",");
        return this.start(model, containerConfig, retryCount + 1);
      }
    }

    // Cache the image if extra deps were installed and container is healthy
    if (healthy && containerConfig.env.EXTRA_PIP_DEPS && !this.cachedImageExists(cachedTag)) {
      this.commitContainer(containerId, cachedTag);
    }

    const state: ModelContainerState = {
      modelId: model.id,
      containerId,
      containerName,
      port,
      runtimeType: containerConfig.runtimeType,
      startedAt: new Date().toISOString(),
      status: healthy ? "running" : "error",
      healthCheckPassed: healthy,
      estimatedRamBytes: containerConfig.estimatedRamBytes ?? model.fileSizeBytes,
    };

    this.activeContainers.set(model.id, state);
    this.persistState();
    this.events.emit("model:started", model.id, port);

    return state;
  }

  /** Stop and remove the container for a given model. */
  async stop(modelId: string): Promise<void> {
    const state = this.activeContainers.get(modelId);
    if (!state) return;

    this.events.emit("model:stopping", modelId);

    if (state.runtimeType === "ollama") {
      try {
        execFileSync("ollama", ["stop", state.containerName.replace("ollama-", "")], {
          stdio: "pipe",
          timeout: 10_000,
        });
      } catch { /* model may not be loaded */ }
    } else {
      try {
        execFileSync("podman", ["stop", "-t", "10", state.containerName], {
          stdio: "pipe",
          timeout: 10_000,
        });
      } catch { /* container may already be stopped */ }

      try {
        execFileSync("podman", ["rm", "-f", state.containerName], {
          stdio: "pipe",
          timeout: 10_000,
        });
      } catch { /* container may already be removed */ }
    }

    this.allocatedPorts.delete(state.port);
    this.activeContainers.delete(modelId);
    this.persistState();

    this.events.emit("model:stopped", modelId);
  }

  /** Return the current state for a running model, or undefined if not active. */
  getStatus(modelId: string): ModelContainerState | undefined {
    return this.activeContainers.get(modelId);
  }

  /** Return all currently active container states. */
  getRunning(): ModelContainerState[] {
    return Array.from(this.activeContainers.values());
  }

  // -------------------------------------------------------------------------
  // Cached image + self-repair helpers
  // -------------------------------------------------------------------------

  private getCachedImageTag(modelId: string): string {
    return `agi-model-${this.sanitizeContainerName(modelId)}:latest`;
  }

  private cachedImageExists(imageTag: string): boolean {
    try {
      execFileSync("podman", ["image", "exists", imageTag], { stdio: "pipe", timeout: 10_000 });
      return true;
    } catch { return false; }
  }

  private commitContainer(containerId: string, imageTag: string): void {
    try {
      execFileSync("podman", ["commit", containerId, imageTag], { stdio: "pipe", timeout: 120_000 });
    } catch { /* non-fatal — next start will pip install again */ }
  }

  clearCachedImage(modelId: string): void {
    const tag = this.getCachedImageTag(modelId);
    try {
      execFileSync("podman", ["rmi", tag], { stdio: "pipe", timeout: 15_000 });
    } catch { /* image may not exist */ }
  }

  private getContainerLogs(containerName: string, tail = 50): string {
    try {
      return execFileSync("podman", ["logs", "--tail", String(tail), containerName], {
        stdio: "pipe", timeout: 10_000,
      }).toString();
    } catch { return ""; }
  }

  private extractMissingPackage(logs: string): string | null {
    const match = /(?:ModuleNotFoundError|ImportError): No module named '([^']+)'/.exec(logs);
    if (!match?.[1]) return null;
    const MODULE_TO_PACKAGE: Record<string, string> = {
      accelerate: "accelerate",
      auto_gptq: "auto-gptq",
      autoawq: "autoawq",
      bitsandbytes: "bitsandbytes",
      flash_attn: "flash-attn",
      mamba_ssm: "mamba-ssm",
      causal_conv1d: "causal-conv1d",
      eetq: "eetq",
      hqq: "hqq",
    };
    return MODULE_TO_PACKAGE[match[1]] ?? match[1].replace(/_/g, "-");
  }

  /**
   * Remove a model from the active-containers map and free its port allocation.
   * Used by the background health monitor to evict containers that have stopped
   * responding without going through the normal stop() flow.
   */
  removeFromActive(modelId: string): void {
    const state = this.activeContainers.get(modelId);
    if (state) {
      this.allocatedPorts.delete(state.port);
      this.activeContainers.delete(modelId);
      this.persistState();
    }
  }

  /**
   * Live health probe against a single running container's /health endpoint.
   * Returns true if the endpoint responds 2xx within 1.5s, false otherwise.
   * Used by the `/api/hf/running` route to surface current (not cached-at-start)
   * health status for the dashboard.
   */
  async probeHealth(modelId: string): Promise<boolean> {
    const state = this.activeContainers.get(modelId);
    if (!state) return false;
    if (state.runtimeType === "ollama") {
      try {
        const res = await fetch("http://localhost:11434/api/tags", { signal: AbortSignal.timeout(3000) });
        return res.ok;
      } catch { return false; }
    }
    try {
      const res = await fetch(`http://localhost:${String(state.port)}/health`, {
        signal: AbortSignal.timeout(1500),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Inspect a container by name and return its status. */
  inspectContainer(containerName: string): { status: string; running: boolean } {
    try {
      const status = execFileSync(
        "podman",
        ["inspect", "--format", "{{.State.Status}}", containerName],
        { stdio: "pipe", timeout: 10_000 },
      ).toString().trim();
      return { status, running: status === "running" };
    } catch {
      return { status: "unknown", running: false };
    }
  }

  /** Stop all running containers — call during gateway shutdown. */
  async stopAll(): Promise<void> {
    const modelIds = Array.from(this.activeContainers.keys());
    await Promise.all(modelIds.map((id) => this.stop(id)));
  }

  // -------------------------------------------------------------------------
  // Port allocation — mirrors HostingManager pattern exactly
  // -------------------------------------------------------------------------

  /** Check whether a TCP port is free using `ss`. */
  private isPortAvailable(port: number): boolean {
    try {
      const out = execFileSync("ss", ["-tlnH", `sport = :${String(port)}`], {
        stdio: "pipe",
        timeout: 5_000,
      }).toString();
      return out.trim().length === 0;
    } catch {
      return true; // ss failed — assume free
    }
  }

  private allocatePort(): number {
    const start = this.config.portRangeStart;
    for (let i = 0; i < PORT_POOL_SIZE; i++) {
      const port = start + i;
      if (!this.allocatedPorts.has(port) && this.isPortAvailable(port)) {
        this.allocatedPorts.add(port);
        return port;
      }
    }
    throw new Error(
      `Port pool exhausted (${String(start)}-${String(start + PORT_POOL_SIZE - 1)})`,
    );
  }

  // -------------------------------------------------------------------------
  // Health checking
  // -------------------------------------------------------------------------

  private async waitForHealth(port: number, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`http://localhost:${String(port)}/health`, {
          signal: AbortSignal.timeout(5_000),
        });
        if (res.ok) return true;
      } catch {
        // Container not ready yet — keep polling
      }
      await new Promise<void>((resolve) => setTimeout(resolve, HEALTH_CHECK_INTERVAL_MS));
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // GPU flags
  // -------------------------------------------------------------------------

  private getGpuFlags(): string[] {
    const mode = this.config.gpuMode;

    if (mode === "cpu-only") return [];

    if (mode === "nvidia") {
      return ["--device", "nvidia.com/gpu=all"];
    }

    if (mode === "amd") {
      return ["--device", "/dev/kfd", "--device", "/dev/dri"];
    }

    // auto — probe for available GPU
    if (mode === "auto") {
      if (this.hasNvidiaGpu()) {
        return ["--device", "nvidia.com/gpu=all"];
      }
      if (this.hasAmdGpu()) {
        return ["--device", "/dev/kfd", "--device", "/dev/dri"];
      }
    }

    return [];
  }

  private hasNvidiaGpu(): boolean {
    try {
      execFileSync("nvidia-smi", ["-L"], { stdio: "pipe", timeout: 5_000 });
      return true;
    } catch {
      return false;
    }
  }

  private hasAmdGpu(): boolean {
    try {
      execFileSync("rocm-smi", ["--version"], { stdio: "pipe", timeout: 5_000 });
      return true;
    } catch {
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Snapshot — used by boot-recovery to record running models at shutdown
  // -------------------------------------------------------------------------

  /**
   * Return a minimal snapshot of currently-running model containers. Used by
   * the gateway shutdown-marker writer so the next boot can re-start exactly
   * these containers if podman-restart missed them after a crash.
   */
  snapshotRunning(): Array<{ modelId: string; containerName: string }> {
    const out: Array<{ modelId: string; containerName: string }> = [];
    for (const [modelId, state] of this.activeContainers) {
      if (state.status === "running") {
        out.push({ modelId, containerName: state.containerName });
      }
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // State persistence
  // -------------------------------------------------------------------------

  private persistState(): void {
    const data: PersistedState = {
      containers: Array.from(this.activeContainers.values()),
    };
    try {
      writeFileSync(this.config.statePath, JSON.stringify(data, null, 2), "utf8");
    } catch {
      // Non-fatal — state will be rebuilt from podman inspect on next boot
    }
  }

  private loadState(): void {
    // First: restore from persisted file (if any)
    if (existsSync(this.config.statePath)) {
      try {
        const data = JSON.parse(readFileSync(this.config.statePath, "utf8")) as PersistedState;
        for (const state of data.containers) {
          const { running } = this.inspectContainer(state.containerName);
          if (!running) continue;
          this.activeContainers.set(state.modelId, { ...state, status: "running" });
          this.allocatedPorts.add(state.port);
        }
      } catch { /* corrupt file — fall through to discovery */ }
    }

    // Second: discover any running HF model containers not in the persisted file.
    // This catches containers started by a previous gateway session whose state
    // file was cleared or lost.
    try {
      const output = execFileSync("podman", [
        "ps", "--format", "{{.Names}}\t{{.Ports}}\t{{.ID}}",
      ], { encoding: "utf-8", stdio: "pipe", timeout: 10_000 }).trim();

      for (const line of output.split("\n")) {
        if (!line) continue;
        const [name, ports, containerId] = line.split("\t");
        if (!name?.startsWith("agi-model-")) continue;

        const modelPart = name.slice("agi-model-".length);
        const modelId = modelPart.replace(/--/g, "/");

        if (this.activeContainers.has(modelId)) continue;

        // Extract port from "127.0.0.1:6000->8080/tcp" format
        let port = 0;
        const portMatch = /:(\d+)->\d+\/tcp/.exec(ports ?? "");
        if (portMatch?.[1]) port = Number(portMatch[1]);

        if (port > 0) {
          this.activeContainers.set(modelId, {
            modelId,
            containerId: containerId ?? "",
            containerName: name ?? "",
            port,
            runtimeType: "general",
            startedAt: new Date().toISOString(),
            status: "running",
            healthCheckPassed: true,
          });
          this.allocatedPorts.add(port);
        }
      }
    } catch { /* podman unavailable — skip discovery */ }

    // Re-persist so the discovered containers are saved
    if (this.activeContainers.size > 0) {
      this.persistState();
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** Produce a valid container name segment from an arbitrary model ID. */
  private sanitizeContainerName(modelId: string): string {
    return modelId
      .replace(/\//g, "--")
      .replace(/[^a-zA-Z0-9-]/g, "");
  }
}
