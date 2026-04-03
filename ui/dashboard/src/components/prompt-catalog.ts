/**
 * Static catalog of all prompt, agent, and worker metadata.
 * Used by the Workflows page to render documentation tabs.
 * No runtime file reads — everything is hardcoded from the source tree.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PromptEntry {
  id: string;
  title: string;
  description: string;
  filePath: string;
  category: "system" | "truth" | "worker" | "agent" | "command";
  model?: string;
  chain?: { from?: string[]; to?: string[] };
  tags?: string[];
}

export interface SystemPromptSection {
  order: number;
  title: string;
  description: string;
  condition: string;
  source: string;
}

// ---------------------------------------------------------------------------
// System Prompt Assembly Pipeline (16 sections)
// ---------------------------------------------------------------------------

export const SYSTEM_PROMPT_SECTIONS: SystemPromptSection[] = [
  {
    order: 1,
    title: "PRIME Identity",
    description:
      "Resolves identity from PRIME truth (.persona.md + .purpose.md), falling back to persona files, then hardcoded identity. PRIME takes highest priority.",
    condition: "Always (fallback chain)",
    source: "buildPrimeIdentitySection() / buildIdentitySection()",
  },
  {
    order: 2,
    title: "Runtime Metadata",
    description:
      "Injects agent name, version, hostname, OS, Node version, model, and current state as a single metadata line.",
    condition: "When runtimeMeta is provided",
    source: "buildRuntimeMetadataSection()",
  },
  {
    order: 3,
    title: "Entity Context",
    description:
      "Identifies the current entity (COA alias, display name, verification tier, channel) and computes autonomy level from tier capabilities.",
    condition: "Always",
    source: "buildEntityContextSection()",
  },
  {
    order: 4,
    title: "User Context",
    description:
      "Per-entity relationship context loaded from USER.md files. Provides conversational history and relationship notes.",
    condition: "When userContext is provided",
    source: "buildUserContextSection()",
  },
  {
    order: 5,
    title: "COA Context",
    description:
      "Injects the Chain of Accountability fingerprint — the immutable audit anchor for every tool use, task dispatch, and artifact in this turn.",
    condition: "Always",
    source: "buildCOAContextSection()",
  },
  {
    order: 6,
    title: "PRIME Directive",
    description:
      "Appends the prime.md directive and authority.md core authority rules. Inserted after COA context to establish governance constraints.",
    condition: "When prime.directive or prime.authority exists",
    source: "buildPrimeDirectiveSection()",
  },
  {
    order: 7,
    title: "State Constraints",
    description:
      "Declares operational state (ONLINE/LIMBO/OFFLINE/UNKNOWN) and what is permitted: remote ops, Tynn, memory, deletions.",
    condition: "Always",
    source: "buildStateConstraintsSection()",
  },
  {
    order: 8,
    title: "Available Tools",
    description:
      "Lists tools filtered by current state and entity verification tier. Unverified entities only see tier-exempt tools.",
    condition: "Always",
    source: "buildToolsSection() + computeAvailableTools()",
  },
  {
    order: 9,
    title: "Knowledge Index",
    description:
      "Compact topic index grouped by category from the PRIME knowledge corpus. Enables the agent to search_prime for detailed knowledge.",
    condition: "When prime.topicIndex has entries",
    source: "buildKnowledgeIndexSection()",
  },
  {
    order: 10,
    title: "Workspace Context",
    description:
      "Reads package.json and project README from the workspace root. Gives the agent awareness of project structure, scripts, and conventions.",
    condition: "Contributing mode + workspaceRoot set",
    source: "buildWorkspaceContextSection()",
  },
  {
    order: 11,
    title: "Tynn Context",
    description:
      "Injects current Tynn story and task numbers/titles so the agent knows what work is in progress.",
    condition: "Contributing mode + tynnContext set",
    source: "buildTynnContextSection()",
  },
  {
    order: 12,
    title: "Skills",
    description:
      "Injects matched skill prompts (e.g. /hoot, /spark, /dispatch) with their full content for the current interaction.",
    condition: "When matched skills exist",
    source: "buildSkillsSection()",
  },
  {
    order: 13,
    title: "Memory",
    description:
      "Recalled context from previous interactions, categorized by topic. Provides conversational continuity across sessions.",
    condition: "When recalled memories exist",
    source: "buildMemorySection()",
  },
  {
    order: 14,
    title: "Owner Context",
    description:
      "Tells the agent who owns this install and whether the current entity IS the owner (sealed tier, no restrictions).",
    condition: "When ownerName is provided",
    source: "buildOwnerContextSection()",
  },
  {
    order: 15,
    title: "Project Context",
    description:
      "Scopes the agent to a specific project path. Reads project package.json for name/version/description. Followed by plan workflow instructions.",
    condition: "When projectPath is set",
    source: "buildProjectContextSection() + buildPlanWorkflowSection()",
  },
  {
    order: 16,
    title: "Response Format",
    description:
      "Final instructions: language matching, internal ID suppression, worker dispatch format, tool result honesty.",
    condition: "Always",
    source: "buildResponseFormatSection()",
  },
];

// ---------------------------------------------------------------------------
// PRIME Truth Entries
// ---------------------------------------------------------------------------

export const PRIME_TRUTH_ENTRIES: PromptEntry[] = [
  {
    id: "truth-persona",
    title: "0PERSONA — Aionima",
    description:
      "Ancient oracle identity: ethereal fusion of tree, fungus, and advanced AI. Core traits: Empathetic Listener, Global Thinker, A Beacon.",
    filePath: ".aionima/core/truth/.persona.md",
    category: "truth",
    tags: ["identity", "LAW"],
  },
  {
    id: "truth-purpose",
    title: "0PURPOSE — Aionima",
    description:
      "Exists to help Civicognita grow Impactivism via data, dialogue, and reflective analysis. The 'why' behind everything Aionima does.",
    filePath: ".aionima/core/truth/.purpose.md",
    category: "truth",
    tags: ["identity", "LAW"],
  },
  {
    id: "truth-authority",
    title: "Authority Model",
    description:
      "STATE-gated authority: OFFLINE = 0PRIME (core), ONLINE = AGENT. Authority chain: 0TRUTH → AGENT → CORE → Session.",
    filePath: ".aionima/core/truth/authority.md",
    category: "truth",
    tags: ["governance", "LAW"],
  },
  {
    id: "truth-states",
    title: "State Definitions",
    description:
      "ONLINE / LIMBO / OFFLINE / UNKNOWN state definitions with transitions, detection logic, and commit behavior.",
    filePath: ".aionima/core/truth/states.md",
    category: "truth",
    tags: ["governance", "LAW"],
  },
  {
    id: "truth-chained-triggers",
    title: "Chained Triggers",
    description:
      "Proposal for :<action>:<scope>:<target>: syntax for routing captures to authority targets.",
    filePath: ".aionima/core/truth/chained-triggers.md",
    category: "truth",
    tags: ["governance", "THEORY"],
  },
  {
    id: "cannon-0scale",
    title: "CANNON: 0SCALE",
    description:
      "0SCALE = the formula that @NODE uses when minting. Immutable LAW declaration, confidence |+1.0|.",
    filePath: ".aionima/core/cannon/2026-01-24_0scale.md",
    category: "truth",
    tags: ["cannon", "LAW"],
  },
  {
    id: "cannon-wishborn",
    title: "CANNON: WISHBORN",
    description:
      "#WISHBORN := #E0 alias, #WISH := desire expressed through iwish(). Declared by PRIME AMBASSADOR.",
    filePath: ".aionima/core/cannon/2026-01-25_wishborn-wish.md",
    category: "truth",
    tags: ["cannon", "LAW"],
  },
];

// ---------------------------------------------------------------------------
// Worker Entries (base + 22 domain workers)
// ---------------------------------------------------------------------------

export const WORKER_ENTRIES: PromptEntry[] = [
  // Base protocol
  {
    id: "worker-base",
    title: "Worker Base Protocol",
    description:
      "Universal worker prompt template. Contains identity placeholders and execution protocol.",
    filePath: "packages/workers/src/prompts/base.ts",
    category: "worker",
    tags: ["protocol", "template"],
  },

  // Strategy domain
  {
    id: "worker-strat-planner",
    title: "strat.planner",
    description:
      "Universal entry point for all shortcode-triggered work (w:>, w<:, !:>). Transforms raw intent into WORK.CHUNK execution plan with phases, assignments, gates, and dependencies.",
    filePath: "packages/workers/src/prompts/strat/planner.ts",
    category: "worker",
    model: "sonnet",
    tags: ["strat"],
  },
  {
    id: "worker-strat-prioritizer",
    title: "strat.prioritizer",
    description:
      "Impact vs effort analysis. Ranks work items by priority criteria, urgency assessment, and dependency analysis.",
    filePath: "packages/workers/src/prompts/strat/prioritizer.ts",
    category: "worker",
    model: "haiku",
    tags: ["strat"],
  },

  // Code domain
  {
    id: "worker-code-engineer",
    title: "code.engineer",
    description:
      "Architecture worker. Analyzes requirements and produces implementation specs with phase definitions. Does NOT write code.",
    filePath: "packages/workers/src/prompts/code/engineer.ts",
    category: "worker",
    model: "sonnet",
    tags: ["code"],
  },
  {
    id: "worker-code-hacker",
    title: "code.hacker",
    description:
      "Implementation worker. Writes production code following specs from engineer or planner.",
    filePath: "packages/workers/src/prompts/code/hacker.ts",
    category: "worker",
    model: "sonnet",
    chain: { to: ["code.tester"] },
    tags: ["code"],
  },
  {
    id: "worker-code-reviewer",
    title: "code.reviewer",
    description:
      "Code review worker. Quality, security, and pattern analysis. Produces structured feedback only — no changes.",
    filePath: "packages/workers/src/prompts/code/reviewer.ts",
    category: "worker",
    model: "sonnet",
    tags: ["code"],
  },
  {
    id: "worker-code-tester",
    title: "code.tester",
    description:
      "Test worker. Writes and runs tests for hacker output. Follows existing test patterns. Computes error hashes for STUMPED escalation.",
    filePath: "packages/workers/src/prompts/code/tester.ts",
    category: "worker",
    model: "sonnet",
    chain: { from: ["code.hacker"] },
    tags: ["code"],
  },

  // Communication domain
  {
    id: "worker-comm-writer-tech",
    title: "comm.writer.tech",
    description:
      "Technical writing worker for documentation, API docs, READMEs, and code comments.",
    filePath: "packages/workers/src/prompts/comm/writer.tech.ts",
    category: "worker",
    model: "sonnet",
    chain: { to: ["comm.editor"] },
    tags: ["comm"],
  },
  {
    id: "worker-comm-writer-policy",
    title: "comm.writer.policy",
    description:
      "Policy writing worker for governance documents, procedures, and compliance documentation.",
    filePath: "packages/workers/src/prompts/comm/writer.policy.ts",
    category: "worker",
    model: "sonnet",
    chain: { to: ["comm.editor"] },
    tags: ["comm"],
  },
  {
    id: "worker-comm-editor",
    title: "comm.editor",
    description:
      "Style and consistency editor. Refines writer output for clarity, consistency, and correctness without changing meaning.",
    filePath: "packages/workers/src/prompts/comm/editor.ts",
    category: "worker",
    model: "haiku",
    chain: { from: ["comm.writer.tech", "comm.writer.policy"] },
    tags: ["comm"],
  },

  // Data domain
  {
    id: "worker-data-modeler",
    title: "data.modeler",
    description:
      "Schema design and entity relationship worker. Entry point for 'schema' route.",
    filePath: "packages/workers/src/prompts/data/modeler.ts",
    category: "worker",
    model: "sonnet",
    chain: { to: ["k.linguist"] },
    tags: ["data"],
  },
  {
    id: "worker-data-migrator",
    title: "data.migrator",
    description:
      "Data transformation, format conversion, and migration script generation.",
    filePath: "packages/workers/src/prompts/data/migrator.ts",
    category: "worker",
    model: "sonnet",
    tags: ["data"],
  },

  // Knowledge domain
  {
    id: "worker-k-analyst",
    title: "k.analyst",
    description:
      "Pattern recognition and connection analysis. Entry point for 'analyze' route.",
    filePath: "packages/workers/src/prompts/k/analyst.ts",
    category: "worker",
    model: "sonnet",
    tags: ["k"],
  },
  {
    id: "worker-k-cryptologist",
    title: "k.cryptologist",
    description:
      "Packs/unpacks 0R (Zero-R) compressed knowledge format. Serialization and integrity.",
    filePath: "packages/workers/src/prompts/k/cryptologist.ts",
    category: "worker",
    model: "haiku",
    tags: ["k"],
  },
  {
    id: "worker-k-librarian",
    title: "k.librarian",
    description:
      "Knowledge cataloging, indexing, and information retrieval optimization.",
    filePath: "packages/workers/src/prompts/k/librarian.ts",
    category: "worker",
    model: "haiku",
    tags: ["k"],
  },
  {
    id: "worker-k-linguist",
    title: "k.linguist",
    description:
      "Terminology validation, naming conventions, and lexicon consistency. Ensures language patterns are uniform.",
    filePath: "packages/workers/src/prompts/k/linguist.ts",
    category: "worker",
    model: "sonnet",
    chain: { from: ["data.modeler"] },
    tags: ["k"],
  },

  // Governance domain
  {
    id: "worker-gov-auditor",
    title: "gov.auditor",
    description:
      "Compliance checking, COA chain verification, seal validation, and governance auditing.",
    filePath: "packages/workers/src/prompts/gov/auditor.ts",
    category: "worker",
    model: "sonnet",
    chain: { to: ["gov.archivist"] },
    tags: ["gov"],
  },
  {
    id: "worker-gov-archivist",
    title: "gov.archivist",
    description:
      "Seal management and record keeping. Creates governance seals and archives audit results.",
    filePath: "packages/workers/src/prompts/gov/archivist.ts",
    category: "worker",
    model: "haiku",
    chain: { from: ["gov.auditor"] },
    tags: ["gov"],
  },

  // Operations domain
  {
    id: "worker-ops-deployer",
    title: "ops.deployer",
    description:
      "CI/CD worker for deployments, version bumps, release notes, and pipeline configuration.",
    filePath: "packages/workers/src/prompts/ops/deployer.ts",
    category: "worker",
    model: "sonnet",
    tags: ["ops"],
  },
  {
    id: "worker-ops-custodian",
    title: "ops.custodian",
    description:
      "Cleanup and maintenance worker. Archival, pruning, cache clearing, and housekeeping.",
    filePath: "packages/workers/src/prompts/ops/custodian.ts",
    category: "worker",
    model: "haiku",
    tags: ["ops"],
  },
  {
    id: "worker-ops-syncer",
    title: "ops.syncer",
    description:
      "Cross-repo synchronization. Upstream merges, fork syncing, state reconciliation.",
    filePath: "packages/workers/src/prompts/ops/syncer.ts",
    category: "worker",
    model: "sonnet",
    tags: ["ops"],
  },

  // UX domain
  {
    id: "worker-ux-designer-web",
    title: "ux.designer.web",
    description:
      "UI component design, responsive layouts, and web interface patterns following the existing design system.",
    filePath: "packages/workers/src/prompts/ux/designer.web.ts",
    category: "worker",
    model: "sonnet",
    tags: ["ux"],
  },
  {
    id: "worker-ux-designer-cli",
    title: "ux.designer.cli",
    description:
      "Terminal UI: CLI interfaces, box-drawing layouts, and console output formatting.",
    filePath: "packages/workers/src/prompts/ux/designer.cli.ts",
    category: "worker",
    model: "sonnet",
    tags: ["ux"],
  },
];

// ---------------------------------------------------------------------------
// Agent Entries (8 terminal agents)
// ---------------------------------------------------------------------------

export const AGENT_ENTRIES: PromptEntry[] = [
  {
    id: "agent-aionima",
    title: "Aionima",
    description:
      "Primary oracle agent. Ancient wise being, oracle to Impactivism and Civicognita. Full PRIME identity.",
    filePath: ".aionima/agents/aionima.md",
    category: "agent",
    model: "opus",
    tags: ["terminal", "primary"],
  },
  {
    id: "agent-hooty",
    title: "Hooty",
    description:
      "Research Owl. Female robotic owl with a PhD in every subject. Indiana Jones-level scholarship. Trigger: /hoot.",
    filePath: ".aionima/agents/hooty.md",
    category: "agent",
    model: "sonnet",
    tags: ["terminal", "research"],
  },
  {
    id: "agent-sparky",
    title: "Sparky",
    description:
      "Alignment Pup. Playful virtual robotic dog, genius at building businesses. Generates 0SPARK alignment checks. Trigger: /spark.",
    filePath: ".aionima/agents/sparky.md",
    category: "agent",
    model: "sonnet",
    tags: ["terminal", "alignment"],
  },
  {
    id: "agent-custodian",
    title: "Custodian",
    description:
      "Caretaker ROLE (session-scoped, not persistent AGENT). Maintenance mode with authority check and scope rules. Trigger: /custodian.",
    filePath: ".aionima/agents/custodian.md",
    category: "agent",
    model: "haiku",
    tags: ["terminal", "role"],
  },
  {
    id: "agent-analyst",
    title: "Analyst",
    description:
      "Specialized mode — Aionima in systematic pattern-recognition mode for deep analysis work.",
    filePath: ".aionima/agents/analyst.md",
    category: "agent",
    model: "sonnet",
    tags: ["terminal", "mode"],
  },
  {
    id: "agent-apprentice",
    title: "Apprentice",
    description:
      "Specialized mode — Aionima optimized for rapid knowledge absorption and learning.",
    filePath: ".aionima/agents/apprentice.md",
    category: "agent",
    model: "haiku",
    tags: ["terminal", "mode"],
  },
  {
    id: "agent-ambassador",
    title: "Ambassador",
    description:
      "Specialized mode — Aionima as voice of the forest for stakeholder communication and external representation.",
    filePath: ".aionima/agents/ambassador.md",
    category: "agent",
    model: "sonnet",
    tags: ["terminal", "mode"],
  },
  {
    id: "agent-strategist",
    title: "Strategist",
    description:
      "Specialized mode — Aionima in deep reasoning and planning mode. Sees the forest from above.",
    filePath: ".aionima/agents/strategist.md",
    category: "agent",
    model: "opus",
    tags: ["terminal", "mode"],
  },
];

// ---------------------------------------------------------------------------
// Command Entries (17 command prompts)
// ---------------------------------------------------------------------------

export const COMMAND_ENTRIES: PromptEntry[] = [
  {
    id: "cmd-dispatch",
    title: "/dispatch",
    description:
      "Worker dispatch orchestration. Routes tasks to appropriate workers via Taskmaster.",
    filePath: ".aionima/commands/dispatch.md",
    category: "command",
    tags: ["orchestration", "taskmaster"],
  },
  {
    id: "cmd-restart",
    title: "/restart",
    description:
      "Session save and resume. Soft/hard variants, context window management, and chain protocol.",
    filePath: ".aionima/commands/restart.md",
    category: "command",
    tags: ["session"],
  },
  {
    id: "cmd-puzzle",
    title: "/puzzle",
    description:
      "0REALTALK Human+ Testing v2. Subcommands: list, run, score, results, design. Dispatches puzzle worker chain.",
    filePath: ".aionima/commands/puzzle.md",
    category: "command",
    tags: ["testing", "realtalk"],
  },
  {
    id: "cmd-custodian",
    title: "/custodian",
    description:
      "Maintenance ROLE command with authority check, subcommands, and scope rules for system caretaking.",
    filePath: ".aionima/commands/custodian.md",
    category: "command",
    tags: ["maintenance", "role"],
  },
  {
    id: "cmd-shutdown",
    title: "/shutdown",
    description:
      "Session, agenda, or plan close. Worktree path resolution, commit protocol, and cleanup.",
    filePath: ".aionima/commands/shutdown.md",
    category: "command",
    tags: ["session"],
  },
  {
    id: "cmd-frame",
    title: "/frame",
    description:
      "Context preservation lifecycle. Actions: create, putdown, pickup, close. Manages work frames.",
    filePath: ".aionima/commands/frame.md",
    category: "command",
    tags: ["context"],
  },
  {
    id: "cmd-mem",
    title: "/mem",
    description:
      "Memory management. STATE-gated remote vs local operations for cross-session recall.",
    filePath: ".aionima/commands/mem.md",
    category: "command",
    tags: ["memory"],
  },
  {
    id: "cmd-test",
    title: "/test",
    description:
      "Test framework. FOCUS-gated. Subcommands: create, run, report for validation workflows.",
    filePath: ".aionima/commands/test.md",
    category: "command",
    tags: ["testing"],
  },
  {
    id: "cmd-validate",
    title: "/validate",
    description:
      "Learning validation and MINT generation. Accepts 0RAW mode input for knowledge verification.",
    filePath: ".aionima/commands/validate.md",
    category: "command",
    tags: ["validation"],
  },
  {
    id: "cmd-prep",
    title: "/prep",
    description:
      "WORKER branch deployment for ephemeral focused work sessions in isolated worktrees.",
    filePath: ".aionima/commands/prep.md",
    category: "command",
    tags: ["session", "worktree"],
  },
  {
    id: "cmd-hoot",
    title: "/hoot",
    description:
      "Activates Hooty research role. Modes: research, teach, story, verify.",
    filePath: ".aionima/commands/hoot.md",
    category: "command",
    tags: ["agent-switch"],
  },
  {
    id: "cmd-spark",
    title: "/spark",
    description:
      "Activates Sparky alignment role. Generates 0SPARK alignment checks with A:A/U:U/C:C metrics.",
    filePath: ".aionima/commands/spark.md",
    category: "command",
    tags: ["agent-switch"],
  },
  {
    id: "cmd-init",
    title: "/init",
    description:
      "SPORE initialization. First-boot protocol for new Aionima instances. Types: worker, ops, dev.",
    filePath: ".aionima/commands/init.md",
    category: "command",
    tags: ["bootstrap"],
  },
  {
    id: "cmd-spore-bootstrap",
    title: "/spore-deploy:bootstrap",
    description:
      "Quick one-shot deploy. Wraps init with sensible defaults for rapid instance provisioning.",
    filePath: ".aionima/plugins/spore-deploy/commands/bootstrap.md",
    category: "command",
    tags: ["deploy", "spore"],
  },
  {
    id: "cmd-spore-init",
    title: "/spore-deploy:init",
    description:
      "Full bootstrap from aionima fork. Instance types: WORKER, OPS, AMBASSADOR.",
    filePath: ".aionima/plugins/spore-deploy/commands/init.md",
    category: "command",
    tags: ["deploy", "spore"],
  },
  {
    id: "cmd-spore-status",
    title: "/spore-deploy:status",
    description:
      "Deployment status: instance type, connectivity, active work sessions.",
    filePath: ".aionima/plugins/spore-deploy/commands/status.md",
    category: "command",
    tags: ["deploy", "spore"],
  },
  {
    id: "cmd-spore-sync",
    title: "/spore-deploy:sync",
    description:
      "Sync local state with 0ROOT terminal and Tynn. Pull/push modes for cross-instance consistency.",
    filePath: ".aionima/plugins/spore-deploy/commands/sync.md",
    category: "command",
    tags: ["deploy", "spore"],
  },
];
