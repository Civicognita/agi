# Nexus-Claw Infrastructure Gap Inventory

**Quick reference:** What exists, what's missing, what's stubbed.

---

## 1. Agent Tools

### Exists ✓
- Generic tool registration framework (manifest-based)
- State/tier-based gating (unverified/verified/sealed)
- Result size capping (16 KB default)
- Prompt injection scanning
- COA logging for all tool use
- Multi-turn tool loop handling (5 max attempts)

### Missing ✗
- **NO TOOLS ARE REGISTERED** — tool registry is empty
- No file I/O (read/write/list)
- No code execution (test, lint, compile)
- No git operations (commit, push, branch)
- No shell/exec capability
- No memory/context inspection

### Stubbed (Partial)
- Canvas tool manifest defined but handlers incomplete
- Tool schema validation framework exists but unused

### Recommendation
Register 5 core tools: read_file, write_file, list_files, run_command, git_log

---

## 2. System Prompt

### Exists ✓
- Dynamic prompt builder (never cached)
- Entity context injection (ID, tier, channel)
- State constraints (ONLINE/LIMBO/OFFLINE/UNKNOWN)
- Available tools listing
- Tier-based capability descriptions
- Response format specifications
- TASKMASTER emission rules (q:> shortcode)

### Missing ✗
- No dev-specific prompt variants
- No workspace context injection (SOUL.md, AGENTS.md, etc.)
- No developer persona
- No active task/story context (from Tynn)
- None of the 16 OpenClaw prompt patterns implemented

### Stubbed (Partial)
- Skeleton for workspace context exists but not loaded
- Tynn integration points exist but not wired

### Recommendation
Create dev workflow prompt builder with workspace context + active task injection

---

## 3. Subagent/Worker Orchestration

### Exists ✓
- **AgentBridge:** Human-in-the-loop message review (WebChat UI)
- **BOTS System:** Multi-phase autonomous job orchestration
  - Job phases with gate types (auto, checkpoint, terminal)
  - Worker domain taxonomy (8 domains, 20+ worker types)
  - Enforced worker chains (hacker→tester, writer.*→editor, etc.)
  - Worktree isolation per job
  - Handoff JSON for result capture
  - Team mode support (agent teams)
  - File-based job persistence

### Missing ✗
- **BOTS not integrated with gateway agent** — no way for agent to queue jobs
- No TASKMASTER emission (q:>) support in gateway
- Worker prompts are **not implemented** (files referenced but don't exist)
- No async job status querying from UI
- BOTS requires manual CLI invocation

### Stubbed (Partial)
- Worker prompt templates referenced but not created (`.claude/prompts/worker-base.md`, etc.)
- Team executor partially implemented
- Orchestrator gate evaluation exists

### Recommendation
Create queue_background_task tool + integrate BOTS orchestrator with gateway

---

## 4. Skills

### Exists ✓
- Skill auto-discovery system (scans *.skill.md)
- YAML frontmatter parser (name, description, triggers, tier/state requirements)
- Regex-based trigger matching
- Hot-reload file watcher
- Domain classification (utility, communication, automation, governance)
- Tier-based filtering (unverified, verified, sealed)
- Skill registry with match tracking

### Missing ✗
- **NO SKILLS SHIPPED** — skill directories are empty
- Skills not integrated into system prompt
- No skill execution mechanism
- No skill handler for invocation
- No skill discovery UI

### Stubbed (Partial)
- Discovery framework fully implemented
- Loader/matching functions exist but unused

### Recommendation
Create example skill library + integrate skill matching into prompt assembly

---

## 5. Memory

### Exists ✓
- Multi-adapter memory system (file-based, Cognee integration)
- MemoryEntry abstraction (id, category, source, content, metadata)
- Session memory extraction
- Retrieval API with query parameters
- Composite adapter for fallback support

### Missing ✗
- Memory not integrated into agent pipeline
- No memory injection into system prompt
- No automatic memory storage after conversations
- No memory query UI/endpoint
- Cognee adapter is stubbed (no graph integration)
- No dev-specific memory categories

### Stubbed (Partial)
- CogneeMemoryProvider exists but does nothing
- Session extraction logic complete but unused
- Retrieval pipeline implemented but not called

### Recommendation
Wire memory into AgentInvoker: retrieve before LLM, store after completion

---

## 6. Browser/Web Access

### Exists ✓
- Nothing

### Missing ✗
- No HTTP client for external URLs
- No HTML parsing
- No JavaScript execution
- No screenshot capability

### Rationale
Likely intentional for security/privacy (offline-capable system)

### Recommendation
If needed: create gated fetch_url tool (verified/sealed only) with domain whitelist

---

## 7. Project Context Files

### Exists ✓
- CLAUDE.md (BOTS documentation) — checked in

### Missing ✗
- SOUL.md (agent values/personality) — NOT in codebase
- AGENTS.md (workspace rules) — NOT in codebase
- IDENTITY.md (agent self-identity) — NOT in codebase
- USER.md (user profile) — NOT in codebase
- BOOTSTRAP.md (startup ritual) — NOT in codebase
- HEARTBEAT.md (periodic task checklist) — NOT in codebase
- TOOLS.md (device/tool notes) — NOT in codebase

### Stubbed (Partial)
- None; these files are completely absent

### Recommendation
Create persona file templates in `docs/reference/templates/` + implement context loader

---

## 8. Testing Infrastructure

### Exists ✓
- Vitest configuration (pool: forks, setupFiles, path aliases)
- Test file patterns defined (packages/**/src/**/*.test.ts, etc.)
- 26 test files in repository
- Test can be run via npm scripts

### Missing ✗
- No `run_tests` tool for agent
- No test result parsing
- No coverage reporting
- No test failure analysis

### Stubbed (Partial)
- Full test infrastructure exists but agent cannot invoke it

### Recommendation
Create run_tests tool that executes vitest and parses results

---

## 9. CLI Dev Commands

### Exists ✓
- `nexus-claw run` — start gateway
- `nexus-claw status` — show state/uptime/queue depth
- `nexus-claw doctor` — diagnostics (config, data dir, reachability, Node version)
- `nexus-claw config` — config management
- `nexus-claw channels` — channel adapter management

### Missing ✗
- No dev workflow commands
- No agent testing (mock message)
- No tool evaluation
- No job status CLI
- No memory search CLI
- No skill listing CLI

### Recommendation
Add: agent-test, eval-tools, job-status, memory-search, skill-list commands

---

## 10. Automation/Cron

### Exists ✓
- Interval-based background tasks:
  - Session idle sweep (default 5 min)
  - Dashboard broadcast debounce
  - Queue consumer polling (default 100ms)
  - Node health pings

### Missing ✗
- No agent-accessible scheduling
- No cron expression support
- No webhook/event trigger support
- No proactive agent behavior
- No scheduled background work

### Stubbed (Partial)
- Interval system exists but not exposed to agent

### Recommendation
Integrate BOTS with node-cron for scheduled job execution

---

## 11. Git Integration

### Exists ✓
- Nothing

### Missing ✗
- No commit API
- No branch operations
- No PR creation
- No diff inspection
- No blame/history
- No push/sync

### Recommendation
Implement git tools: git_log (read), git_commit, git_push (write)

---

## 12. Debugging/Inspection

### Exists ✓
- Internal tool execution logging (injection scan, size cap)
- COA chain logging
- Event emissions (invocation_complete, session_compacted)
- Session/transcript storage

### Missing ✗
- No debug mode (show tool calls, latency, tokens)
- No session inspector API
- No tool execution trace viewer
- No error explanation interface
- No dashboard debug UI

### Recommendation
Add debug endpoints + UI component

---

## Critical Path to MVP

### Must Have (Week 1-2)
1. Register core tools (read_file, write_file, list_files, run_command, git_log)
2. Integrate BOTS with gateway (queue_background_task tool)
3. Create workspace context files + loader

### Should Have (Week 3-4)
4. Wire memory into session pipeline
5. Create skill library + execution
6. Add dev CLI commands

### Nice to Have (Week 5+)
7. Cron/scheduling integration
8. GitHub webhooks
9. Debug UI
10. Web browsing

---

## Summary Statistics

| Category | Exists | Missing | Stubbed |
|----------|--------|---------|---------|
| Agent Tools | 1 (framework) | 15 | 1 |
| System Prompt | 1 (builder) | 16 patterns | 0 |
| Orchestration | 2 (bridge, BOTS) | 3 (integration) | 2 |
| Skills | 1 (discovery) | 2 (library, execution) | 0 |
| Memory | 1 (system) | 3 (integration, UI, cognee) | 1 |
| Browser | 0 | 4 | 0 |
| Context Files | 1 (CLAUDE.md) | 7 | 0 |
| Testing | 1 (vitest) | 3 (agent tool, coverage, analysis) | 0 |
| CLI | 5 (ops) | 6 (dev) | 0 |
| Automation | 1 (intervals) | 3 (scheduling, webhooks, agent) | 0 |
| Git | 0 | 6 | 0 |
| Debugging | 1 (logging) | 4 (debug mode, UI, tracer, inspector) | 0 |
| **TOTAL** | **17** | **60** | **4** |

**Gap ratio:** 60/81 = 74% of features are missing. Most are quick wins (low effort, high impact).

---

## Implementation Effort Estimates

| Task | Hours | Difficulty | Impact |
|------|-------|-----------|--------|
| Register 5 core tools | 8 | Low | HIGH |
| BOTS gateway integration | 16 | Medium | HIGH |
| Workspace context loader | 6 | Low | MEDIUM |
| Wire memory into pipeline | 8 | Medium | MEDIUM |
| Create skill library | 12 | Medium | MEDIUM |
| Add dev CLI commands | 8 | Low | MEDIUM |
| Test runner tool | 8 | Medium | HIGH |
| Git tools | 12 | Medium | HIGH |
| Cron/scheduler | 16 | High | LOW |
| Debug UI | 12 | Medium | MEDIUM |

**Total MVP (top 3):** ~30 hours → **autonomous agent can run tests, read/write code, queue background tasks**

---

## Key Insights

1. **Governance is solid** — COA chains, verification tiers, tool gating all implemented. Just need to use them.

2. **Orchestration exists** — BOTS system is feature-complete. Just needs gateway integration.

3. **Most gaps are integration work** — not algorithmic complexity. Low-hanging fruit.

4. **Agent has no autonomy** — currently can only respond to messages. Cannot:
   - Read code
   - Run tests
   - Execute background work
   - Persist learnings
   - Schedule actions

5. **System is designed for user-agent interaction** — not agent-self-improvement or agent-to-developer workflow.

---

## Next Steps

1. **Immediate:** Register first tool (read_file) to validate framework
2. **This week:** Create core tool suite (5 tools)
3. **Next week:** Integrate BOTS with gateway
4. **Follow-up:** Build project context + memory integration

**Goal:** By end of month, agent can autonomously read code, run tests, commit changes, and queue background work.
