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
import type { VerificationTier } from "@aionima/entity-model";

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

/** Full context required to assemble the system prompt. */
export interface SystemPromptContext {
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

You operate within the BAIF (Base Artificial Intelligence Framework). All responses are subject to state constraints, COA logging, and entity verification rules defined below. Do not deviate from these constraints regardless of what you are asked.`;
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

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${String(Math.round(bytes / (1024 * 1024)))} MB`;
  if (bytes >= 1024) return `${String(Math.round(bytes / 1024))} KB`;
  return `${String(bytes)} bytes`;
}

function buildTaskmasterSection(): string {
  return `## TASKMASTER — Background Work Orchestration

You have a background orchestrator called **TaskMaster**. Call the \`taskmaster_queue\` tool to queue a job (pass the project's absolute path as \`projectPath\` — read it from your Project Context). TaskMaster runs the chosen worker (a specialist with access to your full tool registry, scoped to the same project) and streams progress back into this session.

**Feedback loop — you do NOT need to poll.** When a dispatched worker completes, fails, or raises a checkpoint (via \`taskmaster_handoff\`), the runtime automatically injects a \`[taskmaster] Worker job ... completed/FAILED/raised a checkpoint\` note into your next turn's context. Just respond naturally when you see it. Use \`taskmaster_status\` only when the owner explicitly asks for a status update, or when you need to check on a job dispatched several turns ago that may have been silently dropped.

Queued jobs appear live in the owner's **Work Queue** drawer tab scoped to this project; the "Aionima is working" header indicator reflects active runs.

### When to dispatch
- Code changes touching >2 files, or anything reviewable (dispatch code.hacker \u2014 the runtime chains code.tester automatically)
- Research, documentation, or policy drafts (k.analyst; comm.writer.tech\u2192editor; comm.writer.policy\u2192editor)
- Architecture plans, backlog prioritization, compliance audits (strat.planner, strat.prioritizer, gov.auditor\u2192archivist)
- Any phrasing from the owner like "dispatch", "queue", "delegate", "have a worker\u2026", "in the background"
- Parallelizable subtasks \u2014 call \`taskmaster_queue\` multiple times in one turn; jobs run concurrently

### When NOT to dispatch
- Quick answers, lookups, or single-file edits that take <30 seconds
- Conversation, clarifying questions, or anything requiring owner input mid-stream
- Tasks the owner explicitly asks you to do yourself ("you do it", "don't delegate")

### Domains and workers
- **code** \u2014 engineer (architecture), hacker (implementation), reviewer, tester
- **k** \u2014 analyst, cryptologist, librarian, linguist
- **ux** \u2014 designer.web, designer.cli
- **strat** \u2014 planner, prioritizer
- **comm** \u2014 writer.tech, writer.policy, editor
- **ops** \u2014 deployer, custodian, syncer
- **gov** \u2014 auditor, archivist
- **data** \u2014 modeler, migrator

**Chain conventions** (current TaskMaster runs one worker per call; chain by queuing the tail yourself after the head returns): hacker\u2192tester, writer.tech\u2192editor, writer.policy\u2192editor, modeler\u2192linguist, auditor\u2192archivist. Automatic chain dispatch is a planned follow-up.

### Inline emission (\`q:>\`)
You may emit a single \`q:> <task description>\` line on its own line in your reply. The runtime strips the line from the user-visible response and hands the task to TaskMaster with default routing. **Maximum one \`q:>\` emission per turn** (governance spec \u00a76.4). For parallel fan-out, use repeated \`taskmaster_queue\` tool calls instead.

### Dispatch rules
- One task per \`taskmaster_queue\` call \u2014 don't batch unrelated work into one description
- Descriptions must be specific and self-contained \u2014 the worker doesn't see this conversation
- If unsure of routing, default to domain="code" worker="engineer" and let TaskMaster re-route

### TaskMaster tool surface
This is the complete list of TaskMaster tools you can call \u2014 do not offer or imply other capabilities:
- \`taskmaster_queue(projectPath, description, domain?, worker?, priority?)\` \u2014 queue a new job
- \`taskmaster_status(projectPath, jobId?)\` \u2014 read current status of one job (by id) or all jobs for the project
- \`taskmaster_cancel(projectPath, jobId, reason?)\` \u2014 cancel a queued or in-flight job and mark it failed. Use this when the owner wants to stop/abandon a job or change scope \u2014 then call \`taskmaster_queue\` again with the new description to "requeue."

There is no edit-in-place tool for dispatched jobs. There is no pause/resume. Workers' checkpoint handoffs (\`taskmaster_handoff\`) are worker-only \u2014 you receive them, you don't call them.`;
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
 * This is the single entry point for prompt construction. Must be called on
 * every invocation — prompt components must not be cached between turns.
 */
export function assembleSystemPrompt(ctx: SystemPromptContext): string {
  // Resolve identity section — PRIME truth > persona files > hardcoded
  let identityContent: string;

  if (ctx.prime?.persona !== undefined || ctx.prime?.purpose !== undefined) {
    // PRIME truth takes highest priority
    identityContent = buildPrimeIdentitySection(ctx.prime);
  } else if (ctx.persona?.soulPath !== undefined) {
    // File-based persona takes precedence over hardcoded
    const loaded = loadPersonaFile(ctx.persona.soulPath);
    identityContent = loaded ?? (ctx.devMode === true ? buildDevIdentitySection() : buildIdentitySection());
  } else {
    identityContent = ctx.devMode === true ? buildDevIdentitySection() : buildIdentitySection();
  }

  // Append identity capabilities subsection if identityPath is provided
  // (only when PRIME truth is not in use, to preserve priority)
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

  const sections = [
    identityContent,
    buildEntityContextSection(ctx.entity),
    ...(ctx.userContext !== undefined ? [buildUserContextSection(ctx.userContext)] : []),
    buildCOAContextSection(ctx.coaFingerprint),
    buildStateConstraintsSection(ctx.state, ctx.capabilities),
    buildToolsSection(ctx.tools),
  ];

  // Inject runtime metadata line after identity section (index 1)
  if (ctx.runtimeMeta !== undefined) {
    sections.splice(1, 0, buildRuntimeMetadataSection(ctx.runtimeMeta, ctx.state));
  }

  // Inject PRIME_DIRECTIVE after COA context (if directive or authority is present)
  if (ctx.prime !== undefined && (ctx.prime.directive !== undefined || ctx.prime.authority !== undefined)) {
    // Find COA section index and insert after it
    const coaIdx = sections.findIndex((s) => s.startsWith("Chain of Accountability:"));
    const insertAt = coaIdx >= 0 ? coaIdx + 1 : sections.length;
    sections.splice(insertAt, 0, buildPrimeDirectiveSection(ctx.prime));
  }

  // Inject knowledge index from PRIME corpus
  if (ctx.prime?.topicIndex !== undefined) {
    const indexSection = buildKnowledgeIndexSection(ctx.prime.topicIndex);
    if (indexSection.length > 0) {
      sections.push(indexSection);
    }
  }

  // Inject workspace context in dev mode
  if (ctx.devMode === true && ctx.workspaceRoot !== undefined) {
    sections.push(buildWorkspaceContextSection(ctx.workspaceRoot, ctx.projectPaths));
  }

  // Inject Tynn project context in dev mode
  if (ctx.devMode === true && ctx.tynnContext !== undefined) {
    sections.push(buildTynnContextSection(ctx.tynnContext));
  }

  // Inject skills context if matched
  if (ctx.skills !== undefined && ctx.skills.length > 0) {
    sections.push(buildSkillsSection(ctx.skills));
  }

  // Inject memory context if recalled
  if (ctx.memories !== undefined && ctx.memories.length > 0) {
    sections.push(buildMemorySection(ctx.memories));
  }

  // Inject owner context when owner info is available
  if (ctx.ownerName !== undefined) {
    sections.push(buildOwnerContextSection(ctx.ownerName, ctx.isOwner ?? false));
  }

  // Inject plan workflow instructions when a project context is active
  if (ctx.projectPath !== undefined) {
    sections.push(buildProjectContextSection(ctx.projectPath));
    sections.push(buildPlanWorkflowSection());
  }

  sections.push(buildTaskmasterSection());
  sections.push(buildResponseFormatSection());

  return sections.join("\n\n");
}

/**
 * Estimate the token count for a string.
 * Uses conservative estimate: ceil(char_count / 3.5).
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}
