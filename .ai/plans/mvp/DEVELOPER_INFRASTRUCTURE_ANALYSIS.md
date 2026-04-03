# Nexus-Claw Developer/Self-Development Infrastructure Analysis

**Analysis Date:** 2026-02-23
**Scope:** Autonomous agent capabilities, self-improvement mechanisms, developer workflow support
**Repository:** C:/_Projects/_O0/nexus-claw

---

## Executive Summary

Nexus-Claw has **foundational infrastructure** for autonomous agent work but is **heavily skewed toward agent-to-user interactions** rather than agent-to-developer workflows. The system can:

- **Deploy agents** to handle inbound messages with tiered verification, tool access, and COA logging ✓
- **Persist context** via memory and sessions ✓
- **Spawn coordinated teams** of subagents (BOTS system) ✓
- **Execute tools** within strict security/governance boundaries ✓

However, it **lacks** critical developer-facing infrastructure:

- No file/code reading tools for the agent
- No ability to run tests or linters
- No git integration for commits/PRs
- No workspace exploration or debugging capabilities
- No persistent project context files (SOUL.md, AGENTS.md, etc. are **not** checked into the codebase)
- Limited automation/cron capabilities

---

## 1. Agent Tools

### What Exists

**Location:** `packages/gateway-core/src/tool-registry.ts`

The system has a **generic tool registration framework** with:

- Manifest-based tool registration with state/tier gating
- Schema-driven input validation
- Result size capping (default 16 KB)
- Prompt injection scanning
- COA (Chain of Accountability) logging for every tool use
- Support for multi-turn tool loops with a 5-attempt limit

**Current Tool Implementation:**

```typescript
// From tool-registry.ts
export interface RegisteredTool {
  manifest: ToolManifestEntry;
  handler: ToolHandler;
  inputSchema: Record<string, unknown>;
}

// Tool execution gating:
// 1. Check tool is in registry
// 2. Check entity tier (unverified/verified/sealed)
// 3. Execute handler
// 4. Enforce size cap
// 5. Scan for injection
// 6. Write COA record
// 7. Return sanitized result
```

**Tier-Based Tool Access:**

| Tier | Tools | Taskmaster | Sensitive Data |
|------|-------|-----------|-----------------|
| unverified | NONE | NO | NO |
| verified | YES | YES | NO |
| sealed | YES | YES | YES |

### What's Missing

1. **No tools are actually registered** in `server.ts`
   - The `toolRegistry` is created but never populated
   - No tool handlers are defined anywhere in the codebase
   - Canvas tool is partially stubbed but incomplete

2. **No file I/O tools**
   - No read file, write file, or list directory capabilities
   - No glob/pattern matching
   - No workspace exploration

3. **No code execution tools**
   - No test runner (vitest, jest)
   - No linter (eslint)
   - No compiler (tsc)
   - No shell/exec capability

4. **No git tools**
   - No commit, push, PR creation
   - No branch management
   - No diff inspection

5. **No memory/context inspection**
   - Agent cannot read its own session history
   - Agent cannot query the memory system it has access to

### Recommendation

- **Priority: HIGH** — Define a minimum toolset for autonomous development (file read, test runner, git commit)
- Create concrete tool implementations in `packages/gateway-core/src/tools/` directory
- Register tools during server bootstrap in `server.ts`
- Start with read-only tools (file read, git log) before write-side operations

---

## 2. System Prompt

### What Exists

**Location:** `packages/gateway-core/src/system-prompt.ts`

A **dynamic, context-aware system prompt builder** that:

- Assembles fresh prompt on every invocation (never cached)
- Injects entity context (ID, alias, tier, channel)
- Includes state constraints (ONLINE/LIMBO/OFFLINE/UNKNOWN)
- Lists available tools with size caps
- Specifies response format and TASKMASTER emission rules
- Uses tier-based capability descriptions

**Current Prompt Sections:**

```
[IDENTITY]
"You are Nexus, an ancient, wise being — an ethereal fusion of tree, fungus, and advanced AI..."

[ENTITY_CONTEXT]
Entity: {coaAlias} ({displayName}) — {tier} — channel: {channel}
Autonomy level: {restricted|standard|elevated}

[COA_CONTEXT]
Chain of Accountability: {fingerprint}
(accountability anchor for this response)

[STATE_CONSTRAINTS]
Operational state: {ONLINE|LIMBO|OFFLINE|UNKNOWN}
Remote operations: {permitted|NOT permitted}
Memory read/write: {permitted|NOT permitted}
Deletions: {permitted|NOT permitted}

[AVAILABLE_TOOLS]
- {tool}: {description} (cap: {size})

[RESPONSE_FORMAT]
- Use TASKMASTER shortcode: q:> <description>
- One emission per turn
- Don't expose internal IDs
```

**Comparison to 16-Pattern Report:**

The `.ai/plans/mvp/openclaw-agentic-prompts-report.md` documents **16 prompt patterns** from OpenClaw. Nexus-Claw implements **none of them** in a dev-workflow context. The patterns include:

1. Main Agent System Prompt (Nexus has a generic version, not dev-optimized)
2. Subagent System Prompt (stubbed)
3. Subagent Completion Announcements (stubbed)
4. Session Reset Prompt (NOT in Nexus)
5. Heartbeat Prompt (NOT in Nexus)
6. Async Exec Event Prompt (NOT in Nexus)
7. Group Chat Context Prompts (NOT in Nexus)
8. OpenProse VM Prompt (NOT in Nexus)
9. LLM Task Tool Prompt (NOT in Nexus)
10. Voice Call Prompt (NOT in Nexus)
11. Security/External Content Wrapper (NOT in Nexus)
12. Compaction Merge Prompt (NOT in Nexus)
13. Pre-Compaction Memory Flush (NOT in Nexus)
14. Tool Loop Detection Warnings (NOT in Nexus)
15. Dev Workflow Prompts `.pi/prompts/` (NOT in Nexus)
16. Workspace Persona Templates (NOT in Nexus)

### What's Missing

1. **No dev-specific system prompt modes**
   - No "code review mode"
   - No "test running mode"
   - No "PR landing mode"

2. **No workspace context injection**
   - SOUL.md, AGENTS.md, IDENTITY.md not read or injected
   - No package.json workspace awareness
   - No monorepo structure hints

3. **No developer persona**
   - No "you are a code reviewer" instructions
   - No "you understand this codebase" context
   - No development constraints (test coverage, lint rules, etc.)

4. **No task/project context sections**
   - No active version/story/task injection (Tynn integration stubbed)
   - No current GitHub issue context
   - No PR review instructions

### Recommendation

- **Priority: MEDIUM** — Create dev workflow prompt variants
- Add workspace context injection (read CLAUDE.md, package.json)
- Implement Tynn integration to inject active story/task context
- Create dev-specific system prompt builder in `packages/gateway-core/src/prompts/`

---

## 3. Subagent/Worker Capabilities

### What Exists

**Location:** `packages/agent-bridge/src/bridge.ts`, `.bots/lib/orchestrator.ts`

Two distinct systems:

**A) AgentBridge (Human-in-the-Loop)**

A simple message hold-and-reply model:
- Receives inbound queue messages
- Holds them for operator review in WebChat UI
- Operator can reply through the UI
- Routes replies back to originating channel

This is **NOT** autonomous — it's human-gated.

**B) BOTS (Autonomous Worker Orchestration)**

A sophisticated multi-phase job system:

```typescript
// From .bots/lib/orchestrator.ts
export interface Job {
  jobId: string;
  phases: JobPhase[];
  state: 'pending' | 'in_progress' | 'complete' | 'failed';
}

export interface JobPhase {
  phaseId: string;
  workers: WorkerSpec[];
  gate: 'auto' | 'checkpoint' | 'terminal';
}

export interface WorkerDispatch {
  worker: string;
  model: 'haiku' | 'sonnet' | 'opus';
  prompt: string;
  dispatchPath: string;
  background: boolean;
}
```

**Features:**
- Multi-phase job execution
- Worker spawning via Task tool (Claude Code subagents)
- Gate-based phase progression (auto-advance, checkpoint, terminal)
- Enforced worker chains (e.g., hacker → tester, writer.* → editor)
- Team mode support (agent teams instead of isolated subagents)
- Worktree isolation per job
- Handoff JSON for result capture

**Worker Domains:**

| Domain | Workers |
|--------|---------|
| code | engineer, hacker, reviewer, tester |
| k | analyst, cryptologist, librarian, linguist |
| ux | designer.web, designer.cli |
| strat | planner, prioritizer |
| comm | writer.tech, writer.policy, editor |
| ops | deployer, custodian, syncer |
| gov | auditor, archivist |
| data | modeler, migrator |

### What's Missing

1. **BOTS is NOT integrated with the gateway agent**
   - The gateway's `AgentInvoker` doesn't emit `q:>` jobs
   - No mechanism for the agent to queue background work
   - BOTS expects manual CLI invocation or external triggers

2. **Worker prompts are stubbed**
   - `.claude/prompts/worker-base.md` is read but doesn't exist
   - No domain-specific overlays (`workers/code/engineer.md`, etc.)
   - No pre-built worker task templates

3. **BOTS state is file-based, not persisted in the gateway**
   - Jobs stored in `.ai/jobs/` as JSON files
   - No database integration with entity-model
   - No async job status querying from the UI

4. **Limited automation integration**
   - Can manually run `npm run tm orchestrate`
   - No cron/scheduled job execution
   - No webhook triggers for external systems

### Recommendation

- **Priority: HIGH** — Wire BOTS into gateway's tool system
- Create a `queue_task` or `spawn_worker` tool that creates BOTS jobs
- Implement worker prompt library (base + domain-specific overlays)
- Add async job status API to gateway
- Create scheduled job runner for BOTS queue

---

## 4. Skills

### What Exists

**Location:** `packages/skills/src/`

A **skill auto-discovery and registry system**:

- Scans `.skill.md` files in configured directories
- YAML frontmatter parsing (name, description, domain, triggers, tier/state requirements, priority)
- Regex-based trigger matching
- Hot-reload file watcher
- Domain classification (utility, communication, automation, governance, etc.)
- Tier-based filtering (unverified, verified, sealed)

**Skill Format:**

```markdown
---
name: my-skill
description: What this skill does
domain: utility
triggers:
  - "\\bimpact\\b"
  - "\\$imp"
requires_state: [ONLINE]
requires_tier: verified
priority: 10
direct_invoke: true
---

# Skill content in markdown
...
```

**Discovery Mechanism:**

```typescript
// From discovery.ts
const skillRegistry = new SkillRegistry(config);
const { loaded, errors } = skillRegistry.discover();
skillRegistry.startWatching(); // hot-reload
```

### What's Missing

1. **No skills are shipped with the repository**
   - `skillDirs` is configured but empty
   - No example skills in the codebase
   - No dev/workflow skills (code review, testing, git, etc.)

2. **Skills are not integrated into the system prompt**
   - The gateway doesn't load or register skills
   - Agent has no awareness of available skills
   - No skill matching during prompt assembly

3. **No skill execution mechanism**
   - Skills are loaded but never executed
   - No handler for skill invocation
   - No result injection back into conversation

4. **No skill library UI or catalog**
   - No way to browse/discover skills from the gateway
   - No skill analytics (usage frequency, success rate)

### Recommendation

- **Priority: MEDIUM** — Create a minimal skill library
- Implement skill matching in system prompt assembly
- Create a skill execution tool handler
- Add example skills for common dev tasks (run tests, list files, check git status)

---

## 5. Memory

### What Exists

**Location:** `packages/memory/src/`

A **multi-adapter memory system** with:

- File-based memory (local JSON/markdown files)
- Cognee adapter (external knowledge graph integration)
- Composite adapter (fallback support)
- Session memory extraction and injection
- Retrieval with configurable parameters

**Storage Backends:**

```typescript
export interface MemoryProvider {
  store(entry: MemoryEntry): Promise<void>;
  retrieve(query: string, params?: MemoryQueryParams): Promise<MemoryEntry[]>;
  delete(id: string): Promise<void>;
  list(category?: MemoryCategory): Promise<MemoryEntry[]>;
}

export interface MemoryEntry {
  id: string;
  category: MemoryCategory; // context | decision | fact | artifact | event
  source: MemorySource; // system | user | interaction | synthesis
  content: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  expiresAt?: string;
  accessedAt?: string;
}
```

### What's Missing

1. **Memory is not integrated into the agent pipeline**
   - `AgentSessionManager` doesn't call memory retrieval
   - No memory injection into system prompt
   - No automatic memory storage after conversations

2. **No memory query UI**
   - No endpoint to search memory from the dashboard
   - No memory browser/explorer
   - No memory management (pruning, archiving)

3. **No Cognee integration**
   - External knowledge graph adapter is stubbed
   - No SPARQL queries or graph traversal
   - No relationship/entity extraction

4. **No dev-specific memory**
   - No codebase analysis storage
   - No test failure logs
   - No architectural decision records (ADRs)

### Recommendation

- **Priority: MEDIUM** — Wire memory into agent session pipeline
- Create memory injection in `AgentInvoker.process()` before LLM call
- Build memory storage after conversation completion
- Add memory endpoint to dashboard API
- Create dev memory categories: codebase_analysis, test_failures, adr, performance_profiles

---

## 6. Browser/Web Access

### What Exists

**Locations:** None found

The gateway has **zero web browsing capability**:
- No HTTP client for external APIs
- No HTML parsing
- No JavaScript execution
- No screenshot/visual inspection

### What's Missing

Everything. The system is **completely offline-capable** (by design) but has no way to:
- Fetch external documentation
- Test APIs
- Browse GitHub issues
- Check documentation sites

### Recommendation

- **Priority: LOW** — This is likely intentional for security/privacy
- If needed, create a gated `fetch_url` tool (verified/sealed tier only)
- Implement rate limiting and domain whitelisting

---

## 7. Project Context Files

### What Exists

**Location:** `CLAUDE.md` (exists, checked in)

Contains the BOTS system documentation but **no workspace persona files**:
- ❌ SOUL.md (agent values/personality)
- ❌ AGENTS.md (workspace rules)
- ❌ IDENTITY.md (agent self-identity)
- ❌ USER.md (user profile)
- ❌ BOOTSTRAP.md (startup ritual)
- ❌ HEARTBEAT.md (periodic task checklist)
- ❌ TOOLS.md (device/tool notes)

These files are **referenced in the openclaw-prompts-report.md but don't exist** in nexus-claw.

### Recommendation

- **Priority: MEDIUM** — Create workspace persona files
- Add to `.gitignore` if they should be per-developer
- Implement context file loader in system prompt assembly
- Template files: `docs/reference/templates/`

---

## 8. Testing Infrastructure

### What Exists

**Location:** `vitest.config.ts`

A **basic Vitest setup**:
- Pool mode: "forks" (process isolation)
- Test file patterns: `**/*.test.ts` across packages
- Global setup file: `test/setup.ts`
- Workspace path aliases configured

**Capabilities:**
- Unit tests can be run via `npm test` or `npm run test:watch`
- 26 test files currently in the codebase (various .test.ts files)

**Agent Test Capability:**

The system does NOT expose test running to the agent:
- No tool for `run_tests`
- No test result parsing
- No coverage reporting

### Recommendation

- **Priority: HIGH** — Create a `run_tests` tool
- Implement test result parsing and summary
- Gate to verified/sealed tier
- Add code coverage reporting
- Create `run_specific_test` tool with file pattern matching

---

## 9. CLI Dev Commands

### What Exists

**Location:** `cli/src/commands/`

Four commands currently registered:

| Command | Purpose |
|---------|---------|
| `nexus-claw run` | Start gateway server |
| `nexus-claw status` | Show gateway state, uptime, queue depth |
| `nexus-claw doctor` | Self-diagnostics (config, data dir, reachability, Node version) |
| `nexus-claw config` | Config management |
| `nexus-claw channels` | Channel adapter management |

**None of these are dev-workflow commands.** They're all gateway ops.

### Recommendation

- **Priority: MEDIUM** — Add dev workflow commands
- `nexus-claw agent-test` — test agent with mock message
- `nexus-claw eval-tools` — list/test available tools
- `nexus-claw job-status` — show BOTS job status
- `nexus-claw memory-search` — query memory from CLI
- `nexus-claw skill-list` — list available skills

---

## 10. Automation/Cron

### What Exists

**Locations:** Various services

The system has **interval-based background tasks** but no cron/scheduling:

- Session idle sweep (configurable interval, default 5 min): `agent-session.ts`
- Dashboard event broadcast debounce: `dashboard-events.ts`
- Queue consumer polling (default 100ms): `queue-consumer.ts`
- Node health pings: `node-health.ts`

None of these are **accessible to the agent** or **configurable for custom automation**.

### What's Missing

1. **No agent-scheduled actions**
   - Agent cannot request background execution
   - No periodic task framework
   - No cron expression support

2. **No proactive agent behavior**
   - No "wake up and check X" capability
   - No background learning/analysis
   - No automated maintenance tasks

3. **No webhook/event trigger support**
   - No ability to trigger agent actions from external systems
   - No GitHub webhook handler
   - No timer-based triggers

### Recommendation

- **Priority: LOW for MVP, HIGH for mature system**
- Create async job scheduler (using node-cron or Bull)
- Implement `schedule_task` tool for agents
- Add webhook endpoint for GitHub/GitLab/etc.
- Wire BOTS orchestrator into scheduled execution

---

## 11. Git Integration

### What Exists

**Location:** None found

The system has **zero git integration**:
- No commit API
- No branch operations
- No PR creation
- No diff inspection
- No blame/history
- No remote push

### Recommendation

- **Priority: HIGH for dev workflows**
- Create git tools (read-only first):
  - `git_log` — show commit history
  - `git_show` — inspect a commit/file
  - `git_status` — current state
- Then write-side tools:
  - `git_commit` — create commit (with COA fingerprint in message)
  - `git_branch` — create/switch branches
  - `git_push` — push to remote
- Add GitHub API integration for PR creation

---

## 12. Debugging/Inspection Capabilities

### What Exists

**Location:** `packages/gateway-core/src/` (various)

The system has internal visibility but **no external API for inspection**:

- Tool execution results are logged (injection scan, size cap enforcement)
- COA chain logging for all tool use
- Event emissions (invocation_complete, session_compacted, etc.)
- Transcript/session storage

**But there's no:**
- Agent debug mode (show tool calls, latency, token usage)
- Session inspector (query conversation history)
- Tool execution trace viewer
- Error explanation interface

### Recommendation

- **Priority: MEDIUM** — Add debug endpoints
- `/api/sessions/{entityId}/history` — get conversation transcript
- `/api/sessions/{entityId}/debug/last-invocation` — show tool calls, tokens, latency
- `/api/tools/{name}/schema` — inspect tool input/output schemas
- Create debug UI component in dashboard

---

## Gap Inventory Summary

### Critical Gaps (Block Development)

| Gap | Impact | Effort |
|-----|--------|--------|
| No file read/write tools | Agent cannot inspect code | Medium |
| No test runner | Cannot validate changes | Medium |
| No git tools | Cannot commit/push | High |
| No tools are registered | All tool system is dead code | Low |
| BOTS not integrated with gateway | Background work impossible | High |

### Important Gaps (Impair Development)

| Gap | Impact | Effort |
|-----|--------|--------|
| No workspace context files | No agent self-awareness | Low |
| No dev-specific system prompt | Agent lacks domain knowledge | Medium |
| No skill library | Agent reinvents knowledge | Medium |
| Memory not integrated | Agent forgets lessons | Medium |
| No dev CLI commands | Manual CLI work required | Medium |

### Nice-to-Have Gaps

| Gap | Impact | Effort |
|-----|--------|--------|
| No cron/scheduling | No proactive agents | High |
| No web browsing | Cannot fetch external docs | High |
| No debugging UI | Hard to diagnose issues | Medium |
| No GitHub webhooks | Manual triggering required | Medium |

---

## Recommended Implementation Roadmap

### Phase 1: Enable Agent Tools (Week 1-2)

1. Define 5 core tools:
   - `read_file` (path) → content
   - `write_file` (path, content) → success/error
   - `list_files` (pattern) → paths
   - `run_command` (cmd, args) → stdout/stderr
   - `git_log` (n lines) → commits

2. Register tools in server bootstrap
3. Add tool documentation to system prompt
4. Write basic tests for each tool

**Effort:** ~40 hours | **Blocker removal:** HIGH

### Phase 2: Wire BOTS into Gateway (Week 2-3)

1. Create `queue_background_task` tool
2. Integrate BOTS orchestrator with gateway state
3. Add async job status endpoint
4. Create team-mode worker prompts

**Effort:** ~60 hours | **Blocker removal:** HIGH

### Phase 3: Add Project Context (Week 3)

1. Create SOUL.md, AGENTS.md, IDENTITY.md templates
2. Implement context file loader
3. Inject into system prompt
4. Wire Tynn integration (story/task injection)

**Effort:** ~30 hours | **Blocker removal:** MEDIUM

### Phase 4: Skills & Memory (Week 4)

1. Build skill library (5-10 example skills)
2. Integrate skill matching into system prompt
3. Create skill execution handler
4. Wire memory into session pipeline

**Effort:** ~50 hours | **Blocker removal:** MEDIUM

### Phase 5: Polish (Week 5)

1. Add dev CLI commands
2. Create debug endpoints
3. Documentation
4. E2E testing

**Effort:** ~40 hours | **Polish:** HIGH

---

## Conclusion

Nexus-Claw has **solid governance and execution infrastructure** (COA chains, verification tiers, tool gating) but is **structurally configured for agent-to-user interactions**, not agent-to-developer workflows.

The codebase is **1-2 weeks away** from supporting autonomous development with:
1. Tool registration + basic file/git tools
2. BOTS gateway integration
3. Project context files

**Key insight:** The hardest part (governance, verification, COA logging) is already done. The missing piece is simply **wiring up the tools** that the infrastructure already supports.
