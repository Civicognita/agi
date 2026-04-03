# OpenClaw Self-Development Capabilities Inventory

**Project:** OpenClaw
**Repository:** https://github.com/openclaw/openclaw
**Date:** February 2026
**Purpose:** Comprehensive catalog of tooling and architecture that enables OpenClaw to develop itself and other projects.

---

## 1. Dev Workflow Tooling (`.pi/prompts/`)

OpenClaw uses a **structured prompt-based workflow system** for development tasks. These prompts are in `.pi/prompts/`:

### Prompt Templates

| File | Purpose | Key Features |
|------|---------|--------------|
| **is.md** | Analyze GitHub Issues (bugs/features) | Reads full issue context, traces code, proposes fixes; does NOT auto-implement |
| **reviewpr.md** | Thorough PR review (no merge) | Full diff analysis, quality checks, test validation; recommends READY/NEEDS WORK/NEEDS DISCUSSION |
| **landpr.md** | Land a PR (merge with workflow) | Full E2E: temp base branch, rebase, gate checks, final commit with PR# + attribution, merge |
| **cl.md** | Audit changelog entries pre-release | Cross-package deduplication, external contribution attribution, version alignment |

### Workflow Characteristics

- **Review-only** vs **merge-gated**: Each prompt explicitly separates analysis from action
- **Gate workflow**: Lint/format → build → test gates before any commit
- **Attribution**: PRs include contributor names and issue links in final commits
- **Idempotency**: Each workflow can be re-run safely (temp branches, force-with-lease)

---

## 2. Agent Tools for Code

OpenClaw provides **first-class agent tools** (typed, no shelling) in `src/agents/`:

### Core Tool Modules

| Module | Files | Capability |
|--------|-------|-----------|
| **File Operations** | `pi-tools.ts`, `pi-tools.read.ts` | Read, write, edit files with path safety |
| **Bash Execution** | `bash-tools.ts`, `bash-tools.exec.ts` | Exec with PTY, approval flow, process control, background abort |
| **Git Operations** | `openclaw-tools.ts` | Subagent spawn (parallel work), sessions_spawn tool |
| **Browser/Playwright** | `src/browser/` | CDP control, tab management, actions, snapshots, screenshots |
| **Memory Search** | `memory-search.ts`, `memory-tool.ts` | Vector + semantic search over workspace memory |
| **Channel Tools** | `channel-tools.ts` | Send messages across Telegram, Discord, Slack, Signal, etc. |
| **Project Context** | `agent-scope.ts` | Agent path sandboxing, workspace isolation |

### Tool Safety & Approval

- **Approval flow** (`bash-tools.exec-approval-request.ts`): Long-running or sensitive commands require user approval
- **PTY fallback** (`bash-tools.exec.pty-fallback.ts`): Graceful degradation for pseudo-terminal unavailability
- **Session isolation** (`agent-paths.ts`): Agents run in scoped workspace paths; cross-session access controlled
- **Tool schema validation** (`pi-tools.schema.ts`): TypeBox-based schemas; no `anyOf`/`oneOf` unions

### Invocation Patterns

- **Synchronous tools** (`read`, `write`, `exec`) return results directly to the model
- **Async tools** (`browser`, `sessions_spawn`) may use callbacks or announce patterns for completion
- **Streaming approval** (`exec-approvals.ts`): User can approve/reject mid-session

---

## 3. Subagent/Worker Dispatch

OpenClaw implements **isolated background agent runs** for parallel work.

### Sessions Spawn Tool (`src/agents/openclaw-tools.subagents.*`)

**Purpose:** Spawn a sub-agent that runs independently and announces results back to requester chat.

| Feature | Implementation |
|---------|-----------------|
| **Spawn** | `sessions_spawn` tool (no blocking; returns run ID immediately) |
| **Isolation** | Own session (`agent:<id>:subagent:<uuid>`), separate context window |
| **Model override** | Per-spawn `model` and `thinking` level configuration |
| **Nesting depth** | Default `maxSpawnDepth: 1` (no sub-sub-agents); can enable `maxSpawnDepth: 2` for orchestrator pattern |
| **Timeout** | Optional `runTimeoutSeconds` aborts long-running tasks |
| **Auto-archive** | Sessions auto-deleted after `archiveAfterMinutes` (default: 60); transcript renamed to `*.deleted.<ts>` |
| **Delivery** | Announce pattern: direct `agent` delivery with idempotency key; falls back to queue routing |
| **Cost optimization** | Sub-agents inherit model from caller unless overridden; can set cheaper model globally |

### Allowlist

- `agents.list[].subagents.allowAgents`: Restrict which agent IDs can spawn (`["*"]` for any)
- Default: only requester agent can spawn

### Test Coverage

- Depth limits (`sessions-spawn.depth-limits.test.ts`)
- Allowlist enforcement (`sessions-spawn.allowlist.e2e.test.ts`)
- Lifecycle management (`sessions-spawn.lifecycle.e2e.test.ts`)
- Model override behavior (`sessions-spawn.model.e2e.test.ts`)

---

## 4. Skills System for Dev

Skills are **Markdown-based plugin system** for dynamic capability loading.

### Skill Architecture

**Location:** `~/.openclaw/workspace/skills/` (user-defined) + extensions

**Structure:**
```
my-skill/
├── SKILL.md          # Frontmatter metadata + instructions
├── scripts/          # Optional: shell/Python helpers
└── resources/        # Optional: configs, data files
```

**SKILL.md Format:**
```yaml
---
name: skill_name
description: What this skill does
tools:                # Optional tool definitions
  - name: tool_name
    description: ...
---
# Skill Instructions (Markdown)

When the user asks for X, use the `bash` tool to...
```

### Plugin Infrastructure

**File:** `src/agents/skills/plugin-skills.ts`

- Automatic discovery from workspace + installed extensions
- Skill list injected into system prompt (metadata only; not full content)
- Skills loaded per session; can be disabled globally via `plugins.slots.memory = "none"`
- Token budget: skills are listed (~546 tok for ~12 skills), not full content

### Skill Lifecycle

1. User creates `~/.openclaw/workspace/skills/new-skill/SKILL.md`
2. Agent refreshes or gateway restarts (auto-discovers)
3. Skill metadata injected into next session's system prompt
4. Agent can reference skill by name in instructions
5. User can browse/publish skills to ClawHub (community repository)

---

## 5. Browser/Playwright Integration

OpenClaw runs **isolated, agent-controlled browser profiles** via Chrome DevTools Protocol (CDP).

### Browser Profiles

**Location:** `src/browser/`

| Profile | Managed? | Source | Use Case |
|---------|----------|--------|----------|
| **openclaw** | Yes | Isolated browser process | Agent-only automation; separate from personal browsing |
| **chrome** | No | System browser + extension | Your daily driver; needs extension relay |
| **work**, **remote** | Optional | Custom CDP URLs | Multi-profile support |

### Configuration

**File:** `~/.openclaw/openclaw.json`

```json5
{
  browser: {
    enabled: true,
    defaultProfile: "openclaw",  // or "chrome"
    headless: false,
    executablePath: "/Applications/Brave Browser.app/...",
    profiles: {
      openclaw: { cdpPort: 18800, color: "#FF4500" },
      work: { cdpPort: 18801, color: "#0066CC" },
      remote: { cdpUrl: "http://10.0.0.42:9222", color: "#00AA00" }
    }
  }
}
```

### Agent API

**Tool:** `browser` (in `openclaw-tools.ts`)

- `open(url)` — Open tab
- `list()` — List tabs
- `focus(tabId)` — Focus tab
- `close(tabId)` — Close tab
- `click(selector)` — Click element
- `type(text)` — Type text
- `select(selector, options)` — Select dropdown
- `drag(from, to)` — Drag and drop
- `snapshot()` — Accessibility tree
- `screenshot()` — Visual screenshot
- `pdf()` — Export PDF
- `evaluate(function)` — JavaScript eval

### Chrome Extension

**For extension relay mode** (`docs/tools/chrome-extension.md`):
- Installed on user's default browser
- Allows agent to control extension-attached tabs
- Requires manual attach (user clicks extension icon in target tab)
- Falls back to managed `openclaw` profile if unavailable

---

## 6. Memory/Context Management

OpenClaw maintains **persistent agent memory across sessions** using plain Markdown files + automatic flush.

### Memory Files

**Location:** `~/.openclaw/workspace/`

| File | Purpose | Scope |
|------|---------|-------|
| `memory/YYYY-MM-DD.md` | Daily log (append-only) | Loaded at session start (today + yesterday) |
| `MEMORY.md` | Long-term curated memory | Only in main private session (not group/sandbox) |
| `SOUL.md` | Agent values & personality | Loaded every session |
| `IDENTITY.md` | Agent name, creature, emoji, avatar | Loaded every session |
| `USER.md` | User preferences & context | Loaded every session |
| `BOOTSTRAP.md` | Custom system prompt injections | Loaded every session |
| `TOOLS.md` | Custom tool documentation | Loaded (but truncated if >20K chars) |

### Automatic Memory Flush

**File:** `src/agents/tools/memory-tool.ts`

When session approaches **auto-compaction threshold**:

1. OpenClaw triggers silent agentic turn
2. Model prompted: "Write lasting notes to `memory/YYYY-MM-DD.md`; reply with `NO_REPLY` if nothing"
3. System prompt includes `reserveTokensFloor` (default 20k) + `softThresholdTokens` (default 4k)
4. One flush per compaction cycle (tracked in `sessions.json`)
5. If workspace is read-only, flush is skipped

**Config:**
```json5
{
  agents: {
    defaults: {
      compaction: {
        reserveTokensFloor: 20000,
        memoryFlush: {
          enabled: true,
          softThresholdTokens: 4000,
          systemPrompt: "Session nearing compaction. Store durable memories now.",
          prompt: "Write any lasting notes..."
        }
      }
    }
  }
}
```

### Vector Memory Search

**Plugin:** `extensions/memory-core/`, `extensions/memory-lancedb/`

- Semantic search over `MEMORY.md` + `memory/*.md`
- Uses embeddings (local or remote: OpenAI, Gemini, Voyage)
- SQLite-vec backend for fast similarity search
- Auto-triggers when files change (debounced)
- **Not included in context window size**

### Session Compaction

**File:** `docs/concepts/compaction.md`

- Automatic when tokens exceed window threshold
- Compaction summarizes older history into a single "compact" turn
- Triggered before memory flush
- Preserves continuity while freeing context space

---

## 7. Plugin/Extension Architecture

OpenClaw is **plugin-first** with ~40+ extensions in `extensions/`.

### Plugin Structure

**Location:** `extensions/<plugin-name>/`

```
plugin-name/
├── package.json           # Plugin metadata + dependencies
├── src/
│   ├── index.ts          # Export plugin class
│   ├── tool.ts           # Custom tools
│   └── skills/           # SKILL.md files
├── SKILL.md              # Plugin skill documentation
└── README.md
```

### Plugin Types

| Type | Examples | Purpose |
|------|----------|---------|
| **Channel plugins** | discord, telegram, signal, slack, msteams, matrix | Add messaging channels |
| **LLM auth plugins** | google-antigravity-auth, qwen-portal-auth, minimax-portal-auth | OAuth/auth for LLM providers |
| **Memory plugins** | memory-core, memory-lancedb | Backend for memory storage/search |
| **Tool plugins** | lobster, llm-task, phone-control, device-pair | Custom agent tools |
| **Skill plugins** | feishu/skills | Domain-specific instruction sets |

### Plugin SDK & Lifecycle

**File:** `src/extensionAPI.ts`

- Plugin loads via `pnpm install --omit=dev` in plugin dir
- Runtime deps go in `dependencies`; keep workspace deps out
- Plugins expose tools + skills that merge into agent context
- Plugin discovery: `src/cli/plugin-registry.ts`
- Auto-enable via allowlist: `src/config/plugin-auto-enable.ts`

### Installation & Registry

**File:** `src/cli/plugins-cli.ts`

- User runs `openclaw plugins install <name>`
- Resolves from npm or local paths
- Auto-enables if on allowlist
- Can be disabled via `plugins.allowlist` config

---

## 8. CI/Testing Infrastructure

OpenClaw has **302 test files** (majority in `src/agents/`) with extensive automation.

### Test Framework

**Framework:** Vitest (TypeScript-first)

- Coverage thresholds: 70% lines/branches/functions/statements
- V8 instrumentation
- Colocated: `*.test.ts` next to source

### Test Types

| Type | Pattern | Purpose |
|------|---------|---------|
| **Unit tests** | `*.test.ts` | Individual functions + classes |
| **Integration tests** | `*.e2e.test.ts` | Full workflows (agent spawn, tool execution) |
| **Live tests** | `LIVE=1 pnpm test:live` | Real API keys; real models + services |
| **Docker tests** | `pnpm test:docker:live-models`, `pnpm test:docker:live-gateway` | Sandboxed gateway + browser |
| **Onboarding tests** | `pnpm test:docker:onboard` | End-to-end user onboarding |

### Test Coverage Areas

- **Subagent spawn**: depth limits, allowlist, lifecycle, model overrides
- **Bash tools**: approval flow, PTY fallback, process cleanup, background abort
- **Browser**: tab control, snapshots, screenshot fidelity
- **Auth profiles**: cooldown, expiry, failure handling, round-robin
- **Memory**: flush triggers, compaction, vector search
- **Plugin registry**: discovery, installation, auto-enable
- **Cron/automation**: polling, webhooks, Gmail PubSub, hooks

### CI Pipeline

**Files:** `.github/workflows/`, `.pre-commit-config.yaml`

- Pre-commit hooks: lint, format check, typecheck
- Run before push: `prek install` (same checks as CI)
- Smoke tests: `pnpm test:install:smoke`
- Release checks: `pnpm release:check`

### Linting & Formatting

- **Oxlint** (Rust): Fast linting
- **Oxfmt** (Rust): Fast formatting
- Commands: `pnpm check`, `pnpm format:fix`
- Pre-commit enforces both

---

## 9. Project Context Files (Bootstrap)

These files shape agent **self-awareness** and **task orientation**:

### Core Context Files

**Location:** `docs/reference/templates/` (templates) + `~/.openclaw/workspace/` (runtime)

| File | Content | Persistence | Use |
|------|---------|-----------|-----|
| **AGENTS.md** | Repository guidelines (dev workflow, testing, coding style, release process) | Checked into `.git` | OpenClaw project ops |
| **SOUL.md** | Agent personality + values (helpfulness, resourcefulness, trust, boundaries) | Workspace-local | Every session loads |
| **IDENTITY.md** | Name, creature, vibe, emoji, avatar | Workspace-local | UI + context |
| **USER.md** | User preferences, timezone, skills | Workspace-local | Personalization |
| **BOOTSTRAP.md** | Custom system prompt injections | Workspace-local | Domain-specific tweaks |
| **TOOLS.md** | Custom tool documentation (auto-generated) | Workspace-local | Tool reference |
| **HEARTBEAT.md** | Scheduled task definitions | Workspace-local | Cron orchestration |

### Bootstrap Workflow

1. On first run: user creates workspace
2. `openclaw bootstrap` generates defaults (SOUL.md, IDENTITY.md, USER.md)
3. User edits to customize personality + context
4. On each session start: OpenClaw injects files into system prompt
5. Model reads and uses context to guide behavior

### Token Budget

System prompt includes:
- All bootstrap files (up to 20K chars each)
- Skill metadata (~546 tok for ~12 skills)
- Tool schemas (~7,997 tok for ~20 tools)
- Runtime metadata (time, OS, model, thinking level)
- **Total:** ~38K chars (~9,603 tok) baseline

---

## 10. Cron/Automation & Scheduled Work

OpenClaw supports **persistent background automation** via cron, heartbeats, webhooks, and hooks.

### Cron Jobs

**File:** `src/cron/`, `docs/automation/cron-jobs.md`

**Features:**
- Schedule agent tasks with cron expressions (standard `*/` syntax)
- Isolated agent runs (like `sessions_spawn`)
- Optional delivery to chat (or silent)
- Cooldown between runs
- Heartbeat-based polling (every N seconds/minutes)

**Config:**
```json5
{
  agents: {
    defaults: {
      cron: [
        {
          schedule: "0 9 * * MON",  // 9 AM Monday
          task: "Review open PRs and summarize",
          label: "pr-review",
          deliverToChat: true
        },
        {
          schedule: "*/5 * * * *",  // Every 5 minutes
          task: "Check email and triage",
          label: "email-check",
          heartbeat: true
        }
      ]
    }
  }
}
```

### Heartbeats vs Cron

| Feature | Cron | Heartbeat |
|---------|------|-----------|
| **Timing** | Wall-clock schedule | Relative polling interval |
| **Precision** | Minute-level | Seconds/minutes |
| **Gateway restart** | Timers lost (re-armed) | Survives restart (durable) |
| **Use case** | Daily reports, weekly syncs | Real-time polling (emails, messages) |

### Hooks

**File:** `src/hooks/`, `docs/automation/hooks.md`

**Trigger types:**
- `onGatewayStart`, `onGatewayStop`
- `onSessionStart`, `onSessionEnd`, `onCompaction`
- `onToolInvoke`, `onToolResult`
- `onMessage`, `onCronRun`
- `beforeApplyPatch`, `afterApplyPatch`

**Usage:** Define custom behavior (logging, cleanup, side effects) without modifying core.

### Webhooks

**File:** `docs/automation/webhook.md`

- HTTP POST endpoint for external integrations
- Delivers webhook payload to agent
- Agent runs isolated session
- Optional response delivery back to webhook caller

### Gmail PubSub

**File:** `docs/automation/gmail-pubsub.md`

- Google Cloud Pub/Sub trigger for Gmail label updates
- Real-time push notification (not polling)
- Agent receives email metadata
- Runs isolation agent for triage/processing

---

## 11. Development Patterns & Guardrails

### Multi-Agent Safety

**From AGENTS.md**, constraints for parallel work:

- **DO NOT** create/apply/drop `git stash` (other agents may be working)
- **DO NOT** create/remove `git worktree` checkouts (shared state)
- **DO NOT** switch branches unless explicitly requested (preserve state)
- **Focus reports** on your changes only; avoid disclaimers unless blocked
- **Auto-resolve** formatting-only diffs without asking
- **Continue safely** if unrecognized files exist (don't block on them)

### Git Workflow

**Committer pattern** (`scripts/committer`):

```bash
scripts/committer "<msg>" <file...>
```

- Scopes staging to explicit files (no `git add .`)
- Prevents accidental inclusion of sensitive files (`.env`, credentials)
- Enforces conventional commit style

**Rebase + force-with-lease:**
```bash
git rebase <base>
git push origin <branch> --force-with-lease
```

Safer than `--force`; respects concurrent pushes.

### Code Style Enforcement

- **No `@ts-nocheck`** and **no disabling `no-explicit-any`** — fix root causes
- **No prototype mutation** for shared behavior — use explicit inheritance
- **TypeBox schemas** (no `anyOf`/`oneOf`) for tool inputs
- **Files under ~700 LOC** — split/refactor when it improves clarity
- **Brief comments** for non-obvious logic

### Testing Discipline

- **Before push:** `pnpm test` (+ coverage if you touched logic)
- **Live tests:** `LIVE=1 pnpm test:live` (real keys, real services)
- **Gate before commit:** lint → build → test → commit
- **E2E coverage:** subagents, browser, memory, cron, plugin discovery

---

## 12. Release & Deployment Workflow

### Version Management

**Files:** `package.json`, `apps/*/Info.plist`, `apps/android/build.gradle.kts`, `docs/install/updating.md`

- **CLI:** `package.json` (single version)
- **iOS:** `apps/ios/Sources/Info.plist` + `apps/ios/Tests/Info.plist`
- **Android:** `apps/android/app/build.gradle.kts` (versionName/versionCode)
- **macOS:** `apps/macos/Sources/OpenClaw/Resources/Info.plist`
- **Docs:** `docs/install/updating.md` (pinned npm version)
- **Release docs:** `docs/platforms/mac/release.md`

### Release Checklist

1. **Check divergence:** `git fetch upstream && git rev-list --left-right --count main...upstream/main`
2. **Read release docs:** `docs/reference/RELEASING.md` + `docs/platforms/mac/release.md`
3. **Update CHANGELOG.md:** User-facing changes only (no internals)
4. **Bump version everywhere** (except `appcast.xml` until Sparkle release)
5. **Pre-release checks:** `pnpm release:check` + `pnpm test:install:smoke`
6. **Tag:** `vYYYY.M.D` for stable, `vYYYY.M.D-beta.N` for beta
7. **Publish:** `npm publish --access public --otp=<otp>` (from 1Password)
8. **Verify:** `npm view openclaw version --userconfig "$(mktemp)"`

### Plugin Release Fast Path

- Only release **already-on-npm** plugins
- Use tmux for `op` + `npm publish` (avoids hangs)
- Compare local version to `npm view <plugin> version`
- Publish only if versions differ
- Post-check: `npm view @openclaw/<name> version`

---

## Summary Table: All Tools & Capabilities

| Category | Components | Purpose |
|----------|-----------|---------|
| **Dev Workflows** | `.pi/prompts/` (is, reviewpr, landpr, cl) | Structured task templates (analyze, review, merge, release) |
| **Agent Tools** | `pi-tools.*`, `bash-tools.*`, `browser/`, `channel-tools.*` | File I/O, bash exec, browser control, messaging |
| **Parallel Work** | `sessions_spawn`, subagent dispatch | Spawn isolated agent runs with model/thinking overrides |
| **Skills** | `~/.openclaw/workspace/skills/`, extensions | Markdown-based plugin system for dynamic capabilities |
| **Browser** | `src/browser/`, CDP profiles | Isolated Chrome/Brave/Edge profiles managed by agent |
| **Memory** | `memory/YYYY-MM-DD.md`, `MEMORY.md`, vector search | Persistent workspace-local Markdown files + semantic search |
| **Plugins** | 40+ extensions (channels, tools, auth, memory) | Plugin SDK + auto-discovery + skill injection |
| **Testing** | 302 test files, Vitest, V8 coverage | Unit + integration + live + docker + smoke tests |
| **Context** | SOUL.md, IDENTITY.md, USER.md, BOOTSTRAP.md | Bootstrap files shape agent personality & knowledge |
| **Automation** | Cron, heartbeats, webhooks, Gmail PubSub, hooks | Background + scheduled + event-driven task execution |
| **Release** | 1Password, npm publish, version bumping, changelog | Coordinated multi-platform release workflow |

---

## File Paths Reference

### Key Source Directories

```
src/
├── agents/               # Core agent tooling (302 test files)
│   ├── openclaw-tools.ts             # Main tool factory
│   ├── pi-tools*.ts                  # File I/O, memory, schemas
│   ├── bash-tools*.ts                # Bash execution with approval
│   ├── browser/                      # CDP control
│   ├── subagent-*.ts                 # Sub-agent dispatch
│   ├── memory-*.ts                   # Memory search
│   ├── skills/plugin-skills.ts       # Skill discovery/injection
│   └── *.test.ts                     # Test suites (302 files)
├── browser/              # Browser profile management
├── cli/                  # CLI commands
├── cron/                 # Cron job scheduling + heartbeats
├── commands/             # Agent-facing commands (doctor, status)
├── config/               # Configuration types & loading
├── gateway/              # Gateway server + startup
├── hooks/                # Hook system for lifecycle events
├── memory/               # Memory schema + file sync
└── channels/             # Channel adapters

extensions/
├── bluebubbles/          # iMessage on macOS
├── discord/              # Discord channel
├── feishu/               # Feishu LMS channel
├── llm-task/             # LLM task delegation tool
├── lobster/              # Browser companion tool
├── memory-core/          # Default memory backend
├── memory-lancedb/       # LanceDB vector memory
├── signal/               # Signal channel
├── slack/                # Slack channel
├── telegram/             # Telegram channel
├── msteams/              # MS Teams channel
├── mattermost/           # Mattermost channel
├── voice-call/           # Voice integration
└── [38 more...]          # ~40 total extensions

docs/
├── tools/                # Agent tool documentation
│   ├── browser.md
│   ├── subagents.md
│   ├── exec.md
│   ├── skills.md
│   ├── creating-skills.md
│   └── plugin.md
├── automation/           # Cron, webhooks, hooks, PubSub
├── concepts/             # Architecture docs (memory, context, compaction, session)
├── reference/templates/  # SOUL.md, IDENTITY.md, USER.md, BOOTSTRAP.md templates
├── platforms/            # macOS, iOS, Android guides
└── plugins/              # Plugin documentation

.pi/prompts/             # Dev task templates
├── is.md                 # Issue analysis
├── reviewpr.md           # PR review
├── landpr.md             # PR merge workflow
└── cl.md                 # Changelog audit

.agent/workflows/        # Agent workflows (e.g., upstream sync)
├── update_clawdbot.md   # Sync fork from upstream

tests/ & *.test.ts       # 302 test files across codebase
```

### Critical Configuration Files

- `package.json` — Dependencies, scripts, version
- `~/.openclaw/openclaw.json` — Browser, agent defaults, plugin config
- `~/.openclaw/workspace/SOUL.md`, `IDENTITY.md`, `USER.md` — Agent bootstrap
- `.env.example` — Environment variable reference
- `vitest.config.ts` — Test runner config
- `.oxlintrc.json` — Linting rules
- `.oxfmtrc.jsonc` — Formatting config

---

## What Nexus-Claw Should Build

Based on this inventory, **nexus-claw** needs:

### High-Priority (MVP)

1. **Dev workflow prompts** (`.pi/prompts/`) — Structured task analysis, review, merge templates
2. **Agent tool registry** — File I/O, bash exec, git operations, basic browser control
3. **Subagent dispatch** — Spawn isolated runs with model overrides; announce results
4. **Skill system** — Markdown-based plugins; auto-inject into system prompt
5. **Memory system** — Workspace Markdown files; auto-flush before compaction
6. **Bootstrap files** — SOUL.md, IDENTITY.md, USER.md for agent context

### Medium-Priority (Phase 2)

7. **Browser/CDP control** — Isolated profiles; tab management, snapshots, screenshots
8. **Plugin architecture** — Plugin SDK; plugin discovery + installation
9. **Testing infrastructure** — Vitest setup; unit + integration + live test support
10. **Cron/automation** — Background task scheduling; heartbeat polling

### Nice-to-Have (Phase 3+)

11. **Vector memory search** — Semantic search over memory files
12. **Multi-agent safety** — Worktree isolation, git stash prevention
13. **Release automation** — Version bumping, changelog audit, npm publish
14. **Platform-specific** — macOS app, iOS/Android, voice

---

## Conclusion

OpenClaw's self-development capability emerges from:

- **Structured workflows** in prompts (not free-form agent reasoning)
- **First-class tools** that don't require shelling out
- **Parallel work** via subagent dispatch
- **Persistent memory** in Markdown files with automatic flush
- **Plugin-first architecture** for extensibility
- **Comprehensive testing** (302 tests) enforcing quality
- **Multi-platform coordination** (CLI, gateway, macOS/iOS/Android)
- **Developer experience** (AGENTS.md guidelines, bootstrap files, skill system)

**Nexus-claw** should prioritize the first 6 items (MVP) to unlock self-development, then add browser control and plugins for full capability parity with OpenClaw.
