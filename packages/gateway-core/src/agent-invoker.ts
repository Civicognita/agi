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

import type { Entity } from "@agi/entity-model";
import type { COAChainLogger } from "@agi/coa-chain";

import type { GatewayState } from "./types.js";
import type { GatewayStateMachine } from "./state-machine.js";
import type { AgentSessionManager } from "./agent-session.js";
import type { ToolRegistry, ToolExecutionResult } from "./tool-registry.js";
import type { RateLimiter } from "./rate-limiter.js";

import {
  assembleSystemPromptWithBreakdown,
  computeAvailableTools,
  estimateTokens,
} from "./system-prompt.js";
import type { SystemPromptContext, EntityContextSection, RequestType, SystemPromptTokenBreakdown } from "./system-prompt.js";
import { gateInvocation, isHumanCommand } from "./invocation-gate.js";
import { sanitize } from "./sanitizer.js";
import { helpModeFiltersTool, isHelpModeContext } from "./help-mode-config.js";

import type { LLMProvider, LLMToolCall, LLMToolResult, LLMMessage, LLMContentBlock } from "./llm/index.js";
import type { UserContextStore } from "./user-context-store.js";
import type { PrimeLoader } from "./prime-loader.js";
import type { ProjectConfigManager } from "./project-config-manager.js";
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

/**
 * True when the tool executed successfully. Checks two failure signals:
 *   1. Runtime errors prefixed "Error executing tool" (from executeToolSafe wrapper)
 *   2. Structured error returns `{"error":"..."}` from tool handlers themselves —
 *      these don't start with the prefix so the old `startsWith` check missed them,
 *      causing the chat UI to show ✓ even when the tool failed (e.g. CREATE_PLAN
 *      returning an error JSON showed "Plan created ✓" with no file on disk).
 */
function toolSucceeded(content: string): boolean {
  if (content.startsWith("Error executing tool")) return false;
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    if (typeof parsed.error === "string") return false;
  } catch { /* not JSON — treat as success */ }
  return true;
}

// ---------------------------------------------------------------------------
// Request type classification — heuristic-based, zero LLM cost
// ---------------------------------------------------------------------------

const SYSTEM_KEYWORDS = /\b(status|restart|upgrade|doctor|service|container|hosting|deploy|config|podman|caddy|dnsmasq)\b/i;
const KNOWLEDGE_KEYWORDS = /\b(impactiv|impactinomics|mycelium|protocol|lexicon|prime|civicognita|0scale|0stage|hive.id)\b/i;
const TOOL_KEYWORDS = /\b(search|find|create|delete|install|uninstall|list|manage|run|build|start|stop)\b/i;

function classifyRequestType(content: string, projectPath?: string): RequestType {
  if (projectPath) return "project";
  if (SYSTEM_KEYWORDS.test(content)) return "system";
  if (KNOWLEDGE_KEYWORDS.test(content)) return "knowledge";
  return "chat";
}

/**
 * Which Layer 2 context sections `assembleSystemPrompt` includes for a request
 * type. Mirrors the switching logic in system-prompt.ts so the UI can tell
 * operators what Aion actually saw.
 */
function deriveContextLayers(requestType: string): string[] {
  const layers = ["identity"];
  switch (requestType) {
    case "project":
      layers.push("project", "workspace");
      break;
    case "entity":
      layers.push("entity", "coa");
      break;
    case "knowledge":
      layers.push("knowledge-index");
      break;
    case "system":
      layers.push("state", "hosting");
      break;
    case "worker":
      layers.push("worker-task");
      break;
    case "taskmaster":
      layers.push("taskmaster", "worker-catalog");
      break;
    case "chat":
    default:
      break;
  }
  return layers;
}

/**
 * Decide whether the upcoming LLM call should be given the tool list.
 * Exported for unit testing — see agent-invoker-tools.test.ts.
 *
 * Returns true when:
 *   - requestType is "system" or "project" (always tool-eligible by category), OR
 *   - the user message contains an action verb from TOOL_KEYWORDS, regardless
 *     of requestType (so action-verb chats reach tools — fixes s101 t361).
 *
 * Returns false otherwise (chitchat without action verbs stays cheap).
 */
export function shouldOfferTools(content: string, requestType: RequestType): boolean {
  // System + project requests always get tools — they exist to act on infrastructure.
  if (requestType === "system") return true;
  if (requestType === "project") return true;
  // Action-verb prompts get tools regardless of requestType — including "chat"
  // requests like "list files in /tmp", "search the docs for X", "delete this".
  // Pre-2026-04-25 the chat short-circuit ran before this check, so action-verb
  // chats silently dropped tools (s101 t361). Reordered: TOOL_KEYWORDS first.
  if (TOOL_KEYWORDS.test(content)) return true;
  // Default: chat without action verbs gets no tools — keeps chitchat cheap +
  // prevents the model from inventing unsolicited tool calls.
  return false;
}

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
  skillRegistry?: { getAll(): Array<{ definition: { name: string; description: string; domain: string; content: string; triggers: string[]; compiledTriggers: RegExp[]; requiresState?: string[]; requiresTier?: string; priority: number } }>; getValid(): Array<{ definition: { name: string; description: string; domain: string; content: string; triggers: string[]; compiledTriggers: RegExp[]; requiresState?: string[]; requiresTier?: string; priority: number } }> };
  /** Optional per-entity relationship context store (USER.md files). */
  userContextStore?: UserContextStore;
  /** Optional PRIME knowledge loader — loads corpus for system prompt injection. */
  primeLoader?: PrimeLoader;
  /** Optional project config manager — read at invocation time so iterative-work
   *  mode + other per-project flags can shape prompt assembly. Null when
   *  invoker is run without project context (e.g. entity-only requests). */
  projectConfigManager?: ProjectConfigManager;
  /** s152 t651 — UserNotes store. When wired, the invoker reads up to N
   *  notes for the active project (and global notes) and injects them
   *  into the system-prompt's project-context section so Aion sees what
   *  the owner wrote. Null in tests / non-project paths. */
  notesStore?: import("./notes-store.js").NotesStore;
  /** s152 t651 — alpha-stage owner entity id used to scope note reads. Defaults
   *  to `~$U0`; the same constant the notes-api uses. Hive-ID multi-user
   *  later replaces this with a per-session resolution. */
  notesOwnerEntityId?: string;
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
  /** Returns the configured per-turn tool-loop cap (0 = uncapped). Called per
   *  turn so config hot-reload takes effect. Defaults to uncapped. */
  getMaxToolLoops?: () => number;
  /** Returns the active router cost mode for this turn. Read live so a Settings
   *  toggle (Cloud → Local) takes effect on the next message without restart.
   *  When the result is `"local"`, the system prompt assembler trims sections
   *  small models can't usefully consume (Taskmaster, plan workflow, etc.). */
  getCostMode?: () => string;
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
  /**
   * s137 t532 Phase 2 — when this string starts with `help:`, load the
   * help-mode system prompt + restrict tools to the read-only allowlist.
   * Mirrors the dashboard's `chatContext` (set when the user clicks the
   * `?` icon in the header).
   */
  helpContext?: string;
  /** Pre-saved image references for this invocation (from ImageBlobStore). */
  imageRefs?: import("./agent-session.js").ImageRef[];
  /** Chat session ID used for image blob resolution. */
  chatSessionId?: string;
  /** Abort signal — when triggered, the invocation stops at the next checkpoint. */
  abortSignal?: AbortSignal;
}

export type InvocationOutcome =
  | { type: "response"; text: string; toolsUsed: string[]; coaFingerprint: string; taskmasterEmissions: string[]; model: string; provider: string; usage: { inputTokens: number; outputTokens: number }; toolCount: number; loopCount: number; routingMeta?: { costMode: string; complexity: string; selectedModel: string; selectedProvider: string; escalated: boolean; reason: string; requestType?: string; classifierUsed?: "heuristic" | "aion-micro"; contextLayers?: string[]; tokenBreakdown?: SystemPromptTokenBreakdown } }
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

  /** Set of session keys with an in-flight process() call. Used by server.ts
   *  to decide whether a taskmaster-completion injection should kick off an
   *  autonomous follow-up turn (idle) or just queue for the active loop to
   *  drain (busy). */
  private readonly activeSessions = new Set<string>();

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

  /** Peek at injection queue size without draining. Returns true if pending messages exist. */
  hasPendingInjections(sessionKey: string): boolean {
    const queue = this.injectionQueues.get(sessionKey);
    return queue !== undefined && queue.length > 0;
  }

  /** True when a process() call is in flight for this sessionKey — callers
   *  (e.g. the TaskMaster runtime:event handler) use this to decide whether
   *  to kick off an autonomous follow-up turn or let the active loop drain
   *  the injection on its own. */
  isBusy(sessionKey: string): boolean {
    return this.activeSessions.has(sessionKey);
  }

  /**
   * Process an inbound message through the full invocation pipeline.
   *
   * This is the main entry point called by the QueueConsumer's onInbound
   * callback (replacing AgentBridge.notify for autonomous operation).
   */
  async process(request: InvocationRequest): Promise<InvocationOutcome> {
    const sKey = request.sessionKey ?? request.entity.id;

    // Track this session as busy so the TaskMaster runtime:event handler can
    // tell whether a completion-note injection should kick off an autonomous
    // follow-up turn (session idle) or piggyback on the active loop.
    this.activeSessions.add(sKey);
    try {
      return await this.processInner(request, sKey);
    } finally {
      this.activeSessions.delete(sKey);
    }
  }

  private async processInner(request: InvocationRequest, sKey: string): Promise<InvocationOutcome> {
    const { entity, channel, content, coaFingerprint } = request;

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

    // Resolve project category once — used for both the tool gate (ops-mode
    // tools surface only on ops/admin projects) and the iterativeWork hot-load
    // below. Read at use time per `feedback_hot_config`.
    const projectConfigForTurn = (request.projectContext !== undefined && this.deps.projectConfigManager !== undefined)
      ? this.deps.projectConfigManager.read(request.projectContext)
      : null;
    const projectCategory = (projectConfigForTurn as { category?: string } | null | undefined)?.category;

    const availableToolsBase = computeAvailableTools(
      state,
      entity.verificationTier,
      this.deps.toolRegistry.getManifests(),
      projectCategory,
    );
    // s137 t532 Phase 2 — when invocation is help-mode, drop tools that
    // would mutate state. helpModeFiltersTool defaults to deny so the
    // budget naturally tightens as new tools are added.
    const helpMode = isHelpModeContext(request.helpContext);
    const availableTools = helpMode
      ? availableToolsBase.filter((t) => !helpModeFiltersTool(t.name))
      : availableToolsBase;

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

    // Inject matched skills — match user input against skill triggers
    let skills: Array<{ name: string; description: string; content: string }> | undefined;
    if (this.deps.skillRegistry !== undefined) {
      const validSkills = this.deps.skillRegistry.getValid();
      const matched: Array<{ definition: typeof validSkills[number]["definition"]; confidence: number }> = [];
      const inputText = typeof content === "string" ? content : JSON.stringify(content);

      for (const registered of validSkills) {
        const def = registered.definition;
        // Filter by gateway state
        if (def.requiresState !== undefined && def.requiresState.length > 0) {
          if (!def.requiresState.includes(state)) continue;
        }
        // Check trigger patterns against user message
        for (const regex of def.compiledTriggers) {
          if (regex.test(inputText)) {
            matched.push({ definition: def, confidence: 1.0 });
            break;
          }
        }
      }

      // Sort by priority descending
      matched.sort((a, b) => b.definition.priority - a.definition.priority);

      // Limit to top 5 matched skills to stay within token budget
      const topSkills = matched.slice(0, 5);
      if (topSkills.length > 0) {
        skills = topSkills.map((s) => ({
          name: s.definition.name,
          description: s.definition.description,
          content: s.definition.content,
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

    const sanitizedText = typeof sanitized.content === "string" ? sanitized.content : "";
    const requestType = classifyRequestType(sanitizedText, request.projectContext);
    // Decide whether tools will be offered on the upcoming LLM call. The same
    // decision is reused at the API call site (line ~647) and threaded into
    // the system prompt so the assembler can drop the full tool list when
    // it would be unused — the model otherwise sees ~1.5–2.5k tokens of
    // tools it cannot actually call.
    const willOfferTools = shouldOfferTools(sanitizedText, requestType) && availableTools.length > 0;

    // Iterative-work mode — when the project opts in via
    // `iterativeWork.enabled: true`, hot-load agi/prompts/iterative-work.md so
    // Aion participates in the tynn workflow on this turn. Read at use time
    // (per `feedback_hot_config`); errors are swallowed so a missing prompt
    // file never breaks invocation.
    let iterativeWorkPrompt: string | undefined;
    if (
      requestType === "project" &&
      projectConfigForTurn?.iterativeWork?.enabled === true
    ) {
      try {
        const { readFileSync } = await import("node:fs");
        const { resolve: resolvePath } = await import("node:path");
        iterativeWorkPrompt = readFileSync(
          resolvePath(process.cwd(), "prompts/iterative-work.md"),
          "utf-8",
        );
      } catch { /* iterative-work.md missing — proceed without injection */ }
    }

    // s152 t651 — read UserNotes for the active project + global notes,
    // inject into prompt context so Aion sees what the owner wrote.
    // Cap at top-N (pinned + most-recently-updated) to keep prompt size
    // bounded; full search is available via the `notes` agent tool.
    let projectNotes: SystemPromptContext["projectNotes"];
    if (
      this.deps.notesStore !== undefined
      && request.projectContext !== undefined
      && request.projectContext.length > 0
    ) {
      try {
        const ownerId = this.deps.notesOwnerEntityId ?? "~$U0";
        const [perProject, global] = await Promise.all([
          this.deps.notesStore.list(ownerId, request.projectContext),
          this.deps.notesStore.list(ownerId, null),
        ]);
        const NOTES_INJECTED_CAP = 6;
        // Order: per-project pinned, per-project recent, global pinned, global recent.
        const ordered = [
          ...perProject.filter((n) => n.pinned),
          ...perProject.filter((n) => !n.pinned),
          ...global.filter((n) => n.pinned),
          ...global.filter((n) => !n.pinned),
        ].slice(0, NOTES_INJECTED_CAP);
        projectNotes = ordered.map((n) => ({
          title: n.title,
          body: n.body,
          kind: n.kind,
          pinned: n.pinned,
          updatedAt: n.updatedAt,
          scope: n.projectPath === null ? "global" as const : "project" as const,
        }));
      } catch (err) {
        // Notes injection is best-effort — never block the agent if the DB
        // hiccups. The notes tool surface still works.
        this.log.warn(`notes injection failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
      }
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
      projectCategory,
      requestType,
      costMode: this.deps.getCostMode?.(),
      toolsAvailable: willOfferTools,
      iterativeWorkPrompt,
      ...(projectNotes !== undefined ? { projectNotes } : {}),
    };

    const { prompt: baseSystemPrompt, breakdown: promptBreakdown } = assembleSystemPromptWithBreakdown(promptCtx);
    let systemPrompt = baseSystemPrompt;

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

    // s137 t532 Phase 2 — help-mode prompt prepended for `help:<page>`
    // contexts (mirrors builderMode shape; both can in principle compose
    // but help-mode restricts the tool budget more aggressively, which
    // wins per `helpModeFiltersTool`).
    if (helpMode) {
      try {
        const { readFileSync } = await import("node:fs");
        const { resolve: resolvePath } = await import("node:path");
        const helpPromptPath = resolvePath(process.cwd(), "prompts/help-mode.md");
        const helpPrompt = readFileSync(helpPromptPath, "utf-8");
        const pageContext = (request.helpContext as string).slice("help:".length);
        const contextNote = pageContext
          ? `\n\n## Current page\n\nThe user is asking about: \`${pageContext}\`\n`
          : "";
        systemPrompt = helpPrompt + contextNote + "\n\n---\n\n" + systemPrompt;
      } catch { /* proceed without help-mode prompt */ }
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
        projectCategory,
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

      // Reuse the willOfferTools decision computed before prompt assembly so
      // the prompt and the API call agree on whether tools are active. We
      // re-AND with `providerTools.length > 0` as a defensive guard — these
      // are derived from the same state/tier as `availableTools` so the
      // result should already match.
      const useTools = willOfferTools && providerTools.length > 0;

      // Accumulate token usage across all API calls in this invocation
      let totalInputTokens = 0;
      let totalOutputTokens = 0;

      let result: Awaited<ReturnType<typeof this.apiClient.invoke>>;
      try {
        result = await this.apiClient.invoke({
          system: systemPrompt,
          messages: apiMessages,
          tools: useTools ? providerTools : undefined,
          entityId: entity.id,
        });
      } catch (firstErr) {
        // Retry once on connection errors (Ollama idle unload, transient failures)
        const msg = firstErr instanceof Error ? firstErr.message : String(firstErr);
        if (msg.includes("ECONNREFUSED") || msg.includes("fetch failed") || msg.includes("connection")) {
          await new Promise((r) => setTimeout(r, 2_000));
          result = await this.apiClient.invoke({
            system: systemPrompt,
            messages: apiMessages,
            tools: useTools ? providerTools : undefined,
            entityId: entity.id,
          });
        } else {
          throw firstErr;
        }
      }
      totalInputTokens += result.usage.inputTokens;
      totalOutputTokens += result.usage.outputTokens;

      // Emit thinking blocks from initial invoke
      for (const block of result.thinkingBlocks) {
        this.emit("thought", { sessionKey: sKey, content: block.thinking });
      }

      // Tool use loop — execute tools and continue until no more tool calls
      const toolsUsed: string[] = [];
      let loopCount = 0;
      // No hard cap on tool-loop iterations by default. The circuit breaker
      // below hard-aborts on duplicate tool calls (same tool + same input
      // more than 3 times), which eliminates the only scenario a cap would
      // genuinely protect against (runaway infinite loop). Owners who want
      // a cost ceiling can set gateway.maxToolLoops via the dashboard's
      // Gateway > General settings. 0 = uncapped.
      const configuredCap = this.deps.getMaxToolLoops?.() ?? 0;
      const maxToolLoops = configuredCap > 0 ? configuredCap : Number.MAX_SAFE_INTEGER;
      const abortSignal = request.abortSignal;

      // Accumulate messages across tool iterations so the model sees the full
      // conversation history including prior tool calls and their results.
      const accumulatedMessages: LLMMessage[] = [...apiMessages];

      // Circuit breaker: track call hash repetitions to detect infinite loops.
      const toolCallHashes = new Map<string, number>();

      // Outer continuation loop: re-enters the inner tool loop after draining any pending
      // user injections so that a mid-run message lands on the SAME run rather than being
      // deferred to a post-run follow-up.
      injectionContinuation: while (loopCount < maxToolLoops) {
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
            sKey,
            request.chatSessionId,
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
            success: toolSucceeded(execResult.content),
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
          this.emit("injection_consumed", { sessionKey: sKey, count: injected.length });
        }

        result = await this.apiClient.continueWithToolResults({
          original: {
            system: systemPrompt,
            messages: accumulatedMessages,
            tools: providerTools.length > 0 ? providerTools : undefined,
            entityId: entity.id,
            
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

        // Intermediate assistant narration — the model's "now I'll do Y" prose
        // that Anthropic includes BEFORE the next batch of tool_use blocks.
        // Emit it as a thought so it becomes a persistent message in the chat,
        // not an ephemeral progress pill. Without this, the user sees several
        // tool-call rounds with NO narration between them, because Anthropic
        // often returns zero thinking blocks on continuation calls even when
        // extended thinking is enabled — the narration text is all we get.
        if (result.text.trim().length > 0 && result.toolCalls.length > 0) {
          this.emit("thought", { sessionKey: sKey, content: result.text });
        }

        // After the call, append this iteration's turns so the NEXT iteration
        // sees them in accumulatedMessages (including any injected text).
        accumulatedMessages.push(
          { role: "assistant", content: prevContentBlocks },
          { role: "user", content: toolResultBlocks },
        );
      }

      // Inner tool loop exited. If the user has queued injections while the model was
      // finalizing, treat them as a fresh user turn and re-invoke so the injection is
      // reflected IN THIS RUN rather than creating a post-run follow-up.
      if (
        result.toolCalls.length === 0
        && this.hasPendingInjections(sKey)
        && loopCount < maxToolLoops
      ) {
        if (abortSignal?.aborted) {
          return { type: "response", text: "[Cancelled by user]", toolsUsed, coaFingerprint, taskmasterEmissions: [], model: result.model, provider: "cancelled", usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens }, toolCount: toolsUsed.length, loopCount };
        }
        loopCount++;
        const injected = this.drainInjections(sKey);
        const userText = injected.map((t) => `[User interjection]: ${t}`).join("\n\n");

        accumulatedMessages.push(
          { role: "assistant", content: result.contentBlocks },
          { role: "user", content: userText },
        );

        result = await this.apiClient.invoke({
          system: systemPrompt,
          messages: accumulatedMessages,
          tools: providerTools.length > 0 ? providerTools : undefined,
          entityId: entity.id,
          
        });
        totalInputTokens += result.usage.inputTokens;
        totalOutputTokens += result.usage.outputTokens;

        for (const block of result.thinkingBlocks) {
          this.emit("thought", { sessionKey: sKey, content: block.thinking });
        }
        this.emit("injection_consumed", { sessionKey: sKey, count: injected.length });

        // Re-enter the outer continuation loop — if `result` has tool calls, the inner
        // while will pick them up again; otherwise we fall through and break out.
        continue injectionContinuation;
      }

      break injectionContinuation;
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
            const execResult = await this.executeToolSafe(toolCall, entity, coaFingerprint, state, sKey, request.chatSessionId);
            toolsUsed.push(toolCall.name);
            // Merge result data into detail for tools that return structured output
            let acDetail = extractToolDetail(toolCall.name, toolCall.input ?? {});
            if (toolCall.name === "browser_session" || toolCall.name === "visual_inspect") {
              try {
                const parsed = JSON.parse(execResult.content) as Record<string, unknown>;
                acDetail = { ...acDetail, ...parsed };
              } catch { /* non-JSON result */ }
            }

            this.emit("tool_result", {
              sessionKey: sKey,
              toolName: toolCall.name,
              toolIndex: i,
              loopIteration: loopCount,
              success: toolSucceeded(execResult.content),
              summary: FRIENDLY_TOOL_SUMMARY[toolCall.name] ?? (execResult.wasTruncated ? "Done (truncated)" : "Done"),
              resultContent: execResult.content,
              detail: acDetail,
              toolInput: sanitizeToolInput(toolCall.input ?? {}),
            });
            toolResults.push({ tool_use_id: toolCall.id, content: execResult.content });
          }

          const prevContentBlocks = result.contentBlocks;
          result = await this.apiClient.continueWithToolResults({
            original: { system: systemPrompt, messages: accumulatedMessages, tools: providerTools.length > 0 ? providerTools : undefined, entityId: entity.id,  },
            assistantContent: prevContentBlocks,
            toolResults,
          });
          totalInputTokens += result.usage.inputTokens;
          totalOutputTokens += result.usage.outputTokens;

          // Emit thinking blocks from auto-continue tool continuation
          for (const block of result.thinkingBlocks) {
            this.emit("thought", { sessionKey: sKey, content: block.thinking });
          }

          // Same treatment as the main tool loop: persist intermediate
          // narration as a thought bubble, not an ephemeral progress pill.
          if (result.text.trim().length > 0 && result.toolCalls.length > 0) {
            this.emit("thought", { sessionKey: sKey, content: result.text });
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
      const outboundFingerprint = await this.deps.coaLogger.log({
        resourceId: this.deps.resourceId,
        entityId: entity.id,
        entityAlias: entity.coaAlias,
        nodeId: this.deps.nodeId,
        workType: "message_out",
      });

      // -----------------------------------------------------------------------
      // Step 9: TASKMASTER extraction + response cleanup
      // -----------------------------------------------------------------------
      // If we exited the tool loop because we hit the maxToolLoops cap AND the
      // model still wanted to call more tools, the user's getting a truncated
      // turn. Tell them explicitly so they don't see a half-sentence "Let me
      // fix that:" with no follow-up and think the chat is broken.
      let finalText = result.text;
      if (loopCount >= maxToolLoops && result.toolCalls.length > 0) {
        finalText =
          (finalText.trim().length > 0 ? `${finalText}\n\n---\n` : "") +
          `**\u26a0 Reached the maximum of ${String(maxToolLoops)} tool iterations for this turn.** ` +
          `I was about to take another action but stopped here to avoid runaway execution. ` +
          `Send a follow-up message (e.g. "continue") to pick up where I left off.`;
        this.log.warn(
          `agent hit maxToolLoops=${String(maxToolLoops)} for session ${sKey}; surfacing cap message to user`,
        );
      }

      const emissions =
        this.deps.toolRegistry.extractTaskmasterEmissions(finalText);
      const { text: cleanedText, strippedCount } =
        this.deps.toolRegistry.stripTaskmasterEmissions(
          finalText,
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
        provider: typeof result.model === "string" && result.model.startsWith("claude") ? "anthropic" : typeof result.model === "string" && result.model.startsWith("gpt") ? "openai" : "ollama",
        usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
        toolsUsed,
        toolCount: toolsUsed.length,
        loopCount,
        coaFingerprint: outboundFingerprint,
      });

      const historyTokens = history.tokenEstimate;
      const enrichedRoutingMeta = result.routingMeta
        ? {
            ...result.routingMeta,
            requestType: promptCtx.requestType,
            classifierUsed: "heuristic" as const,
            contextLayers: deriveContextLayers(promptCtx.requestType ?? "chat"),
            tokenBreakdown: {
              ...promptBreakdown,
              history: historyTokens,
              response: totalOutputTokens,
            },
          }
        : undefined;

      return {
        type: "response",
        text: cleanedText,
        toolsUsed,
        coaFingerprint: outboundFingerprint,
        taskmasterEmissions: emissions.map((e) => e.description),
        model: result.model,
        provider: typeof result.model === "string" && result.model.startsWith("claude") ? "anthropic" : typeof result.model === "string" && result.model.startsWith("gpt") ? "openai" : "ollama",
        usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
        toolCount: toolsUsed.length,
        loopCount,
        routingMeta: enrichedRoutingMeta,
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const isBillingError =
        errMsg.includes("credit balance") ||
        errMsg.includes("insufficient_quota") ||
        errMsg.includes("exceeded your current quota");
      const isAuthError =
        errMsg.includes("401") ||
        errMsg.includes("invalid_x_api_key");

      this.emit("invocation_error", {
        entityId: entity.id,
        error: errMsg,
      });

      if (isBillingError) {
        return {
          type: "response",
          text: "Your API credit balance is too low. Please add credits at your provider's billing page, or switch to a different provider in Settings > Providers.",
          toolsUsed: [],
          coaFingerprint: "",
          taskmasterEmissions: [],
          model: "unknown",
          provider: "unknown",
          usage: { inputTokens: 0, outputTokens: 0 },
          toolCount: 0,
          loopCount: 0,
        };
      }

      if (isAuthError) {
        return {
          type: "response",
          text: "API authentication failed. Please check your API key in Settings > Providers.",
          toolsUsed: [],
          coaFingerprint: "",
          taskmasterEmissions: [],
          model: "unknown",
          provider: "unknown",
          usage: { inputTokens: 0, outputTokens: 0 },
          toolCount: 0,
          loopCount: 0,
        };
      }

      return {
        type: "error",
        message: errMsg,
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
    sessionKey?: string,
    chatSessionId?: string,
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
          sessionKey,
          chatSessionId,
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
