# Tynn workflow + parallel concepts in AGI

This doc clarifies the distinction between **the tynn workflow** (AGI's canonical agentic operating model — see `agi/prompts/iterative-work.md` and tynn s118) and several **parallel concepts** in AGI that LOOK similar but serve different purposes. Future contributors who confuse these will produce subtle architectural drift; surfacing the boundaries here keeps each concept clean.

## The tynn workflow (canonical)

**What it is:** The cross-iteration project-management workflow AGI agents use to track durable work. Story → tasks → status transitions (`backlog → starting → doing → testing → finished`) → markers → end-of-cycle walks. Storage is pluggable (tynn-the-service, tynn-lite file-based, plugin-registered alternatives), workflow shape is canonical.

**When to use it:** When work needs to persist across iterations, surface in a project audit trail, transition through review states, or be picked up by an autonomous cron-nudged loop. Examples: shipping a feature, fixing a bug, completing a multi-cycle effort.

**Source of truth:** the PM tool (s118 t432, in progress). Memory: `feedback_tynn_workflow_is_the_agi_agentic_model`.

## Parallel concepts that are NOT tynn

### Taskmaster ≠ tynn

`packages/gateway-core/src/taskmaster-orchestrator.ts` decomposes a single user-supplied work description into ordered worker phases. Each phase is one-shot — a worker executes the phase, produces output, and the orchestrator moves on.

**Purpose:** ephemeral work decomposition. Taskmaster does NOT manage durable PM state. A phase has no `backlog` status, no `testing` review gate, no audit-trail row. It exists for a single Aion-driven work session.

**When to use:** when Aion needs to break a complex request into worker-routed sub-jobs (e.g. "research X, then summarize Y, then file a PR"). The work itself may be tracked in tynn separately, but Taskmaster's internal decomposition is its own.

**Don't confuse:** Taskmaster's "work phase" is NOT a tynn task. A phase is a runtime instruction; a tynn task is a durable artifact.

### Worker session state ≠ tynn task state

Workers (`packages/skills/`) executing Taskmaster-dispatched jobs have their own status state machine: roughly `queued → running → done | failed`. This is the dispatch-layer lifecycle.

**Purpose:** track which jobs are currently being executed by which worker, for runtime concerns (queue depth, cancellation, timeout, error reporting).

**When to use:** when monitoring or controlling worker dispatch. The worker state surfaces in the dashboard's Work Queue, in `taskmaster_status` tool output, in handoff/cancel flows.

**Don't confuse:** worker `running` status is NOT tynn `doing` status. They live in different state machines, refer to different artifacts, and have different lifecycles. A worker's `running` job may correspond to ZERO, ONE, or MANY tynn tasks depending on what the user asked Aion to do.

### Plans ≠ tynn stories

`packages/gateway-core/src/plan-api.ts` lets Aion (or the user) draft a structured plan for a non-trivial task. Plans have steps, decisions, references. The `plan-tynn-mapper.ts` module maps an approved plan to tynn entity-creation operations (1 step → task; 2-5 steps → story+tasks; 6+ → version+stories+tasks).

**Purpose:** within-iteration scaffolding. A plan answers "how am I going to approach this work?" before the work begins.

**When to use:** complex multi-step work where the approach itself needs review before execution. Plans expire after the work is done; the durable record lives in tynn (created via the plan→tynn mapping).

**Don't confuse:** a plan and a tynn story are not the same shape, even when one maps to the other. The plan is the intent; tynn captures the durable artifact.

### `tynnContext` in system prompt ≠ Aion calling tynn

`packages/gateway-core/src/system-prompt.ts:123` injects a `TynnContextSection` into Aion's system prompt — the current story title + number + optional task title + number. This is **read-only visibility**: Aion knows what it's working on.

**Purpose:** ground Aion's responses in current PM state without requiring tool calls.

**Don't confuse:** seeing `tynnContext` does NOT mean Aion can update tynn. Read-write participation requires the `mcp` agent tool (s118 t441, shipped v0.4.224) + a registered tynn server (s118 t435, pending) + the PM tool surface that wraps MCP calls into a clean PmProvider interface (s118 t432, pending).

### `mcp` agent tool ≠ tynn-specific

The `mcp` agent tool (s118 t441, v0.4.224) is a **generic** MCP-protocol surface. It can call ANY registered MCP server — tynn, GitHub MCP, filesystem MCP, Linear MCP, etc. Tynn happens to be one MCP server agi expects to talk to, but the tool isn't tynn-shaped on its own.

**When to use:** when Aion needs to call any registered MCP server's tools, list resources, etc. Today the `mcp` agent tool returns empty server lists because no servers are registered yet (waits on s118 t435).

**Don't confuse:** the `mcp` tool is the protocol surface; the `pm` tool (s118 t432, pending) will be the workflow surface. The `pm` tool wraps `mcp.call` for tynn-the-service AND wraps tynn-lite file ops AND wraps plugin-provider calls — a unified workflow API regardless of backing storage.

## Decision matrix: which to use when

| Concern | Use this |
|---------|----------|
| "I want a task to track over multiple cycles, with status review gates" | tynn workflow (PM tool, t432) |
| "I want Aion to break this complex request into worker phases" | Taskmaster orchestrator |
| "I need to know which workers are busy right now" | Worker session state (taskmaster_status tool) |
| "I want to draft an approach before executing non-trivial work" | Plan API |
| "I want Aion to know what story it's working on" | tynnContext (read-only, automatic) |
| "I want Aion to call any registered MCP server" | `mcp` agent tool |
| "I want Aion to query/update tynn directly" | `pm` agent tool (t432, pending) |

## When this doc gets updated

- New parallel concepts get added (e.g. when the Memory & Learning Framework lands its own state machine)
- Tynn workflow gains new operations or status states
- Plugin-provider examples emerge that don't follow the tynn workflow shape
- A future contributor proposes collapsing two of these concepts (review carefully — usually they're parallel for a reason)

## References

- `agi/prompts/iterative-work.md` — the tynn workflow encoded for agi-internal agents
- `tynn s118` — the story that brings tynn workflow into AGI's runtime
- `packages/gateway-core/src/taskmaster-orchestrator.ts` — Taskmaster
- `packages/gateway-core/src/system-prompt.ts:123` — tynnContext injection
- `packages/gateway-core/src/plan-api.ts` + `plan-tynn-mapper.ts` — Plans + plan→tynn mapping
- `packages/gateway-core/src/tools/taskmaster-*.ts` — Worker session tools
- Memory: `feedback_tynn_workflow_is_the_agi_agentic_model`
