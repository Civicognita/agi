# Workers & Taskmaster: Writing Prompts and Chains

**Taskmaster** is the built-in job orchestration engine in Aionima. It discovers registered workers (provided by plugins), routes background tasks to them, enforces chains between workers, and manages gate-controlled phase transitions. This document covers how to write worker prompts, understand chains, and work with the Taskmaster engine.

> **Note:** Workers are defined by plugins via `api.registerWorker()` using the `defineWorker()` SDK builder. The Taskmaster engine lives inside `packages/gateway-core/`. There is no external BOTS repo.

## Architecture

```
gateway-core/
  taskmaster/
    orchestrator.ts    # Main entry — processes pending jobs, dispatches workers
    job-manager.ts     # Job lifecycle: status, phases, chains
    executor.ts        # Phase execution, dispatch file creation
    gates.ts           # Gate evaluation (auto/checkpoint/terminal)
    worktree.ts        # Isolated git worktrees per job
    router.ts          # Task routing to worker domains
    model-config.ts    # Per-worker model assignment
.ai/
  handoff/             # Worker handoff files (one JSON per worker invocation)
  jobs/                # Job state files (one JSON per job)
```

## Worker Domains and Types

| Domain | Workers | Purpose |
|--------|---------|---------|
| `code` | `engineer`, `hacker`, `reviewer`, `tester` | Implementation, security, review, testing |
| `k` | `analyst`, `cryptologist`, `librarian`, `linguist` | Knowledge, research, language |
| `ux` | `designer.web`, `designer.cli` | UI/UX design |
| `strat` | `planner`, `prioritizer` | Planning, prioritization |
| `comm` | `writer.tech`, `writer.policy`, `editor` | Technical writing, policy docs, editing |
| `ops` | `deployer`, `custodian`, `syncer` | Deployment, cleanup, synchronization |
| `gov` | `auditor`, `archivist` | Auditing, archiving |
| `data` | `modeler`, `migrator` | Data modeling, migrations |

Worker identifiers use the pattern `$W.<domain>.<type>` — e.g., `$W.code.engineer`, `$W.comm.writer.tech`.

## Enforced Chains

Certain workers always trigger a follow-up worker. These chains are enforced by the executor:

| Source Worker | Chained Worker | Reason |
|---------------|----------------|--------|
| `$W.code.hacker` | `$W.code.tester` | Implementation work must be tested |
| `$W.comm.writer.tech` | `$W.comm.editor` | Technical writing must be edited |
| `$W.comm.writer.policy` | `$W.comm.editor` | Policy writing must be edited |
| `$W.data.modeler` | `$W.k.linguist` | Data models need linguistic review |
| `$W.gov.auditor` | `$W.gov.archivist` | Audit findings must be archived |

When a chained source worker completes, Taskmaster automatically dispatches the chained worker in the next phase. You do not need to specify the chain target in the job definition — it is resolved by `getChainedWorker()` in `job-manager.ts`.

## Gate Types

Each phase ends with a gate that controls transition to the next phase:

| Gate | Behavior |
|------|----------|
| `auto` | Proceed immediately to the next phase — no human review |
| `checkpoint` | Pause the job; notify the operator; resume with `taskmaster approve <jobId>` |
| `terminal` | Job is complete; offer merge/archive; finalize with `taskmaster complete <jobId>` |

The Taskmaster router maps task descriptions to worker domains via `router.ts`. Simple tasks use `auto` gates throughout. Tasks involving security changes (hacker worker), policy changes (writer.policy worker), or production deployments (deployer worker) typically use `checkpoint` before the terminal phase.

## Dispatch and Handoff Schemas

### Dispatch (what Taskmaster sends to a worker)

```json
{
  "dispatch": {
    "worker": "$W.comm.writer.tech",
    "task": {
      "description": "Document the authentication API endpoints",
      "scope": ["src/api/auth/**"],
      "output_location": "docs/api/auth.md"
    },
    "context": {
      "parent_coa": "$A0.#E0.@A0.C010",
      "job_id": "job-001"
    }
  }
}
```

The worker reads this from the dispatch file at the path specified in `dispatchPath`. The file is written by `executor.ts` before the worker is spawned.

### Handoff (what a worker sends back)

```json
{
  "handoff": {
    "worker": "$W.comm.writer.tech",
    "job_id": "job-001",
    "status": "done",
    "output": {
      "summary": "Documented 4 auth endpoints with examples",
      "files_created": ["docs/api/auth.md"],
      "coverage": { "endpoints_documented": 4 }
    },
    "chain_next": "$W.comm.editor"
  }
}
```

Workers write their handoff JSON to `.ai/handoff/<worker-tid>.json`. Taskmaster detects this file and advances the job.

`chain_next` is optional — it specifies the next worker in an enforced chain. For chain-enforced workers (hacker, writer.*), Taskmaster validates that `chain_next` matches the expected chain target.

## Writing a Worker Prompt

Worker prompts are the system prompt for each agent type. They are embedded in the `WorkerDefinition` (via `defineWorker().prompt(...)`) when a plugin registers a worker.

A well-written worker prompt has these sections:

### 1. Class and Identity

```
> **Class:** WORKER
> **Model:** sonnet
> **Lifecycle:** Ephemeral (task-scoped)
> **Chain:** ALWAYS followed by $W.<chain-target> (enforced)
```

### 2. Purpose (2-3 sentences)

What this worker specializes in. Be specific — workers are single-domain specialists.

### 3. Constraints

```
- **No user interaction:** Cannot use AskUserQuestion
- **Task-scoped:** Terminates after handoff
- **Documentation only:** Does not modify implementation code (for writer workers)
```

### 4. Capabilities

Bullet list of what this worker type can do.

### 5. Approach (numbered steps)

The worker's execution sequence. Always ends with writing the handoff JSON.

### 6. Input and Output (JSON schemas)

Show the exact dispatch JSON format (what the worker reads) and the handoff JSON format (what it writes).

### Example: A new `$W.data.migrator` worker prompt

```
# Data Migrator — Worker Agent

> **Class:** WORKER
> **Model:** sonnet
> **Lifecycle:** Ephemeral (task-scoped)
> **Chain:** Standalone (no enforced chain)

## Purpose

Executes database schema migrations in a controlled, reversible way. Reads migration scripts,
validates them against the current schema, applies them to the SQLite entity database, and
verifies the result.

## Constraints

- **No user interaction:** Cannot use AskUserQuestion
- **Migrations only:** Does not modify application code — only schema and seed data
- **Reversibility:** Every migration must have a documented rollback strategy

## Capabilities

- SQLite schema analysis
- Migration script validation
- Idempotent migration application (IF NOT EXISTS patterns)
- Pre/post migration data counts for verification

## Approach

1. Read dispatch for migration scope and target database path
2. Inspect current schema (`.schema` command or `sqlite_master` table)
3. Validate migration SQL — check syntax, FK references, index names
4. Apply migration inside a transaction
5. Verify result — count rows, check column existence
6. Write handoff JSON with migration details

## Input

[dispatch JSON example]

## Output

[handoff JSON example]
```

## Registering a Worker via Plugin

Workers are provided by plugins, not hardcoded in the engine. To add a new worker:

```typescript
import { defineWorker } from "@aionima/sdk";

const migrator = defineWorker("data.migrator", "Data Migrator")
  .domain("data")
  .role("migrator")
  .description("Executes database schema migrations in a controlled, reversible way")
  .prompt(migratorPromptMarkdown)
  .modelTier("balanced")
  .allowedTools(["Read", "Write", "Edit", "Bash"])
  .keywords(["migrate", "schema", "database", "migration"])
  .build();

api.registerWorker(migrator);
```

See `docs/sdk/builders.md` for the full `defineWorker()` builder reference.

## CLI Commands

```bash
taskmaster status              # Show active jobs and their current phases
taskmaster jobs                # List all jobs (active + complete)
taskmaster approve <jobId>     # Approve a checkpoint gate, resume job
taskmaster reject <jobId>      # Reject a checkpoint gate, stop job
taskmaster complete <jobId>    # Mark a terminal-gated job as complete
```

## Job State Files

Each job has a state file in `.ai/jobs/<job-id>.json`:

```json
{
  "id": "job-001",
  "queueText": "Document the authentication API endpoints",
  "route": "$W.comm.writer.tech",
  "entryWorker": "$W.comm.writer.tech",
  "worktree": ".ai/worktrees/job-001",
  "branch": "taskmaster/job-001",
  "phases": [
    {
      "id": "phase-0",
      "name": "Write",
      "workers": ["$W.comm.writer.tech"],
      "gate": "auto",
      "status": "complete"
    },
    {
      "id": "phase-1",
      "name": "Edit",
      "workers": ["$W.comm.editor"],
      "gate": "terminal",
      "status": "running"
    }
  ],
  "currentPhase": "phase-1",
  "status": "running"
}
```

## Files to Modify

| File | Change |
|------|--------|
| `packages/gateway-core/src/taskmaster/router.ts` | Add routing rules for new worker types |
| `packages/gateway-core/src/taskmaster/model-config.ts` | Assign model to new worker domain |
| `packages/gateway-core/src/taskmaster/job-manager.ts` | Add enforced chain mapping for new worker if needed |

## Verification Checklist

- [ ] Worker prompt follows the standard structure (Class, Purpose, Constraints, Capabilities, Approach, Input, Output)
- [ ] If the worker is chain-enforced, `chain_next` matches the declared chain target
- [ ] Worker is registered via `api.registerWorker()` in the plugin's `activate()` function
- [ ] Worker terminates after writing handoff — no interactive loops
- [ ] `taskmaster jobs` shows the job in expected state after completion
- [ ] `taskmaster status` shows correct phase and gate after each phase
- [ ] For `checkpoint` gates: `taskmaster approve` advances the job
- [ ] For `terminal` gates: `taskmaster complete` finalizes the job
