# BOTS Workers: Writing Prompts and Chains

BOTS (Bolt-On Taskmaster System) is the autonomous work queue built into Aionima. It routes background tasks to specialized worker agents, enforces chains between them, and manages gate-controlled phase transitions. This document covers how to write worker prompts, understand chains, and work with the orchestrator.

> **Note:** BOTS is an independent repository, not a subdirectory of AGI. In production it lives at `/opt/aionima-bots` (configurable via `bots.dir`). All `.bots/` paths below are relative to the BOTS repo root.

## Architecture

```
.bots/
  lib/
    orchestrator.ts    # Main entry — processes pending jobs, spawns workers
    job-manager.ts     # Job lifecycle: status, phases, chains
    executor.ts        # Phase execution, dispatch file creation
    gates.ts           # Gate evaluation (auto/checkpoint/terminal)
    worktree.ts        # Isolated git worktrees per job
    router.ts          # Task routing to worker domains
    model-config.ts    # Per-worker model assignment
    team-orchestrator.ts  # Team mode coordination
  schemas/
    dispatch-v1.json   # Worker dispatch JSON schema
    handoff-v1.json    # Worker handoff JSON schema
    workers-v1.json    # Active workers registry schema
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
| `$W.code.hacker` | `$W.code.tester` | Security work must be tested |
| `$W.comm.writer.tech` | `$W.comm.editor` | Technical writing must be edited |
| `$W.comm.writer.policy` | `$W.comm.editor` | Policy writing must be edited |
| `$W.data.modeler` | `$W.k.linguist` | Data models need linguistic review |
| `$W.gov.auditor` | `$W.gov.archivist` | Audit findings must be archived |

When a chained source worker completes, the orchestrator automatically dispatches the chained worker in the next phase. You do not need to specify the chain target in the job definition — it is resolved by `getChainedWorker()` in `job-manager.ts`.

## Gate Types

Each phase ends with a gate that controls transition to the next phase:

| Gate | Behavior |
|------|----------|
| `auto` | Proceed immediately to the next phase — no human review |
| `checkpoint` | Pause the job; notify the operator via CLI; resume with `npm run tm approve <jobId>` |
| `terminal` | Job is complete; offer merge/archive; finalize with `npm run tm complete <jobId>` |

Define the gate in the job definition JSON or via the queue syntax:

```
w:> Implement the authentication module    # auto gate by default
```

The orchestrator maps task descriptions to worker domains via `router.ts`. Simple tasks use `auto` gates throughout. Tasks involving security changes (hacker worker), policy changes (writer.policy worker), or production deployments (deployer worker) typically use `checkpoint` before the terminal phase.

## Dispatch and Handoff Schemas

### Dispatch (what the orchestrator sends to a worker)

Schema: `.bots/schemas/dispatch-v1.json`

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

Schema: `.bots/schemas/handoff-v1.json`

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

Workers write their handoff JSON to `handoffPath` (also specified in the dispatch). The orchestrator detects this file and advances the job.

`chain_next` is optional — it specifies the next worker in an enforced chain. For chain-enforced workers (hacker, writer.*), the orchestrator validates that `chain_next` matches the expected chain target.

## Writing a Worker Prompt

Worker prompts are the system prompt for each agent type. They live in `.bots/` as agent configuration (not as files directly — the prompts are embedded in the orchestrator or registry).

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

## Subagent Mode vs Team Mode

### Subagent Mode (default)

Each worker is spawned as an ephemeral Claude Code instance via the `Task` tool. Workers are isolated — they communicate only through dispatch and handoff files. The orchestrator polls for handoff completion.

```bash
npm run tm mode subagent   # ensure subagent mode
npx tsx .bots/lib/orchestrator.ts run   # process pending jobs
```

### Team Mode

Workers become teammates in a coordinated Claude Code agent team. They share a task list and can see each other's status. Phase sequencing uses task `blockedBy` dependencies rather than the poll loop.

```bash
# Enable team mode
npm run tm mode team
CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 npx tsx .bots/lib/orchestrator.ts run
```

In team mode, the orchestrator calls `orchestrateTeam()` from `team-orchestrator.ts` which:
1. Generates a team lead instruction set via `generateTeamLeadInstructions()`
2. Creates teammates for each worker
3. Wires tasks with `blockedBy` dependencies
4. Returns a `TeamOrchestratorResult` with teammate IDs and task mappings

### When to use team mode

Use team mode when:
- Workers need to share intermediate artifacts (not just dispatch/handoff files)
- Phase ordering is complex and would benefit from task dependency tracking
- The job has more than 4 phases with multiple workers per phase

Use subagent mode (default) for:
- Single-phase jobs
- Simple chains (writer → editor)
- Jobs that fit well in isolated worktrees

## CLI Commands

```bash
npm run tm status              # Show active jobs and their current phases
npm run tm jobs                # List all jobs (active + complete)
npm run tm approve <jobId>     # Approve a checkpoint gate, resume job
npm run tm reject <jobId>      # Reject a checkpoint gate, stop job
npm run tm complete <jobId>    # Mark a terminal-gated job as complete
npm run tm mode                # Show current execution mode
npm run tm mode team           # Switch to team mode
npm run tm mode subagent       # Switch to subagent mode
```

## Queuing Work (w:> Syntax)

In the Claude Code terminal session (with BOTS hooks active), queue work using:

```
w:> Document all tRPC procedures in the codebase
```

The `w:>` prefix triggers the hook which:
1. Creates a new job with a unique ID
2. Routes the task description to the appropriate worker domain
3. Emits `<bots-auto-spawn jobs="job-001"/>` signal
4. The orchestrator reads the signal, prepares the phase, and spawns workers

Multiple tasks can be queued:

```
w:> Implement rate limiting on the auth endpoints
w:> Write tests for the rate limiter
```

These become separate jobs. If the tasks are related, the router may detect the dependency and link them.

## Job State Files

Each job has a state file in `.bots/jobs/<job-id>.json`:

```json
{
  "id": "job-001",
  "queueText": "Document the authentication API endpoints",
  "route": "$W.comm.writer.tech",
  "entryWorker": "$W.comm.writer.tech",
  "worktree": ".claude/worktrees/job-001",
  "branch": "bots/job-001",
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
| `.bots/lib/router.ts` | Add routing rules for new worker types |
| `.bots/lib/model-config.ts` | Assign model to new worker domain |
| `.bots/lib/job-manager.ts` | Add enforced chain mapping for new worker if needed |
| `.bots/schemas/dispatch-v1.json` | Extend dispatch schema if new fields are needed |
| `.bots/schemas/handoff-v1.json` | Extend handoff schema if new output fields are needed |

## Verification Checklist

- [ ] Worker prompt follows the standard structure (Class, Purpose, Constraints, Capabilities, Approach, Input, Output)
- [ ] If the worker is chain-enforced, `chain_next` matches the declared chain target
- [ ] Dispatch and handoff JSON matches the respective schema in `.bots/schemas/`
- [ ] Worker terminates after writing handoff — no interactive loops
- [ ] `npm run tm jobs` shows the job in expected state after completion
- [ ] `npm run tm status` shows correct phase and gate after each phase
- [ ] For `checkpoint` gates: `npm run tm approve` advances the job
- [ ] For `terminal` gates: `npm run tm complete` finalizes the job
