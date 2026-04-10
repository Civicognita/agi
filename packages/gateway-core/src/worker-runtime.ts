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
import { join, resolve } from "node:path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { execSync } from "node:child_process";

import { JobBridge } from "./job-bridge.js";
import { WorkerPromptLoader } from "./worker-prompt-loader.js";
import type { LLMProvider } from "./llm/provider.js";
import type { LLMInvokeParams, LLMToolContinuationParams, LLMContentBlock } from "./llm/types.js";

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
}

export interface WorkerRuntimeDeps {
  llmProvider: LLMProvider;
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
// Worker tool definitions (sandboxed subset)
// ---------------------------------------------------------------------------

function getWorkerTools(): RuntimeToolDef[] {
  return [
    {
      name: "read_file",
      description: "Read a file from the project directory.",
      input_schema: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path relative to project root" },
        },
        required: ["path"],
      },
    },
    {
      name: "write_file",
      description: "Write content to a file in the project directory.",
      input_schema: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path relative to project root" },
          content: { type: "string", description: "File content to write" },
        },
        required: ["path", "content"],
      },
    },
    {
      name: "list_files",
      description: "List files in a directory.",
      input_schema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Directory path relative to project root" },
          pattern: { type: "string", description: "Glob pattern to filter (optional)" },
        },
        required: ["path"],
      },
    },
    {
      name: "search_files",
      description: "Search file contents for a pattern using grep.",
      input_schema: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Search pattern (regex)" },
          path: { type: "string", description: "Directory to search in (default: project root)" },
        },
        required: ["pattern"],
      },
    },
    {
      name: "run_command",
      description: "Run a shell command in the project directory. Only for build/test commands.",
      input_schema: {
        type: "object",
        properties: {
          command: { type: "string", description: "Shell command to execute" },
        },
        required: ["command"],
      },
    },
  ];
}

function executeWorkerTool(toolName: string, input: Record<string, unknown>, projectRoot: string): string {
  try {
    switch (toolName) {
      case "read_file": {
        const filePath = resolve(projectRoot, String(input.path ?? ""));
        if (!existsSync(filePath)) return JSON.stringify({ error: "File not found" });
        return readFileSync(filePath, "utf-8");
      }
      case "write_file": {
        const filePath = resolve(projectRoot, String(input.path ?? ""));
        const dir = resolve(filePath, "..");
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        writeFileSync(filePath, String(input.content ?? ""), "utf-8");
        return JSON.stringify({ ok: true, path: filePath });
      }
      case "list_files": {
        const dirPath = resolve(projectRoot, String(input.path ?? "."));
        if (!existsSync(dirPath)) return JSON.stringify({ error: "Directory not found" });
        const out = execSync(`find ${JSON.stringify(dirPath)} -maxdepth 2 -type f | head -100`, { timeout: 10000 }).toString();
        return out || "(empty)";
      }
      case "search_files": {
        const searchPath = resolve(projectRoot, String(input.path ?? "."));
        const pattern = String(input.pattern ?? "");
        const out = execSync(`grep -rn --include='*.ts' --include='*.tsx' --include='*.md' ${JSON.stringify(pattern)} ${JSON.stringify(searchPath)} | head -50`, { timeout: 10000 }).toString();
        return out || "(no matches)";
      }
      case "run_command": {
        const cmd = String(input.command ?? "");
        const out = execSync(cmd, { cwd: projectRoot, timeout: 60000, stdio: "pipe" }).toString();
        return out.slice(0, 10000);
      }
      default:
        return JSON.stringify({ error: `Unknown tool: ${toolName}` });
    }
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
  }
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

  constructor(config: WorkerRuntimeConfig, deps: WorkerRuntimeDeps) {
    super();
    this.config = config;
    this.invoker = createRuntimeInvoker(deps.llmProvider, config.modelMap);
    if (config.promptDir) {
      this.promptLoader = new WorkerPromptLoader(config.promptDir);
    }
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
   * Execute a worker job. Fire-and-forget — called after worker_dispatch.
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

    // Read dispatch file to get job details
    const jobsDir = join(this.config.workspaceRoot ?? ".", ".dispatch", "jobs");
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

    const tools = getWorkerTools();
    const messages: RuntimeMessage[] = [
      { role: "user", content: `## Dispatch\n\n**Task:** ${dispatch.description}\n**Priority:** ${dispatch.priority}\n**Project:** ${projectRoot}\n\nExecute this task. Use the available tools to read, write, and search project files. When done, summarize what you accomplished.` },
    ];

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

        // Execute each tool call
        const toolResults: RuntimeToolResult[] = [];
        for (const tc of response.toolCalls) {
          const result = executeWorkerTool(tc.name, tc.input, projectRoot);
          toolResults.push({ tool_use_id: tc.id, content: result });
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
