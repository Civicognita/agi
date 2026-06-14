# Scheduled Jobs — agent-side reference

Aionima implements per-project scheduled jobs (s118 / v0.4.0): owners configure recurring prompts, terminal commands, plugin actions, or PM-loop ticks. The scheduler fires each job on its cron schedule.

This page is a pointer doc — the canonical sources live where they're actually maintained. Read them in order:

## 1. The discipline (canonical)

**`agi/prompts/iterative-work.md`** — the prompt the system-prompt assembler injects when a project has an enabled `pm-loop` job. Encodes ship-first / walk-last, slice schema → infra → behavior → wiring → UI, honest scope-down, look-for-MORE, end-of-cycle indicators, AskUserQuestion discipline, etc.

The bigger picture: tynn workflow IS Aionima's agentic operating model. See **`agi/docs/agents/tynn-and-related-concepts.md`** for what the workflow IS and what it is NOT (Taskmaster, Worker session state, Plans, tynnContext, mcp tool — all parallel concepts that LOOK tynn-shaped but aren't).

## 2. The runtime surfaces

| Surface | What it is | Where it lives |
|---|---|---|
| `mcp` agent tool | Aion-facing tool that lists / calls / reads against any MCP server (tynn, Linear, etc.) | Registered at `gateway-core/src/server.ts` boot; backed by `@agi/mcp-client` |
| `pm` agent tool | Aion-facing tool that speaks the canonical tynn workflow (next / start / testing / finished / etc.) | Registered at `gateway-core/src/server.ts`; dispatches to the active `PmProvider` |
| `PmProvider` interface | Storage-pluggable contract every PM backing implements | `packages/aion-sdk/src/pm.ts` |
| `TynnPmProvider` | MCP-backed provider — talks to tynn-the-service via `@agi/mcp-client` | `packages/gateway-core/src/pm/tynn-provider.ts` |
| `TynnLitePmProvider` | File-backed fallback — `<project>/.tynn-lite/{tasks,comments,wishes}.jsonl` + `state.json` | `packages/gateway-core/src/pm/tynn-lite-provider.ts` |
| `IterativeWorkScheduler` | Walks projects per tick, fires each enabled job whose cron is due | `packages/gateway-core/src/iterative-work/scheduler.ts` |
| Settings → Scheduled Jobs | System-wide view of all active scheduled jobs + plugin tasks | `ui/dashboard/src/routes/settings-scheduled-jobs.tsx` |
| Project → Scheduled Jobs tab | Per-project job list + Add/Edit/Delete dialog | `ui/dashboard/src/components/ScheduledJobsTab.tsx` |

## 3. Job types

| Type | What it does |
|---|---|
| `pm-loop` | Fires the iterative-work discipline prompt for this project (original behavior) |
| `prompt` | Fires an owner-authored recurring prompt as a project chat turn |
| `command` | Runs a shell command via `agi bash` passthrough (policy-gated, logged) |
| `action` | Calls a plugin-registered action by `actionId` with optional `params` |

## 4. Per-project configuration

Owners manage scheduled jobs through the project's **Scheduled Jobs** tab in the dashboard. Configuration is stored in `project.json` as a `scheduledJobs` array:

```json
{
  "scheduledJobs": [
    {
      "id": "abc-123",
      "type": "pm-loop",
      "name": "PM Loop",
      "enabled": true,
      "cron": "*/30 * * * *"
    },
    {
      "id": "def-456",
      "type": "prompt",
      "name": "Daily standup",
      "enabled": true,
      "cron": "0 9 * * *",
      "prompt": "What shipped yesterday? What's next?"
    }
  ]
}
```

**Migration:** nodes upgrading from the old `iterativeWork` field are transparently migrated on first read — the existing `iterativeWork` config becomes a `pm-loop` job in `scheduledJobs`. No manual migration needed.

`cron` accepts the cron-parser subset documented at `iterative-work/cron.ts` (`M,M`, `*/N`, single `M`, `*` minute fields). Same shape as the bash parser in `~/.claude/statusline-command.sh` so visual countdowns match.

`agent.pm.provider`: `"tynn"` (default) | `"tynn-lite"` | any plugin-registered id (see `agi/docs/agents/adding-a-plugin.md` § "How to Add a PM Provider").

## 5. What plan-tool vs. pm-tool means

See **`agi/docs/agents/plan-vs-pm.md`** — the decision doc + composition discipline. TL;DR:

- **plan** = within-iteration scaffolding (file `~/.agi/{slug}/plans/{planId}.mdc`, status: draft → executing → complete).
- **pm** = across-iteration tracking (storage-pluggable per the PmProvider interface, status: backlog → starting → doing → testing → finished, etc.).

They compose by reference (`plan.tynnRefs.taskIds`) but never mutate each other.

## 6. What a scheduled fire looks like

When the scheduler fires a job for a project, the gateway dispatches by `job.type`:

**`pm-loop`:**
1. Resolves the `$ITERATIVE-WORK` system entity.
2. Builds a synthetic `[iterative-work tick]` prompt + composes a per-fire COA fingerprint.
3. Calls `agentInvoker.process()` with `channel: "system"`, `projectContext: <projectPath>`, `isOwner: true`.
4. The system prompt assembler detects an enabled `pm-loop` job and injects `agi/prompts/iterative-work.md` into Layer 2.
5. Aion responds — typically: read prior markers (checkpoint / pending-questions / tynn `next`), pick a task, ship a slice, mark progress.

**`prompt`:** same flow as `pm-loop` but uses `job.prompt` as the user turn text instead of the iterative-work tick.

**`command`:** spawns `agi bash '<job.command>'` — logged, policy-gated; stdout/stderr recorded.

**`action`:** looks up the plugin action registry by `job.actionId`, calls it with `job.params`.

Scheduler calls `markComplete(projectPath, job.id)` and `recordCompletion(projectPath, job.id, outcome)` when the handler finishes (success or failure). Per-fire records persist in the scheduler's in-memory ring buffer (default 50 entries per job); the dashboard's "Recent fires" section reads them.

## 7. API

| Method | Route | Purpose |
|---|---|---|
| `GET`  | `/api/projects/scheduled-jobs?path=` | List all jobs + per-job status |
| `POST` | `/api/projects/scheduled-jobs` | Create a job |
| `PUT`  | `/api/projects/scheduled-jobs/:id` | Update a job |
| `DELETE` | `/api/projects/scheduled-jobs/:id?path=` | Delete a job |
| `POST` | `/api/projects/scheduled-jobs/:id/stop` | Kill in-flight run |
| `POST` | `/api/projects/scheduled-jobs/:id/run-now` | Manual trigger |

Legacy iterative-work routes (`/api/projects/iterative-work/*`) are kept as shims that delegate to the `scheduledJobs` schema.

## 8. References

- Story: tynn s118 — "Iterative work mode — cron-nudged Aion + pluggable PM tool + tynn-lite fallback"
- Discipline: `agi/prompts/iterative-work.md`
- Composition contract: `agi/docs/agents/plan-vs-pm.md`
- Workflow context: `agi/docs/agents/tynn-and-related-concepts.md`
- Plugin extensibility: `agi/docs/agents/adding-a-plugin.md` § "How to Add a PM Provider" + `plugin-schema.md`
- Owner memory invariants: `feedback_iterative_work_discipline`, `feedback_loop_drives_to_done_not_qa`, `feedback_tynn_workflow_is_the_agi_agentic_model`
