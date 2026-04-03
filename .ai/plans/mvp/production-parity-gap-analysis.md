# Nexus-Claw vs OpenClaw: Production Parity Gap Analysis

**Date:** 2026-02-21
**Nexus-claw files:** 198 (source + test)
**OpenClaw files:** 4,185 (source + test, 35+ channel extensions)
**Test count:** 2,822 passing (35 test files)

---

## Current State

Chat works end-to-end on Telegram via @WishAgentBot. The full message pipeline is operational:
Telegram bot.on -> normalizeMessage -> InboundRouter.route() -> MessageQueue.enqueue() -> QueueConsumer.poll() -> AgentInvoker.process() -> OutboundDispatcher.dispatch() -> Telegram bot.api.sendMessage()

**Key insight:** Most features are CODED but NOT WIRED into the gateway boot sequence. The work is integration, not greenfield.

---

## Package-by-Package Status

### packages/gateway-core/src/ — 37 files

**Status: Functionally present, Phase 2-4 features coded but not wired.**

Real and wired:
- `server.ts` — full 9-step boot sequence, real HTTP/WS startup, graceful shutdown
- `agent-invoker.ts` — complete Anthropic API call + tool loop + compaction + COA logging
- `inbound-router.ts`, `outbound-dispatcher.ts`, `queue-consumer.ts` — real routing pipeline
- `state-machine.ts` — ONLINE/LIMBO/OFFLINE/UNKNOWN transitions
- `auth.ts`, `rate-limiter.ts`, `sanitizer.ts`, `session-manager.ts`, `session-store.ts` — real
- `ws-server.ts`, `server-runtime-state.ts`, `server-startup.ts` — HTTP + WebSocket server
- `dashboard-api.ts`, `dashboard-queries.ts`, `dashboard-events.ts` — basic dashboard backend
- `system-prompt.ts`, `tool-registry.ts`, `invocation-gate.ts` — agent pipeline utilities

Coded but not wired into boot:
- `seal-signer.ts`, `seal-verifier.ts`, `seal-workflow.ts` — Ed25519 signing
- `federation-node.ts`, `federation-handshake.ts`, `federation-router.ts` — Mycelium federation
- `canvas-tool.ts` — tool manifest defined, not registered in ToolRegistry
- `companion-pairing.ts` — pairing codes, not mounted on HTTP routes
- `billing.ts`, `legal-compliance.ts`, `protocol-stability.ts`, `node-health.ts`, `trust-engine.ts`
- `governance-api.ts` — not mounted on HTTP server

Missing vs OpenClaw:
- No daemon/process supervisor (OpenClaw has `src/daemon/`, `src/process/supervisor/`)
- No config hot-reload (OpenClaw uses chokidar)
- No channel restart-on-failure with backoff (OpenClaw: 5s initial, 5min max, 10 attempts)
- No ACP (Agent Control Protocol) for inter-agent communication (OpenClaw: 13 files)
- No browser/Playwright tool (OpenClaw has full CDP + Playwright sandbox)
- No multi-model failover (OpenClaw supports model failover in agent runner)

### packages/entity-model/src/ — 37 files

**Status: Real SQLite store with significant Phase 3-4 code.**

Core (real, working):
- `store.ts` — prepared statements, `resolveOrCreate`, entity CRUD
- `database.ts` — `createDatabase()` with `better-sqlite3`, WAL mode
- `schema.sql.ts` — DDL for entities, channel_accounts, coa_chains, impact_interactions
- `queue.ts` — SQLite message queue (poll/enqueue/complete/fail)
- `migration.ts` — schema migration runner

Phase 2 (coded, real):
- `impact.ts`, `impact-scorer.ts` — full $imp formula
- `bool-classifier.ts`, `quant-table.ts` — Tier 1 rules + LLM Tier 2
- `verification.ts`, `verification-types.ts` — verification request lifecycle + seal issuance
- `geid.ts` — GEID generation

Phase 3-4 (coded, ahead of integration):
- `governance.ts` — multi-entity org memberships
- `marketplace.ts`, `marketplace-ranking.ts` — skill marketplace backend
- `bonding.ts` — entity relationships
- `proposals.ts`, `voting.ts` — governance voting
- `constitution.ts` — governance rules
- `tier-engine.ts` — automated tier promotion
- `tenant.ts` — multi-tenant mode
- `pg-schema.ts` — PostgreSQL alternative
- `gdpr.ts` — data export/deletion
- `co-verification.ts` — cross-org verification

### packages/coa-chain/src/ — 9 files

**Status: Real and complete for Phase 1.**

- `logger.ts` — real SQLite, atomic transactions, fingerprint generation
- `format.ts` — fingerprint formatting ($A0.#E0.@A0.C001)
- `hash-chain.ts` — SHA-256 payload hashing
- `chain-verifier.ts` — chain integrity verification
- `coa-api.ts` — query interface

Advantage: OpenClaw has security audit log but no COA chain concept.

### packages/agent-bridge/src/ — 6 files

**Status: Human-in-the-loop bridge coded, not connected to boot sequence.**

- `bridge.ts` — holds messages, broadcasts via WebSocket, handles operator replies
- server.ts bypasses AgentBridge and wires QueueConsumer directly to AgentInvoker
- WebChat reply bar sends `reply_request` WS messages but ws-server.ts doesn't handle them

### packages/memory/src/ — 7 files

**Status: Coded, NOT wired into agent.**

- `cognee-adapter.ts` — Cognee API calls (ONLINE mode)
- `file-adapter.ts` — local `.nexus/.mem/` storage (OFFLINE mode)
- `composite-adapter.ts` — STATE-gated provider selection
- `retrieval.ts` — search with relevance filtering
- AgentInvoker never calls the memory package

### packages/voice/src/ — 7 files

**Status: Coded, NOT wired into agent.**

- `pipeline.ts` — full round-trip with budget limits, STATE-gated providers
- `whisper-stt.ts` — OpenAI Whisper API
- `edge-tts.ts` — node-edge-tts (free TTS)
- `local-stt.ts`, `local-tts.ts` — sherpa-onnx stubs (offline mode)
- Voice messages arrive as `[voice message]` literal text, not transcribed

### packages/skills/src/ — 6 files

**Status: Discovery system works, zero skill files exist.**

- `discovery.ts` — real FS scan for `*.skill.md` files
- `loader.ts` — frontmatter + body loading
- Hot-reload watcher via `node:fs.watch`
- No `.skill.md` files in repo — system discovers nothing

### channels/telegram/src/ — 6 files

**Status: Fully working (polling mode).**

Gaps vs OpenClaw:
- No webhook mode (OpenClaw supports both)
- No threading support (capabilities declares true, not implemented)
- No media download/upload pipeline
- No voice transcription on inbound

### channels/whatsapp/src/ — 7 files

**Status: Webhook architecture coded, NOT working.**

Critical issues:
- `hashToPhone` reverse map is in-memory only — lost on restart
- `webhookHandler` never mounted on HTTP server
- `ConversationWindowTracker` not persisted
- Template message fallback not implemented

### channels/discord/src/ — 5 files

**Status: Basic text functional, voice/threading incomplete.**

- `channelUserId` now correctly maps to Discord channel ID (fixed 2026-02-21)
- Voice declared but not normalized
- Guild channel reply routing needs work

### channels/signal/src/ — 6 files

**Status: Text functional via signal-cli REST, requires external JVM process.**

- Phone number hash persistence same issue as WhatsApp (in-memory only)
- No media support in normalizer

### ui/web/src/ — 2 files + 3 public assets

**Status: WebChat control UI working.**

- Vanilla JS WebSocket client with reconnect, message list, reply bar
- Missing: voice input, entity management, COA chain browser, worker status

### ui/dashboard/src/ — 17+ files

**Status: Preact dashboard coded, not integrated with real data.**

- Canvas renderers, timeline charts, activity feed, entity profile, COA explorer
- Calls REST endpoints partially defined in dashboard-api.ts

### config/src/ — 2 files

**Status: Complete.** Zod-validated schema covers all subsystems.

### cli/src/ — 8 files

**Status: Core commands work.**

- `run`, `status`, `doctor`, `channels`, `config` — real
- Missing: `entity list/verify`, `coa search`

---

## Tier 1 — Reliable MVP (wire existing code)

These are all "connect existing code" work — no greenfield needed.

| # | Gap | Where | Work |
|---|-----|-------|------|
| 1 | Memory not wired | agent-invoker.ts | Import memory package, call retrieve() before API call, store() after |
| 2 | Voice not wired | server.ts onInbound | Import voice pipeline, transcribe before passing to agent |
| 3 | Skills empty | skills/ | Create initial .skill.md files for core capabilities |
| 4 | Canvas tool not registered | server.ts | Import CANVAS_TOOL_MANIFEST, register in ToolRegistry |
| 5 | Channel restart-on-failure | channel-registry.ts | Add exponential backoff retry on channel error events |
| 6 | WhatsApp webhook mounting | server-startup.ts | Detect webhookHandler property, mount on HTTP server |
| 7 | Phone hash persistence | Signal/WhatsApp plugins | Persist hash-to-phone in entity DB channel_accounts table |
| 8 | Human-in-loop path | ws-server.ts + server.ts | Handle `reply_request` WS message type, route to AgentBridge |

## Tier 2 — Production Infrastructure

| # | Gap | Work |
|---|-----|------|
| 9 | CI/CD | GitHub Actions: typecheck, lint, test on push |
| 10 | Docker | Dockerfile + compose for gateway + SQLite volume |
| 11 | Config hot-reload | chokidar watch on nexus-claw.json, apply changes live |
| 12 | E2E tests | Real message flow tests (inbound -> agent -> outbound) |
| 13 | System prompt / persona | Load from config or .skill.md, not hardcoded default |
| 14 | Multi-model failover | Try alternate model on 429/500 from Anthropic |

## Tier 3 — OpenClaw Feature Parity

| # | Gap | Work |
|---|-----|------|
| 15 | More channels | Slack, Matrix, IRC, SMS, iMessage (OpenClaw has 35+) |
| 16 | Browser/Playwright tool | Agent can browse the web (CDP sandbox) |
| 17 | Media pipeline | Download, transcode, SSRF guards |
| 18 | Process supervisor | Daemon mode, process management |
| 19 | ACP protocol | Inter-agent communication for companion apps |
| 20 | TUI | Interactive terminal interface |
| 21 | Native apps | macOS (SwiftUI), iOS, Android |

---

## Nexus-Claw Advantages (unique vs OpenClaw)

| Feature | Description |
|---------|-------------|
| COA chain ledger | Immutable SHA-256 accountability trail with fingerprints |
| Entity model (#E/$R/@N) | Governed identity registry with verification tiers |
| Impact scoring ($imp) | QUANT x VALUE[0BOOL] x (1 + 0BONUS) formula |
| Ed25519 seal signing | Cryptographic verification with GENESIS key |
| Governance / org model | Multi-entity orgs, roles, impact pooling, voting |
| BAIF state machine | ONLINE/LIMBO/OFFLINE/UNKNOWN gating on all operations |
| Federation (Mycelium) | Peer node discovery, Ed25519-signed headers, COA relay |
| Impact dashboard | Preact dashboard with Canvas renderers, timeline charts |
| Skill marketplace | Submission, review, usage stats, endorsements |

---

## Recommendation

Start with Tier 1 items 1-4 (memory, voice, skills, canvas tool). All four are "connect existing packages" work — the code exists, it just needs wiring into server.ts and agent-invoker.ts. This would make the agent dramatically more capable in a single push.

Then Tier 1 items 5-8 (channel resilience, WhatsApp, hash persistence, human-in-loop) to make the gateway robust.

Then Tier 2 for production readiness before any public deployment.
