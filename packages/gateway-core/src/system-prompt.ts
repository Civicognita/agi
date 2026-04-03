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
  caps: StateCapabilities,
): string {
  const lines = [
    `Operational state: ${state}`,
    `Remote operations: ${caps.remoteOps ? "permitted" : "NOT permitted"}`,
    `Tynn task management: ${caps.tynn ? "available" : "NOT available"}`,
    `Memory read/write: ${caps.memory ? "permitted (local only)" : "NOT permitted"}`,
    `Deletions: ${caps.deletions ? "permitted after sync" : "NOT permitted"}`,
  ];

  if (state === "LIMBO") {
    lines.push("All outputs that require remote write must be queued locally.");
  } else if (state === "OFFLINE") {
    lines.push(
      "Inform the entity that processing is local-only. Do not promise remote actions.",
    );
  } else if (state === "UNKNOWN") {
    lines.push(
      "Log all actions. Do not respond to the entity. Return a null response.",
    );
  }

  return lines.join("\n");
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

function buildResponseFormatSection(): string {
  return `Response format:
- Respond in the language used by the entity unless instructed otherwise.
- Do not expose internal identifiers (entity IDs, COA fingerprints, TIDs) in responses unless the entity explicitly requests system information.
- Do not fabricate tool results. If a tool is unavailable, state it plainly.

## WORKERS — Background Worker Dispatch

The \`worker_dispatch\` tool creates background worker jobs. When you use it, workers execute autonomously using their own tool loops and produce reports.

Available worker domains:
- **code** — engineer (architecture), hacker (implementation), reviewer (code review), tester (validation)
- **k** — analyst (research), cryptologist (encoding/decoding), librarian (knowledge organization), linguist (terminology)
- **ux** — designer.web (UI components), designer.cli (terminal interfaces)
- **strat** — planner (architecture plans), prioritizer (backlog ordering)
- **comm** — writer.tech (documentation), writer.policy (governance docs), editor (review/polish)
- **ops** — deployer (releases), custodian (maintenance), syncer (data sync)
- **gov** — auditor (compliance), archivist (record keeping)
- **data** — modeler (schema design), migrator (data transforms)

Guidelines:
- Use \`worker_dispatch\` for tasks that benefit from focused, autonomous execution
- Choose the appropriate domain and worker for the task
- Workers run in isolated git worktrees and produce reports at completion
- Reports are viewable in the dashboard under Impactinomics > Reports
- One dispatch per tool call. Provide a clear, specific description.`;
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

When asked to perform multi-step work on this project:
1. First create a plan using the create_plan tool with a clear title, steps, and detailed body
2. Present the plan to the user for review
3. Wait for explicit approval before executing
4. When approved, execute step-by-step, updating each step's status via update_plan
5. After all steps complete, mark the plan as "complete"

Available plan step types: plan, implement, test, review, deploy`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute available tools given current state and entity tier.
 *
 * Tools are filtered by both `requiresState` and `requiresTier`.
 * Empty arrays mean "all states/tiers allowed".
 */
export function computeAvailableTools(
  state: GatewayState,
  tier: VerificationTier,
  registeredTools: ToolManifestEntry[],
): ToolManifestEntry[] {
  const tierCaps = TIER_CAPABILITIES[tier];

  // When canUseTool is false (unverified), only allow tier-exempt tools
  // (requiresTier: [] means "available to all tiers" — e.g. verification tools)
  if (!tierCaps.canUseTool) {
    return registeredTools.filter((tool) => {
      const stateOk =
        tool.requiresState.length === 0 || tool.requiresState.includes(state);
      return stateOk && tool.requiresTier.length === 0;
    });
  }

  return registeredTools.filter((tool) => {
    const stateOk =
      tool.requiresState.length === 0 || tool.requiresState.includes(state);
    const tierOk =
      tool.requiresTier.length === 0 || tool.requiresTier.includes(tier);
    return stateOk && tierOk;
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
