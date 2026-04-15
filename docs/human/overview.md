# Aionima — Architecture & How It All Fits Together

Aionima is an autonomous AI gateway. It connects messaging channels (Telegram, Discord, Signal, WhatsApp, Gmail) to a Claude-powered agent pipeline. You send a message on any supported channel; Aionima receives it, consults the agent, and replies — all without manual intervention.

The system is a pnpm monorepo running on Node.js 22 LTS. It uses TypeScript throughout, with a Fastify-backed HTTP server, a WebSocket control plane, SQLite for entity and message storage, and a React dashboard for monitoring and administration.

---

## The Four Pillars

### 1. Channel Adapters

Each messaging platform is a channel plugin. Channels receive inbound messages and deliver outbound replies. They are independent: you can enable Telegram without enabling Discord, and a failure in one channel does not affect others.

Supported channels:

| Channel | Library | Protocol |
|---------|---------|---------|
| Telegram | grammy | Bot API polling or webhook |
| Discord | discord.js | Gateway WebSocket |
| Gmail | Gmail OAuth2 | API polling + API send |
| Signal | signal-cli REST | HTTP polling |
| WhatsApp | WhatsApp Business API | Webhook |

### 2. Agent Pipeline

Every inbound message enters a queue, where it is processed by the agent pipeline:

1. The sending entity is looked up or created in the entity store.
2. A system prompt is assembled from PRIME corpus, entity context, and applicable skills.
3. The Claude API (or OpenAI/Ollama) is invoked.
4. The response is dispatched back to the originating channel.

The pipeline is gated by the gateway state (Initial / Limbo / Offline / Online — see below), rate limits per entity, and the entity's verification tier.

### 3. Entity Model

Entities represent people, organizations, and other participants who interact with Aionima. Each entity has a verification tier (unverified, verified, sealed) and a Chain of Accountability (COA) alias (e.g. `#E0`, `#O1`). All agent invocations are anchored to a COA fingerprint for audit purposes.

The entity model is stored in a SQLite database at `~/.agi/entities.db`.

### 4. Dashboard

The React dashboard runs at `http://127.0.0.1:3100` (or wherever you configure the gateway). It provides real-time visibility into channel status, message logs, entity records, impact scores, system resources, and deployment controls.

---

## Monorepo Structure

```
aionima/
├── cli/                    CLI entry point (Commander.js)
├── config/                 Config schema (Zod validation)
├── packages/
│   ├── gateway-core/       HTTP/WS server, agent pipeline, core engine
│   ├── entity-model/       SQLite entity store, message queue
│   ├── channel-sdk/        Channel plugin interface and types
│   ├── coa-chain/          Chain of Accountability audit logger
│   ├── memory/             Composite memory adapter
│   ├── skills/             Skill file loader and registry
│   ├── voice/              STT/TTS pipeline (Whisper, Edge TTS)
│   ├── plugins/            Plugin lifecycle and discovery
│   ├── aion-sdk/           Developer SDK for building plugins
│   ├── trpc-api/           tRPC router definitions
│   └── agent-bridge/       Agent invocation logic
├── channels/
│   ├── telegram/           Telegram adapter (grammy)
│   ├── discord/            Discord adapter (discord.js)
│   ├── gmail/              Gmail OAuth2 adapter
│   ├── signal/             Signal adapter (signal-cli REST)
│   └── whatsapp/           WhatsApp Business API adapter
├── ui/
│   └── dashboard/          React dashboard (Vite + Tailwind + TanStack Query)
├── scripts/
│   ├── upgrade.sh           Production deployment script
│   └── aionima.service     systemd unit file
├── skills/                 Agent skill definitions (.skill.md files)
└── aionima.example.json    Example configuration to copy from
```

> **Note:** All plugins live in the [MARKETPLACE repo](https://github.com/Civicognita/aionima-marketplace), not in this monorepo. This includes service plugins (MySQL, PostgreSQL, Redis, Adminer), runtime plugins (Node.js, PHP), project-type plugins (Web App, Mobile App, Literature, Media, Monorepo, Ops), the editor plugin, LLM provider plugins (Anthropic, OpenAI, Ollama), and channel plugins (Telegram, Discord, Gmail, Signal, WhatsApp). Only the core packages and SDK live here. Runtime data and configuration live in `~/.agi/` — see [Runtime Data Paths](#runtime-data-paths) below.

---

## How Components Connect

### Message Flow (Inbound)

```
Channel (Telegram, Discord, etc.)
    |
    | inbound message
    v
Channel Adapter (channels/telegram/, etc.)
    |
    | AionimaMessage { id, channelId, channelUserId, content }
    v
InboundRouter (gateway-core)
    |
    | entity lookup / creation
    | rate limit check
    | queue enqueue
    v
MessageQueue (entity-model)
    |
    | queue poll
    v
QueueConsumer (gateway-core)
    |
    | session lookup or creation
    | skill matching
    | memory recall
    | system prompt assembly
    v
AgentInvoker (gateway-core)
    |
    | Claude / OpenAI / Ollama API call
    v
Response text
    |
    v
OutboundDispatcher (gateway-core)
    |
    v
Channel Adapter (sends reply)
```

### Message Flow (Dashboard → WS)

The dashboard connects to the gateway via WebSocket on the same port as HTTP. Real-time events (new messages, state changes, channel status updates) are broadcast to connected dashboard clients.

### Config Flow

```
~/.agi/gateway.json + ~/.agi/.env
    |
    | $ENV{VAR} references resolved at load time
    v
AionimaConfig (Zod-validated)
    |
    | config watcher monitors file changes
    v
Hot-reload (config.changed hook fires, relevant services update)
```

---

## Tech Stack Summary

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 22 LTS |
| Language | TypeScript 5.7 (strict) |
| Package manager | pnpm 10.5 |
| HTTP server | Fastify 5 |
| API layer | tRPC 11 |
| Database | SQLite via better-sqlite3 |
| Frontend | React 19, Vite 6, Tailwind CSS 4, TanStack Query |
| Bundler | tsdown (esbuild-based) |
| Testing | Vitest (unit/integration), Playwright (e2e) |
| Linting | oxlint, oxfmt |
| LLM | Anthropic Claude (primary), OpenAI, Ollama |
| Channels | grammy (Telegram), discord.js (Discord), Gmail OAuth2, signal-cli REST, WhatsApp Business API |

---

## Runtime Data Paths

| Path | Purpose |
|------|---------|
| `~/.agi/gateway.json` | Runtime config |
| `~/.agi/entities.db` | SQLite entity database |
| `~/.agi/chat-history/` | Chat session history (JSON files per session) |
| `~/.agi/secrets/` | TPM2-sealed credentials |
| `~/.agi/` | Runtime data root |
| `/opt/aionima/` | Production deployment target |
| `/opt/aionima-prime/` | PRIME knowledge corpus (external repo) — never write runtime data here |
| `logs/` | Application log files (configured via `logging.logDir`, default `./logs` relative to workspace root) |

---

## Gateway States

The gateway operates in one of four states. **State is a read-only status, not a user setting** — it reflects AGI's connection to Aionima-prime + Hive-ID and is computed at runtime from peer reachability and the 0PRIME Schema validation outcome.

| State | Meaning | Agent Behavior |
|-------|---------|---------------|
| Initial / Unknown | Boot not yet resolved; peer probes haven't returned | Logs all actions, returns null response |
| Limbo | Running locally; local COA<>COI not yet validated with the 0PRIME Schema | Local memory + Tynn MCP only; no remote writes, deletions disabled. Expected steady state until 0PRIME Hive mind is operational. |
| Offline | local-id or local-prime is unavailable | No outbound connections; informs user |
| Online | HIVE-aligned; local COA<>COI validates against 0PRIME Schema | Full responses, tool use, remote ops, deletions. Future — not reachable until 0PRIME is live. |

Read the current state via `GET /api/gateway/state` or check the **Operational State** pill on Settings → Gateway in the dashboard. See [state machine docs](../agents/state-machine.md) for the full semantics, capabilities table, and the 0PRIME relationship (Hive mind / distributed AI / Impactium blockchain).

---

## Boot Sequence

When `aionima run` executes, the gateway starts in nine steps:

1. Load and validate `gateway.json`
2. Bootstrap auth (tokens, rate limiter)
3. Initialize state machine
4. Create HTTP + WebSocket servers (bound to configured host:port)
5. Initialize core services (entity store, queue, sessions, COA logger)
6. Mount HTTP routes (dashboard API, channel API, system API, tRPC)
7. Attach WebSocket handler
8. Start sidecars: channel plugins, queue consumer, session sweep, dashboard broadcaster
9. Return server handle with graceful shutdown capability

The process holds open handles (the HTTP server, WebSocket server, any polling timers) and stays alive until `SIGINT` or `SIGTERM` is received.
