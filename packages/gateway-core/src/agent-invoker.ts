/**
 * Agent Invoker — orchestrates the full invocation pipeline.
 *
 * Ties together: system prompt assembly, invocation gating, rate limiting,
 * session management, sanitization, API calls, tool execution, COA logging,
 * TASKMASTER emission, and outbound dispatch.
 *
 * Steps (from agent-invocation-spec.md §2.1):
 *   [1] InboundRouter.route() — already handled upstream
 *   [2] QueueConsumer.poll() — already handled upstream
 *   [3] STATE CHECK (invocation gate)
 *   [4] Session lookup/creation + history assembly
 *   [5] Sanitization
 *   [6] System prompt assembly
 *   [7] Anthropic API call
 *   [8] COA log: message_out
 *   [9] Response routing (TASKMASTER extraction, outbound dispatch)
 *   [10] Outbound delivery — handled downstream
 */

import { EventEmitter } from "node:events";

import type { Entity } from "@aionima/entity-model";
import type { COAChainLogger } from "@aionima/coa-chain";

import type { GatewayState } from "./types.js";
import type { GatewayStateMachine } from "./state-machine.js";
import type { AgentSessionManager } from "./agent-session.js";
import type { ToolRegistry, ToolExecutionResult } from "./tool-registry.js";
import type { RateLimiter } from "./rate-limiter.js";

import {
  assembleSystemPrompt,
  computeAvailableTools,
  estimateTokens,
} from "./system-prompt.js";
import type { SystemPromptContext, EntityContextSection } from "./system-prompt.js";
import { gateInvocation, isHumanCommand } from "./invocation-gate.js";
import { sanitize } from "./sanitizer.js";

import type { LLMProvider, LLMToolCall, LLMToolResult, LLMMessage, LLMContentBlock } from "./llm/index.js";
import type { UserContextStore } from "./user-context-store.js";
import type { PrimeLoader } from "./prime-loader.js";
import { createComponentLogger } from "./logger.js";
import type { Logger, ComponentLogger } from "./logger.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FRIENDLY_TOOL_SUMMARY: Record<string, string> = {
  manage_project: "Project updated",
  shell_exec: "Command completed",
  dir_list: "Files listed",
  file_read: "File read",
  file_write: "File written",
  create_plan: "Plan created",
  taskmaster_dispatch: "Work dispatched",
  search_prime: "Knowledge searched",
};

// ---------------------------------------------------------------------------
// Tool event helpers — sanitize inputs and extract structured detail
// ---------------------------------------------------------------------------

function sanitizeToolInput(input: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (k === "content" && typeof v === "string" && v.length > 200) {
      sanitized[k] = `[${String(v.length)} chars]`;
    } else {
      sanitized[k] = v;
    }
  }
  return sanitized;
}

function extractToolDetail(
  toolName: string,
  input: Record<string, unknown>,
): Record<string, unknown> | undefined {
  switch (toolName) {
    case "file_read": return { path: input.path };
    case "file_write": return { path: input.path };
    case "shell_exec": return { command: input.command };
    case "dir_list": return { path: input.path };
    case "grep_search": return { pattern: input.pattern, path: input.path };
    case "git_status": case "git_diff": case "git_add": case "git_commit": case "git_branch":
      return { action: (input.action as string | undefined) ?? toolName.replace("git_", "") };
    case "manage_project": return { action: input.action, name: input.name };
    case "search_prime": return { query: input.query };
    case "create_plan": case "update_plan": return { title: input.title };
    case "browser_session": return { action: input.action, url: input.url, selector: input.selector };
    default: return undefined;
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentInvokerDeps {
  stateMachine: GatewayStateMachine;
  apiClient: LLMProvider | (() => LLMProvider);
  sessionManager: AgentSessionManager;
  toolRegistry: ToolRegistry;
  rateLimiter: RateLimiter;
  coaLogger: COAChainLogger;
  /** The gateway's resource ID, e.g. "$A0". */
  resourceId: string;
  /** The gateway's node ID, e.g. "@A0". */
  nodeId: string;
  /** Optional memory adapter for context injection (CompositeMemoryAdapter). */
  memoryAdapter?: { query(params: { entityId?: string; category?: string; limit?: number }): Promise<Array<{ content: string; category: string }>>; store(entry: unknown): Promise<void> };
  /** Optional skill registry for skill-based prompt injection. */
  skillRegistry?: { getAll(): Array<{ definition: { name: string; description: string; domain: string } }> };
  /** Optional per-entity relationship context store (USER.md files). */
  userContextStore?: UserContextStore;
  /** Optional PRIME knowledge loader — loads corpus for system prompt injection. */
  primeLoader?: PrimeLoader;
  /** Workspace root path — injected as context when devMode is true. */
  workspaceRoot?: string;
  /** Directories where projects are stored and worked on. */
  projectPaths?: string[];
  /** Owner config — for injecting owner context into system prompt. */
  ownerConfig?: { displayName: string; channels: Record<string, string | undefined> };
  /** Optional logger instance. */
  logger?: Logger;
  /** Optional image blob store for resolving image references in history. */
  imageBlobStore?: import("./image-blob-store.js").ImageBlobStore;
}

export interface InvocationRequest {
  /** The resolved entity. */
  entity: Entity;
  /** Channel the message arrived on. */
  channel: string;
  /** Raw message content (will be sanitized). */
  content: unknown;
  /** COA fingerprint from inbound routing. */
  coaFingerprint: string;
  /** Queue message ID (for outbound routing reference). */
  queueMessageId: string;
  /** Activate dev persona mode for this invocation. */
  devMode?: boolean;
  /** Whether the sender is the owner of this install. */
  isOwner?: boolean;
  /** Override session key (for multi-session chat). Defaults to entity.id. */
  sessionKey?: string;
  /** Optional project context path included in system prompt for scoped chat. */
  projectContext?: string;
  /** BuilderChat mode — loads builder system prompt and designer tools. */
  builderMode?: "create" | "update" | "review";
  /** Pre-saved image references for this invocation (from ImageBlobStore). */
  imageRefs?: import("./agent-session.js").ImageRef[];
  /** Chat session ID used for image blob resolution. */
  chatSessionId?: string;
  /** Abort signal — when triggered, the invocation stops at the next checkpoint. */
  abortSignal?: AbortSignal;
}

export type InvocationOutcome =
  | { type: "response"; text: string; toolsUsed: string[]; coaFingerprint: string; taskmasterEmissions: string[]; model: string; provider: string; usage: { inputTokens: number; outputTokens: number }; toolCount: number; loopCount: number }
  | { type: "queued"; reason: string; entityNotification: string }
  | { type: "human_routed"; content: string }
  | { type: "log_only" }
  | { type: "rate_limited"; retryAfterMs?: number; entityNotification: string }
  | { type: "error"; message: string };

// ---------------------------------------------------------------------------
// AgentInvoker
// ---------------------------------------------------------------------------

export class AgentInvoker extends EventEmitter {
  private readonly deps: AgentInvokerDeps;
  private readonly log: ComponentLogger;

  /** Per-session injection queues for mid-loop message injection. */
  private readonly injectionQueues = new Map<string, string[]>();

  /** Resolve apiClient — supports both static LLMProvider and getter function. */
  private get apiClient(): LLMProvider {
    const c = this.deps.apiClient;
    return typeof c === "function" ? c() : c;
  }

  constructor(deps: AgentInvokerDeps) {
    super();
    this.deps = deps;
    this.log = createComponentLogger(deps.logger, "agent-invoker");
  }

  /** Queue a user message for injection into an active agent loop. */
  injectMessage(sessionKey: string, text: string): void {
    let queue = this.injectionQueues.get(sessionKey);
    if (!queue) {
      queue = [];
      this.injectionQueues.set(sessionKey, queue);
    }
    queue.push(text);
  }

  /** Drain all queued injections for a session. Returns empty array if none. */
  drainInjections(sessionKey: string): string[] {
    const queue = this.injectionQueues.get(sessionKey);
    if (!queue || queue.length === 0) return [];
    const drained = [...queue];
    queue.length = 0;
    return drained;
  }

  /**
   * Process an inbound message through the full invocation pipeline.
   *
   * This is the main entry point called by the QueueConsumer's onInbound
   * callback (replacing AgentBridge.notify for autonomous operation).
   */
  async process(request: InvocationRequest): Promise<InvocationOutcome> {
    const { entity, channel, content, coaFingerprint } = request;
    const sKey = request.sessionKey ?? entity.id;

    // -----------------------------------------------------------------------
    // Step 3: /human command check (processed in ALL states)
    // -----------------------------------------------------------------------
    if (isHumanCommand(content)) {
      this.emit("human_command", request);
      return {
        type: "human_routed",
        content: typeof content === "string" ? content : String(content),
      };
    }

    // -----------------------------------------------------------------------
    // Step 3: STATE CHECK (invocation gate)
    // -----------------------------------------------------------------------
    const state = this.deps.stateMachine.getState();
    const decision = gateInvocation(state);

    if (decision.action === "log_only") {
      return { type: "log_only" };
    }

    if (decision.action === "queue") {
      return {
        type: "queued",
        reason: decision.reason,
        entityNotification: decision.message,
      };
    }

    // -----------------------------------------------------------------------
    // Step 3: Rate limit check
    // -----------------------------------------------------------------------
    const rateResult = this.deps.rateLimiter.check(entity.id, state);
    if (!rateResult.allowed) {
      return {
        type: "rate_limited",
        retryAfterMs: rateResult.retryAfterMs,
        entityNotification:
          "I'm receiving a high volume of requests. Please wait a moment.",
      };
    }

    // -----------------------------------------------------------------------
    // Step 4: Session lookup/creation + history assembly
    // -----------------------------------------------------------------------
    const session = this.deps.sessionManager.getOrCreate(
      sKey,
      entity.coaAlias,
      channel,
    );

    // -----------------------------------------------------------------------
    // Step 5: Sanitization
    // -----------------------------------------------------------------------
    const sanitized = sanitize(content);
    if (sanitized.wasRedacted) {
      this.emit("content_redacted", {
        entityId: entity.id,
        originalLength: sanitized.originalLength,
        sanitizedLength: sanitized.sanitizedLength,
      });
    }

    // When content includes images/blocks, use the sanitized blocks for the
    // API call and store the text-only version in the session for history.
    const apiContent: string | LLMContentBlock[] = sanitized.contentBlocks
      ? sanitized.contentBlocks as LLMContentBlock[]
      : sanitized.content;

    // Add user turn to session (text + image refs for context continuity)
    this.deps.sessionManager.addUserTurn(
      sKey,
      sanitized.content,
      coaFingerprint,
      request.imageRefs,
    );

    // -----------------------------------------------------------------------
    // Step 6: System prompt assembly
    // -----------------------------------------------------------------------
    const capabilities = this.deps.stateMachine.getCapabilities();
    const availableTools = computeAvailableTools(
      state,
      entity.verificationTier,
      this.deps.toolRegistry.getManifests(),
    );

    const entityCtx: EntityContextSection = {
      entityId: entity.id,
      coaAlias: entity.coaAlias,
      displayName: entity.displayName,
      verificationTier: entity.verificationTier,
      channel,
    };

    // Inject recalled memories (if memory adapter is wired)
    let memories: Array<{ content: string; category: string }> | undefined;
    if (this.deps.memoryAdapter !== undefined) {
      try {
        memories = await this.deps.memoryAdapter.query({
          entityId: entity.id,
          limit: 10,
        });
      } catch {
        // Memory recall failure is non-fatal
      }
    }

    // Inject matched skills (if skill registry is wired)
    let skills: Array<{ name: string; description: string; content: string }> | undefined;
    if (this.deps.skillRegistry !== undefined) {
      const allSkills = this.deps.skillRegistry.getAll();
      if (allSkills.length > 0) {
        skills = allSkills.map((s) => ({
          name: s.definition.name,
          description: s.definition.description,
          content: s.definition.domain,
        }));
      }
    }

    // Load per-entity relationship context (USER.md)
    let userContext: string | undefined;
    if (this.deps.userContextStore !== undefined) {
      userContext = this.deps.userContextStore.load(entity.id);
    }

    // Load PRIME context — always, not gated by devMode (directive is part of BAIF)
    let prime: SystemPromptContext["prime"];
    if (this.deps.primeLoader !== undefined) {
      const truth = this.deps.primeLoader.loadCoreTruth();
      const directive = this.deps.primeLoader.loadPrimeDirective();
      const topicIndex = this.deps.primeLoader.getTopicIndex();
      prime = {
        persona: truth.persona,
        purpose: truth.purpose,
        authority: truth.authority,
        directive,
        topicIndex,
      };
    }

    const promptCtx: SystemPromptContext = {
      entity: entityCtx,
      coaFingerprint,
      state,
      capabilities,
      tools: availableTools,
      memories,
      skills,
      devMode: request.devMode,
      workspaceRoot: request.devMode === true ? this.deps.workspaceRoot : undefined,
      projectPaths: request.devMode === true ? this.deps.projectPaths : undefined,
      userContext,
      prime,
      ownerName: this.deps.ownerConfig?.displayName,
      isOwner: request.isOwner,
      projectPath: request.projectContext,
    };

    let systemPrompt = assembleSystemPrompt(promptCtx);

    // BuilderChat mode: prepend the builder system prompt
    if (request.builderMode) {
      try {
        const { readFileSync } = await import("node:fs");
        const { resolve: resolvePath } = await import("node:path");
        const builderPromptPath = resolvePath(process.cwd(), "prompts/builder-chat.md");
        const builderPrompt = readFileSync(builderPromptPath, "utf-8");
        systemPrompt = builderPrompt + "\n\n---\n\n" + systemPrompt;
      } catch { /* proceed without builder prompt */ }
    }

    const systemPromptTokens = estimateTokens(systemPrompt);

    // Assemble history
    const history = this.deps.sessionManager.assembleHistory(
      sKey,
      systemPromptTokens,
    );

    // Check if compaction is needed
    if (history.needsCompaction) {
      // Pre-compaction memory flush: extract key facts before summarization
      if (this.deps.memoryAdapter !== undefined) {
        try {
          const flushResult = await this.apiClient.invoke({
            system: "You are a memory extraction assistant. Extract important facts, decisions, and user preferences from the conversation. Return each fact on a new line, prefixed with '- '. Be concise.",
            messages: history.messages,
            entityId: entity.id,
          });

          if (flushResult.text.trim().length > 0) {
            // Parse lines starting with "- " as individual facts
            const facts = flushResult.text
              .split("\n")
              .map((line) => line.trim())
              .filter((line) => line.startsWith("- "))
              .map((line) => line.slice(2).trim())
              .filter((fact) => fact.length > 0);

            for (const fact of facts) {
              await this.deps.memoryAdapter.store({
                entityId: entity.id,
                content: fact,
                category: "compaction-flush",
                timestamp: new Date().toISOString(),
              });
            }

            this.log.info(
              `pre-compaction flush: saved ${String(facts.length)} facts for entity ${entity.id}`,
            );

            this.emit("memory_flushed", {
              entityId: entity.id,
              factCount: facts.length,
            });
          }
        } catch (err) {
          // Flush failure is non-fatal — proceed with compaction
          this.log.warn(
            `pre-compaction memory flush failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      try {
        await this.deps.sessionManager.compact(
          sKey,
          (text, prompt) => this.apiClient.summarize(text, prompt),
        );

        // Re-assemble history after compaction
        const compactedHistory = this.deps.sessionManager.assembleHistory(
          sKey,
          systemPromptTokens,
        );
        history.messages = compactedHistory.messages;
        history.tokenEstimate = compactedHistory.tokenEstimate;
        history.turnsIncluded = compactedHistory.turnsIncluded;

        this.emit("session_compacted", {
          entityId: entity.id,
          sessionId: session.sessionId,
        });
      } catch (err) {
        // Compaction failure is non-fatal — proceed with full history
        this.emit("compaction_failed", {
          entityId: entity.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // -----------------------------------------------------------------------
    // Step 7: Anthropic API call (with tool loop)
    // -----------------------------------------------------------------------
    try {
      const providerTools = this.deps.toolRegistry.toProviderTools(
        state,
        entity.verificationTier,
      );

      // Build API messages: resolve image refs on ALL history turns so the
      // model can reference screenshots/images from earlier in the conversation.
      // The current turn uses in-memory content blocks (freshest data), while
      // prior turns resolve from the ImageBlobStore on disk.
      const apiMessages: LLMMessage[] = history.messages.map((msg, idx) => {
        const isLastUser = idx === history.messages.length - 1 && msg.role === "user";

        // Current turn: use the in-memory content blocks if they include images
        if (isLastUser && typeof apiContent !== "string") {
          return { role: msg.role, content: apiContent };
        }

        // Prior turns: resolve stored image refs back to content blocks
        if (msg.role === "user" && msg.imageRefs?.length && this.deps.imageBlobStore && request.chatSessionId) {
          const blocks: LLMContentBlock[] = [];
          for (const ref of msg.imageRefs) {
            const blob = this.deps.imageBlobStore.load(request.chatSessionId, ref.imageId);
            if (blob) {
              blocks.push({
                type: "image",
                source: {
                  type: "base64",
                  media_type: blob.mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
                  data: blob.data,
                },
              });
            }
          }
          if (msg.content) {
            blocks.push({ type: "text", text: msg.content });
          }
          return { role: msg.role, content: blocks.length > 0 ? blocks : msg.content };
        }

        return { role: msg.role, content: msg.content };
      });

      const thinkingConfig = { type: "enabled" as const, budget_tokens: 10_000 };

      // Accumulate token usage across all API calls in this invocation
      let totalInputTokens = 0;
      let totalOutputTokens = 0;

      let result = await this.apiClient.invoke({
        system: systemPrompt,
        messages: apiMessages,
        tools: providerTools.length > 0 ? providerTools : undefined,
        entityId: entity.id,
        thinking: thinkingConfig,
      });
      totalInputTokens += result.usage.inputTokens;
      totalOutputTokens += result.usage.outputTokens;

      // Emit thinking blocks from initial invoke
      for (const block of result.thinkingBlocks) {
        this.emit("thought", { sessionKey: sKey, content: block.thinking });
      }

      // Tool use loop — execute tools and continue until no more tool calls
      const toolsUsed: string[] = [];
      let loopCount = 0;
      const maxToolLoops = 15;
      const abortSignal = request.abortSignal;

      // Accumulate messages across tool iterations so the model sees the full
      // conversation history including prior tool calls and their results.
      const accumulatedMessages: LLMMessage[] = [...apiMessages];

      // Circuit breaker: track call hash repetitions to detect infinite loops.
      const toolCallHashes = new Map<string, number>();

      while (result.toolCalls.length > 0 && loopCount < maxToolLoops) {
        // Check for cancellation before each tool iteration
        if (abortSignal?.aborted) {
          return { type: "response", text: "[Cancelled by user]", toolsUsed, coaFingerprint, taskmasterEmissions: [], model: result.model, provider: "cancelled", usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens }, toolCount: toolsUsed.length, loopCount };
        }

        loopCount++;
        const toolResults: LLMToolResult[] = [];

        // Check for repeated tool calls before executing
        let circuitBroken = false;
        for (const toolCall of result.toolCalls) {
          const hash = `${toolCall.name}:${JSON.stringify(toolCall.input ?? {})}`;
          const count = (toolCallHashes.get(hash) ?? 0) + 1;
          toolCallHashes.set(hash, count);
          if (count > 3) {
            this.log.warn(
              `circuit breaker: tool "${toolCall.name}" called with same input ${String(count)} times — breaking loop`,
            );
            circuitBroken = true;
            break;
          }
        }

        if (circuitBroken) {
          // Return an error message instead of continuing the loop
          return {
            type: "error",
            message:
              "Tool loop circuit breaker triggered: the same tool was called with identical inputs more than 3 times. Please rephrase your request.",
          };
        }

        for (let i = 0; i < result.toolCalls.length; i++) {
          const toolCall = result.toolCalls[i]!;

          this.emit("tool_start", {
            sessionKey: sKey,
            toolName: toolCall.name,
            toolIndex: i,
            loopIteration: loopCount,
            toolInput: sanitizeToolInput(toolCall.input ?? {}),
          });

          const execResult = await this.executeToolSafe(
            toolCall,
            entity,
            coaFingerprint,
            state,
          );
          toolsUsed.push(toolCall.name);

          // Merge result data into detail for tools that return structured output (e.g., browser screenshots)
          let detail = extractToolDetail(toolCall.name, toolCall.input ?? {});
          if (toolCall.name === "browser_session" || toolCall.name === "visual_inspect") {
            try {
              const parsed = JSON.parse(execResult.content) as Record<string, unknown>;
              detail = { ...detail, ...parsed };
            } catch { /* non-JSON result */ }
          }

          this.emit("tool_result", {
            sessionKey: sKey,
            toolName: toolCall.name,
            toolIndex: i,
            loopIteration: loopCount,
            success: !execResult.content.startsWith("Error executing tool"),
            summary: FRIENDLY_TOOL_SUMMARY[toolCall.name] ?? (execResult.wasTruncated ? "Done (truncated)" : "Done"),
            resultContent: execResult.content,
            detail,
            toolInput: sanitizeToolInput(toolCall.input ?? {}),
          });

          toolResults.push({
            tool_use_id: toolCall.id,
            content: execResult.content,
          });
        }

        // Continue with the full accumulated conversation.
        // continueWithToolResults appends the current assistant + tool results
        // to original.messages, so accumulatedMessages must contain all PRIOR
        // iterations' turns but NOT the current one.
        const prevContentBlocks = result.contentBlocks;

        // Build tool results user turn content blocks
        const toolResultBlocks: LLMContentBlock[] = toolResults.map((r) => ({
          type: "tool_result" as const,
          tool_use_id: r.tool_use_id,
          content: r.content,
        }));

        // Mid-loop injection: drain any queued user messages and piggyback on the tool results turn
        const injected = this.drainInjections(sKey);
        if (injected.length > 0) {
          for (const injMsg of injected) {
            toolResultBlocks.push({ type: "text" as const, text: `[User interjection]: ${injMsg}` });
          }
          this.emit("injection_received", { sessionKey: sKey, count: injected.length });
        }

        result = await this.apiClient.continueWithToolResults({
          original: {
            system: systemPrompt,
            messages: accumulatedMessages,
            tools: providerTools.length > 0 ? providerTools : undefined,
            entityId: entity.id,
            thinking: thinkingConfig,
          },
          assistantContent: prevContentBlocks,
          toolResults,
        });
        totalInputTokens += result.usage.inputTokens;
        totalOutputTokens += result.usage.outputTokens;

        // Emit thinking blocks from tool continuation
        for (const block of result.thinkingBlocks) {
          this.emit("thought", { sessionKey: sKey, content: block.thinking });
        }

        if (result.text.trim().length > 0 && result.toolCalls.length > 0) {
          this.emit("progress", {
            sessionKey: sKey,
            text: result.text,
            phase: "tool_loop",
          });
        }

        // After the call, append this iteration's turns so the NEXT iteration
        // sees them in accumulatedMessages (including any injected text).
        accumulatedMessages.push(
          { role: "assistant", content: prevContentBlocks },
          { role: "user", content: toolResultBlocks },
        );
      }

      // -----------------------------------------------------------------------
      // Step 7b: Auto-continue — ONLY when the model was genuinely cut off
      // by the output token limit (stop_reason === "max_tokens").
      //
      // Previously this used regex pattern matching on phrases like "let me",
      // "I'll", etc. — but those appear in normal complete responses and
      // caused the actual answer to be swallowed and replaced with a
      // confused continuation response.
      // -----------------------------------------------------------------------
      let autoContinues = 0;
      const maxAutoContinues = 3;

      while (
        autoContinues < maxAutoContinues &&
        loopCount < maxToolLoops &&
        result.stopReason === "max_tokens" &&
        result.toolCalls.length === 0
      ) {
        autoContinues++;
        this.log.info(`auto-continue ${String(autoContinues)}/${String(maxAutoContinues)}: response truncated by max_tokens`);

        // Show the truncated text as a thought so the user can see it
        if (result.text.trim().length > 0) {
          this.emit("thought", {
            sessionKey: sKey,
            content: `[Response truncated — continuing...]\n\n${result.text}`,
          });
        }

        accumulatedMessages.push(
          { role: "assistant", content: result.contentBlocks },
          { role: "user", content: "[SYSTEM:AUTO_CONTINUE] Your response was truncated by the output token limit. Continue from where you left off. Do not repeat what you already said." },
        );

        result = await this.apiClient.invoke({
          system: systemPrompt,
          messages: accumulatedMessages,
          tools: providerTools.length > 0 ? providerTools : undefined,
          entityId: entity.id,
          thinking: thinkingConfig,
        });
        totalInputTokens += result.usage.inputTokens;
        totalOutputTokens += result.usage.outputTokens;

        // Emit thinking blocks from auto-continue
        for (const block of result.thinkingBlocks) {
          this.emit("thought", { sessionKey: sKey, content: block.thinking });
        }

        // If the model now wants tools, enter the tool loop
        while (result.toolCalls.length > 0 && loopCount < maxToolLoops) {
          if (abortSignal?.aborted) {
            return { type: "response", text: "[Cancelled by user]", toolsUsed, coaFingerprint, taskmasterEmissions: [], model: result.model, provider: "cancelled", usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens }, toolCount: toolsUsed.length, loopCount };
          }
          loopCount++;
          const toolResults: LLMToolResult[] = [];

          let circuitBroken = false;
          for (const toolCall of result.toolCalls) {
            const hash = `${toolCall.name}:${JSON.stringify(toolCall.input ?? {})}`;
            const count = (toolCallHashes.get(hash) ?? 0) + 1;
            toolCallHashes.set(hash, count);
            if (count > 3) {
              this.log.warn(`circuit breaker: tool "${toolCall.name}" called with same input ${String(count)} times — breaking loop`);
              circuitBroken = true;
              break;
            }
          }

          if (circuitBroken) break;

          for (let i = 0; i < result.toolCalls.length; i++) {
            const toolCall = result.toolCalls[i]!;
            this.emit("tool_start", { sessionKey: sKey, toolName: toolCall.name, toolIndex: i, loopIteration: loopCount, toolInput: sanitizeToolInput(toolCall.input ?? {}) });
            const execResult = await this.executeToolSafe(toolCall, entity, coaFingerprint, state);
            toolsUsed.push(toolCall.name);
            this.emit("tool_result", {
              sessionKey: sKey,
              toolName: toolCall.name,
              toolIndex: i,
              loopIteration: loopCount,
              success: !execResult.content.startsWith("Error executing tool"),
              summary: FRIENDLY_TOOL_SUMMARY[toolCall.name] ?? (execResult.wasTruncated ? "Done (truncated)" : "Done"),
              resultContent: execResult.content,
              detail: extractToolDetail(toolCall.name, toolCall.input ?? {}),
              toolInput: sanitizeToolInput(toolCall.input ?? {}),
            });
            toolResults.push({ tool_use_id: toolCall.id, content: execResult.content });
          }

          const prevContentBlocks = result.contentBlocks;
          result = await this.apiClient.continueWithToolResults({
            original: { system: systemPrompt, messages: accumulatedMessages, tools: providerTools.length > 0 ? providerTools : undefined, entityId: entity.id, thinking: thinkingConfig },
            assistantContent: prevContentBlocks,
            toolResults,
          });
          totalInputTokens += result.usage.inputTokens;
          totalOutputTokens += result.usage.outputTokens;

          // Emit thinking blocks from auto-continue tool continuation
          for (const block of result.thinkingBlocks) {
            this.emit("thought", { sessionKey: sKey, content: block.thinking });
          }

          if (result.text.trim().length > 0 && result.toolCalls.length > 0) {
            this.emit("progress", { sessionKey: sKey, text: result.text, phase: "tool_loop" });
          }

          const toolResultBlocks: LLMContentBlock[] = toolResults.map((r) => ({
            type: "tool_result" as const,
            tool_use_id: r.tool_use_id,
            content: r.content,
          }));
          accumulatedMessages.push(
            { role: "assistant", content: prevContentBlocks },
            { role: "user", content: toolResultBlocks },
          );
        }
      }

      // -----------------------------------------------------------------------
      // Step 8: COA log: message_out
      // -----------------------------------------------------------------------
      const outboundFingerprint = this.deps.coaLogger.log({
        resourceId: this.deps.resourceId,
        entityId: entity.id,
        entityAlias: entity.coaAlias,
        nodeId: this.deps.nodeId,
        workType: "message_out",
      });

      // -----------------------------------------------------------------------
      // Step 9: TASKMASTER extraction + response cleanup
      // -----------------------------------------------------------------------
      const emissions =
        this.deps.toolRegistry.extractTaskmasterEmissions(result.text);
      const { text: cleanedText, strippedCount } =
        this.deps.toolRegistry.stripTaskmasterEmissions(
          result.text,
          entity.verificationTier,
        );

      if (strippedCount > 0) {
        this.emit("taskmaster_emissions", {
          entityId: entity.id,
          emissions,
          coaFingerprint: outboundFingerprint,
        });
      }

      // Add assistant turn to session
      this.deps.sessionManager.addAssistantTurn(
        sKey,
        result.text, // store full text including q:> lines
        outboundFingerprint,
        toolsUsed.length > 0 ? toolsUsed : undefined,
      );

      this.emit("invocation_complete", {
        entityId: entity.id,
        model: result.model,
        provider: result.model.startsWith("claude") ? "anthropic" : result.model.startsWith("gpt") ? "openai" : "ollama",
        usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
        toolsUsed,
        toolCount: toolsUsed.length,
        loopCount,
        coaFingerprint: outboundFingerprint,
      });

      return {
        type: "response",
        text: cleanedText,
        toolsUsed,
        coaFingerprint: outboundFingerprint,
        taskmasterEmissions: emissions.map((e) => e.description),
        model: result.model,
        provider: result.model.startsWith("claude") ? "anthropic" : result.model.startsWith("gpt") ? "openai" : "ollama",
        usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
        toolCount: toolsUsed.length,
        loopCount,
      };
    } catch (err) {
      this.emit("invocation_error", {
        entityId: entity.id,
        error: err instanceof Error ? err.message : String(err),
      });

      return {
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Tool execution helper
  // ---------------------------------------------------------------------------

  private async executeToolSafe(
    toolCall: LLMToolCall,
    entity: Entity,
    coaChainBase: string,
    state: GatewayState,
  ): Promise<ToolExecutionResult> {
    try {
      return await this.deps.toolRegistry.execute(
        toolCall.name,
        toolCall.input ?? {},
        {
          state,
          tier: entity.verificationTier,
          entityId: entity.id,
          entityAlias: entity.coaAlias,
          coaChainBase,
          resourceId: this.deps.resourceId,
          nodeId: this.deps.nodeId,
        },
      );
    } catch (err) {
      // Return error as tool result rather than crashing the invocation
      return {
        toolName: toolCall.name,
        rawResultBytes: 0,
        deliveredResultBytes: 0,
        wasTruncated: false,
        wasInjectionBlocked: false,
        coaFingerprint: coaChainBase,
        content: `Error executing tool "${toolCall.name}": ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}
