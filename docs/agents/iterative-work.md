# Iterative Work — agent-side reference

Aionima implements iterative-work mode (s118 / v0.4.0): cron-nudged Aion can autonomously progress through a project's tynn workflow when the owner is away.

This page is a pointer doc — the canonical sources live where they're actually maintained. Read them in order:

## 1. The discipline (canonical)

**`agi/prompts/iterative-work.md`** — the prompt the system-prompt assembler injects when a project has `iterativeWork.enabled: true`. Encodes ship-first / walk-last, slice schema → infra → behavior → wiring → UI, honest scope-down, look-for-MORE, end-of-cycle indicators, AskUserQuestion discipline, etc.

The bigger picture: tynn workflow IS Aionima's agentic operating model. See **`agi/docs/agents/tynn-and-related-concepts.md`** for what the workflow IS and what it is NOT (Taskmaster, Worker session state, Plans, tynnContext, mcp tool — all parallel concepts that LOOK tynn-shaped but aren't).

## 2. The runtime surfaces

| Surface | What it is | Where it lives |
|---|---|---|
| `mcp` agent tool | Aion-facing tool that lists / calls / reads against any MCP server (tynn, Linear, etc.) | Registered at `gateway-core/src/server.ts` boot; backed by `@agi/mcp-client` |
| `pm` agent tool | Aion-facing tool that speaks the canonical tynn workflow (next / start / testing / finished / etc.) | Registered at `gateway-core/src/server.ts`; dispatches to the active `PmProvider` |
| `PmProvider` interface | Storage-pluggable contract every PM backing implements | `packages/aion-sdk/src/pm.ts` |
| `TynnPmProvider` | MCP-backed provider — talks to tynn-the-service via `@agi/mcp-client` | `packages/gateway-core/src/pm/tynn-provider.ts` |
| `TynnLitePmProvider` | File-backed fallback — `<project>/.tynn-lite/{tasks,comments,wishes}.jsonl` + `state.json` | `packages/gateway-core/src/pm/tynn-lite-provider.ts` |
| `IterativeWorkScheduler` | Walks projects per tick, decides who's due based on `iterativeWork.cron`, fires AgentInvoker | `packages/gateway-core/src/iterative-work/scheduler.ts` |
| Settings → Iterative Work UX | Owner control + audit + progress bar | `ui/dashboard/src/routes/settings-iterative-work.tsx` (route at `/settings/iterative-work`) |

## 3. Per-project configuration

Owners opt a project into iterative-work mode via `~/.agi/{slug}/project.json`:

```json
{
  "iterativeWork": {
    "enabled": true,
    "cron": "*/30 * * * *"
  },
  "agent": {
    "pm": {
      "provider": "tynn",
      "config": { "tynnKey": "..." }
    }
  }
}
```

`iterativeWork.cron` accepts the cron-parser subset documented at `iterative-work/cron.ts` (`M,M`, `*/N`, single `M`, `*` minute fields). Same shape as the bash parser in `~/.claude/statusline-command.sh` so visual countdowns match.

`agent.pm.provider`: `"tynn"` (default) | `"tynn-lite"` | any plugin-registered id (see `agi/docs/agents/adding-a-plugin.md` § "How to Add a PM Provider").

## 4. What plan-tool vs. pm-tool means

See **`agi/docs/agents/plan-vs-pm.md`** — the decision doc + composition discipline. TL;DR:

- **plan** = within-iteration scaffolding (file `~/.agi/{slug}/plans/{planId}.mdc`, status: draft → executing → complete).
- **pm** = across-iteration tracking (storage-pluggable per the PmProvider interface, status: backlog → starting → doing → testing → finished, etc.).

They compose by reference (`plan.tynnRefs.taskIds`) but never mutate each other.

## 5. What an iteration looks like

When the cron-nudge scheduler fires for a project, the gateway:

1. Resolves the `$ITERATIVE-WORK` system entity.
2. Builds a synthetic `[iterative-work tick]` prompt + composes a per-fire COA fingerprint.
3. Calls `agentInvoker.process()` with `channel: "system"`, `projectContext: <projectPath>`, `isOwner: true`.
4. The system prompt assembler sees `requestType === "project"` + `iterativeWork.enabled: true` and injects `agi/prompts/iterative-work.md` into Layer 2.
5. Aion responds — typically: read prior markers (checkpoint / pending-questions / tynn `next`), pick a task, ship a slice, mark progress.
6. Scheduler's fire-event handler calls `markComplete(projectPath)` so the project releases back to schedulable.

Per-fire records persist in the scheduler's in-memory ring buffer (default 50 entries); the dashboard's "Recent fires" section reads them. Postgres persistence is a follow-up when storage choices for cross-restart audit are owner-blessed.

## 6. References

- Story: tynn s118 — "Iterative work mode — cron-nudged Aion + pluggable PM tool + tynn-lite fallback"
- Discipline: `agi/prompts/iterative-work.md`
- Composition contract: `agi/docs/agents/plan-vs-pm.md`
- Workflow context: `agi/docs/agents/tynn-and-related-concepts.md`
- Plugin extensibility: `agi/docs/agents/adding-a-plugin.md` § "How to Add a PM Provider" + `plugin-schema.md`
- Owner memory invariants: `feedback_iterative_work_discipline`, `feedback_loop_drives_to_done_not_qa`, `feedback_tynn_workflow_is_the_agi_agentic_model`
