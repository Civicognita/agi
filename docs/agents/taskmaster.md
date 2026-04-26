# Taskmaster: System Reference

**Taskmaster** is the built-in job orchestration engine in Aionima. It receives background task requests via the `taskmaster_dispatch` tool, routes them to worker agents scoped to the dispatching project, and manages the full job lifecycle from dispatch to completion. Workers run with Aion's full tool registry.

> **Note:** Workers are defined in plugins via `api.registerWorker()`. The engine that runs them lives entirely in `packages/gateway-core/`. Prompts for the built-in workers are loaded from `prompts/workers/` by `WorkerPromptLoader`. There is no external BOTS repo.

> **Not yet implemented (2026-04-15):** multi-phase plan decomposition (described in `prompts/taskmaster.md`) and enforced-chain auto-dispatch (`hacker→tester` etc.). Both are aspirational. Today each `taskmaster_dispatch` call runs a single worker; chain the tail yourself in a follow-up call.

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
                                      └── LLM tool loop — worker calls the shared
                                          ToolRegistry (same surface as Aion at its
                                          tier: file tools, grep, git, plan tools,
                                          etc.), not a hardcoded sandbox
                                      └── runtime:event emissions
                                            ├── tm:job_update
                                            ├── tm:phase_done
                                            ├── tm:checkpoint
                                            ├── tm:report_ready
                                            ├── tm:job_failed
                                            └── worker:done
```

### Component Responsibilities

| Component | File | Responsibility |
|-----------|------|----------------|
| `JobBridge` | `job-bridge.ts` | Translates flat dispatch files into taskmaster state entries |
| `WorkerRuntime` | `worker-runtime.ts` | Manages concurrent job execution and the LLM tool loop |
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

`WorkerRuntime.executeJob()` loads the dispatch, starts the LLM tool loop via `runWorker()`, and tracks the job in the active jobs map. Concurrent jobs are bounded by `maxConcurrentJobs` (default: 3).

### 4. Tool Loop

The worker receives its system prompt (loaded by `WorkerPromptLoader`) and the task in the first user message. It can call tools in a loop of up to 30 iterations. On each iteration, tool results are appended to the conversation and the LLM is called again.

### Worker Tool Surface

Workers use Aion's shared `ToolRegistry`, filtered by the worker's tier (typically `verified`). This means workers have the same file/git/plan/project/grep tools as Aion — not a hardcoded sandbox. All tool paths resolve relative to the project set at dispatch time (via `projectPath`).

The previous 5-tool mini-sandbox (`read_file` / `write_file` / `list_files` / `search_files` / `run_command`) has been retired. If a worker needs to, e.g., commit changes, it now calls `git_commit` — the same tool Aion uses.

### 5. Completion

When the tool loop finishes (either naturally or after 30 iterations), `WorkerRuntime` emits a `report_ready` or `job_failed` event and updates the job status in `taskmaster.json` via `JobBridge.updateJobStatus()`.

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
| `checkpoint` | Pauses the job and notifies the operator; resumed via `POST /api/taskmaster/approve/:jobId` |
| `terminal` | Final phase — job is complete when all workers in this phase finish |

Jobs dispatched via `taskmaster_dispatch` receive a single phase with `gate: "terminal"`. Multi-phase plans would use `auto` or `checkpoint` gates for earlier phases — not currently implemented.

---

## Event Types

`WorkerRuntime` extends `EventEmitter` and emits `runtime:event` with a typed payload. The dashboard event broadcaster subscribes to these and forwards them to connected clients via WebSocket.

| Event type | When emitted |
|------------|-------------|
| `job_started` | `executeJob()` begins processing a dispatch |
| `worker_started` | LLM invocation begins for a specific worker |
| `worker_progress` | After each tool loop iteration (includes loop count and partial text) |
| `worker_done` | Worker LLM loop finishes (status: `completed` or `failed`) |
| `report_ready` | Job completed successfully; includes a 500-char gist of the final response |
| `job_failed` | Job could not be executed (missing dispatch, concurrent limit, error) |

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

Approves a paused checkpoint gate and resumes the job. If the job is not currently active, re-invokes `executeJob()`.

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
    "workerTimeoutMs": 300000,
    "modelOverrides": {
      "code.hacker": "claude-opus-4-5",
      "k.analyst": "claude-opus-4-5"
    }
  }
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `autoApprove` | `false` | Skip human review at checkpoint gates — jobs proceed automatically |
| `maxConcurrentJobs` | `3` | Maximum number of worker jobs running in parallel |
| `workerTimeoutMs` | `300000` | Per-worker LLM timeout in milliseconds (5 minutes) |
| `modelOverrides` | `{}` | Override the LLM model for specific workers by `"domain.role"` key |

Configuration is read from disk each time `WorkerRuntime.reloadConfig()` is called — no restart required.

---

## Files to Modify

| File | Change |
|------|--------|
| `packages/gateway-core/src/worker-runtime.ts` | Core execution engine; sandbox tool set |
| `packages/gateway-core/src/worker-prompt-loader.ts` | Prompt discovery and frontmatter parsing |
| `packages/gateway-core/src/job-bridge.ts` | Dispatch-to-state translation |
| `packages/gateway-core/src/worker-api.ts` | HTTP API endpoints |
| `prompts/workers/{domain}/{role}.md` | Individual worker system prompts |
| `prompts/taskmaster.md` | Orchestrator prompt (worker table, gate rules, planning rules) |
| `config/src/schema.ts` | `WorkersConfigSchema` for new config fields |

## Verification Checklist

- [ ] `GET /api/workers/catalog` lists the new worker prompt
- [ ] `taskmaster_dispatch` with the new domain/role creates a job file in `~/.agi/{projectSlug}/dispatch/jobs/`
- [ ] `GET /api/taskmaster/jobs` shows the job with correct status
- [ ] If the worker uses an enforced chain, `chain_next` in the handoff matches the declared target
- [ ] Job reaches `status: "complete"` in `~/.agi/state/taskmaster.json`
- [ ] `runtime:event` type `report_ready` appears in the dashboard workflow view
