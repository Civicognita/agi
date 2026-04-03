# Nexus-Claw Build Plan

## Context

Three specialized workers analyzed the OpenClaw codebase (30,000 LOC TypeScript, 30+ channel adapters) and the Civicognita knowledge base (27+ core docs) to determine what it would take to build a personal AI assistant powered by impactinomics and 0REALTALK. The unanimous recommendation: build from the ground up, don't fork. OpenClaw's flat identity model (users = endpoint addresses) is architecturally incompatible with Civicognita's governed entity model (#E/$R/@N with COA chains, 0R verification, and impact scoring). The existing BAIF framework, TASKMASTER dispatch, and entity classification system provide a stronger foundation than starting from zero.

**Full analysis report:** `.ai/handoff/openclaw-analysis-report.md`
**Reference codebase:** `C:/_Projects/_x/openclaw/` (OpenClaw source, used for pattern analysis)

---

## Phase 1: Foundation (Months 1-3)

**Goal:** Working single-channel assistant with 0R identity layer and COA audit trail.

### 1.1 Scaffold Monorepo

```
nexus-claw/
├── packages/
│   ├── gateway-core/        # 0R Gateway — WebSocket control plane
│   ├── entity-model/        # #E/$R/@N entity store + COA chains
│   ├── channel-sdk/         # Channel adapter interface contract
│   ├── agent-bridge/        # BAIF/TASKMASTER integration layer
│   └── coa-chain/           # COA record generation + SQLite persistence
├── channels/
│   └── telegram/            # First channel adapter (grammy)
├── ui/
│   └── web/                 # Minimal WebChat control UI
├── config/                  # Zod-validated JSON5 config (inspired by OpenClaw pattern)
├── cli/                     # Commander-based CLI surface
└── docs/                    # Architecture docs
```

**Tech stack:**
- TypeScript (ESM), Node.js 22+
- pnpm workspaces
- tsdown (build), tsx (dev)
- Vitest (test)
- SQLite via better-sqlite3 (entity store, COA chains)
- sqlite-vec (future vector search)
- ws (WebSocket server)
- grammy (Telegram)
- Zod 4 (config validation)
- croner (cron, Phase 2)

### 1.2 Define Channel Adapter Interface

Steal the interface pattern from OpenClaw's `ChannelPlugin` (see `C:/_Projects/_x/openclaw/src/channels/plugins/types.plugin.ts`), adapt for 0R entity resolution:

```typescript
type NexusChannelPlugin = {
  id: ChannelId;
  meta: ChannelMeta;
  capabilities: ChannelCapabilities;

  // Core adapters (same pattern as OpenClaw)
  config: ChannelConfigAdapter;
  gateway?: ChannelGatewayAdapter;      // start()/stop() lifecycle
  outbound?: ChannelOutboundAdapter;    // send messages back
  messaging?: ChannelMessagingAdapter;  // inbound delivery
  security?: ChannelSecurityAdapter;    // DM policy, allowlist

  // 0R additions (not in OpenClaw)
  entityResolver?: EntityResolverAdapter;  // resolve sender to #E entity
  impactHook?: ImpactHookAdapter;          // classify interaction for scoring
  coaEmitter?: COAEmitterAdapter;          // generate COA records per message
}
```

### 1.3 Build 0R Gateway Core

The gateway differs from OpenClaw's at the identity resolution step. Before routing to agents:

1. **Receive** normalized channel message
2. **Resolve entity** — lookup sender in entity store, create unverified entry if unknown
3. **Check verification tier** — unverified / verified / 0R-sealed
4. **Generate COA record** — `$A0.#E?.@A0.<chain>` fingerprint
5. **Route to agent** — based on entity tier + channel + config bindings
6. **Log to impact ledger** — raw interaction event for future scoring

**STATE-GATING integration:** Gateway respects ONLINE/LIMBO/OFFLINE/UNKNOWN states from BAIF. Messages arriving in OFFLINE state are queued and acknowledged, not dropped.

### 1.4 Build Telegram Channel Adapter

First channel. Use grammy library (same as OpenClaw). Implement:
- Polling mode (simpler than webhooks for MVP)
- Inbound message normalization
- Outbound message delivery
- Entity resolution (Telegram user ID -> #E entity)
- Pairing flow for unknown senders (inspired by OpenClaw's pairing code pattern)

### 1.5 Build Agent Bridge (BAIF Integration)

**MVP approach: Human-in-the-loop gateway.**

The gateway receives messages, stores them, and notifies the operator via WebChat UI. #E0 responds via the Claude Code terminal as nexus. The "automation" at MVP is the gateway normalizing messages, resolving entities, and logging COA chains.

**Phase 2 approach:** Gateway calls Anthropic API directly with BAIF prompt context, enabling autonomous agent response.

The bridge needs:
- Message queue (gateway -> agent)
- Response routing (agent -> gateway -> channel outbound)
- TASKMASTER connector (gateway can emit `q:>` jobs for complex requests)
- Worker dispatch integration (existing handoff/dispatch JSON protocol)

### 1.6 Entity Store + COA Chain Logging

SQLite database with tables:

```sql
-- Entity registry
CREATE TABLE entities (
  id TEXT PRIMARY KEY,           -- ULID
  type TEXT NOT NULL,            -- 'E' (human), 'R' (resource), 'N' (node)
  display_name TEXT,
  verification_tier TEXT DEFAULT 'unverified', -- unverified | verified | sealed
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Channel identity mapping
CREATE TABLE channel_accounts (
  id TEXT PRIMARY KEY,
  entity_id TEXT REFERENCES entities(id),
  channel TEXT NOT NULL,          -- 'telegram', 'discord', etc.
  channel_user_id TEXT NOT NULL,  -- platform-specific ID
  UNIQUE(channel, channel_user_id)
);

-- COA chain records
CREATE TABLE coa_chains (
  id TEXT PRIMARY KEY,
  resource TEXT NOT NULL,         -- $A0 (the assistant)
  entity_id TEXT REFERENCES entities(id),
  node TEXT NOT NULL,             -- @A0 (age/version)
  chain TEXT NOT NULL,            -- C010, C011, etc.
  session_id TEXT,
  channel TEXT,
  action TEXT NOT NULL,           -- 'message_in', 'message_out', 'tool_use', etc.
  payload_hash TEXT,              -- SHA-256 of the interaction content
  created_at TEXT NOT NULL
);

-- Impact interaction ledger (raw events, scoring comes Phase 2)
CREATE TABLE impact_interactions (
  id TEXT PRIMARY KEY,
  coa_id TEXT REFERENCES coa_chains(id),
  entity_id TEXT REFERENCES entities(id),
  interaction_type TEXT NOT NULL,  -- 'conversation', 'task_dispatch', 'verification', etc.
  quant INTEGER DEFAULT 1,        -- base measurement
  bool_value INTEGER DEFAULT 0,   -- 0BOOL_SCALE position (-3 to +3), default 00 (neutral)
  created_at TEXT NOT NULL
);
```

### 1.7 Minimal WebChat Control UI

Simple web interface served by the gateway showing:
- Active conversations (entity + channel + last message)
- Entity list with verification tiers
- COA chain browser (searchable log)
- Worker status (if TASKMASTER jobs running)

**Stack:** Preact or vanilla + WebSocket connection to gateway. Keep it minimal — no framework overhead at MVP.

### 1.8 CLI Surface

```
nexus-claw gateway run          # Start gateway
nexus-claw config get/set       # Config management
nexus-claw entity list/verify   # Entity management
nexus-claw coa search           # COA chain queries
nexus-claw doctor               # Self-diagnostics (stolen from OpenClaw pattern)
nexus-claw channel status       # Channel health
```

---

## Phase 2: Core Features (Months 4-7)

**Goal:** Multi-channel, autonomous agent, voice, impact scoring v1, 0R verification ceremony.

### 2.1 Autonomous Agent (API Integration)
- Gateway calls Anthropic API directly with BAIF system prompt
- Remove human-in-the-loop requirement for routine conversations
- Keep operator override for complex/sensitive requests
- Session persistence (transcript files, compaction when context fills)

### 2.2 Second Channel: Discord
- discord.js adapter
- Guild/role-based entity resolution
- Group session isolation

### 2.3 Third Channel: Signal
- signal-cli adapter (requires JVM dependency — budget this)
- Privacy-first positioning aligns with Civicognita constituency

### 2.4 Impact Scoring Algorithm v1
- Implement 0SCALE formula: `$imp = QUANT x VALUE[0BOOL] x (1 + 0BONUS)`
- Simple scoring: conversation interactions earn base QUANT
- 0BOOL assessment: agent classifies interaction direction (-3 to +3)
- 0BONUS calculation from entity's historical alignment
- Dashboard showing accumulated $imp per entity

### 2.5 0R Verification Flow
- **Prerequisite:** Write 0R Verification Protocol document BEFORE dev starts
- Entity requests verification -> proof submission -> review -> seal issuance
- Basic seal stored in entity record
- Verified entities get elevated routing privileges

### 2.6 Talk Mode (Voice)
- TTS via node-edge-tts (free, no API key) or ElevenLabs
- STT via OpenAI Whisper API or sherpa-onnx (local)
- Voice input -> text -> agent -> text -> TTS -> audio output

### 2.7 Cognee Memory Integration
- When STATE=ONLINE, connect to Cognee for semantic memory
- Fallback to .nexus/.mem/ when OFFLINE/LIMBO
- Memory search tool available to agent

### 2.8 Skills System
- Markdown-driven skills (same pattern as OpenClaw: `SKILL.md` per skill)
- Skills classified by impactinomics domain (Governance, Community, Innovation, etc.)
- Agent discovers and loads skills automatically

---

## Phase 3: Differentiators (Months 8-14)

**Goal:** Make impactinomics visible in the product. This is where it separates from everything else.

### 3.1 Impact Dashboard
- Visual representation of $imp over time
- Per-entity, per-domain, per-channel breakdowns
- 0BONUS multiplier visualization (how alignment compounds)

### 3.2 0R Seal Issuance
- Full GENESIS-authorized seal generation
- Public verification portal (web page to verify a seal)
- Seal stored with cryptographic proof on COA chain

### 3.3 WhatsApp Integration
- Baileys adapter (with explicit TOS risk warnings to user)
- Consider official WhatsApp Business API as alternative

### 3.4 Canvas / A2UI
- Agent-driven visual workspace
- Impact reports rendered as interactive canvases
- COA chain visualizations

### 3.5 Multi-Entity Governance
- Organizations (#O) with member entities (#E)
- Role-based routing within orgs
- Impact pooling across org members

### 3.6 Plugin SDK (Stable Release)
- Published @civicognita/channel-sdk
- Third-party channel adapters and tools
- Impact-domain classification for plugins

### 3.7 iOS Companion Node
- Notifications, voice input
- Camera for visual input to agent

---

## Phase 4: Scale (Months 15+)

- Hosted multi-user service
- Impact exchange between entities
- Governance voting (impact-weighted)
- Federated community nodes
- Cross-node COA chain verification
- Android companion app
- macOS native app
- Public skill marketplace (impactinomics-based discovery)

---

## Key Patterns to Steal from OpenClaw

| Pattern | OpenClaw Source | Adapt For |
|---------|----------------|-----------|
| Channel adapter interface | `src/channels/plugins/types.plugin.ts` | Add entity resolver + COA emitter adapters |
| Plugin manifest schema | `extensions/*/openclaw.plugin.json` | Add impact-domain classification |
| Session key encoding | `src/routing/session-key.ts` | Add entity tier to key structure |
| Config validation (Zod) | `src/config/zod-schema.ts` | Same pattern, different schema |
| Doctor diagnostics | `src/cli/doctor/` | Self-diagnosis for entity store + channels |
| Pairing code flow | DM policy in security/ | Adapt to 0R verification flow |
| Exponential backoff | Channel restart policy | Same resilience pattern |
| Compaction | `src/agents/pi-embedded-runner/compact.ts` | Context management for agent sessions |
| Structured session keys | `src/routing/session-key.ts` | Deterministic routing |

---

## What Already Exists in Nexus

| Component | Location | Reuse Level |
|-----------|----------|-------------|
| BAIF agent framework | `CLAUDE.md`, `.ai/.env` | Core — IS the agent runtime |
| TASKMASTER dispatch | `.nexus/lib/taskmaster/` | Core — parallel worker orchestration |
| Entity classification | `core/ENTITY.md` | Specification — needs code implementation |
| COA chain format | `core/0COA.md` | Specification — needs code implementation |
| 0SCALE formula | `core/0SCALE.md` | Specification — needs code implementation |
| 0BOOL_SCALE | `core/0TERMS.md` | Specification — needs code implementation |
| 0MINT ceremony | `core/0MINT.md` | Specification — needs code implementation |
| Worker agents | `.claude/agents/workers/` | Direct reuse for dispatch |
| Dispatch protocol | `schemas/definitions/dispatch-v1.json` | Direct reuse |
| Handoff protocol | `schemas/definitions/handoff-v1.json` | Direct reuse |
| Terminal/worker system | `.ai/.nexus/spawn-config.json` | Direct reuse |
| Tynn integration | MCP server | Direct reuse for work management |

---

## Blockers (Resolve Before Phase 2)

1. **0R Verification Protocol** — governance document defining: claim types, proof formats, ceremony steps, seal structure, revocation mechanism
2. **Impact scoring definition** — what earns $imp? What is a QUANT for a conversation? For a task dispatch?
3. **BAIF/API integration decision** — how does the gateway invoke the agent autonomously? (spawn Claude process vs. call Anthropic API directly vs. human-in-loop)
4. **WhatsApp legal review** — Baileys TOS risk assessment before Phase 3
5. **Contributor onboarding path** — BAIF documentation accessible to new developers

---

## Risk Matrix

| Risk | Severity | Probability | Mitigation |
|------|----------|-------------|------------|
| Scope collapse (two projects in one) | HIGH | HIGH | Strict phase separation; assistant first, impactinomics second |
| BAIF integration complexity | HIGH | MEDIUM | MVP uses human-in-loop; full automation Phase 2 |
| Channel API instability (Baileys) | MEDIUM | MEDIUM | MVP on Telegram only; WhatsApp deferred to Phase 3 |
| 0R verification unspecified | MEDIUM | HIGH | Write protocol document as Phase 1 prerequisite |
| Feature gravity from OpenClaw | MEDIUM | HIGH | Every feature must answer: "Does this demonstrate impactinomics?" |
| Solo founder bottleneck | HIGH | HIGH | Document BAIF for contributors; separate platform eng from governance |

---

## Naming

| Name | Use | Rationale |
|------|-----|-----------|
| **Mycelium** | Platform/project (internal) | Nexus persona connection, interconnection, resilience, decentralized |
| **Koru** | Consumer brand (future) | Maori symbol of new growth, community-oriented, compact, distinctive |
| **nexus-claw** | Working project name | Bridge identity during development |

---

## The One-Sentence Pitch

> The only personal AI assistant whose effectiveness is measured not in tasks completed, but in verifiable, non-tradeable impact toward the eradication of poverty — with a full accountability chain from every action back to the human who requested it.
