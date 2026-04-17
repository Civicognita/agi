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
  llm: "ghcr.io/ggerganov/llama.cpp:server",
  diffusion: "ghcr.io/civicognita/diffusion-server:latest",
  general: "ghcr.io/civicognita/transformers-server:latest",
  // Custom runtimes have no shared default — image must be provided per-model
  // via model.containerImage or containerConfig.image (set by CustomContainerBuilder).
  custom: "",
};

const INTERNAL_PORTS: Record<ModelRuntimeType, number> = {
  llm: 8080,
  diffusion: 8000,
  general: 8000,
  // Custom runtimes declare their own port via containerConfig.internalPort
  custom: 8000,
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
   */
  async start(model: InstalledModel, containerConfig: ModelContainerConfig): Promise<ModelContainerState> {
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

    const port = this.allocatePort();

    const containerName = `aionima-model-${this.sanitizeContainerName(model.id)}`;

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
    const image = containerConfig.runtimeType === "custom"
      ? (model.containerImage ?? (containerConfig.image || DEFAULT_IMAGES[containerConfig.runtimeType]))
      : (containerConfig.image || DEFAULT_IMAGES[containerConfig.runtimeType]);
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
      "-p", `${String(port)}:${String(internalPort)}`,
      "-v", `${containerConfig.modelHostPath}:${modelContainerPath}:ro`,
      ...(containerConfig.memoryLimit ? ["--memory", containerConfig.memoryLimit] : []),
      "--restart", "on-failure:3",
      "--label", "aionima.model=true",
      "--label", `aionima.model.id=${model.id}`,
      "--label", `aionima.model.runtime=${containerConfig.runtimeType}`,
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

    try {
      execFileSync("podman", ["stop", "-t", "10", state.containerName], {
        stdio: "pipe",
        timeout: 10_000,
      });
    } catch {
      // Container may already be stopped
    }

    try {
      execFileSync("podman", ["rm", "-f", state.containerName], {
        stdio: "pipe",
        timeout: 10_000,
      });
    } catch {
      // Container may already be removed
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

  /**
   * Live health probe against a single running container's /health endpoint.
   * Returns true if the endpoint responds 2xx within 1.5s, false otherwise.
   * Used by the `/api/hf/running` route to surface current (not cached-at-start)
   * health status for the dashboard.
   */
  async probeHealth(modelId: string): Promise<boolean> {
    const state = this.activeContainers.get(modelId);
    if (!state) return false;
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
    if (!existsSync(this.config.statePath)) return;

    let data: PersistedState;
    try {
      data = JSON.parse(readFileSync(this.config.statePath, "utf8")) as PersistedState;
    } catch {
      return;
    }

    for (const state of data.containers) {
      // Verify the container is still alive before restoring state
      const { running } = this.inspectContainer(state.containerName);
      if (!running) continue;

      this.activeContainers.set(state.modelId, { ...state, status: "running" });
      this.allocatedPorts.add(state.port);
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
