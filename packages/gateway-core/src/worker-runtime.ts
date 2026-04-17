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
import { dispatchJobsDir, finalizeDispatchFile, loadLiveJobOverlay, mergeJobStatus } from "./dispatch-paths.js";
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
  /** Post-terminal fields: populated after finalizeDispatchFile writes. */
  summary?: string;
  tokens?: { input: number; output: number };
  toolCalls?: Array<{ name: string; ts: string }>;
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

/** Minimal plugin registry interface for worker prompt resolution. */
interface WorkerPluginLookup {
  getWorker(id: string): { prompt: string; name: string } | undefined;
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
  /** Plugin registry — primary source for worker system prompts. Workers are
   *  plugins that register via api.registerWorker() with their prompt inline. */
  pluginWorkers?: WorkerPluginLookup;
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
  toolCalls: Array<{ name: string; ts: string }>;
  model: string;
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
  private pluginWorkers: WorkerPluginLookup | null = null;
  private getState: () => GatewayState;

  constructor(config: WorkerRuntimeConfig, deps: WorkerRuntimeDeps) {
    super();
    this.config = config;
    this.invoker = createRuntimeInvoker(deps.llmProvider, config.modelMap);
    if (config.promptDir) {
      this.promptLoader = new WorkerPromptLoader(config.promptDir);
    }
    this.toolRegistry = deps.toolRegistry ?? null;
    this.pluginWorkers = deps.pluginWorkers ?? null;
    this.getState = deps.getState ?? (() => "ONLINE" as GatewayState);
  }

  /** Late-bind the tool registry (used when the registry is constructed after the runtime). */
  setToolRegistry(registry: ToolRegistry): void {
    this.toolRegistry = registry;
  }

  /** Late-bind the plugin worker registry (plugins load after the runtime). */
  setPluginWorkers(lookup: WorkerPluginLookup): void {
    this.pluginWorkers = lookup;
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
   * Execute a multi-phase worker job. Called after taskmaster_dispatch +
   * orchestrator decomposition. Iterates through phases sequentially,
   * passing context from each worker to the next.
   */
  async executeJob(
    jobId: string,
    coaReqId: string,
    projectContext?: { path: string; name: string },
    phases?: import("./taskmaster-orchestrator.js").WorkPhase[],
  ): Promise<void> {
    if (this.activeJobs.size >= this.config.maxConcurrentJobs) {
      this.emit("runtime:event", { type: "job_failed", jobId, error: "Max concurrent jobs reached" });
      return;
    }

    if (this.activeJobs.has(jobId)) {
      return;
    }

    const jobsDir = dispatchJobsDir(projectContext?.path ?? "");
    const dispatchFile = join(jobsDir, `${jobId}.json`);
    let dispatch: { description: string; priority: string; planRef?: { planId: string; stepId: string }; domain?: string; worker?: string } | null = null;

    if (existsSync(dispatchFile)) {
      try {
        dispatch = JSON.parse(readFileSync(dispatchFile, "utf-8")) as typeof dispatch;
      } catch { /* fall through */ }
    }

    // Bridge into taskmaster state
    const bridge = new JobBridge(this.config.stateDir);
    try {
      if (dispatch && existsSync(dispatchFile) && phases) {
        bridge.ensureJobWithPhases(jobId, dispatchFile, phases);
      } else if (dispatch && existsSync(dispatchFile)) {
        bridge.ensureJob(jobId, dispatchFile);
      }
    } catch { /* non-fatal */ }

    if (!dispatch) {
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

    // Build the effective phase list. If phases were passed from the
    // orchestrator, use them. Otherwise fall back to single-phase from
    // legacy dispatch files that still have domain/worker.
    const effectivePhases: import("./taskmaster-orchestrator.js").WorkPhase[] = phases ?? (
      dispatch.domain && dispatch.worker
        ? [{ domain: dispatch.domain, role: dispatch.worker, phaseDescription: dispatch.description, gate: "auto" as const }]
        : [{ domain: "code", role: "engineer", phaseDescription: dispatch.description, gate: "auto" as const }]
    );

    const workerSpecs = effectivePhases.map((p) => `$W.${p.domain}.${p.role}`);
    this.emit("runtime:event", {
      type: "job_started",
      jobId,
      description: dispatch.description,
      workers: workerSpecs,
      totalPhases: effectivePhases.length,
    });

    try {
      bridge.updateJobStatus(jobId, "running");
      bridge.markPhaseRunning(jobId);
    } catch { /* non-fatal */ }

    const promise = this.executePhases(jobId, dispatch, effectivePhases, coaReqId, projectContext?.path ?? ".");
    this.activeJobs.set(jobId, { jobId, coaReqId, startedAt: Date.now(), promise });

    promise
      .then((result) => {
        this.activeJobs.delete(jobId);
        const finalStatus = result.status === "completed" ? "complete" : "failed";
        const errorMsg = result.errors.length > 0 ? result.errors.join("; ") : undefined;
        try { bridge.updateJobStatus(jobId, finalStatus, errorMsg); } catch { /* non-fatal */ }
        if (projectContext?.path) {
          finalizeDispatchFile(projectContext.path, jobId, {
            status: finalStatus,
            summary: result.text,
            completedAt: new Date().toISOString(),
            error: errorMsg,
            tokens: { input: result.totalInputTokens, output: result.totalOutputTokens },
            toolCalls: result.toolCalls,
          });
        }
        this.emit("runtime:event", {
          type: result.status === "completed" ? "report_ready" : "job_failed",
          jobId,
          gist: result.text.slice(0, 500),
          summary: result.text,
          error: errorMsg,
          tokens: { input: result.totalInputTokens, output: result.totalOutputTokens },
          toolCalls: result.toolCalls,
          toolLoops: result.toolLoops,
          model: result.model,
          coaReqId,
        });
      })
      .catch((err: unknown) => {
        this.activeJobs.delete(jobId);
        const errorMsg = err instanceof Error ? err.message : String(err);
        if (projectContext?.path) {
          finalizeDispatchFile(projectContext.path, jobId, { status: "failed", completedAt: new Date().toISOString(), error: errorMsg });
        }
        this.emit("runtime:event", { type: "job_failed", jobId, error: errorMsg });
      });
  }

  /**
   * Execute phases sequentially, passing context from each worker to the next.
   */
  private async executePhases(
    jobId: string,
    dispatch: { description: string; priority: string; planRef?: { planId: string; stepId: string } },
    phases: import("./taskmaster-orchestrator.js").WorkPhase[],
    coaReqId: string,
    projectRoot: string,
  ): Promise<WorkerRunResult> {
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalToolLoops = 0;
    const allToolCalls: Array<{ name: string; ts: string }> = [];
    const allErrors: string[] = [];
    let lastModel = "unknown";
    let previousOutput = "";

    const bridge = new JobBridge(this.config.stateDir);

    for (let i = 0; i < phases.length; i++) {
      const phase = phases[i]!;
      const isLast = i === phases.length - 1;

      this.emit("runtime:event", {
        type: "phase_started",
        jobId,
        phaseIndex: i,
        totalPhases: phases.length,
        worker: `$W.${phase.domain}.${phase.role}`,
        description: phase.phaseDescription,
      });

      try { bridge.markPhaseRunning(jobId); } catch { /* non-fatal */ }

      const phaseDispatch = {
        description: phase.phaseDescription,
        domain: phase.domain,
        worker: phase.role,
        priority: dispatch.priority,
        planRef: isLast ? dispatch.planRef : undefined,
      };

      const result = await this.runWorker(jobId, phaseDispatch, coaReqId, projectRoot, previousOutput);

      totalInputTokens += result.totalInputTokens;
      totalOutputTokens += result.totalOutputTokens;
      totalToolLoops += result.toolLoops;
      allToolCalls.push(...result.toolCalls);
      lastModel = result.model;

      if (result.status === "failed") {
        allErrors.push(...result.errors);
        try { bridge.markPhaseFailed(jobId, result.errors.join("; ")); } catch { /* non-fatal */ }
        this.emit("runtime:event", { type: "phase_failed", jobId, phaseIndex: i, error: result.errors.join("; ") });
        return {
          jobId,
          status: "failed",
          text: result.text || `Phase ${i + 1} (${phase.domain}.${phase.role}) failed: ${result.errors.join("; ")}`,
          totalInputTokens,
          totalOutputTokens,
          toolLoops: totalToolLoops,
          errors: allErrors,
          toolCalls: allToolCalls,
          model: lastModel,
        };
      }

      previousOutput = result.text;

      this.emit("runtime:event", {
        type: "phase_completed",
        jobId,
        phaseIndex: i,
        totalPhases: phases.length,
        worker: `$W.${phase.domain}.${phase.role}`,
        summary: result.text.slice(0, 300),
      });

      // Advance to next phase in state
      if (!isLast) {
        try { bridge.advancePhase(jobId); } catch { /* non-fatal */ }
      }
    }

    // All phases complete
    try { bridge.advancePhase(jobId); } catch { /* non-fatal */ }

    const summaryParts = phases.map((p, i) => `Phase ${String(i + 1)} (${p.domain}.${p.role}): ${p.phaseDescription}`);
    const finalSummary = previousOutput || summaryParts.join("\n");

    return {
      jobId,
      status: "completed",
      text: finalSummary,
      totalInputTokens,
      totalOutputTokens,
      toolLoops: totalToolLoops,
      errors: allErrors,
      toolCalls: allToolCalls,
      model: lastModel,
    };
  }

  // -------------------------------------------------------------------------
  // Inline worker execution — replaces .bots/lib/runtime.ts
  // -------------------------------------------------------------------------

  private async runWorker(
    jobId: string,
    dispatch: { description: string; domain: string; worker: string; priority: string; planRef?: { planId: string; stepId: string } },
    coaReqId: string,
    projectRoot: string,
    previousPhaseOutput?: string,
  ): Promise<WorkerRunResult> {
    const workerSpec = `$W.${dispatch.domain}.${dispatch.worker}`;
    const model = this.config.modelMap[dispatch.worker] ?? this.config.modelMap["sonnet"] ?? this.config.modelMap["default"] ?? "claude-sonnet-4-6";

    // Load worker system prompt. Workers are plugins — their prompts live in
    // WorkerDefinition.prompt, registered via api.registerWorker(). The
    // filesystem WorkerPromptLoader is a legacy fallback for workers that
    // haven't been migrated to the plugin system yet.
    const workerId = `${dispatch.domain}.${dispatch.worker}`;
    const pluginWorker = this.pluginWorkers?.getWorker(workerId);
    let systemPrompt: string;
    let promptSource: string;
    if (pluginWorker) {
      systemPrompt = pluginWorker.prompt;
      promptSource = `plugin (${pluginWorker.name})`;
    } else if (this.promptLoader) {
      const fsPrompt = this.promptLoader.getSystemPrompt(dispatch.domain, dispatch.worker);
      if (fsPrompt) {
        systemPrompt = fsPrompt;
        promptSource = "filesystem (legacy)";
      } else {
        systemPrompt = `You are ${workerSpec}, a Taskmaster worker. Domain: ${dispatch.domain}. Role: ${dispatch.worker}.\n\nComplete the dispatched task.`;
        promptSource = "generic fallback";
      }
    } else {
      systemPrompt = `You are ${workerSpec}, a Taskmaster worker. Domain: ${dispatch.domain}. Role: ${dispatch.worker}.\n\nComplete the dispatched task.`;
      promptSource = "generic fallback";
    }
    this.emit("runtime:event", { type: "worker_started", jobId, worker: workerSpec, model, promptSource });

    // Workers use Aion's shared ToolRegistry filtered by the worker's tier.
    // This replaces the retired 5-tool mini-sandbox — a worker dispatched to
    // "fix the failing git test" can now call git_status/git_diff/etc., the
    // same tools Aion has at the same tier.
    if (this.toolRegistry === null) {
      const msg = "WorkerRuntime has no ToolRegistry bound — cannot execute workers. (Call setToolRegistry() during boot.)";
      this.emit("runtime:event", { type: "worker_done", jobId, worker: workerSpec, status: "failed" });
      return { jobId, status: "failed", text: "", totalInputTokens: 0, totalOutputTokens: 0, toolLoops: 0, errors: [msg], toolCalls: [], model: "none" };
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

    const planLine = dispatch.planRef
      ? `\n**Plan step:** \`${dispatch.planRef.planId}\` / \`${dispatch.planRef.stepId}\` — the server auto-marks this step \`complete\` when you finish successfully, \`failed\` otherwise, so you do NOT need to call \`update_plan\` yourself for this step.`
      : "";
    const contextLine = previousPhaseOutput
      ? `\n\n## Previous Phase Output\n\nThe worker before you produced this output. Use it as context for your work:\n\n${previousPhaseOutput.slice(0, 4000)}`
      : "";
    const messages: RuntimeMessage[] = [
      { role: "user", content: `## Dispatch\n\n**Task:** ${dispatch.description}\n**Priority:** ${dispatch.priority}\n**Project:** ${projectRoot}\n**Your jobId:** ${jobId}${planLine}${contextLine}\n\nExecute this task. You have access to the same tool registry as the dispatching agent, scoped to this project. Tools that accept a \`projectPath\` argument should receive \`${projectRoot}\`.\n\nIf you need a decision you can't make yourself (design choice, config change you can't perform, ambiguous scope), call \`taskmaster_handoff\` with your \`jobId\` and a specific question — then finish your turn with a summary. You will not be auto-resumed; Aion will re-dispatch with clarification if needed.\n\nWhen done, summarize what you accomplished.` },
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
    const toolCalls: Array<{ name: string; ts: string }> = [];

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
          toolCalls.push({ name: tc.name, ts: new Date().toISOString() });
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
        toolCalls,
        model,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      errors.push(errorMsg);
      this.emit("runtime:event", { type: "worker_done", jobId, worker: workerSpec, status: "failed" });
      return { jobId, status: "failed", text: "", totalInputTokens, totalOutputTokens, toolLoops, errors, toolCalls, model };
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

  /**
   * Cancel a job by flipping its state-index status to "failed" and dropping
   * it from the active map. Best-effort: a worker that's already mid-tool-
   * call will finish that call before stopping — a full AbortController
   * integration is a planned follow-up. Emits a job_failed runtime:event so
   * the Work Queue + chat feedback loop pick it up uniformly.
   */
  cancelJob(jobId: string, reason: string): void {
    try {
      const bridge = new JobBridge(this.config.stateDir);
      bridge.updateJobStatus(jobId, "failed", reason);
    } catch { /* non-fatal */ }
    this.activeJobs.delete(jobId);
    this.emit("runtime:event", { type: "job_failed", jobId, error: reason });
  }

  /**
   * Boot-time reconciliation: any job in `running` / `pending` / `checkpoint`
   * status in the state index at the moment WorkerRuntime boots is by
   * definition orphaned (the process that was running it did not survive the
   * restart). Flip each to `failed` with a restart reason and emit
   * `job_failed` events so the chat feedback loop + Work Queue reflect
   * reality. Call this exactly once per boot, right after construction.
   *
   * Returns the number of jobs that were reconciled (zero when the state
   * file is empty or only contains terminal jobs).
   */
  async reconcileOrphanedJobs(): Promise<number> {
    const jobs = await this.listAllJobs();
    const orphaned = jobs.filter((j) =>
      j.status === "running" || j.status === "pending" || j.status === "checkpoint",
    );
    if (orphaned.length === 0) return 0;

    const reason = "Gateway restarted while this job was in flight — the worker process did not survive.";
    const bridge = new JobBridge(this.config.stateDir);
    for (const job of orphaned) {
      try {
        bridge.updateJobStatus(job.id, "failed", reason);
      } catch { /* non-fatal */ }
      this.emit("runtime:event", { type: "job_failed", jobId: job.id, error: reason });
    }
    return orphaned.length;
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
   * List dispatch entries for a project, merged with the live-status overlay
   * from ~/.agi/state/taskmaster.json. The merge rule lives in
   * `dispatch-paths.ts::mergeJobStatus` so that `taskmaster_status` (Aion's
   * view) and the Work Queue UI cannot drift apart.
   */
  async listJobsForProject(projectPath: string): Promise<WorkerJob[]> {
    try {
      const { readdirSync } = await import("node:fs");
      const dir = dispatchJobsDir(projectPath);
      if (!existsSync(dir)) return [];
      const files = readdirSync(dir).filter((f) => f.endsWith(".json"));

      const overlay = loadLiveJobOverlay(this.config.stateDir);

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
            completedAt?: string;
            handoffs?: Array<{ question: string; askedAt: string }>;
            summary?: string;
            error?: string;
            tokens?: { input: number; output: number };
            toolCalls?: Array<{ name: string; ts: string }>;
          };
          const live = overlay.get(flat.id);
          const mergedStatus = mergeJobStatus(flat, live);
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
              status: mergedStatus === "checkpoint" ? "running" : mergedStatus,
            }],
            currentPhase: "phase-1",
            status: mergedStatus,
            createdAt: flat.createdAt,
            startedAt: live?.startedAt,
            completedAt: live?.completedAt ?? flat.completedAt,
            error: live?.error ?? flat.error,
            summary: flat.summary,
            tokens: flat.tokens,
            toolCalls: flat.toolCalls,
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
