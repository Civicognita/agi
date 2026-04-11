# Taskmaster: System Reference

**Taskmaster** is the built-in job orchestration engine in Aionima. It receives background task requests via the `worker_dispatch` tool, routes them to worker agents, enforces phase chains and gate transitions, and manages the full job lifecycle from dispatch to completion.

> **Note:** Workers are defined in plugins via `api.registerWorker()`. The engine that runs them lives entirely in `packages/gateway-core/`. Prompts for the built-in workers are loaded from `prompts/workers/` by `WorkerPromptLoader`. There is no external BOTS repo.

---

## Architecture

```
Agent (LLM tool call)
  └── worker_dispatch tool
        └── .dispatch/jobs/{jobId}.json   (flat dispatch file written to disk)
              └── JobBridge.ensureJob()
                    └── ~/.agi/state/taskmaster.json   (structured state file)
                          └── WorkerRuntime.executeJob()
                                └── WorkerPromptLoader.getSystemPrompt()
                                      └── LLM tool loop (up to 30 iterations)
                                            ├── read_file
                                            ├── write_file
                                            ├── list_files
                                            ├── search_files
                                            └── run_command
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

The agent calls `worker_dispatch` with a `description`, `domain`, `worker`, and optional `priority`. The tool writes a flat JSON file to `.dispatch/jobs/{jobId}.json` and calls the `onJobCreated` callback to notify `WorkerRuntime`.

```json
{
  "id": "job-1715000000000-abc123",
  "description": "Document the authentication API endpoints",
  "domain": "comm",
  "worker": "writer.tech",
  "priority": "normal",
  "status": "pending",
  "coaReqId": "$A0.#E0.@A0.C010",
  "createdAt": "2026-04-09T10:00:00.000Z"
}
```

### 2. Bridge

`JobBridge.ensureJob()` reads the dispatch file and writes a structured entry into `~/.agi/state/taskmaster.json`. The job gets a single phase with `gate: "terminal"` by default.

### 3. Execute

`WorkerRuntime.executeJob()` loads the dispatch, starts the LLM tool loop via `runWorker()`, and tracks the job in the active jobs map. Concurrent jobs are bounded by `maxConcurrentJobs` (default: 3).

### 4. Tool Loop

The worker receives its system prompt (loaded by `WorkerPromptLoader`) and the task in the first user message. It can call sandboxed tools in a loop of up to 30 iterations. On each iteration, tool results are appended to the conversation and the LLM is called again.

### Sandboxed Worker Tools

Workers run with a restricted tool set. These are not the full agent tools — they are a sandboxed subset exposed only during worker execution:

| Tool | Description |
|------|-------------|
| `read_file` | Read a file by path relative to the project root |
| `write_file` | Write content to a file relative to the project root |
| `list_files` | List files in a directory (max depth 2, max 100 entries) |
| `search_files` | Search `.ts`, `.tsx`, `.md` files by regex pattern (max 50 matches) |
| `run_command` | Run a shell command in the project directory (timeout: 60s, output capped at 10KB) |

All tool paths are resolved relative to `projectRoot`, which is the project directory set at dispatch time.

### 5. Completion

When the tool loop finishes (either naturally or after 30 iterations), `WorkerRuntime` emits a `report_ready` or `job_failed` event and updates the job status in `taskmaster.json` via `JobBridge.updateJobStatus()`.

---

## Enforced Chains

Certain workers always trigger a follow-up worker. The chain is declared in the worker's system prompt (`chain_next` in the handoff) and validated by the runtime.

| Source Worker | Chained Worker | Reason |
|---------------|----------------|--------|
| `$W.code.hacker` | `$W.code.tester` | All implementation must be tested |
| `$W.comm.writer.tech` | `$W.comm.editor` | Technical writing must be edited |
| `$W.comm.writer.policy` | `$W.comm.editor` | Policy writing must be edited |
| `$W.data.modeler` | `$W.k.linguist` | Data models need naming review |
| `$W.gov.auditor` | `$W.gov.archivist` | Audit findings must be archived |

When a chained source worker completes, Taskmaster dispatches the chained worker in the next phase automatically.

---

## Gate Types

Each job phase ends with a gate that controls progression:

| Gate | Behavior |
|------|----------|
| `auto` | Proceeds immediately to the next phase — no human review |
| `checkpoint` | Pauses the job and notifies the operator; resumed via `POST /api/taskmaster/approve/:jobId` |
| `terminal` | Final phase — job is complete when all workers in this phase finish |

Jobs dispatched via `worker_dispatch` receive a single phase with `gate: "terminal"`. Multi-phase plans created by the Taskmaster orchestrator may include `auto` or `checkpoint` gates for earlier phases.

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

The `workers` block in `aionima.json` controls the runtime:

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
- [ ] `worker_dispatch` with the new domain/role creates a job file in `.dispatch/jobs/`
- [ ] `GET /api/taskmaster/jobs` shows the job with correct status
- [ ] If the worker uses an enforced chain, `chain_next` in the handoff matches the declared target
- [ ] Job reaches `status: "complete"` in `~/.agi/state/taskmaster.json`
- [ ] `runtime:event` type `report_ready` appears in the dashboard workflow view
