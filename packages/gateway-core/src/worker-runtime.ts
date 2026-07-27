/**
 * Worker Runtime — executes Taskmaster worker jobs by driving a paired
 * Genie workspace's `runAgent` MCP tool (a real coding agent — Claude Code
 * or Codex — with genuine file/terminal access), not an in-process LLM
 * tool-loop. Manages concurrent job execution and bridges runtime events to
 * the DashboardEventBroadcaster. Worker prompts are loaded from
 * prompts/workers/ via WorkerPromptLoader; they become the initial prompt
 * handed to the spawned agent.
 */

import { EventEmitter } from "node:events";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";

import { JobBridge } from "./job-bridge.js";
import { WorkerPromptLoader } from "./worker-prompt-loader.js";
import { dispatchJobsDir, finalizeDispatchFile, loadLiveJobOverlay, mergeJobStatus } from "./dispatch-paths.js";
import { projectSlug } from "./project-config-path.js";
import type { McpClient } from "@agi/mcp-client";

// ---------------------------------------------------------------------------
// Genie runAgent bridge
// ---------------------------------------------------------------------------

/** Sentinel a Genie-hosted worker is instructed to emit when its phase is
 *  genuinely done — runAgent has no "agent finished" signal of its own
 *  (Claude Code/Codex stay interactive), so completion is detected by
 *  pattern-matching this marker in the polled output. */
const TASKMASTER_DONE_MARKER = "<<<TASKMASTER_DONE>>>";

/** How often to poll runAgent's `read` action while a worker is running. */
const GENIE_POLL_INTERVAL_MS = 4000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** MCP tool results wrap JSON in `content[0].text` (same convention
 *  TynnPmProvider already relies on for the `tynn` server). */
function parseMcpJson(result: { isError: boolean; content: Array<{ type: string; [key: string]: unknown }> }): Record<string, unknown> {
  if (result.isError) {
    const text = result.content.find((c) => c.type === "text")?.text;
    throw new Error(typeof text === "string" ? text : "MCP tool call returned an error");
  }
  const block = result.content.find((c) => c.type === "text");
  const text = block?.text;
  if (typeof text !== "string") return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
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
  /** How often (ms) to poll a Genie-hosted worker for its completion
   *  marker. Defaults to GENIE_POLL_INTERVAL_MS; overridable so tests can
   *  exercise the poll/timeout loop without waiting on the real interval. */
  genieDonePollMs?: number;
}

/** Minimal plugin registry interface for worker prompt resolution. */
interface WorkerPluginLookup {
  getWorker(id: string): { prompt: string; name: string } | undefined;
}

export interface WorkerRuntimeDeps {
  /**
   * MCP client used to reach a project's paired Genie workspace. A worker's
   * project must have a `genie` entry registered (namespaced as
   * `${projectSlug}:genie` — written automatically to that project's
   * `.mcp.json` by Genie itself) or dispatch fails with a clear error.
   */
  mcpClient?: McpClient;
  /** Plugin registry — primary source for worker system prompts. Workers are
   *  plugins that register via api.registerWorker() with their prompt inline. */
  pluginWorkers?: WorkerPluginLookup;
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
  /** "paused" = a checkpoint gate stopped the job between phases; not a
   *  terminal outcome — resumed via approveCheckpoint()/rejectCheckpoint(). */
  status: "completed" | "failed" | "paused";
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
  private promptLoader: WorkerPromptLoader | null = null;
  private mcpClient: McpClient | null = null;
  private pluginWorkers: WorkerPluginLookup | null = null;

  constructor(config: WorkerRuntimeConfig, deps: WorkerRuntimeDeps) {
    super();
    this.config = config;
    if (config.promptDir) {
      this.promptLoader = new WorkerPromptLoader(config.promptDir);
    }
    this.mcpClient = deps.mcpClient ?? null;
    this.pluginWorkers = deps.pluginWorkers ?? null;
  }

  /** Late-bind the MCP client (constructed after WorkerRuntime during server boot). */
  setMcpClient(client: McpClient): void {
    this.mcpClient = client;
  }

  /** Late-bind the plugin worker registry (plugins load after the runtime). */
  setPluginWorkers(lookup: WorkerPluginLookup): void {
    this.pluginWorkers = lookup;
  }

  /** Hot-reload config without interrupting running jobs. */
  reloadConfig(config: WorkerRuntimeConfig): void {
    this.config = config;
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
        bridge.ensureJobWithPhases(jobId, dispatchFile, phases, projectContext?.path);
      } else if (dispatch && existsSync(dispatchFile)) {
        bridge.ensureJob(jobId, dispatchFile, projectContext?.path);
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
    this.trackPhasesRun(jobId, coaReqId, projectContext?.path, bridge, promise);
  }

  /**
   * Wire an in-flight `executePhases()` promise into `activeJobs` and
   * translate its eventual outcome (paused / completed / failed) into
   * JobBridge state + `report_ready`/`job_failed`/`checkpoint_reached`
   * runtime events. Shared by a fresh dispatch (`executeJob`) and a
   * checkpoint resume (`approveCheckpoint`) — both eventually run the same
   * `executePhases()` and need the same finalization.
   */
  private trackPhasesRun(
    jobId: string,
    coaReqId: string,
    projectPath: string | undefined,
    bridge: JobBridge,
    promise: Promise<WorkerRunResult>,
  ): void {
    this.activeJobs.set(jobId, { jobId, coaReqId, startedAt: Date.now(), promise });

    promise
      .then((result) => {
        this.activeJobs.delete(jobId);
        if (result.status === "paused") {
          // Bridge status is already "checkpoint" (set inside executePhases
          // right before it returned) — nothing to finalize until the owner
          // approves/rejects via /api/taskmaster/approve|reject/:jobId.
          this.emit("runtime:event", {
            type: "checkpoint_reached",
            jobId,
            summary: result.text.slice(0, 500),
            coaReqId,
          });
          return;
        }
        const finalStatus = result.status === "completed" ? "complete" : "failed";
        const errorMsg = result.errors.length > 0 ? result.errors.join("; ") : undefined;
        try { bridge.updateJobStatus(jobId, finalStatus, errorMsg); } catch { /* non-fatal */ }
        if (projectPath) {
          finalizeDispatchFile(projectPath, jobId, {
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
        if (projectPath) {
          finalizeDispatchFile(projectPath, jobId, { status: "failed", completedAt: new Date().toISOString(), error: errorMsg });
        }
        this.emit("runtime:event", { type: "job_failed", jobId, error: errorMsg });
      });
  }

  /**
   * Execute phases sequentially, passing context from each worker to the
   * next. `startIndex`/`initialPreviousOutput` let a checkpoint-resume
   * (see `approveCheckpoint`) re-enter mid-job without re-running earlier
   * phases' Genie agents. A phase whose `gate` is `"checkpoint"` pauses the
   * job (status "checkpoint") right after it completes rather than starting
   * the next phase — Taskmaster's own gate stays the sole approval
   * authority; the owner resumes via `/api/taskmaster/approve/:jobId`.
   */
  private async executePhases(
    jobId: string,
    dispatch: { description: string; priority: string; planRef?: { planId: string; stepId: string } },
    phases: import("./taskmaster-orchestrator.js").WorkPhase[],
    coaReqId: string,
    projectRoot: string,
    startIndex = 0,
    initialPreviousOutput = "",
  ): Promise<WorkerRunResult> {
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalToolLoops = 0;
    const allToolCalls: Array<{ name: string; ts: string }> = [];
    const allErrors: string[] = [];
    let lastModel = "unknown";
    let previousOutput = initialPreviousOutput;

    const bridge = new JobBridge(this.config.stateDir);

    for (let i = startIndex; i < phases.length; i++) {
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

      // Advance to next phase in state, persisting this phase's output so a
      // checkpoint-resume (which may happen in a later process) can rebuild
      // "previous phase output" context without it being passed back in.
      if (!isLast) {
        try { bridge.advancePhase(jobId, result.text); } catch { /* non-fatal */ }
      }

      if (phase.gate === "checkpoint" && !isLast && !this.config.autoApprove) {
        try { bridge.updateJobStatus(jobId, "checkpoint"); } catch { /* non-fatal */ }
        this.emit("runtime:event", {
          type: "checkpoint_pending",
          jobId,
          phaseIndex: i,
          nextPhaseIndex: i + 1,
          worker: `$W.${phase.domain}.${phase.role}`,
        });
        return {
          jobId,
          status: "paused",
          text: previousOutput,
          totalInputTokens,
          totalOutputTokens,
          toolLoops: totalToolLoops,
          errors: allErrors,
          toolCalls: allToolCalls,
          model: lastModel,
        };
      }
    }

    // All phases complete
    try { bridge.advancePhase(jobId, previousOutput); } catch { /* non-fatal */ }

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
  // Genie-backed worker execution
  // -------------------------------------------------------------------------

  private async runWorker(
    jobId: string,
    dispatch: { description: string; domain: string; worker: string; priority: string; planRef?: { planId: string; stepId: string } },
    _coaReqId: string,
    projectRoot: string,
    previousPhaseOutput?: string,
  ): Promise<WorkerRunResult> {
    const workerSpec = `$W.${dispatch.domain}.${dispatch.worker}`;
    // Genie-executed workers pick their own model (Claude Code / Codex's own
    // config) — Taskmaster's modelMap no longer applies. Kept in the result
    // shape for event-schema compatibility with the dashboard/reports store.
    const model = "genie";

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

    const fail = (msg: string): WorkerRunResult => {
      this.emit("runtime:event", { type: "worker_done", jobId, worker: workerSpec, status: "failed" });
      return { jobId, status: "failed", text: "", totalInputTokens: 0, totalOutputTokens: 0, toolLoops: 0, errors: [msg], toolCalls: [], model: "none" };
    };

    if (!this.mcpClient) {
      return fail("WorkerRuntime has no McpClient bound — cannot reach a paired Genie workspace. (Call setMcpClient() during boot.)");
    }

    // Every worker executes via the project's paired Genie workspace — no
    // in-process fallback. The `genie` entry is written into a project's
    // `.mcp.json` automatically once that project is opened in Genie (a
    // one-time, owner-driven setup step; see docs/agents/taskmaster-genie.md).
    const genieServerId = `${projectSlug(projectRoot)}:genie`;
    if (!this.mcpClient.listServers().some((s) => s.id === genieServerId)) {
      return fail(`No paired Genie workspace for this project (expected MCP server "${genieServerId}") — open this project in Genie to enable Taskmaster.`);
    }

    const planLine = dispatch.planRef
      ? `\n**Plan step:** \`${dispatch.planRef.planId}\` / \`${dispatch.planRef.stepId}\` — the server auto-marks this step \`complete\` when you finish successfully, \`failed\` otherwise, so you do NOT need to call \`update_plan\` yourself for this step.`
      : "";
    const contextLine = previousPhaseOutput
      ? `\n\n## Previous Phase Output\n\nThe worker before you produced this output. Use it as context for your work:\n\n${previousPhaseOutput.slice(0, 4000)}`
      : "";
    const taskPrompt = `${systemPrompt}\n\n## Dispatch\n\n**Task:** ${dispatch.description}\n**Priority:** ${dispatch.priority}\n**Project:** ${projectRoot}\n**Your jobId:** ${jobId}${planLine}${contextLine}\n\nExecute this task directly in this project using your normal file/terminal tools — you have full access.\n\nWhen you have GENUINELY finished this phase's work (not before), output this exact marker on its own line, followed by a one-paragraph summary of what you did and why:\n\n${TASKMASTER_DONE_MARKER}`;

    let agentId: string | undefined;
    try {
      const startResult = parseMcpJson(
        await this.mcpClient.callTool(genieServerId, "runAgent", { action: "start", agent: "claude", cwd: projectRoot }),
      );
      agentId = typeof startResult.id === "string" ? startResult.id : undefined;
      if (!agentId) {
        return fail("runAgent start did not return an agent id");
      }

      await this.mcpClient.callTool(genieServerId, "runAgent", { action: "send", id: agentId, prompt: taskPrompt });

      const deadline = Date.now() + this.config.workerTimeoutMs;
      const pollIntervalMs = this.config.genieDonePollMs ?? GENIE_POLL_INTERVAL_MS;
      let cursor: number | undefined;
      let output = "";
      let markerAt = -1;

      while (Date.now() < deadline) {
        await sleep(pollIntervalMs);
        const readResult = parseMcpJson(
          await this.mcpClient.callTool(genieServerId, "runAgent", { action: "read", id: agentId, cursor, strip: true }),
        );
        if (typeof readResult.output === "string") output += readResult.output;
        if (typeof readResult.cursor === "number") cursor = readResult.cursor;
        markerAt = output.indexOf(TASKMASTER_DONE_MARKER);
        if (markerAt !== -1) break;
        this.emit("runtime:event", { type: "worker_progress", jobId, worker: workerSpec, toolLoops: 0, text: output.slice(-200) });
      }

      try { await this.mcpClient.callTool(genieServerId, "runAgent", { action: "stop", id: agentId }); } catch { /* best-effort cleanup */ }

      if (markerAt === -1) {
        return fail(`Worker did not emit ${TASKMASTER_DONE_MARKER} within ${String(this.config.workerTimeoutMs)}ms`);
      }

      const summary = output.slice(markerAt + TASKMASTER_DONE_MARKER.length).trim() || output.slice(0, markerAt).trim();

      this.emit("runtime:event", { type: "worker_done", jobId, worker: workerSpec, status: "completed" });
      return {
        jobId,
        status: "completed",
        text: summary,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        toolLoops: 0,
        errors: [],
        toolCalls: [],
        model,
      };
    } catch (err) {
      if (agentId) {
        try { await this.mcpClient.callTool(genieServerId, "runAgent", { action: "stop", id: agentId }); } catch { /* best-effort cleanup */ }
      }
      return fail(err instanceof Error ? err.message : String(err));
    }
  }

  // -------------------------------------------------------------------------
  // Checkpoint management (via JobBridge state)
  // -------------------------------------------------------------------------

  /**
   * Resume a job paused at a checkpoint gate. Rebuilds everything
   * `executePhases()` needs — project path, remaining phases, the
   * completed phase's output as context, the original coaReqId/priority —
   * from JobBridge-persisted state, since this call can happen well after
   * (and in a different request than) the original dispatch.
   */
  async approveCheckpoint(jobId: string): Promise<void> {
    const bridge = new JobBridge(this.config.stateDir);
    const job = bridge.getJob(jobId);
    if (!job) {
      this.emit("runtime:event", { type: "job_failed", jobId, error: `approveCheckpoint: job ${jobId} not found` });
      return;
    }
    if (!job.projectPath) {
      this.emit("runtime:event", { type: "job_failed", jobId, error: `approveCheckpoint: job ${jobId} has no persisted project path — cannot resume` });
      return;
    }
    if (this.activeJobs.has(jobId)) return;

    let coaReqId = jobId;
    let priority = "normal";
    let planRef: { planId: string; stepId: string } | undefined;
    try {
      const dispatchFile = join(dispatchJobsDir(job.projectPath), `${jobId}.json`);
      if (existsSync(dispatchFile)) {
        const raw = JSON.parse(readFileSync(dispatchFile, "utf-8")) as { coaReqId?: string; priority?: string; planRef?: { planId: string; stepId: string } };
        coaReqId = raw.coaReqId ?? coaReqId;
        priority = raw.priority ?? priority;
        planRef = raw.planRef;
      }
    } catch { /* fall back to defaults above */ }

    const phases: import("./taskmaster-orchestrator.js").WorkPhase[] = job.phases.map((p) => ({
      domain: p.domain,
      role: p.role,
      phaseDescription: p.description,
      gate: p.gate === "checkpoint" ? "checkpoint" as const : "auto" as const,
    }));
    const previousOutput = job.phases[job.currentPhase - 1]?.output ?? "";

    bridge.updateJobStatus(jobId, "running");
    this.emit("runtime:event", {
      type: "job_started",
      jobId,
      description: job.queueText,
      workers: phases.map((p) => `$W.${p.domain}.${p.role}`),
      totalPhases: phases.length,
    });

    const promise = this.executePhases(
      jobId,
      { description: job.queueText, priority, planRef },
      phases,
      coaReqId,
      job.projectPath,
      job.currentPhase,
      previousOutput,
    );
    this.trackPhasesRun(jobId, coaReqId, job.projectPath, bridge, promise);
  }

  async rejectCheckpoint(jobId: string, reason: string): Promise<void> {
    const bridge = new JobBridge(this.config.stateDir);
    bridge.updateJobStatus(jobId, "failed", reason);
    this.activeJobs.delete(jobId);
    this.emit("runtime:event", { type: "job_failed", jobId, error: reason });
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
