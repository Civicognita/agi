/**
 * Worker Runtime — executes Taskmaster worker jobs within the gateway process.
 *
 * Manages concurrent job execution, tool loops, and bridges runtime events
 * to the DashboardEventBroadcaster. Worker prompts are loaded from
 * prompts/workers/ via WorkerPromptLoader.
 *
 * Previously this dynamically imported from .bots/lib/ — now all execution
 * logic is inlined into gateway-core.
 */

import { EventEmitter } from "node:events";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";

import { JobBridge } from "./job-bridge.js";
import { WorkerPromptLoader } from "./worker-prompt-loader.js";
import { dispatchJobsDir } from "./dispatch-paths.js";
import type { ToolRegistry, ToolExecutionContext } from "./tool-registry.js";
import type { LLMProvider } from "./llm/provider.js";
import type { LLMInvokeParams, LLMToolContinuationParams, LLMContentBlock } from "./llm/types.js";
import type { VerificationTier } from "@aionima/entity-model";
import type { GatewayState } from "./types.js";

// ---------------------------------------------------------------------------
// Runtime types
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

// Runtime events are plain objects passed to emit("runtime:event", {...}).
// No interface needed — EventEmitter accepts any payload.

// ---------------------------------------------------------------------------
// Worker state types
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
  /** Workspace root for resolving dispatch files. */
  workspaceRoot?: string;
  /** Resource entity ID used when constructing the worker's ToolExecutionContext. */
  resourceId?: string;
  /** Node ID used when constructing the worker's ToolExecutionContext. */
  nodeId?: string;
  /** Tier the worker runs at when invoking the shared ToolRegistry. Defaults to "verified". */
  workerTier?: VerificationTier;
}

export interface WorkerRuntimeDeps {
  llmProvider: LLMProvider;
  /**
   * Shared tool registry. When provided, workers call the same tools as Aion
   * (filtered by workerTier). Without it, the runtime emits a job_failed
   * event explaining the misconfiguration — workers no longer silently fall
   * back to the retired 5-tool mini-sandbox.
   */
  toolRegistry?: ToolRegistry;
  /** Optional getter so the runtime reads the current gateway state when building ToolExecutionContext. Defaults to "ONLINE". */
  getState?: () => GatewayState;
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
// Active job tracking
// ---------------------------------------------------------------------------

interface ActiveJob {
  jobId: string;
  coaReqId: string;
  startedAt: number;
  promise: Promise<WorkerRunResult>;
}

interface WorkerRunResult {
  jobId: string;
  status: "completed" | "failed";
  text: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  toolLoops: number;
  errors: string[];
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
  private promptLoader: WorkerPromptLoader | null = null;
  private toolRegistry: ToolRegistry | null = null;
  private getState: () => GatewayState;

  constructor(config: WorkerRuntimeConfig, deps: WorkerRuntimeDeps) {
    super();
    this.config = config;
    this.invoker = createRuntimeInvoker(deps.llmProvider, config.modelMap);
    if (config.promptDir) {
      this.promptLoader = new WorkerPromptLoader(config.promptDir);
    }
    this.toolRegistry = deps.toolRegistry ?? null;
    this.getState = deps.getState ?? (() => "ONLINE" as GatewayState);
  }

  /** Late-bind the tool registry (used when the registry is constructed after the runtime). */
  setToolRegistry(registry: ToolRegistry): void {
    this.toolRegistry = registry;
  }

  /** Hot-reload config without interrupting running jobs. */
  reloadConfig(config: WorkerRuntimeConfig, llmProvider: LLMProvider): void {
    this.config = config;
    this.invoker = createRuntimeInvoker(llmProvider, config.modelMap);
    if (config.promptDir) {
      this.promptLoader = new WorkerPromptLoader(config.promptDir);
    }
  }

  /**
   * Execute a worker job. Fire-and-forget — called after taskmaster_queue.
   */
  async executeJob(
    jobId: string,
    coaReqId: string,
    projectContext?: { path: string; name: string },
  ): Promise<void> {
    if (this.activeJobs.size >= this.config.maxConcurrentJobs) {
      this.emit("runtime:event", { type: "job_failed", jobId, error: "Max concurrent jobs reached" });
      return;
    }

    if (this.activeJobs.has(jobId)) {
      return;
    }

    // Read dispatch file to get job details. When a projectContext is provided
    // we read from that project's dispatch dir (~/.agi/{projectSlug}/dispatch/jobs/).
    // When it isn't (legacy paths, bridged jobs without a project), fall back
    // to the "general" bucket.
    const jobsDir = dispatchJobsDir(projectContext?.path ?? "");
    const dispatchFile = join(jobsDir, `${jobId}.json`);
    let dispatch: { description: string; domain: string; worker: string; priority: string } | null = null;

    // Try dispatch file first, then state file
    if (existsSync(dispatchFile)) {
      try {
        dispatch = JSON.parse(readFileSync(dispatchFile, "utf-8")) as typeof dispatch;
      } catch { /* fall through */ }
    }

    // Bridge into taskmaster state
    try {
      const bridge = new JobBridge(this.config.stateDir);
      if (dispatch && existsSync(dispatchFile)) {
        bridge.ensureJob(jobId, dispatchFile);
      }
    } catch { /* non-fatal */ }

    if (!dispatch) {
      // Try reading from taskmaster state
      const job = await this.getJob(jobId);
      if (job) {
        const parts = job.entryWorker.replace("$W.", "").split(".");
        dispatch = { description: job.queueText, domain: parts[0] ?? "code", worker: parts[1] ?? "engineer", priority: "normal" };
      }
    }

    if (!dispatch) {
      this.emit("runtime:event", { type: "job_failed", jobId, error: "Dispatch file not found and job not in state" });
      return;
    }

    this.emit("runtime:event", {
      type: "job_started",
      jobId,
      description: dispatch.description,
      workers: [`$W.${dispatch.domain}.${dispatch.worker}`],
    });

    const promise = this.runWorker(jobId, dispatch, coaReqId, projectContext?.path ?? ".");

    this.activeJobs.set(jobId, { jobId, coaReqId, startedAt: Date.now(), promise });

    promise
      .then((result) => {
        this.activeJobs.delete(jobId);
        // Update state
        try {
          const bridge = new JobBridge(this.config.stateDir);
          bridge.updateJobStatus(jobId, result.status === "completed" ? "complete" : "failed",
            result.errors.length > 0 ? result.errors.join("; ") : undefined);
        } catch { /* non-fatal */ }
        this.emit("runtime:event", {
          type: result.status === "completed" ? "report_ready" : "job_failed",
          jobId,
          gist: result.text.slice(0, 500),
          error: result.errors.join("; ") || undefined,
        });
      })
      .catch((err: unknown) => {
        this.activeJobs.delete(jobId);
        this.emit("runtime:event", { type: "job_failed", jobId, error: err instanceof Error ? err.message : String(err) });
      });
  }

  // -------------------------------------------------------------------------
  // Inline worker execution — replaces .bots/lib/runtime.ts
  // -------------------------------------------------------------------------

  private async runWorker(
    jobId: string,
    dispatch: { description: string; domain: string; worker: string; priority: string },
    coaReqId: string,
    projectRoot: string,
  ): Promise<WorkerRunResult> {
    const workerSpec = `$W.${dispatch.domain}.${dispatch.worker}`;
    const model = this.config.modelMap[dispatch.worker] ?? this.config.modelMap["sonnet"] ?? this.config.modelMap["default"] ?? "claude-sonnet-4-6";

    this.emit("runtime:event", { type: "worker_started", jobId, worker: workerSpec, model });

    // Load worker system prompt
    let systemPrompt: string;
    if (this.promptLoader) {
      systemPrompt = this.promptLoader.getSystemPrompt(dispatch.domain, dispatch.worker)
        ?? `You are ${workerSpec}, a Taskmaster worker. Domain: ${dispatch.domain}. Role: ${dispatch.worker}.\n\nComplete the dispatched task.`;
    } else {
      systemPrompt = `You are ${workerSpec}, a Taskmaster worker. Domain: ${dispatch.domain}. Role: ${dispatch.worker}.\n\nComplete the dispatched task.`;
    }

    // Workers use Aion's shared ToolRegistry filtered by the worker's tier.
    // This replaces the retired 5-tool mini-sandbox — a worker dispatched to
    // "fix the failing git test" can now call git_status/git_diff/etc., the
    // same tools Aion has at the same tier.
    if (this.toolRegistry === null) {
      const msg = "WorkerRuntime has no ToolRegistry bound — cannot execute workers. (Call setToolRegistry() during boot.)";
      this.emit("runtime:event", { type: "worker_done", jobId, worker: workerSpec, status: "failed" });
      return { jobId, status: "failed", text: "", totalInputTokens: 0, totalOutputTokens: 0, toolLoops: 0, errors: [msg] };
    }
    const toolRegistry = this.toolRegistry;
    const workerTier: VerificationTier = this.config.workerTier ?? "verified";
    const workerState = this.getState();

    // Workers inherit Aion's tool registry EXCEPT for tools marked agentOnly
    // (project/entity/settings configuration). If a worker needs one of those,
    // it must call taskmaster_handoff and ask Aion to make the change.
    const agentOnlyNames = new Set(
      toolRegistry.getAvailable(workerState, workerTier)
        .filter((m) => m.agentOnly === true)
        .map((m) => m.name),
    );
    const tools: RuntimeToolDef[] = toolRegistry
      .toProviderTools(workerState, workerTier)
      .filter((t) => !agentOnlyNames.has(t.name));

    const messages: RuntimeMessage[] = [
      { role: "user", content: `## Dispatch\n\n**Task:** ${dispatch.description}\n**Priority:** ${dispatch.priority}\n**Project:** ${projectRoot}\n**Your jobId:** ${jobId}\n\nExecute this task. You have access to the same tool registry as the dispatching agent, scoped to this project. Tools that accept a \`projectPath\` argument should receive \`${projectRoot}\`.\n\nIf you need a decision you can't make yourself (design choice, config change you can't perform, ambiguous scope), call \`taskmaster_handoff\` with your \`jobId\` and a specific question — then finish your turn with a summary. You will not be auto-resumed; Aion will re-dispatch with clarification if needed.\n\nWhen done, summarize what you accomplished.` },
    ];

    const executionCtx: ToolExecutionContext = {
      state: workerState,
      tier: workerTier,
      entityId: coaReqId,
      entityAlias: workerSpec,
      coaChainBase: coaReqId,
      resourceId: this.config.resourceId ?? "aionima",
      nodeId: this.config.nodeId ?? "local",
    };

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let toolLoops = 0;
    const maxToolLoops = 30;
    const errors: string[] = [];

    try {
      let response = await this.invoker.invoke({
        system: systemPrompt,
        messages,
        tools,
        model,
        maxTokens: 8192,
        entityId: coaReqId,
      });
      totalInputTokens += response.usage.inputTokens;
      totalOutputTokens += response.usage.outputTokens;

      // Tool loop
      const accMessages: RuntimeMessage[] = [...messages];

      while (response.toolCalls.length > 0 && toolLoops < maxToolLoops) {
        toolLoops++;

        // Execute each tool call via the shared registry. Emit a per-call
        // progress event so the dashboard + chat transcript see live activity.
        const toolResults: RuntimeToolResult[] = [];
        for (const tc of response.toolCalls) {
          // Auto-fill projectPath when the tool accepts it and the worker didn't
          // pass one — saves every prompt from having to remember.
          const tcInput: Record<string, unknown> = { ...tc.input };
          if (!("projectPath" in tcInput) || !tcInput.projectPath) {
            tcInput.projectPath = projectRoot;
          }
          let resultContent: string;
          if (agentOnlyNames.has(tc.name)) {
            // Defense in depth: block agent-only tools at execute time even if
            // the model somehow called one that wasn't in the list.
            resultContent = JSON.stringify({
              error: `${tc.name} is Aion-only. Use taskmaster_handoff to request this change from Aion.`,
            });
          } else {
            try {
              const execResult = await toolRegistry.execute(tc.name, tcInput, executionCtx);
              resultContent = execResult.content;
            } catch (err) {
              resultContent = JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
            }
          }
          toolResults.push({ tool_use_id: tc.id, content: resultContent });
          this.emit("runtime:event", { type: "worker_tool_call", jobId, worker: workerSpec, tool: tc.name });
        }

        const prevBlocks = response.contentBlocks;

        // Build tool result blocks
        const toolResultBlocks: RuntimeContentBlock[] = toolResults.map((r) => ({
          type: "tool_result" as const,
          tool_use_id: r.tool_use_id,
          content: r.content,
        }));

        response = await this.invoker.continueWithToolResults({
          original: { system: systemPrompt, messages: accMessages, tools, model, maxTokens: 8192, entityId: coaReqId },
          assistantContent: prevBlocks,
          toolResults,
        });
        totalInputTokens += response.usage.inputTokens;
        totalOutputTokens += response.usage.outputTokens;

        // Append turns for next iteration
        accMessages.push(
          { role: "assistant", content: prevBlocks },
          { role: "user", content: toolResultBlocks },
        );

        this.emit("runtime:event", { type: "worker_progress", jobId, worker: workerSpec, toolLoops, text: response.text.slice(0, 200) });
      }

      this.emit("runtime:event", { type: "worker_done", jobId, worker: workerSpec, status: "completed" });

      return {
        jobId,
        status: "completed",
        text: response.text,
        totalInputTokens,
        totalOutputTokens,
        toolLoops,
        errors,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      errors.push(errorMsg);
      this.emit("runtime:event", { type: "worker_done", jobId, worker: workerSpec, status: "failed" });
      return { jobId, status: "failed", text: "", totalInputTokens, totalOutputTokens, toolLoops, errors };
    }
  }

  // -------------------------------------------------------------------------
  // Checkpoint management (via JobBridge state)
  // -------------------------------------------------------------------------

  async approveCheckpoint(jobId: string): Promise<void> {
    const bridge = new JobBridge(this.config.stateDir);
    bridge.updateJobStatus(jobId, "running");
    const active = this.activeJobs.get(jobId);
    if (!active) {
      await this.executeJob(jobId, jobId);
    }
  }

  async rejectCheckpoint(jobId: string, _reason: string): Promise<void> {
    const bridge = new JobBridge(this.config.stateDir);
    bridge.updateJobStatus(jobId, "failed", _reason);
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
   * Read all jobs from the taskmaster state file at ~/.agi/state/taskmaster.json.
   */
  async listAllJobs(): Promise<WorkerJob[]> {
    try {
      const stateBase = this.config.stateDir ?? join(homedir(), ".agi", "state");
      const statePath = join(stateBase, "taskmaster.json");
      if (!existsSync(statePath)) return [];
      const content = readFileSync(statePath, "utf-8");
      const state = JSON.parse(content) as { wip?: { jobs?: Record<string, WorkerJob> } };
      if (!state.wip?.jobs) return [];
      return Object.values(state.wip.jobs);
    } catch {
      return [];
    }
  }

  /**
   * List dispatch entries for a project, read directly from
   * ~/.agi/{projectSlug}/dispatch/jobs/. Returns a minimal WorkerJob shape
   * synthesized from the flat dispatch file (per-phase structure isn't
   * exercised today — one worker per job).
   */
  async listJobsForProject(projectPath: string): Promise<WorkerJob[]> {
    try {
      const { readdirSync } = await import("node:fs");
      const { dispatchJobsDir: jobsDirFn } = await import("./dispatch-paths.js");
      const dir = jobsDirFn(projectPath);
      if (!existsSync(dir)) return [];
      const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
      const jobs: WorkerJob[] = [];
      for (const file of files.sort()) {
        try {
          const raw = readFileSync(join(dir, file), "utf-8");
          const flat = JSON.parse(raw) as {
            id: string;
            description: string;
            domain?: string;
            worker?: string;
            status: "pending" | "running" | "checkpoint" | "complete" | "failed";
            createdAt: string;
          };
          jobs.push({
            id: flat.id,
            queueText: flat.description,
            route: flat.domain && flat.worker ? `${flat.domain}.${flat.worker}` : null,
            entryWorker: flat.domain && flat.worker ? `$W.${flat.domain}.${flat.worker}` : "$W.code.engineer",
            worktree: ".",
            branch: "dev",
            phases: [{
              id: "phase-1",
              name: `${flat.domain ?? "code"}/${flat.worker ?? "engineer"}`,
              workers: [flat.domain && flat.worker ? `$W.${flat.domain}.${flat.worker}` : "$W.code.engineer"],
              gate: "terminal",
              status: flat.status === "checkpoint" ? "running" : flat.status,
            }],
            currentPhase: "phase-1",
            status: flat.status,
            createdAt: flat.createdAt,
          });
        } catch {
          // Skip unreadable files.
        }
      }
      return jobs;
    } catch {
      return [];
    }
  }

  async getJob(jobId: string): Promise<WorkerJob | null> {
    const jobs = await this.listAllJobs();
    return jobs.find((j) => j.id === jobId) ?? null;
  }

  async shutdown(): Promise<void> {
    const promises = Array.from(this.activeJobs.values()).map((j) => j.promise);
    await Promise.allSettled(promises);
    this.activeJobs.clear();
  }
}
