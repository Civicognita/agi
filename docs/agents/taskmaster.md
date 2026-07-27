# Taskmaster: System Reference

**Taskmaster** is the built-in job orchestration engine in Aionima. It receives background task requests via the `taskmaster_dispatch` tool, routes them to worker agents scoped to the dispatching project, and manages the full job lifecycle from dispatch to completion. `agi` is the harness that runs Aion; Taskmaster is one of `agi`'s harness-level capabilities.

Workers execute as **real coding agents** (Claude Code / Codex) driven through a paired [Genie](./mcp-integration.md) workspace's `runAgent` MCP tool — not an in-process LLM tool-loop. This gives workers genuine file/terminal access (real edits, real test runs, a real dev environment) instead of Taskmaster's own `ToolRegistry`-mediated tool calls. See [Genie Pairing](#genie-pairing-one-time-setup) below for the one-time setup a project needs before it can dispatch Taskmaster jobs.

> **Note:** Workers are defined in plugins via `api.registerWorker()`. The engine that runs them lives entirely in `packages/gateway-core/`. Prompts for the built-in workers are loaded from `prompts/workers/` by `WorkerPromptLoader` — these prompts become the initial `runAgent` prompt handed to the spawned coding agent. There is no external BOTS repo.

> **Tradeoff:** a Genie-executed worker is a full coding-agent CLI with its own model selection and full native tool access. `WorkerDefinition.modelTier` / `allowedTools` no longer constrain a Genie-executed worker the way they did the old in-process ToolRegistry path — that's the necessary cost of a real dev environment instead of a simulated one.

> **Not yet implemented:** multi-worker "teams" per phase (parallel workers within one phase, described aspirationally in `prompts/taskmaster.md`). Today `taskmaster-orchestrator.ts`'s `WorkPhase` is one worker per phase; sequential multi-phase decomposition and checkpoint-gate pausing between phases ARE implemented (see Gate Types below).

---

## Architecture

```
Agent (LLM tool call)
  └── taskmaster_dispatch tool           (requires projectPath)
        └── ~/.agi/{projectSlug}/dispatch/jobs/{jobId}.json   (per-project dispatch file)
              └── JobBridge.ensureJob()
                    └── ~/.agi/state/taskmaster.json   (structured state index — global)
                          └── WorkerRuntime.executeJob()
                                └── WorkerPromptLoader.getSystemPrompt()
                                      └── McpClient.callTool("<projectSlug>:genie", "runAgent", ...)
                                          ├── start   — launch a Claude Code / Codex agent
                                          ├── send    — deliver the resolved worker prompt
                                          ├── read    — poll for the `<<<TASKMASTER_DONE>>>` marker
                                          └── stop    — clean up the agent terminal
                                      └── runtime:event emissions
                                            ├── job_started
                                            ├── phase_started / phase_completed / phase_failed
                                            ├── checkpoint_pending / checkpoint_reached
                                            ├── worker_started / worker_progress / worker_done
                                            ├── report_ready
                                            └── job_failed
```

### Component Responsibilities

| Component | File | Responsibility |
|-----------|------|----------------|
| `JobBridge` | `job-bridge.ts` | Translates flat dispatch files into taskmaster state entries; persists `projectPath` and each phase's `output` so a checkpoint can resume without needing the caller to re-supply context |
| `WorkerRuntime` | `worker-runtime.ts` | Manages concurrent job execution and drives each phase's worker via a paired Genie workspace's `runAgent` MCP tool |
| `McpClient` | `packages/mcp-client/src/index.ts` | Generic MCP client — `WorkerRuntime` calls `callTool("<projectSlug>:genie", "runAgent", …)` on it, the same client Tynn PM integration uses |
| `WorkerPromptLoader` | `worker-prompt-loader.ts` | Discovers and loads worker system prompts from `prompts/workers/` |
| `registerWorkerApi` | `worker-api.ts` | Registers HTTP endpoints for job control and the worker catalog |
| Orchestrator prompt | `prompts/taskmaster.md` | System prompt for the Taskmaster orchestrator agent |

---

## Worker Prompt Discovery

`WorkerPromptLoader` scans `prompts/workers/` recursively at call time (no cache — always fresh). It finds every `.md` file that is not `worker-base.md` and parses its YAML frontmatter.

The domain is derived from the file's parent directory name. The role is the filename without extension.

```
prompts/workers/
  code/
    engineer.md    → domain="code", role="engineer"  → id="code.engineer"
    hacker.md      → domain="code", role="hacker"    → id="code.hacker"
  comm/
    editor.md      → domain="comm", role="editor"    → id="comm.editor"
  worker-base.md   (skipped — shared base, not a worker)
```

### YAML Frontmatter Format

```yaml
---
name: worker-code-engineer
description: Architecture analysis and implementation specifications.
model: sonnet
color: blue
---
```

| Field | Required | Description |
|-------|----------|-------------|
| `name` | No | Worker identifier string (defaults to `worker-{domain}-{role}`) |
| `description` | No | Human-readable description shown in the catalog |
| `model` | No | LLM model tier: `sonnet`, `haiku`, or `opus` (defaults to `sonnet`) |
| `color` | No | Display color for the dashboard (defaults to `blue`) |

The markdown body after the closing `---` is used verbatim as the worker's system prompt.

### Prompt Body Structure

A well-formed worker prompt body includes these sections (in order):

1. **Class and Identity block** — a blockquote declaring `Class: WORKER`, `Model`, `Lifecycle`, and `Chain` (if enforced)
2. **Purpose** — 2–3 sentences describing the worker's specialization
3. **Constraints** — bullet list of what the worker cannot do
4. **Capabilities** — bullet list of what the worker can do
5. **Approach** — numbered steps the worker follows, always ending with writing the handoff JSON
6. **Input** — example dispatch JSON the worker receives
7. **Output** — example handoff JSON the worker writes

---

## Worker Domains

| Domain | Workers | File paths |
|--------|---------|------------|
| `code` | `engineer`, `hacker`, `reviewer`, `tester` | `prompts/workers/code/` |
| `k` | `analyst`, `cryptologist`, `librarian`, `linguist` | `prompts/workers/k/` |
| `ux` | `designer.web`, `designer.cli` | `prompts/workers/ux/` |
| `strat` | `planner`, `prioritizer` | `prompts/workers/strat/` |
| `comm` | `writer.tech`, `writer.policy`, `editor` | `prompts/workers/comm/` |
| `ops` | `deployer`, `custodian`, `syncer` | `prompts/workers/ops/` |
| `gov` | `auditor`, `archivist` | `prompts/workers/gov/` |
| `data` | `modeler`, `migrator` | `prompts/workers/data/` |

Worker identifiers use the pattern `$W.<domain>.<role>`, for example `$W.code.engineer` or `$W.comm.writer.tech`.

---

## Execution Pipeline

### 1. Dispatch

The agent has two ways to dispatch work: an explicit tool call (`taskmaster_dispatch`) and an inline emission (`q:>` prefix on a single line in its response).

**Explicit tool call.** The agent calls `taskmaster_dispatch` with a `projectPath` (required), `description`, `domain`, `worker`, and optional `priority`. The tool writes a flat JSON file to `~/.agi/{projectSlug}/dispatch/jobs/{jobId}.json` and calls the `onJobCreated` callback (passing `projectPath`) to notify `WorkerRuntime`.

**Inline `q:>` emission.** The agent may also emit a single line beginning with `q:>` in its response text — the runtime parses it as a dispatch and queues the work, same as if `taskmaster_dispatch` had been called. Maximum one `q:>` per turn; for parallel fan-out, use repeated `taskmaster_dispatch` tool calls instead.

#### Tier-dependent emission visibility

When the response text contains `q:>` lines, the runtime decides whether to **strip them from the user-visible reply** based on the entity's verification tier:

| Tier | Behavior |
|---|---|
| `unverified` | `q:>` lines stripped from the response — user never sees them. |
| `verified` | `q:>` lines stripped from the response — user never sees them. |
| `sealed` | `q:>` lines **preserved** in the response — visible to the user. |

The strip / preserve decision lives in `ToolRegistry.stripTaskmasterEmissions(text, tier)` (`packages/gateway-core/src/tool-registry.ts`); behavior pinned by the unit tests at `packages/gateway-core/src/agent.test.ts:1620+` (the canonical reference). Stripping also collapses any blank-line gaps the removed lines leave behind and trims the final text.

**Why sealed preserves.** Sealed-tier entities (the owner) get to see the dispatch decisions Aion makes — preserving `q:>` keeps the audit transparent in conversation. Verified + unverified entities (paired or general users) see only the response prose; the dispatch happens in the background and surfaces via the Work Queue UI.

**Common gotcha.** A sealed-tier entity reading a response with `q:>` lines may mistake them for manual instructions ("you should do this thing"). They're already-dispatched tasks — the runtime queued them when the response was emitted. Check the Work Queue, not the response text, for execution status.

**Mixing forms in one turn.** If the agent both calls `taskmaster_dispatch` AND emits a `q:>` line in the same turn, the runtime processes both as separate dispatches — there is no automatic deduplication today. The agent's prompt asks for "maximum one `q:>` per turn"; if you need parallel fan-out use repeated `taskmaster_dispatch` calls instead of mixing forms.

```json
{
  "id": "job-1715000000000-abc123",
  "description": "Document the authentication API endpoints",
  "domain": "comm",
  "worker": "writer.tech",
  "priority": "normal",
  "status": "pending",
  "coaReqId": "$A0.#E0.@A0.C010",
  "projectPath": "/home/wishborn/_projects/civicognita_web",
  "createdAt": "2026-04-09T10:00:00.000Z"
}
```

### 2. Bridge

`JobBridge.ensureJob()` reads the dispatch file and writes a structured entry into `~/.agi/state/taskmaster.json`. The job gets a single phase with `gate: "terminal"` by default.

### 3. Execute

`WorkerRuntime.executeJob()` loads the dispatch, then `executePhases()` runs each phase's worker in sequence via `runWorker()`, passing the previous phase's output as context to the next. Concurrent **jobs** are bounded by `maxConcurrentJobs` (default: 3); each phase within a job still runs one worker at a time (multi-worker "teams" per phase are not yet implemented).

### 4. Genie Bridge

`runWorker()` resolves the dispatching project's paired Genie workspace as MCP server `<projectSlug>:genie` (the same generic per-project `.mcp.json` reading that already powers Tynn PM integration — no new discovery mechanism). If that server isn't registered, the job fails immediately and cleanly rather than falling back to any in-process execution:

1. `runAgent` **start** — launches a Claude Code (or Codex) agent in the project's directory.
2. `runAgent` **send** — delivers the worker's resolved prompt (system prompt + dispatch + previous-phase context + jobId), instructing it to emit `<<<TASKMASTER_DONE>>>` followed by a summary once genuinely finished.
3. `runAgent` **read** — polled on an interval (`genieDonePollMs`, default 4s) until the marker appears or `workerTimeoutMs` elapses.
4. `runAgent` **stop** — the agent's terminal is cleaned up either way (success, failure, or timeout).

A worker that never emits the marker within `workerTimeoutMs` fails the phase rather than polling forever.

### Worker Tool Surface

Workers get the spawned coding agent's own native tool access (file edits, running tests, git, everything Claude Code / Codex itself can do) scoped to the project directory — not Taskmaster's `ToolRegistry`. There is no tier-based tool filtering for Genie-executed workers; see the tradeoff note at the top of this doc.

### 5. Completion

When a phase's worker emits the done marker, `WorkerRuntime` advances to the next phase (persisting the phase's output via `JobBridge.advancePhase()`). When all phases complete, or any phase fails, `WorkerRuntime` emits `report_ready` / `job_failed` and updates the job status via `JobBridge.updateJobStatus()`.

---

## Chain Conventions

Certain workers should be followed by a specific downstream worker. Today this is a **convention** — the dispatching agent queues the tail after the head returns. Automatic chain dispatch is a planned follow-up (see "Not yet implemented" above).

| Source Worker | Chained Worker | Reason |
|---------------|----------------|--------|
| `$W.code.hacker` | `$W.code.tester` | All implementation must be tested |
| `$W.comm.writer.tech` | `$W.comm.editor` | Technical writing must be edited |
| `$W.comm.writer.policy` | `$W.comm.editor` | Policy writing must be edited |
| `$W.data.modeler` | `$W.k.linguist` | Data models need naming review |
| `$W.gov.auditor` | `$W.gov.archivist` | Audit findings must be archived |

---

## Gate Types

Each job phase ends with a gate that controls progression:

| Gate | Behavior |
|------|----------|
| `auto` | Proceeds immediately to the next phase — no human review |
| `checkpoint` | Pauses the job (status `checkpoint`) right after this phase's worker completes; resumed via `POST /api/taskmaster/approve/:jobId` or failed via `POST /api/taskmaster/reject/:jobId` |
| `terminal` | Final phase — job is complete when this phase's worker finishes. `JobBridge.ensureJobWithPhases()` always forces the LAST phase to `terminal` regardless of what the orchestrator proposed, so a job can never pause forever waiting on a checkpoint after its own final phase. |

Jobs dispatched via `taskmaster_dispatch` with no orchestrator decomposition receive a single phase with `gate: "terminal"`. Multi-phase plans (via `taskmaster-orchestrator.ts`'s `decompose()`) use `auto` or `checkpoint` for earlier phases.

**Taskmaster's own gate is the sole approval authority** — Genie's own approval-gating on `runAgent.start`/`send` must be turned off for a project's paired Genie workspace (see below), or every phase would double-pause behind an OS modal that Taskmaster's gate already supersedes.

### Checkpoint resume

`approveCheckpoint(jobId)` rebuilds everything `executePhases()` needs from `JobBridge`-persisted state — `job.projectPath`, `job.phases` (converted back to `WorkPhase[]`), `job.currentPhase` (the phase to resume AT), and the just-completed phase's persisted `output` as context — plus `coaReqId`/`priority`/`planRef` re-read from the original dispatch file. This means a checkpoint can be approved well after (and in a different request than) the original dispatch call; nothing needs to be kept in memory across the pause. `rejectCheckpoint(jobId, reason)` marks the job `failed` and emits `job_failed`.

---

## Event Types

`WorkerRuntime` extends `EventEmitter` and emits `runtime:event` with a typed payload. The dashboard event broadcaster subscribes to these and forwards them to connected clients via WebSocket.

| Event type | When emitted |
|------------|-------------|
| `job_started` | `executeJob()` (or `approveCheckpoint()`) begins processing a dispatch |
| `phase_started` / `phase_completed` / `phase_failed` | Around each phase's `runWorker()` call |
| `worker_started` | A phase's Genie agent is about to be started |
| `worker_progress` | Each poll of the running agent's output (tail of accumulated text) |
| `worker_done` | The phase's Genie agent finished (status: `completed` or `failed`) |
| `checkpoint_pending` | A `checkpoint`-gated phase just completed; the job is now paused |
| `checkpoint_reached` | The job's `executePhases()` promise resolved with `status: "paused"` |
| `report_ready` | Job completed successfully; includes a 500-char gist of the final response |
| `job_failed` | Job could not be executed (missing dispatch, concurrent limit, no paired Genie workspace, timeout, rejected checkpoint, error) |

---

## API Endpoints

Registered by `registerWorkerApi()` during gateway boot.

### Worker Catalog

```
GET /api/workers/catalog
```

Returns the full list of discovered worker prompts from `prompts/workers/`. Only available when `promptLoader` is configured.

**Response:**
```json
[
  {
    "id": "code.engineer",
    "title": "worker-code-engineer",
    "description": "Architecture analysis and implementation specifications.",
    "domain": "code",
    "role": "engineer",
    "model": "sonnet",
    "color": "blue",
    "filePath": "/path/to/prompts/workers/code/engineer.md"
  }
]
```

### Job List

```
GET /api/taskmaster/jobs
```

Returns all jobs from `~/.agi/state/taskmaster.json` as a summary array.

**Response (array):**
```json
[
  {
    "id": "job-1715000000000-abc123",
    "description": "Document the authentication API endpoints",
    "status": "complete",
    "currentPhase": "phase-1",
    "workers": ["$W.comm.writer.tech"],
    "gate": "terminal",
    "createdAt": "2026-04-09T10:00:00.000Z"
  }
]
```

### Job Detail

```
GET /api/taskmaster/jobs/:jobId
```

Returns the summary for a single job. Returns `{ id, status: "not_found" }` if the job does not exist.

### Approve Checkpoint

```
POST /api/taskmaster/approve/:jobId
```

Approves a paused checkpoint gate and resumes the job at its next phase, using the project path and phases persisted in `taskmaster.json`.

**Response:** `{ "ok": true }`

### Reject Checkpoint

```
POST /api/taskmaster/reject/:jobId
```

Rejects a checkpoint gate and marks the job as failed.

**Body (optional):** `{ "reason": "string" }`

**Response:** `{ "ok": true }`

---

## Job State File

Jobs are persisted at `~/.agi/state/taskmaster.json`. This is runtime data — never in the repo.

```json
{
  "version": "1.0",
  "wip": {
    "jobs": {
      "job-1715000000000-abc123": {
        "id": "job-1715000000000-abc123",
        "queueText": "Document the authentication API endpoints",
        "route": "comm.writer.tech",
        "entryWorker": "$W.comm.writer.tech",
        "worktree": ".",
        "branch": "dev",
        "phases": [
          {
            "id": "phase-1",
            "name": "comm/writer.tech",
            "workers": ["$W.comm.writer.tech"],
            "gate": "terminal",
            "status": "complete"
          }
        ],
        "currentPhase": "phase-1",
        "status": "complete",
        "createdAt": "2026-04-09T10:00:00.000Z",
        "startedAt": "2026-04-09T10:00:01.000Z",
        "completedAt": "2026-04-09T10:02:45.000Z"
      }
    },
    "next_frame": null,
    "job_counter": 1
  }
}
```

---

## Configuration

The `workers` block in `gateway.json` controls the runtime:

```json
{
  "workers": {
    "autoApprove": false,
    "maxConcurrentJobs": 3,
    "workerTimeoutMs": 300000
  }
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `autoApprove` | `false` | Skip checkpoint pauses — a `checkpoint`-gated phase's completion is treated like `auto` and the job proceeds straight to the next phase |
| `maxConcurrentJobs` | `3` | Maximum number of worker jobs running in parallel |
| `workerTimeoutMs` | `300000` | Per-phase timeout: how long a Genie-hosted worker has to emit `<<<TASKMASTER_DONE>>>` before the phase fails (5 minutes) |

`modelOverrides` / `modelMap` no longer apply — a Genie-executed worker uses whatever model its coding-agent CLI (Claude Code / Codex) is configured with, not a Taskmaster-selected model. Configuration is read from disk each time `WorkerRuntime.reloadConfig()` is called — no restart required.

---

## Genie Pairing (one-time setup)

Before a project can dispatch Taskmaster jobs, its owner must, once:

1. **Open the project as a Genie workspace.** Genie writes a `genie` entry into that project's `.mcp.json` automatically (a fixed local URL, e.g. `http://127.0.0.1:<port>/mcp/<session>`). `agi`'s existing per-project MCP registration (`server.ts`, reading via `readProjectMcpServers()`) picks this up generically — the same mechanism the Tynn PM integration already uses — and registers it as MCP server `<projectSlug>:genie`, where `projectSlug()` is the same slug function `PlanStore` uses (`/home/user/myproject` → `home-user-myproject`).
2. **Turn off Genie's own approval-gating for that workspace**, in Genie's own settings. By default `runAgent.start`/`send` block on an OS-level approval modal; Taskmaster's own gate system (`auto`/`checkpoint`/`terminal`, see above) is already the approval authority for Taskmaster-dispatched work, so leaving Genie's gate on would double-pause every phase behind a modal that never gets auto-dismissed by anything in this flow. `agi` cannot flip this setting itself — it's Genie-side config.

If a project has no registered `<projectSlug>:genie` MCP server when a job dispatches, `WorkerRuntime` fails that phase immediately with a clear error (`No paired Genie workspace for this project (expected MCP server "<projectSlug>:genie") — open this project in Genie to enable Taskmaster.`) — there is no in-process fallback.

---

## Files to Modify

| File | Change |
|------|--------|
| `packages/gateway-core/src/worker-runtime.ts` | Core execution engine — Genie `runAgent` bridge, checkpoint-gate pause/resume |
| `packages/gateway-core/src/worker-prompt-loader.ts` | Prompt discovery and frontmatter parsing |
| `packages/gateway-core/src/job-bridge.ts` | Dispatch-to-state translation; persists `projectPath` and each phase's `output` |
| `packages/mcp-client/src/index.ts` | `McpClient.callTool()` — how `WorkerRuntime` reaches a project's paired Genie workspace |
| `packages/gateway-core/src/worker-api.ts` | HTTP API endpoints |
| `prompts/workers/{domain}/{role}.md` | Individual worker system prompts (become the initial `runAgent` prompt) |
| `prompts/taskmaster.md` | Orchestrator prompt (worker table, gate rules, planning rules) |
| `config/src/schema.ts` | `WorkersConfigSchema` for new config fields |

## Verification Checklist

- [ ] `GET /api/workers/catalog` lists the new worker prompt
- [ ] `taskmaster_dispatch` with the new domain/role creates a job file in `~/.agi/{projectSlug}/dispatch/jobs/`
- [ ] `GET /api/taskmaster/jobs` shows the job with correct status
- [ ] If the worker uses an enforced chain, `chain_next` in the handoff matches the declared target
- [ ] Job reaches `status: "complete"` in `~/.agi/state/taskmaster.json`
- [ ] `runtime:event` type `report_ready` appears in the dashboard workflow view
