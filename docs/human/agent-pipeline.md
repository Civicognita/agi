# Agent Pipeline

This document describes how a message travels from a channel adapter to the Claude API and back. Understanding the pipeline helps you configure the agent, debug unexpected responses, and tune performance.

---

## Overview

Every inbound message passes through a six-stage pipeline:

```
1. Intake       — normalize and validate the message
2. Gate         — entity lookup, rate limits, DM policy
3. Queue        — buffer messages during bursts
4. Prompt       — assemble system prompt from context
5. Invoke       — call the LLM API
6. Dispatch     — route the response back to the channel
```

---

## Stage 1 — Intake

The channel adapter emits a normalized `AionimaMessage` to the `InboundRouter`. The router validates the message structure (non-empty content, valid channel ID, timestamp) and logs the inbound event to the COA chain.

```typescript
interface AionimaMessage {
  id: string;
  channelId: ChannelId;
  channelUserId: string;
  timestamp: string;
  content: MessageContent;  // text | media | voice
  replyTo?: string;
  threadId?: string;
  metadata?: Record<string, unknown>;
}
```

Voice messages enter a pre-processing step where the STT (Speech-to-Text) pipeline transcribes the audio before the text enters the standard pipeline. See the [Voice Pipeline](./voice.md) document for details.

---

## Stage 2 — Gate

The `InboundRouter` applies several gates before accepting a message for processing.

### Entity Resolution

The router looks up the entity for `channelUserId` in the entity store. If no entity exists, one is created with `verificationTier: "unverified"` and assigned a COA alias (e.g. `#E5`).

If `owner.channels.{channelId}` in `gateway.json` matches the sender's ID, the entity is treated as the owner with `verificationTier: "sealed"`.

### DM Policy Check

If `owner.dmPolicy` is `"pairing"`, non-owner senders must complete the pairing flow before their messages are processed. The router checks whether the entity has a valid pairing. If not, it sends a pairing prompt and discards the message.

If `dmPolicy` is `"open"`, all senders are accepted with unverified-tier access.

### Rate Limiting

Per-entity rate limits are enforced in memory. Limits are keyed by gateway state:

| State | Requests/minute | Burst |
|-------|----------------|-------|
| ONLINE | 20 | 5 |
| LIMBO | 5 | 2 |
| OFFLINE | 0 | 0 |
| UNKNOWN | 0 | 0 |

If a rate limit is exceeded, the message is dropped and the entity receives a brief "slow down" response. Rate limit counters reset on gateway restart.

---

## Stage 3 — Queue

Accepted messages are enqueued in the `MessageQueue`. The queue is backed by SQLite and survives gateway restarts (messages remain queued across restarts).

The `QueueConsumer` polls the queue at a configurable interval (default: 100ms) and processes up to `queue.concurrency` messages simultaneously (default: 10).

Messages are processed in FIFO order per entity. If an entity has multiple messages queued, they are processed sequentially to preserve conversation context.

---

## Stage 4 — Prompt Assembly

For each dequeued message, the `AgentSessionManager` retrieves or creates a session for the entity+channel pair. Sessions maintain conversation history within a configured context window (default: 200,000 tokens).

The system prompt is assembled fresh for every invocation. It is never cached. The assembly order is:

### Identity Block

Loaded from PRIME corpus files in priority order:
1. `core/truth/.persona.md` in the PRIME repo (highest priority if present)
2. `core/truth/.purpose.md` in the PRIME repo
3. `data/persona/SOUL.md` (file-based persona override)
4. Hardcoded identity (fallback)

In contributing mode (`agent.devMode: true`), a developer identity is used instead, giving the agent knowledge of the codebase and shell/file tools.

### Runtime Metadata

```
Runtime: agent=Aionima version=0.3.0 host=nexus os=linux node=v22.x.x model=claude-sonnet-4-6 state=ONLINE
```

### Entity Context

```
Entity: #E0 (Alice) — verified — channel: telegram

Verification tier: verified
Autonomy level: standard (full responses, tool access, TASKMASTER q:> permitted)
```

### User Context

If a `USER.md` file exists for the entity (in `entities/` within the PRIME repo), its content is injected here. This contains relationship context — preferences, history notes, and personalization.

### COA Fingerprint

```
Chain of Accountability: $A0.#E0.@A0.C012

This fingerprint is the accountability anchor for this response. Any tool use, task dispatch, or artifact produced during this turn must reference this chain.
```

### PRIME Directive

Loaded from `prime.md` and `core/truth/authority.md` in the PRIME repo if present. Contains the governing directives for agent behavior.

### State Constraints

```
Operational state: ONLINE
Remote operations: permitted
Tynn task management: available
Memory read/write: permitted (local only)
Deletions: permitted after sync
```

### Tool Manifest

Lists available tools filtered by gateway state and entity tier. Unverified entities cannot use tools. Verified entities can use standard tools. Sealed entities (owner) can use all tools.

### Knowledge Index

A compact topic index from the PRIME corpus, organized by category. Tells the agent what knowledge is available for `search_prime` tool calls.

### Skills (if matched)

Skill files matched by trigger patterns are injected. Up to five skills, with a 4000-token budget. See the [Skills](./skills.md) document.

### Memory

Recalled memories from the composite memory adapter, formatted as bullet points with category labels.

### Owner Context

Tells the agent who owns this install and whether the current entity is the owner.

### Response Format Directives

```
- Respond in the language used by the entity
- Do not expose internal identifiers in responses
- If emitting a TASKMASTER job: q:> <description>
- One TASKMASTER emission per turn
```

---

## Stage 5 — Invocation

The assembled system prompt plus the conversation history (prior turns) are sent to the LLM API via the `AgentInvoker`.

### Providers

| Provider | Config value | Default model | Key env var |
|---------|-------------|--------------|-------------|
| Anthropic | `anthropic` | `claude-sonnet-4-6` | `ANTHROPIC_API_KEY` |
| OpenAI | `openai` | `gpt-4o` | `OPENAI_API_KEY` |
| Ollama | `ollama` | `llama3` | (none, uses `baseUrl`) |

Set `agent.provider` and `agent.model` in `gateway.json`:

```json
{
  "agent": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-6",
    "maxTokens": 8192,
    "maxRetries": 3,
    "replyMode": "autonomous"
  }
}
```

### Extended Thinking

When extended thinking is enabled (Anthropic models), the API uses a streaming response. Thinking tokens appear in the internal context but are not sent to the user. The final response text is extracted from the `content` blocks.

### Failover Providers

You can configure a failover list. If the primary provider returns a transient error, Aionima retries on the next provider in the list:

```json
{
  "agent": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-6",
    "providers": [
      { "type": "openai", "model": "gpt-4o" }
    ]
  }
}
```

### Tool Use

When the agent calls a tool, the tool call is intercepted by the `ToolRegistry`, which dispatches to the appropriate handler. Tool results are fed back to the API in the next turn of the conversation. Tool use continues until the agent produces a final text response.

Tools are gated by state and entity tier. The `requiresState` and `requiresTier` fields on each tool definition control availability.

---

## Stage 6 — Dispatch

The final text response is routed to the `OutboundDispatcher`.

### Reply Mode: Autonomous

The response is sent directly to the originating channel. The channel adapter formats it for the platform (Markdown, HTML, etc.) and delivers it.

### Reply Mode: Human-in-Loop

The response is broadcast to dashboard WebSocket clients as a `pending_response` event. It appears in the dashboard for operator review. The operator can approve or reject the response. On approval, the dispatcher sends it to the channel.

### COA Logging

Both the invocation and the response are logged to the COA chain. The log entry includes the entity COA alias, the COA fingerprint, the channel, timestamps, and whether the response was delivered or queued.

---

## Context Management

Sessions maintain a sliding context window. When the accumulated token count approaches the limit (default: 200,000 tokens), older messages are summarized and compressed to stay within budget.

Sessions expire after 24 hours of inactivity by default (`sessions.idleTimeoutMs`). When a session expires, the next message from that entity starts a fresh context.

---

## Heartbeat

If `heartbeat.enabled` is `true`, the agent is invoked on a schedule (default: hourly) using a prompt loaded from `data/persona/HEARTBEAT.md`. The heartbeat invocation uses the owner identity and runs independently of inbound messages. It can be used for autonomous tasks, daily summaries, or proactive outreach.
