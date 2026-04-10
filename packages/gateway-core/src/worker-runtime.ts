/**
 * Worker Runtime — gateway adapter that wires LLMProvider to the runtime engine.
 *
 * Creates RuntimeInvoker from the gateway's LLMProvider, manages concurrent
 * job execution, and bridges runtime events to the DashboardEventBroadcaster.
 *
 * Uses dynamic imports for .bots/lib/ modules since they are outside the
 * gateway-core package boundary.
 */

import { EventEmitter } from "node:events";
import { join } from "node:path";
import { JobBridge } from "./job-bridge.js";
import type { LLMProvider } from "./llm/provider.js";
import type { LLMInvokeParams, LLMToolContinuationParams, LLMContentBlock } from "./llm/types.js";

// ---------------------------------------------------------------------------
// Inline minimal types (mirrors .bots/lib/runtime-types.ts)
// Avoids cross-package imports that TypeScript can't resolve.
// ---------------------------------------------------------------------------

interface RuntimeInvoker {
  invoke(params: RuntimeInvokeParams): Promise<RuntimeResponse>;
  continueWithToolResults(params: RuntimeContinuation): Promise<RuntimeResponse>;
}

interface RuntimeInvokeParams {
  system: string;
  messages: RuntimeMessage[];
  tools?: RuntimeToolDef[];
  model?: string;
  maxTokens?: number;
  entityId?: string;
}

interface RuntimeContinuation {
  original: RuntimeInvokeParams;
  assistantContent: RuntimeContentBlock[];
  toolResults: RuntimeToolResult[];
}

interface RuntimeToolDef { name: string; description: string; input_schema: Record<string, unknown> }
interface RuntimeToolResult { tool_use_id: string; content: string }
interface RuntimeMessage { role: "user" | "assistant" | "system"; content: string | RuntimeContentBlock[] }
interface RuntimeContentBlock { type: string; [key: string]: unknown }
interface RuntimeResponse {
  text: string;
  toolCalls: { id: string; name: string; input: Record<string, unknown> }[];
  contentBlocks: RuntimeContentBlock[];
  usage: { inputTokens: number; outputTokens: number };
  model: string;
  stopReason: string | null;
}

interface RuntimeToolExecutor {
  execute(toolName: string, input: Record<string, unknown>): Promise<string>;
  getToolDefinitions(): RuntimeToolDef[];
}

interface RuntimeConfig {
  concurrency: number;
  autoApprove: boolean;
  reportDir: string;
  coaReqId: string;
  maxToolLoops: number;
  modelMap: Record<string, string>;
  projectContext?: { path: string; name: string };
  onProgress?: (event: RuntimeEvent) => void;
  promptDir?: string;
}

interface RuntimeResult {
  jobId: string;
  status: "completed" | "failed" | "checkpoint";
  phases: unknown[];
  burn: unknown;
  reportDir: string;
  errors: string[];
}

interface RuntimeEvent {
  type: string;
  jobId: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Worker state types (mirrors .bots/lib/job-manager.ts — read-only)
// ---------------------------------------------------------------------------

export interface WorkerJobPhase {
  id: string;
  name: string;
  workers: string[];
  gate: "auto" | "checkpoint" | "terminal";
  status: "pending" | "running" | "complete" | "failed";
}

export interface WorkerJob {
  id: string;
  queueText: string;
  route: string | null;
  entryWorker: string;
  worktree: string;
  branch: string;
  phases: WorkerJobPhase[];
  currentPhase: string | null;
  status: "pending" | "running" | "checkpoint" | "complete" | "failed";
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface WorkerRuntimeConfig {
  autoApprove: boolean;
  maxConcurrentJobs: number;
  workerTimeoutMs: number;
  reportsDir: string;
  modelMap: Record<string, string>;
  /** Directory containing worker prompt .md files. */
  promptDir?: string;
  /** Directory for runtime state files (default: ~/.agi/state/). */
  stateDir?: string;
}

export interface WorkerRuntimeDeps {
  llmProvider: LLMProvider;
}

// ---------------------------------------------------------------------------
// COA filesystem key helper (inlined from runtime-types)
// ---------------------------------------------------------------------------

function sanitizeCoaForFs(fingerprint: string): string {
  return fingerprint.replace(/[$#@]/g, "").replace(/\./g, "-");
}

// ---------------------------------------------------------------------------
// LLMProvider → RuntimeInvoker adapter
// ---------------------------------------------------------------------------

export function createRuntimeInvoker(
  llmProvider: LLMProvider,
  modelMap: Record<string, string>,
): RuntimeInvoker {
  return {
    async invoke(params: RuntimeInvokeParams): Promise<RuntimeResponse> {
      const llmParams: LLMInvokeParams = {
        system: params.system,
        messages: params.messages.map((m) => ({
          role: m.role,
          content: m.content as string | LLMContentBlock[],
        })),
        tools: params.tools?.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.input_schema,
        })),
        entityId: params.entityId ?? "worker",
        model: resolveModel(params.model, modelMap),
        maxTokens: params.maxTokens,
      };

      const resp = await llmProvider.invoke(llmParams);

      return {
        text: resp.text,
        toolCalls: resp.toolCalls.map((tc) => ({
          id: tc.id,
          name: tc.name,
          input: tc.input,
        })),
        contentBlocks: resp.contentBlocks as unknown as RuntimeContentBlock[],
        usage: resp.usage,
        model: resp.model,
        stopReason: resp.stopReason,
      };
    },

    async continueWithToolResults(params: RuntimeContinuation): Promise<RuntimeResponse> {
      const llmContinuation: LLMToolContinuationParams = {
        original: {
          system: params.original.system,
          messages: params.original.messages.map((m) => ({
            role: m.role,
            content: m.content as string | LLMContentBlock[],
          })),
          tools: params.original.tools?.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.input_schema,
          })),
          entityId: params.original.entityId ?? "worker",
          model: resolveModel(params.original.model, modelMap),
          maxTokens: params.original.maxTokens,
        },
        assistantContent: params.assistantContent as unknown as LLMContentBlock[],
        toolResults: params.toolResults.map((tr) => ({
          tool_use_id: tr.tool_use_id,
          content: tr.content,
        })),
      };

      const resp = await llmProvider.continueWithToolResults(llmContinuation);

      return {
        text: resp.text,
        toolCalls: resp.toolCalls.map((tc) => ({
          id: tc.id,
          name: tc.name,
          input: tc.input,
        })),
        contentBlocks: resp.contentBlocks as unknown as RuntimeContentBlock[],
        usage: resp.usage,
        model: resp.model,
        stopReason: resp.stopReason,
      };
    },
  };
}

function resolveModel(
  model: string | undefined,
  modelMap: Record<string, string>,
): string | undefined {
  if (!model) return undefined;
  return modelMap[model] ?? model;
}

// ---------------------------------------------------------------------------
// Dynamic imports for .bots/lib/ modules
//
// These modules live outside the gateway-core package boundary (.bots/lib/).
// We compute paths at runtime so TypeScript doesn't try to resolve them.
// ---------------------------------------------------------------------------

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BOTS_LIB = resolve(__dirname, "..", "..", "..", ".bots", "lib");

type RunJobFn = (
  jobId: string,
  invoker: RuntimeInvoker,
  factory: (p: string) => RuntimeToolExecutor,
  config: RuntimeConfig,
) => Promise<RuntimeResult>;

type SandboxFactoryFn = (worktreePath: string) => RuntimeToolExecutor;

async function loadRunJob(): Promise<RunJobFn> {
  const modPath = join(BOTS_LIB, "runtime.js");
  const mod = await import(modPath) as { runJob: RunJobFn };
  return mod.runJob;
}

async function loadSandboxFactory(): Promise<SandboxFactoryFn> {
  const modPath = join(BOTS_LIB, "runtime-tools.js");
  const mod = await import(modPath) as { createSandboxedToolExecutor: SandboxFactoryFn };
  return mod.createSandboxedToolExecutor;
}

// ---------------------------------------------------------------------------
// Active job tracking
// ---------------------------------------------------------------------------

interface ActiveJob {
  jobId: string;
  coaReqId: string;
  startedAt: number;
  promise: Promise<RuntimeResult>;
}

export interface ActiveJobStatus {
  jobId: string;
  coaReqId: string;
  elapsedMs: number;
}

// ---------------------------------------------------------------------------
// WorkerRuntime
// ---------------------------------------------------------------------------

export class WorkerRuntime extends EventEmitter {
  private activeJobs = new Map<string, ActiveJob>();
  private config: WorkerRuntimeConfig;
  private invoker: RuntimeInvoker;

  constructor(config: WorkerRuntimeConfig, deps: WorkerRuntimeDeps) {
    super();
    this.config = config;
    this.invoker = createRuntimeInvoker(deps.llmProvider, config.modelMap);
  }

  /** Hot-reload config without interrupting running jobs. */
  reloadConfig(config: WorkerRuntimeConfig, llmProvider: LLMProvider): void {
    this.config = config;
    this.invoker = createRuntimeInvoker(llmProvider, config.modelMap);
  }

  /**
   * Execute a worker job. Fire-and-forget — called after agentInvoker.process().
   */
  async executeJob(
    jobId: string,
    coaReqId: string,
    projectContext?: { path: string; name: string },
  ): Promise<void> {
    if (this.activeJobs.size >= this.config.maxConcurrentJobs) {
      this.emit("error", { jobId, error: "Max concurrent jobs reached" });
      return;
    }

    if (this.activeJobs.has(jobId)) {
      return; // Already running
    }

    const reportDir = join(this.config.reportsDir);
    const runtimeConfig: RuntimeConfig = {
      concurrency: 4,
      autoApprove: this.config.autoApprove,
      reportDir,
      coaReqId,
      maxToolLoops: 30,
      modelMap: this.config.modelMap,
      projectContext,
      onProgress: (event: RuntimeEvent) => this.handleRuntimeEvent(event),
      promptDir: this.config.promptDir,
    };

    // Bridge the dispatch file into taskmaster state so the runtime can find it
    const jobsDir = resolve(BOTS_LIB, "..", "jobs");
    const dispatchFile = join(jobsDir, `${jobId}.json`);
    try {
      const bridge = new JobBridge(this.config.stateDir);
      bridge.ensureJob(jobId, dispatchFile);
    } catch {
      // Bridge failure is non-fatal — runtime may still find the job in state
    }

    // Dynamic imports: load runtime modules at execution time
    const [runJob, createSandbox] = await Promise.all([
      loadRunJob(),
      loadSandboxFactory(),
    ]);

    const promise = runJob(jobId, this.invoker, createSandbox, runtimeConfig);

    this.activeJobs.set(jobId, {
      jobId,
      coaReqId,
      startedAt: Date.now(),
      promise,
    });

    // Fire-and-forget: clean up when done
    promise
      .then((result: RuntimeResult) => {
        this.activeJobs.delete(jobId);
        this.emit("job:completed", result);
      })
      .catch((err: unknown) => {
        this.activeJobs.delete(jobId);
        this.emit("job:failed", { jobId, error: err instanceof Error ? err.message : String(err) });
      });
  }

  async approveCheckpoint(jobId: string): Promise<void> {
    const modPath = join(BOTS_LIB, "job-manager.js");
    const mod = await import(modPath) as { approveCheckpoint: (id: string) => void };
    mod.approveCheckpoint(jobId);
    // Re-trigger job execution if paused at checkpoint
    const active = this.activeJobs.get(jobId);
    if (!active) {
      const coaReqId = sanitizeCoaForFs(jobId);
      await this.executeJob(jobId, coaReqId);
    }
  }

  async rejectCheckpoint(jobId: string, reason: string): Promise<void> {
    const modPath = join(BOTS_LIB, "job-manager.js");
    const mod = await import(modPath) as { rejectCheckpoint: (id: string, reason: string) => void };
    mod.rejectCheckpoint(jobId, reason);
    this.activeJobs.delete(jobId);
  }

  getActiveJobs(): ActiveJobStatus[] {
    const now = Date.now();
    return Array.from(this.activeJobs.values()).map((j) => ({
      jobId: j.jobId,
      coaReqId: j.coaReqId,
      elapsedMs: now - j.startedAt,
    }));
  }

  /**
   * Read all jobs from the worker state file.
   * Returns the full Job objects from `.bots/state/taskmaster.json`.
   * Falls back to empty array if the state file doesn't exist yet.
   */
  async listAllJobs(): Promise<WorkerJob[]> {
    try {
      const stateBase = this.config.stateDir ?? resolve(BOTS_LIB, "..", "state");
      const statePath = join(stateBase, "taskmaster.json");
      const { readFileSync } = await import("node:fs");
      const content = readFileSync(statePath, "utf-8");
      const state = JSON.parse(content) as { wip?: { jobs?: Record<string, WorkerJob> } };
      if (!state.wip?.jobs) return [];
      return Object.values(state.wip.jobs);
    } catch {
      return [];
    }
  }

  /**
   * Get a single job from the worker state file by ID.
   */
  async getJob(jobId: string): Promise<WorkerJob | null> {
    const jobs = await this.listAllJobs();
    return jobs.find((j) => j.id === jobId) ?? null;
  }

  async shutdown(): Promise<void> {
    const promises = Array.from(this.activeJobs.values()).map((j) => j.promise);
    await Promise.allSettled(promises);
    this.activeJobs.clear();
  }

  private handleRuntimeEvent(event: RuntimeEvent): void {
    this.emit("runtime:event", event);
  }
}
