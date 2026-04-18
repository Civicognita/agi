/**
 * FineTuneManager — Manages PEFT/LoRA fine-tuning jobs via Podman containers.
 *
 * Jobs run in a dedicated finetune container image (containers/Containerfile.finetune)
 * that exposes a FastAPI server with /finetune/start, /finetune/status, and /finetune/stop.
 *
 * State is kept in memory (Map) — jobs do not persist across gateway restarts.
 * Model weights and datasets are mounted read-only; adapter output is mounted read-write
 * at ~/.agi/finetune/{jobId}/.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { ulid } from "ulid";
import type { ModelStore } from "@agi/model-runtime";
import type { DatasetStore } from "@agi/model-runtime";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface FineTuneConfig {
  baseModelId: string;
  datasetId: string;
  method: "lora" | "qlora";
  loraR: number;
  loraAlpha: number;
  loraDropout: number;
  targetModules: string[];
  epochs: number;
  batchSize: number;
  learningRate: number;
  maxSteps?: number;
  outputName: string;
}

export interface FineTuneJob {
  id: string;
  config: FineTuneConfig;
  status: "pending" | "building" | "training" | "complete" | "error";
  containerId?: string;
  containerPort?: number;
  startedAt: string;
  completedAt?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FINETUNE_IMAGE = "agi-finetune:latest";
const FINETUNE_INTERNAL_PORT = 8000;
const PORT_RANGE_START = 6200;

// ---------------------------------------------------------------------------
// FineTuneManager
// ---------------------------------------------------------------------------

export class FineTuneManager {
  private readonly jobs = new Map<string, FineTuneJob>();
  private readonly allocatedPorts = new Set<number>();

  constructor(
    private readonly modelStore: ModelStore,
    private readonly datasetStore: DatasetStore,
    private readonly outputDir: string,
  ) {
    mkdirSync(outputDir, { recursive: true });
  }

  async startJob(config: FineTuneConfig): Promise<FineTuneJob> {
    // Validate base model and dataset exist and are ready
    const model = await this.modelStore.getById(config.baseModelId);
    if (!model) {
      throw new Error(`Base model not installed: ${config.baseModelId}`);
    }
    if (model.status !== "ready") {
      throw new Error(`Base model is not ready (status: ${model.status})`);
    }

    const dataset = await this.datasetStore.getById(config.datasetId);
    if (!dataset) {
      throw new Error(`Dataset not installed: ${config.datasetId}`);
    }
    if (dataset.status !== "ready") {
      throw new Error(`Dataset is not ready (status: ${dataset.status})`);
    }

    const jobId = ulid().toLowerCase();
    const outputPath = join(this.outputDir, jobId);
    mkdirSync(outputPath, { recursive: true });

    const job: FineTuneJob = {
      id: jobId,
      config,
      status: "pending",
      startedAt: new Date().toISOString(),
    };

    this.jobs.set(jobId, job);

    // Start container async
    this.launchContainer(job, model.filePath, dataset.filePath, outputPath).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      const j = this.jobs.get(jobId);
      if (j) {
        this.jobs.set(jobId, { ...j, status: "error", error: msg, completedAt: new Date().toISOString() });
      }
    });

    return job;
  }

  getJob(jobId: string): FineTuneJob | undefined {
    return this.jobs.get(jobId);
  }

  listJobs(): FineTuneJob[] {
    return Array.from(this.jobs.values());
  }

  async stopJob(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`Fine-tune job not found: ${jobId}`);

    if (job.containerId) {
      try {
        execFileSync("podman", ["stop", job.containerId], { stdio: "pipe", timeout: 30_000 });
        execFileSync("podman", ["rm", "-f", job.containerId], { stdio: "pipe", timeout: 15_000 });
      } catch {
        // Best-effort
      }
      if (job.containerPort) {
        this.allocatedPorts.delete(job.containerPort);
      }
    }

    this.jobs.set(jobId, {
      ...job,
      status: "complete",
      completedAt: new Date().toISOString(),
    });
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async launchContainer(
    job: FineTuneJob,
    modelPath: string,
    datasetPath: string,
    outputPath: string,
  ): Promise<void> {
    const jobId = job.id;
    const config = job.config;

    // Allocate a port
    const port = this.allocatePort();

    const containerName = `agi-finetune-${jobId}`;

    // Build env var list for the container
    const env: Record<string, string> = {
      BASE_MODEL_PATH: "/models",
      DATASET_PATH: "/data",
      OUTPUT_PATH: "/output",
      LORA_R: String(config.loraR),
      LORA_ALPHA: String(config.loraAlpha),
      LORA_DROPOUT: String(config.loraDropout),
      TARGET_MODULES: config.targetModules.join(","),
      EPOCHS: String(config.epochs),
      BATCH_SIZE: String(config.batchSize),
      LEARNING_RATE: String(config.learningRate),
      MAX_STEPS: config.maxSteps !== undefined ? String(config.maxSteps) : "0",
      METHOD: config.method,
      OUTPUT_NAME: config.outputName,
    };

    const envArgs: string[] = [];
    for (const [k, v] of Object.entries(env)) {
      envArgs.push("-e", `${k}=${v}`);
    }

    const podmanArgs = [
      "run",
      "-d",
      "--name", containerName,
      "-p", `${port}:${FINETUNE_INTERNAL_PORT}`,
      "-v", `${modelPath}:/models:ro`,
      "-v", `${datasetPath}:/data:ro`,
      "-v", `${outputPath}:/output:rw`,
      ...envArgs,
      FINETUNE_IMAGE,
    ];

    this.jobs.set(jobId, { ...job, status: "building", containerPort: port });

    const result = execFileSync("podman", podmanArgs, { stdio: "pipe", timeout: 60_000 });
    const containerId = result.toString().trim();

    this.jobs.set(jobId, {
      ...this.jobs.get(jobId)!,
      status: "training",
      containerId,
      containerPort: port,
    });
  }

  private allocatePort(): number {
    let port = PORT_RANGE_START;
    while (this.allocatedPorts.has(port)) {
      port++;
    }
    this.allocatedPorts.add(port);
    return port;
  }
}
