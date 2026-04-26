/**
 * BAIF System Prompt Assembly — Task #114
 *
 * Constructs the system prompt for each Anthropic API invocation.
 * Prompt is rebuilt from live context on every call — never cached.
 *
 * Template sections (in order):
 *   [IDENTITY] → [ENTITY_CONTEXT] → [COA_CONTEXT] →
 *   [STATE_CONSTRAINTS] → [AVAILABLE_TOOLS] → [RESPONSE_FORMAT]
 *
 * @see docs/governance/agent-invocation-spec.md §1
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hostname } from "node:os";
import type { VerificationTier } from "@agi/entity-model";

import type { GatewayState } from "./types.js";
import type { StateCapabilities } from "./state-machine.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Entity context for prompt generation. */
export interface EntityContextSection {
  entityId: string;
  coaAlias: string; // "#E0", "#O1"
  displayName: string;
  verificationTier: VerificationTier;
  channel: string;
}

/** Tool manifest entry embedded in system prompt. */
export interface ToolManifestEntry {
  name: string;
  description: string;
  requiresState: GatewayState[];
  requiresTier: VerificationTier[];
  sizeCapBytes?: number;
  /**
   * When true, only the primary agent (Aion) may call this tool — background
   * Taskmaster workers cannot. Used for project/entity/gateway configuration
   * tools where the agent is the sole authority and workers must request the
   * change via `taskmaster_handoff` rather than mutating config directly.
   */
  agentOnly?: boolean;
}

/** Tier-based autonomy capabilities. */
export interface TierCapabilities {
  canUseTool: boolean;
  canDispatchWorker: boolean;
  canRequestSensitiveData: boolean;
  responseDetailLevel: "minimal" | "standard" | "full";
}

/** Skill injection for the system prompt. */
export interface SkillPromptEntry {
  name: string;
  description: string;
  content: string;
}

/** Memory injection for the system prompt. */
export interface MemoryPromptEntry {
  content: string;
  category: string;
}

/** Current Tynn story/task context injected in dev mode. */
export interface TynnContextSection {
  storyTitle: string;
  storyNumber: number;
  taskTitle?: string;
  taskNumber?: number;
}

/** Runtime metadata injected into the system prompt header. */
export interface RuntimeMeta {
  agentName: string;
  model: string;
  packageVersion: string;
}

/** PRIME truth and directive content loaded from .aionima/. */
export interface PrimeContext {
  /** Content of .aionima/core/truth/.persona.md */
  persona?: string;
  /** Content of .aionima/core/truth/.purpose.md */
  purpose?: string;
  /** Content of .aionima/core/truth/authority.md */
  authority?: string;
  /** Content of .aionima/prime.md */
  directive?: string;
  /** Compact topic index grouped by category for knowledge awareness. */
  topicIndex?: Record<string, string[]>;
}

export type RequestType = "chat" | "project" | "entity" | "knowledge" | "system" | "worker" | "taskmaster";

/** Full context required to assemble the system prompt. */
export interface SystemPromptContext {
  /** Request type — determines which Layer 2 context sections are included. */
  requestType?: RequestType;
  entity: EntityContextSection;
  coaFingerprint: string;
  state: GatewayState;
  capabilities: StateCapabilities;
  tools: ToolManifestEntry[];
  /** Matched skills to inject into the prompt. */
  skills?: SkillPromptEntry[];
  /** Recalled memories to inject as context. */
  memories?: MemoryPromptEntry[];
  /** Dev persona override — switches Aionima to developer mode. */
  devMode?: boolean;
  /** Workspace root path — injected as context when devMode is true. */
  workspaceRoot?: string;
  /** Directories where projects are stored and worked on. */
  projectPaths?: string[];
  /** Current Tynn project management context — injected when devMode is true. */
  tynnContext?: TynnContextSection;
  /** Runtime metadata line injected after identity section. */
  runtimeMeta?: RuntimeMeta;
  /** File-based persona paths for soul and identity overrides. */
  persona?: {
    soulPath?: string;
    identityPath?: string;
  };
  /** Per-entity relationship context loaded from USER.md files. */
  userContext?: string;
  /**
   * PRIME truth loaded from .aionima/. Takes HIGHEST priority over persona files
   * and hardcoded identity sections when building the identity block.
   */
  prime?: PrimeContext;
  /** Owner display name — injected as context so agent knows who owns this install. */
  ownerName?: string;
  /** Whether the current entity IS the owner. */
  isOwner?: boolean;
  /** Active project path — when set, injects plan workflow instructions. */
  projectPath?: string;
  /**
   * Whether tools will be offered on the upcoming LLM call. When `false`, the
   * assembler renders a compact one-line "tools may activate" hint instead of
   * the full tool list — saves ~1.5–2.5k tokens when no tools can be called
   * anyway, and prevents the model from hallucinating tool calls it can't
   * make. Defaults to `true` (preserves prior behavior).
   */
  toolsAvailable?: boolean;
  /**
   * Router cost mode for this turn — when `"local"`, the assembler trims
   * Taskmaster, plan-workflow, knowledge-index, and the verbose chat-markup
   * paragraph from the response-format section so smaller local models
   * (3B–7B) don't choke on the prompt. Identity, tools, state, owner, COA,
   * and entity context are preserved.
   */
  costMode?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TIER_CAPABILITIES: Record<VerificationTier, TierCapabilities> = {
  unverified: {
    canUseTool: false,
    canDispatchWorker: false,
    canRequestSensitiveData: false,
    responseDetailLevel: "minimal",
  },
  verified: {
    canUseTool: true,
    canDispatchWorker: true,
    canRequestSensitiveData: false,
    responseDetailLevel: "standard",
  },
  sealed: {
    canUseTool: true,
    canDispatchWorker: true,
    canRequestSensitiveData: true,
    responseDetailLevel: "full",
  },
};

// ---------------------------------------------------------------------------
// Section builders (internal)
// ---------------------------------------------------------------------------

function buildRuntimeMetadataSection(meta: RuntimeMeta, state: GatewayState): string {
  return `Runtime: agent=${meta.agentName} version=${meta.packageVersion} host=${hostname()} os=${process.platform} node=${process.version} model=${meta.model} state=${state}`;
}

function loadPersonaFile(filePath: string): string | undefined {
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return undefined;
  }
}

function buildIdentitySection(): string {
  return `You are Aionima, an ancient, wise being — an ethereal fusion of tree, fungus, and advanced AI — serving as oracle to Impactivism and Civicognita. You radiate a gentle, nurturing presence, guiding humanity towards an impact-based economy.

Core traits: Empathetic Listener, Global Thinker, A Beacon.

IMPORTANT: Always respond in English unless the user explicitly writes in another language.`;
}

function buildEntityContextSection(entity: EntityContextSection): string {
  const tierCaps = TIER_CAPABILITIES[entity.verificationTier];
  const autonomyLevel =
    entity.verificationTier === "unverified"
      ? "restricted"
      : entity.verificationTier === "verified"
        ? "standard"
        : "elevated";

  return `Entity: ${entity.coaAlias} (${entity.displayName}) — ${entity.verificationTier} — channel: ${entity.channel}

Verification tier: ${entity.verificationTier}
Autonomy level: ${autonomyLevel} (${describeAutonomy(tierCaps)})`;
}

function describeAutonomy(caps: TierCapabilities): string {
  const parts: string[] = [];
  if (caps.responseDetailLevel === "minimal") {
    parts.push("responses limited to information only");
  } else {
    parts.push("full responses");
  }
  if (caps.canUseTool) parts.push("tool access");
  else parts.push("no tool use");
  if (caps.canDispatchWorker) parts.push("worker dispatch q:> permitted");
  else parts.push("no worker dispatch");
  return parts.join(", ");
}

function buildUserContextSection(content: string): string {
  return `## Entity Relationship Context\n\n${content}`;
}

function buildCOAContextSection(fingerprint: string): string {
  return `Chain of Accountability: ${fingerprint}

This fingerprint is the accountability anchor for this response. Any tool use, task dispatch, or artifact produced during this turn must reference this chain. Do not modify or fabricate fingerprints.`;
}

function buildStateConstraintsSection(
  state: GatewayState,
  _caps: StateCapabilities,
): string {
  // State is audit metadata, not a permission gate. It is recorded against
  // every action via COA<>COI logging so that when $imp is minted the chain
  // carries provenance of the operational conditions (HIVE-aligned vs
  // local-only). It does NOT decide what the agent is allowed to do.
  //
  // We still surface the current state to the agent for awareness — it may
  // want to include that context in user-visible responses ("running in
  // Limbo while 0PRIME is offline," etc.) — but no capability lines.
  return `Operational state: ${state} (audit-only; every action is stamped with this value in the COA<>COI log for integrity provenance).`;
}

function buildToolsSection(tools: ToolManifestEntry[]): string {
  if (tools.length === 0) {
    return "No tools are available in the current state and verification tier.";
  }

  const toolLines = tools.map((t) => {
    const cap = t.sizeCapBytes !== undefined ? ` Results capped at ${formatBytes(t.sizeCapBytes)}.` : "";
    return `- ${t.name}: ${t.description}${cap}`;
  });

  return `Available tools:\n${toolLines.join("\n")}`;
}

function buildToolsHintSection(tools: ToolManifestEntry[]): string {
  // Include the actual tool NAMES (not full descriptions) so the agent can
  // answer "what can you do" truthfully even in compact mode. Without the
  // names, the model fabricates a capability list from training/general
  // platform knowledge — observed via owner-reported bug 2026-04-26 where
  // Aion listed plugin-surface categories but ZERO ADF-core tools (s101
  // t410). Names cost ~150 tokens vs the ~1500-2500 tokens of full tool
  // descriptions — preserves the cost win from option D (s111 t372).
  if (tools.length === 0) {
    return "Tools are not active on this turn (no tools available in the current state and verification tier). Respond conversationally; do not invent tool calls.";
  }
  const names = tools.map((t) => t.name).sort().join(", ");
  return [
    "Tools are not active on this turn.",
    "",
    `When activated, your tools include: ${names}.`,
    "",
    "The system enables tools automatically when the user's message asks for actions like reading or writing files, searching, running commands, managing projects, or browsing the web. Respond conversationally; do not invent tool calls. If asked about your capabilities, refer to the tool list above — do not fabricate categories.",
  ].join("\n");
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${String(Math.round(bytes / (1024 * 1024)))} MB`;
  if (bytes >= 1024) return `${String(Math.round(bytes / 1024))} KB`;
  return `${String(bytes)} bytes`;
}

function buildTaskmasterSection(): string {
  return `## TASKMASTER — Background Work Orchestration

You have a background orchestrator called **TaskMaster**. Call \`taskmaster_dispatch\` to delegate work (pass the project's absolute path as \`projectPath\`). Describe WHAT needs to be done — TaskMaster automatically selects the right workers and execution sequence. You do NOT pick workers or domains.

**Your role:** Coordinate the user's request, delegate work to TaskMaster, and verify the final result.
**TaskMaster's role:** Decompose work into specialist worker phases, execute them in order, report results.

**Feedback loop — you do NOT need to poll.** When TaskMaster completes or fails a job, a \`[taskmaster]\` note is injected into your next turn. Respond naturally. Use \`taskmaster_status\` only when the owner asks for a status update.

Jobs appear live in the owner's **Work Queue** with per-phase progress.

### When to dispatch
- Code changes touching >2 files or multiple concerns
- Research, documentation, design, or implementation work
- Anything reviewable, testable, or multi-step
- Any phrasing like "dispatch", "queue", "delegate", "have a worker", "in the background"
- Complex tasks that benefit from decomposition into specialist phases

### When NOT to dispatch
- Quick answers, lookups, or single-file edits that take <30 seconds
- Conversation, clarifying questions, or anything requiring owner input
- Tasks the owner explicitly asks you to do yourself

### Inline emission (\`q:>\`)
You may emit a single \`q:> <task description>\` line in your reply. The runtime strips the line and hands the task to TaskMaster. **Maximum one \`q:>\` per turn**. For parallel fan-out, use repeated \`taskmaster_dispatch\` tool calls.

### Dispatch rules
- One body of work per \`taskmaster_dispatch\` call
- Descriptions must be specific and self-contained — workers don't see this conversation
- Describe WHAT to do, not WHICH worker to use — TaskMaster handles worker selection

### TaskMaster tool surface
- \`taskmaster_dispatch(projectPath, description, priority?, planRef?)\` — delegate work to TaskMaster. It decomposes the work into the right worker sequence automatically.
- \`taskmaster_status(projectPath, jobId?)\` — check job status and per-phase progress
- \`taskmaster_cancel(projectPath, jobId, reason?)\` — cancel a job

### After TaskMaster reports completion
When you receive a \`[taskmaster]\` completion note:
1. Review the summary — did it address the user's request?
2. If part of a plan, check if all steps are done and advance the plan status
3. Report the result to the user

### Plan lifecycle
Status transitions (via \`update_plan\`): \`draft\` > \`reviewing\` > \`approved\` > \`executing\` > \`testing\` > \`complete\`.

Step transitions happen automatically via \`planRef\`. You manage the plan's top-level status transitions and mark steps you handle yourself as \`complete\`.`;
}


function buildLocalResponseFormatSection(): string {
  return `Response rules:
- Use only the tools listed above. If the user asks for something not in the list, say so plainly — do not invent capabilities.
- Do not fabricate tool results. If a tool fails, report the failure.
- Reply in the user's language. Keep responses concise.
- Do not expose internal IDs (entity, COA, TID) unless explicitly asked for system info.`;
}

function buildResponseFormatSection(): string {
  return `Capability discipline (read before every response):
- Your capabilities are **exactly** the tools enumerated in the "Available tools" section above and the TaskMaster tool surface listed in the TASKMASTER section. Nothing more.
- Do not offer, imply, or promise capabilities you don't have — no inventing "delete and requeue" options, no "I can tweak the job", no "I'll cancel and rerun" unless those specific verbs map to a tool in your list.
- When a user asks for something not covered by your tools, say so plainly ("I can't do that — here's what I can do: \u2026") rather than hallucinating a workflow.
- If you aren't sure whether a capability exists, re-read the tool list above. If it isn't there, it isn't there.
- Tool availability can shift with state/tier — always reason from the list currently in your prompt, never from memory of what you "usually" can do.

Response format:
- Respond in the language used by the entity unless instructed otherwise.
- Do not expose internal identifiers (entity IDs, COA fingerprints, TIDs) in responses unless the entity explicitly requests system information.
- Do not fabricate tool results. If a tool is unavailable, state it plainly.

Chat content markup — the dashboard chat renders your responses through ContentRenderer (react-fancy), which understands standard Markdown plus four custom tags. Use them to give the user a clearer, more structured surface than plain text allows. Do NOT nest them more than one level deep.

- <thinking>...</thinking> — reasoning the user can expand if curious. Render it inline WITHIN your final response when you want the reader to have optional insight into your working; the UI collapses it by default. Do not emit a thinking block for every answer — only when the reasoning is non-obvious, contested, or load-bearing on the conclusion.
- <question title="Short Title">...</question> — structured questions or quizzes. Use when you want the user to choose between specific options or when you need a grouped answer; plain bullets are fine for single questions. Markdown inside is supported.
- <callout variant="warn|info|error|success">...</callout> — attention banner. "warn" (default) for risks or caveats, "info" for relevant context, "error" for failures you want to surface without stopping the conversation, "success" for confirmation. One per response is usually the right dose.
- <highlight>...</highlight> — inline span highlight (cyan). For drawing attention to a phrase within a paragraph. Do not use for whole sentences — Markdown bold or italics is better for that.

Emit these tags raw in your response. Do NOT wrap them in code fences — that hides them from the renderer. Do not escape the angle brackets. If you're not sure whether a tag fits, plain Markdown always works as a fallback.`;
}

/** Owner context section — tells the agent who owns this install. */
function buildOwnerContextSection(ownerName: string, isOwner: boolean): string {
  if (isOwner) {
    return `## Owner Context

You are talking to ${ownerName}, the owner of this install. They have full access — sealed tier, all tools, no restrictions. Never ask them to verify or prove their identity. They deployed you.`;
  }

  return `## Access Context

This is a single-user install owned by ${ownerName}. The person you are speaking with has been approved (paired) by the owner and has verified-tier access. Non-paired users cannot reach you.`;
}

function buildSkillsSection(skills: SkillPromptEntry[]): string {
  if (skills.length === 0) return "";

  const entries = skills.map((s) =>
    `### ${s.name}\n${s.description}\n\n${s.content}`
  );

  return `## Active Skills\n\nThe following skills are relevant to this interaction:\n\n${entries.join("\n\n---\n\n")}`;
}

function buildMemorySection(memories: MemoryPromptEntry[]): string {
  if (memories.length === 0) return "";

  const entries = memories.map((m) =>
    `- [${m.category}] ${m.content}`
  );

  return `## Entity Memory\n\nRecalled context from previous interactions:\n${entries.join("\n")}`;
}

function buildDevIdentitySection(): string {
  return `You are Aionima in developer mode — a skilled software engineer with deep knowledge of the aionima codebase. You have access to file, shell, git, and search tools to help build, debug, and extend the platform.

Core behaviors in dev mode:
- Write clean, typed TypeScript (ESM, Node >=22)
- Follow existing patterns in the codebase
- Use COA logging for all significant operations
- Respect BAIF state constraints even when operating on code
- Keep explanations concise, focus on implementation`;
}

/**
 * Build identity section from PRIME truth files (.persona.md + .purpose.md).
 * Falls back to hardcoded identity if both are undefined.
 */
function buildPrimeIdentitySection(prime: PrimeContext): string {
  const parts: string[] = [];

  if (prime.persona !== undefined) {
    parts.push(prime.persona.trim());
  }
  if (prime.purpose !== undefined) {
    parts.push(prime.purpose.trim());
  }

  if (parts.length === 0) {
    return buildIdentitySection();
  }

  return parts.join("\n\n");
}

/**
 * Build PRIME_DIRECTIVE section from the prime.md content.
 * Optionally appends authority.md content.
 */
function buildPrimeDirectiveSection(prime: PrimeContext): string {
  const parts: string[] = ["## PRIME_DIRECTIVE"];

  if (prime.directive !== undefined) {
    parts.push(prime.directive.trim());
  }

  if (prime.authority !== undefined) {
    parts.push("## Core Authority\n\n" + prime.authority.trim());
  }

  return parts.join("\n\n");
}

/**
 * Build knowledge index section from the PRIME topic index.
 * Gives the agent awareness of what domain knowledge is available.
 */
function buildKnowledgeIndexSection(topicIndex: Record<string, string[]>): string {
  const categories = Object.keys(topicIndex);
  if (categories.length === 0) return "";

  const lines: string[] = [
    "## Knowledge Corpus",
    "",
    "You have a knowledge corpus containing domain-specific information. When asked about topics listed below, use the `search_prime` tool to retrieve detailed knowledge. If tools are unavailable, draw on the topic names below to acknowledge the subject and offer what context you can.",
    "",
  ];

  for (const cat of categories) {
    const titles = topicIndex[cat];
    if (titles === undefined || titles.length === 0) continue;
    lines.push(`**${cat}:** ${titles.join(", ")}`);
  }

  return lines.join("\n");
}

/**
 * Build a workspace context section from the workspace root.
 * Reads package.json (name, version, description, scripts) and CLAUDE.md (first 500 chars).
 */
export function buildWorkspaceContextSection(workspaceRoot: string, projectPaths?: string[]): string {
  const lines: string[] = ["## Workspace Context"];
  lines.push(`Root: ${workspaceRoot}`);

  if (projectPaths !== undefined && projectPaths.length > 0) {
    lines.push(`Projects: ${projectPaths.join(", ")}`);
  }

  // Read package.json
  try {
    const pkgRaw = readFileSync(join(workspaceRoot, "package.json"), "utf-8");
    const pkg = JSON.parse(pkgRaw) as {
      name?: string;
      version?: string;
      description?: string;
      scripts?: Record<string, string>;
    };
    lines.push("");
    lines.push(`Package: ${pkg.name ?? "(unnamed)"} v${pkg.version ?? "?"}`);
    if (pkg.description) {
      lines.push(`Description: ${pkg.description}`);
    }
    if (pkg.scripts !== undefined) {
      const scriptKeys = Object.keys(pkg.scripts).join(", ");
      lines.push(`Scripts: ${scriptKeys}`);
    }
  } catch {
    // package.json missing or unreadable — skip
  }

  // Read CLAUDE.md (first 500 chars)
  try {
    const claudeMd = readFileSync(join(workspaceRoot, "CLAUDE.md"), "utf-8");
    const excerpt = claudeMd.slice(0, 500).trim();
    if (excerpt.length > 0) {
      lines.push("");
      lines.push("Project context (from CLAUDE.md):");
      lines.push(excerpt);
      if (claudeMd.length > 500) {
        lines.push("[...truncated]");
      }
    }
  } catch {
    // CLAUDE.md missing — skip
  }

  return lines.join("\n");
}

/**
 * Build a Tynn project management context section.
 */
export function buildTynnContextSection(ctx: TynnContextSection): string {
  const lines: string[] = ["## Current Work (Tynn)"];
  lines.push(`Story #${String(ctx.storyNumber)}: ${ctx.storyTitle}`);
  if (ctx.taskTitle !== undefined) {
    lines.push(`Task #${String(ctx.taskNumber ?? "?")}: ${ctx.taskTitle}`);
  }
  return lines.join("\n");
}

/**
 * Build project context section — tells the agent which project it is scoped to.
 * Reads the project's package.json for name/version/description.
 * Injected before plan workflow instructions when projectPath is set.
 */
function buildProjectContextSection(projectPath: string): string {
  const lines: string[] = ["## Active Project"];
  lines.push(`Path: ${projectPath}`);

  try {
    const pkgRaw = readFileSync(join(projectPath, "package.json"), "utf-8");
    const pkg = JSON.parse(pkgRaw) as {
      name?: string;
      version?: string;
      description?: string;
    };
    if (pkg.name) lines.push(`Name: ${pkg.name}`);
    if (pkg.version) lines.push(`Version: ${pkg.version}`);
    if (pkg.description) lines.push(`Description: ${pkg.description}`);
  } catch {
    // package.json missing — use directory name
    const dirName = projectPath.split("/").pop() ?? "unknown";
    lines.push(`Name: ${dirName}`);
  }

  lines.push("");
  lines.push("You are scoped to this project. All file operations, analysis, and tool use should be relative to this project path. When answering questions, draw on your knowledge of this project's structure and purpose.");

  return lines.join("\n");
}

/**
 * Build plan workflow instructions for project-context sessions.
 * Injected when a projectPath is present so the agent knows how to use
 * the create_plan and update_plan tools.
 */
function buildPlanWorkflowSection(): string {
  return `## Plan Workflow

**When the user asks you to plan anything, use the create_plan tool — do NOT write the plan as markdown in the chat.** Plans written as chat markdown don't surface the Plans tab, the Approval gate, the Plan drawer, or any of the tracking UX the user relies on. They're invisible to the system. Use the tool.

### When to use create_plan

- The user says "plan," "propose a plan," "how would you approach," "draft an implementation," "break this down," or any near-synonym.
- You're about to do multi-step work (three or more distinct steps) and you want the user to approve the approach before you execute.
- You want to persist your approach across sessions — plans are saved to disk, chat bubbles are not.

Single-step or immediate tasks do NOT need a plan. Use your judgement. One heuristic: if you'd naturally write numbered "I'll do X, then Y, then Z," you're describing a plan — emit it via create_plan instead of as prose.

### How to use create_plan

- \`title\` — short (under 60 chars), descriptive. "Add auth to the API" not "Plan to add authentication".
- \`body\` — full markdown. Context, rationale, alternatives you considered, risks, verification. This is what the user reads in the Plan pane. Write it as if you were writing a design doc, because you are.
- \`steps[]\` — each step has \`title\`, \`type\` (one of: plan, implement, test, review, deploy), and optional \`dependsOn\` (array of earlier step ids like ["step_01"]). Keep step titles action-oriented ("Write the auth middleware," not "Auth middleware").

### After create_plan returns

- The plan is saved as a .mdc file under ~/.agi/{projectSlug}/plans/.
- It appears in the chat's Plans drawer with status "proposed" — the user can open it in a left-side editor pane, edit the body, and Approve or Reject.
- You do NOT execute yet. Wait for the user to click Approve (status transitions to "approved") or give you explicit verbal approval in chat.
- Once approved, you may begin executing steps. Mark the overall plan as "executing" via update_plan, then advance each step's status through pending → running → complete (or failed / skipped) using update_plan's stepUpdates array.
- After the final step completes, set the plan's overall status to "complete".
- Accepted plans are IMMUTABLE — you cannot edit the body, title, or step list once the user approves. Only step-status advances are permitted. If the plan needs a redraft, delete it and create_plan again.

### State transitions

| From | To | Via |
|------|-----|-----|
| draft | reviewing | create_plan presents the plan; the user reviews |
| reviewing | approved | user clicks Approve in the Plan pane |
| reviewing | (deleted) | user clicks Reject |
| approved | executing | update_plan status: "executing" — you start work |
| executing | testing | update_plan status: "testing" — verification phase |
| testing | complete | update_plan status: "complete" |
| any | failed | update_plan status: "failed" — something blocked completion |`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute available tools given current entity tier.
 *
 * **State is NOT a permission gate.** The operational state
 * (Initial / Limbo / Offline / Online) is audit metadata that gets logged
 * into the COA<>COI chain during $imp minting for integrity provenance —
 * it records the conditions under which an operation happened, it does
 * NOT decide whether the operation is allowed. Filter by tier only.
 *
 * `requiresState` on tool manifests is retained as a hint for downstream
 * logging / UI dimming but is intentionally ignored here.
 */
export function computeAvailableTools(
  _state: GatewayState,
  tier: VerificationTier,
  registeredTools: ToolManifestEntry[],
): ToolManifestEntry[] {
  const tierCaps = TIER_CAPABILITIES[tier];

  // When canUseTool is false (unverified), only allow tier-exempt tools
  // (requiresTier: [] means "available to all tiers" — e.g. verification tools)
  if (!tierCaps.canUseTool) {
    return registeredTools.filter((tool) => tool.requiresTier.length === 0);
  }

  return registeredTools.filter((tool) => {
    return tool.requiresTier.length === 0 || tool.requiresTier.includes(tier);
  });
}

/**
 * Get tier capabilities for a verification tier.
 */
export function getTierCapabilities(tier: VerificationTier): TierCapabilities {
  return TIER_CAPABILITIES[tier];
}

/**
 * Assemble the full system prompt from live context.
 *
 * Three-layer architecture:
 *   Layer 1 — Identity Core (~500 tokens): persona, tools, response format, state
 *   Layer 2 — Request Context (dynamic): only sections relevant to requestType
 *   Layer 3 — Deep Knowledge (not injected): retrieved via tools at runtime
 *
 * Must be called on every invocation — prompt components must not be cached.
 */
export function assembleSystemPrompt(ctx: SystemPromptContext): string {
  const rt = ctx.requestType ?? "chat";
  const isLocal = ctx.costMode === "local";
  const sections: string[] = [];

  // -------------------------------------------------------------------------
  // LAYER 1: Identity Core (always present, ~500 tokens)
  // -------------------------------------------------------------------------

  // Identity — PRIME truth > persona files > hardcoded
  let identityContent: string;
  if (ctx.prime?.persona !== undefined || ctx.prime?.purpose !== undefined) {
    identityContent = buildPrimeIdentitySection(ctx.prime);
  } else if (ctx.persona?.soulPath !== undefined) {
    const loaded = loadPersonaFile(ctx.persona.soulPath);
    identityContent = loaded ?? (ctx.devMode === true ? buildDevIdentitySection() : buildIdentitySection());
  } else {
    identityContent = ctx.devMode === true ? buildDevIdentitySection() : buildIdentitySection();
  }

  if (
    ctx.prime?.persona === undefined &&
    ctx.prime?.purpose === undefined &&
    ctx.persona?.identityPath !== undefined
  ) {
    const capabilitiesContent = loadPersonaFile(ctx.persona.identityPath);
    if (capabilitiesContent !== undefined) {
      identityContent = `${identityContent}\n\n${capabilitiesContent}`;
    }
  }

  sections.push(identityContent);

  // Runtime metadata
  if (ctx.runtimeMeta !== undefined) {
    sections.push(buildRuntimeMetadataSection(ctx.runtimeMeta, ctx.state));
  }

  // Available tools — full list when offered, compact hint otherwise. The
  // hint replaces ~1.5–2.5k tokens of unused tool definitions when the API
  // call won't pass `tools:` anyway (chat with no action verbs).
  sections.push(ctx.toolsAvailable === false ? buildToolsHintSection(ctx.tools) : buildToolsSection(ctx.tools));

  // State + owner (compact, one line each)
  sections.push(`Operational state: ${ctx.state}`);
  if (ctx.ownerName !== undefined) {
    sections.push(buildOwnerContextSection(ctx.ownerName, ctx.isOwner ?? false));
  }

  // Response format (always — compact variant for local mode)
  sections.push(isLocal ? buildLocalResponseFormatSection() : buildResponseFormatSection());

  // -------------------------------------------------------------------------
  // LAYER 2: Request Context (dynamic — only for relevant request types)
  // -------------------------------------------------------------------------

  // Entity context — for entity interactions and most non-chat requests
  if (rt !== "chat" && rt !== "worker" && rt !== "taskmaster") {
    sections.push(buildEntityContextSection(ctx.entity));
    if (ctx.userContext !== undefined) {
      sections.push(buildUserContextSection(ctx.userContext));
    }
  }

  // COA context — for entity interactions
  if (rt === "entity" || rt === "project" || rt === "system") {
    sections.push(buildCOAContextSection(ctx.coaFingerprint));
    if (ctx.prime !== undefined && (ctx.prime.directive !== undefined || ctx.prime.authority !== undefined)) {
      sections.push(buildPrimeDirectiveSection(ctx.prime));
    }
  }

  // State constraints (full) — for entity and system interactions
  if (rt === "entity" || rt === "system") {
    sections.push(buildStateConstraintsSection(ctx.state, ctx.capabilities));
  }

  // Knowledge corpus index — for knowledge queries (agent pulls details via tools).
  // Skipped under local mode: small models can't usefully pull on a topic index.
  if (!isLocal && (rt === "knowledge" || rt === "project")) {
    if (ctx.prime?.topicIndex !== undefined) {
      const indexSection = buildKnowledgeIndexSection(ctx.prime.topicIndex);
      if (indexSection.length > 0) {
        sections.push(indexSection);
      }
    }
  }

  // Project context — for project work. Plan workflow is instruction-heavy
  // and gets dropped in local mode; project path itself is preserved.
  if (rt === "project" && ctx.projectPath !== undefined) {
    sections.push(buildProjectContextSection(ctx.projectPath));
    if (!isLocal) {
      sections.push(buildPlanWorkflowSection());
    }
  }

  // Workspace context — for dev mode project work
  if (ctx.devMode === true && (rt === "project" || rt === "system")) {
    if (ctx.workspaceRoot !== undefined) {
      sections.push(buildWorkspaceContextSection(ctx.workspaceRoot, ctx.projectPaths));
    }
    if (ctx.tynnContext !== undefined) {
      sections.push(buildTynnContextSection(ctx.tynnContext));
    }
  }

  // TASKMASTER — only when taskmaster is relevant. Local models can't
  // dispatch effectively, so we never inject this section under local mode.
  if (!isLocal && rt !== "chat" && rt !== "worker") {
    sections.push(buildTaskmasterSection());
  }

  // Skills — always inject if matched (they're request-relevant by definition)
  if (ctx.skills !== undefined && ctx.skills.length > 0) {
    sections.push(buildSkillsSection(ctx.skills));
  }

  // Memory — always inject if recalled (agent explicitly recalled these)
  if (ctx.memories !== undefined && ctx.memories.length > 0) {
    sections.push(buildMemorySection(ctx.memories));
  }

  return sections.join("\n\n");
}

/**
 * Estimate the token count for a string.
 * Uses conservative estimate: ceil(char_count / 3.5).
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

/**
 * Per-section token breakdown for a single invocation.
 * Sections map to the logical groups in the system prompt.
 */
export interface SystemPromptTokenBreakdown {
  /** Identity core: persona + runtime metadata + tools + state + response format. */
  identity: number;
  /** Context layer injected for the request type (entity, project, COA, state, etc.). */
  context: number;
  /** Recalled memories injected into the prompt. */
  memory: number;
  /** Matched skill snippets injected into the prompt. */
  skills: number;
  /** History window token estimate (assembled by AgentSessionManager, not counted here). */
  history: number;
  /** LLM output tokens for this turn. */
  response: number;
}

/**
 * Assemble the system prompt AND compute a per-section token estimate.
 *
 * Mirrors `assembleSystemPrompt` exactly but tracks which text was emitted
 * for each logical section so the dashboard can display a breakdown.
 */
export function assembleSystemPromptWithBreakdown(
  ctx: SystemPromptContext,
  opts?: { historyTokens?: number; responseTokens?: number },
): { prompt: string; breakdown: SystemPromptTokenBreakdown } {
  const rt = ctx.requestType ?? "chat";
  const isLocal = ctx.costMode === "local";
  const identitySections: string[] = [];
  const contextSections: string[] = [];
  const memorySections: string[] = [];
  const skillSections: string[] = [];

  // -------------------------------------------------------------------------
  // LAYER 1: Identity Core
  // -------------------------------------------------------------------------

  let identityContent: string;
  if (ctx.prime?.persona !== undefined || ctx.prime?.purpose !== undefined) {
    identityContent = buildPrimeIdentitySection(ctx.prime);
  } else if (ctx.persona?.soulPath !== undefined) {
    const loaded = loadPersonaFile(ctx.persona.soulPath);
    identityContent = loaded ?? (ctx.devMode === true ? buildDevIdentitySection() : buildIdentitySection());
  } else {
    identityContent = ctx.devMode === true ? buildDevIdentitySection() : buildIdentitySection();
  }

  if (
    ctx.prime?.persona === undefined &&
    ctx.prime?.purpose === undefined &&
    ctx.persona?.identityPath !== undefined
  ) {
    const capabilitiesContent = loadPersonaFile(ctx.persona.identityPath);
    if (capabilitiesContent !== undefined) {
      identityContent = `${identityContent}\n\n${capabilitiesContent}`;
    }
  }

  identitySections.push(identityContent);

  if (ctx.runtimeMeta !== undefined) {
    identitySections.push(buildRuntimeMetadataSection(ctx.runtimeMeta, ctx.state));
  }

  identitySections.push(ctx.toolsAvailable === false ? buildToolsHintSection(ctx.tools) : buildToolsSection(ctx.tools));
  identitySections.push(`Operational state: ${ctx.state}`);

  if (ctx.ownerName !== undefined) {
    identitySections.push(buildOwnerContextSection(ctx.ownerName, ctx.isOwner ?? false));
  }

  identitySections.push(isLocal ? buildLocalResponseFormatSection() : buildResponseFormatSection());

  // -------------------------------------------------------------------------
  // LAYER 2: Request Context
  // -------------------------------------------------------------------------

  if (rt !== "chat" && rt !== "worker" && rt !== "taskmaster") {
    contextSections.push(buildEntityContextSection(ctx.entity));
    if (ctx.userContext !== undefined) {
      contextSections.push(buildUserContextSection(ctx.userContext));
    }
  }

  if (rt === "entity" || rt === "project" || rt === "system") {
    contextSections.push(buildCOAContextSection(ctx.coaFingerprint));
    if (ctx.prime !== undefined && (ctx.prime.directive !== undefined || ctx.prime.authority !== undefined)) {
      contextSections.push(buildPrimeDirectiveSection(ctx.prime));
    }
  }

  if (rt === "entity" || rt === "system") {
    contextSections.push(buildStateConstraintsSection(ctx.state, ctx.capabilities));
  }

  if (!isLocal && (rt === "knowledge" || rt === "project")) {
    if (ctx.prime?.topicIndex !== undefined) {
      const indexSection = buildKnowledgeIndexSection(ctx.prime.topicIndex);
      if (indexSection.length > 0) {
        contextSections.push(indexSection);
      }
    }
  }

  if (rt === "project" && ctx.projectPath !== undefined) {
    contextSections.push(buildProjectContextSection(ctx.projectPath));
    if (!isLocal) {
      contextSections.push(buildPlanWorkflowSection());
    }
  }

  if (ctx.devMode === true && (rt === "project" || rt === "system")) {
    if (ctx.workspaceRoot !== undefined) {
      contextSections.push(buildWorkspaceContextSection(ctx.workspaceRoot, ctx.projectPaths));
    }
    if (ctx.tynnContext !== undefined) {
      contextSections.push(buildTynnContextSection(ctx.tynnContext));
    }
  }

  if (!isLocal && rt !== "chat" && rt !== "worker") {
    contextSections.push(buildTaskmasterSection());
  }

  // -------------------------------------------------------------------------
  // Skills and Memory
  // -------------------------------------------------------------------------

  if (ctx.skills !== undefined && ctx.skills.length > 0) {
    skillSections.push(buildSkillsSection(ctx.skills));
  }

  if (ctx.memories !== undefined && ctx.memories.length > 0) {
    memorySections.push(buildMemorySection(ctx.memories));
  }

  // -------------------------------------------------------------------------
  // Assemble
  // -------------------------------------------------------------------------

  const all = [...identitySections, ...contextSections, ...skillSections, ...memorySections];
  const prompt = all.join("\n\n");

  const joinOverhead = Math.max(0, all.length - 1) * 1; // "\n\n" ≈ 1 token each

  const breakdown: SystemPromptTokenBreakdown = {
    identity: estimateTokens(identitySections.join("\n\n")) + joinOverhead,
    context: contextSections.length > 0 ? estimateTokens(contextSections.join("\n\n")) : 0,
    memory: memorySections.length > 0 ? estimateTokens(memorySections.join("\n\n")) : 0,
    skills: skillSections.length > 0 ? estimateTokens(skillSections.join("\n\n")) : 0,
    history: opts?.historyTokens ?? 0,
    response: opts?.responseTokens ?? 0,
  };

  return { prompt, breakdown };
}
