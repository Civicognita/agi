# OpenClaw Analysis & Civicognita Assistant Strategy Report

**Date:** 2026-02-19
**Workers:** $W.researcher, $W.k.analyst, $W.strategist
**Commissioned by:** #E0 (Wish Born)
**Purpose:** Determine what it would take to build an impactinomics-powered personal AI assistant inspired by OpenClaw
**Reference codebase:** `C:/_Projects/_x/openclaw/` (OpenClaw source, used for pattern analysis)

---

## I. Executive Summary

Three specialized workers analyzed the OpenClaw codebase (6,078 files, ~30,000 LOC TypeScript) and the Civicognita knowledge base (27+ core docs) to produce this unified assessment.

**Bottom line:** Don't fork OpenClaw. Build from the ground up. You already have more infrastructure than you realize (BAIF, TASKMASTER, dispatch protocol, entity system, COA chains). OpenClaw is an excellent reference architecture for the channel-routing layer, but its identity model is fundamentally incompatible with impactinomics. The differentiation — verifiable impact ledger, 0R verification, COA accountability chains — has zero competition in the market.

**Recommended project name:** Mycelium (internal/platform), Koru (consumer-facing)

**MVP timeline:** 8-10 weeks for one developer, single channel (Telegram), nexus agent, COA chain logging

---

## II. What OpenClaw Actually Is (Researcher Report)

### Tech Stack
- **Runtime:** Node.js 22, TypeScript (ESM modules)
- **Build:** tsdown (esbuild-based), pnpm workspaces monorepo
- **Test:** Vitest with 1,300+ test files
- **Linting:** oxlint (type-aware), oxfmt formatter
- **Key deps:** @whiskeysockets/baileys (WhatsApp), grammy (Telegram), @slack/bolt (Slack), @buape/carbon (Discord), Playwright (browser), Sharp (images), better-sqlite3, croner (cron)

### Architecture (10 Subsystems)

| Subsystem | What It Does | Files | Complexity |
|-----------|-------------|-------|------------|
| **Gateway** | WebSocket control plane, session routing, channel lifecycle, config reload | ~150 | High |
| **Agent Runtime** | Pi SDK integration, tool streaming, model failover, compaction, auth rotation | ~300+ | Highest |
| **Channels** | 30+ adapters (WhatsApp, Telegram, Discord, Slack, Signal, etc.) via ChannelPlugin interface | ~400 ext | Medium each |
| **Sessions** | Structured session keys encoding agent/channel/account/peer/thread routing | ~20 | Medium |
| **Media** | Image/audio/video pipeline, SSRF guards, transcription hooks | ~30 | Medium |
| **Browser** | CDP + Playwright, sandbox bridge, profile management, accessibility snapshots | ~25 | High |
| **Canvas/A2UI** | Agent-driven visual workspace, live reload, server-side rendering | ~15 | Medium |
| **Voice** | TTS (Edge/ElevenLabs/ONNX), Talk Mode (duplex), Voice Wake (keyword) | ~20 | Medium |
| **Skills** | Markdown-driven capability packs, ClawHub registry, install/manage lifecycle | ~30 | Medium |
| **Cron/Hooks** | Cron service (croner), HTTP webhooks, hook mappings for external triggers | ~50 | Medium |

### Key Design Patterns
1. **Event-driven with explicit lanes** — serialized per-session, capped globally
2. **Plugin adapter interfaces** — ChannelPlugin defines ~15 optional adapters (outbound, threading, security, pairing, etc.)
3. **Config-driven everything** — Zod-validated JSON5, live reload via chokidar
4. **Structured session keys** — deterministic routing encoded in a single string
5. **Exponential backoff** — channel restart resilience (5s initial, 5min max, 10 attempts)
6. **Compaction as first-class** — context overflow handled by summarize-and-rebuild

### Message Flow (WhatsApp Example)
```
Baileys socket event
  -> extensions/whatsapp/runtime.ts (normalize to ChannelMessage)
  -> channels/plugins/actions/message-actions.ts (allowlist, mention-gate)
  -> auto-reply/dispatch.ts (queue + process)
  -> routing/resolve-route.ts (bindings -> agentId + sessionKey)
  -> agents/pi-embedded-runner/run.ts (load session, build prompt, call LLM)
  -> agents/pi-embedded-subscribe.ts (stream response, execute tools)
  -> auto-reply/reply.ts (chunk, format)
  -> infra/outbound/deliver.ts (resolve target)
  -> extensions/whatsapp/channel.ts (Baileys sendMessage)
```

### Codebase Size
| Category | Files | LOC (non-test) |
|----------|-------|----------------|
| src/ | 2,151 | ~25,000 |
| extensions/ | ~400 | ~4,000 |
| ui/ | ~100 | ~1,500 |
| Total | ~2,700 | ~30,000 |

---

## III. Impactinomics & 0REALTALK Concept Mapping (K-Analyst Report)

### Core Philosophical Differentiators

Generic AI assistants optimize for **task completion**. A Civicognita assistant optimizes for **impact alignment toward the Prime Directive**:
1. Eradicate poverty
2. End non-consensual exploitation
3. Reduce crime to near zero

This is not a content filter — it is a positive directional optimization embedded in every output.

### The 0SCALE Formula
```
$imp = QUANT x VALUE[0BOOL] x (1 + 0BONUS)
```

| 0BOOL | Quant | State | Feeling |
|-------|-------|-------|---------|
| 0FALSE | -3 | 0DOOM | 0BAD |
| FALSE | -2 | DOOM | BAD |
| -0 | -1 | 0INDIFFERENT | 0MEH |
| 00 | 0 | HARMONY | NEUTRAL |
| 0+ | +1 | FLOW | HAPPY |
| TRUE | +2 | JOY | FULFILLED |
| 0TRUE | +3 | BLISS | ECSTASY |

### Entity System -> Multi-User Architecture

| Symbol | Domain | Assistant Mapping |
|--------|--------|-------------------|
| #E | Entity (human) | The user — all accountability flows here |
| $R | Resource (AI, app) | The assistant itself — constitutionally subordinate to #E |
| @N | Node (temporal) | Version/age context for interactions |

### 7 Unique Features No Other Assistant Has

1. **Verifiable Impact Ledger** — immutable, non-tradeable, COA-attributed record of every interaction's impact score
2. **Assistant Calibration via 0MINT** — after interactions, the assistant surfaces its assumptions for user validation; X-ALIGNMENT score measures calibration accuracy per domain
3. **Local-First Sovereignty (SPORE)** — operates fully OFFLINE on user's hardware, syncs when connected, never requires central platform
4. **MYCELIUM Knowledge Network** — opt-in validated learnings propagate across consenting users (MUSE -> IDEA -> THEORY -> LAW progression)
5. **Constitutional AI Governance** — three Prime Directive constraints are positive optimization targets, not just safety filters
6. **Achievement & Title System** — 0FIRST (unique forever), 0ACHIEVEMENT (earned milestones), 0TITLE (active roles) — earned through verifiable work
7. **Impact-Weighted Network Governance** — users with long histories of impactful work carry more weight in consensus (not plutocracy, not pure democracy)

### 20 LAW-Status Terms That Must Be Embedded

| # | Term | Meaning |
|---|------|---------|
| 1 | 0REALTALK | The synaptic verification language |
| 2 | 0USER | Identity root — all impact flows to the human requestor |
| 3 | $imp | Non-tradeable unit of social/environmental impact |
| 4 | COA | Chain of Accountability — unbreakable audit trail |
| 5 | 0BOOL_SCALE | 7-point truth scale (-3 to +3) |
| 6 | A:A | Agenda-to-Agenda alignment measurement |
| 7 | MAGIC | Confidence threshold (0.6+) for actionability |
| 8 | 0MINT | Proof-of-learning ceremony |
| 9 | 0BOON/0BURN | Positive/negative impact from work |
| 10 | 0BONUS | Upstream alignment multiplier — impact compounds |
| 11 | 0STAGE | 8-stage growth lifecycle (SPORE to FULLAGENT) |
| 12 | FRAME | Context window — knowledge is always temporal |
| 13 | LAW/THEORY/MUSING | Three tiers of knowledge confidence |
| 14 | 0K | Knowledge refinement process (raw to hardened) |
| 15 | TURN | Single work cycle toward next milestone |
| 16 | 0PRIME | Authoritative local source of truth |
| 17 | MYCELIUM | Immortal network layer connecting all nodes |
| 18 | SPORE | Deployable unit maintaining COA lineage |
| 19 | X-ALIGNMENT | Calibration score — % of correct assumptions |
| 20 | 0SCALE | The impact formula itself |

### One-Sentence Differentiator

> A Civicognita personal AI assistant is the only assistant whose effectiveness is measured not in tasks completed or minutes engaged, but in verifiable, non-tradeable impact toward the eradication of poverty — with a full accountability chain from every action back to the human who requested it.

---

## IV. Strategic Recommendations (Strategist Report)

### Build vs. Fork: BUILD

**Why not fork:**
- OpenClaw treats users as endpoint addresses (phone numbers, handles). Civicognita treats entities as governed identities with 0R verification, impact scores, and COA chains. These are architectural incompatibilities, not surface-level differences.
- A fork inherits OpenClaw's bugs, technical debt, and release cadence pressure
- Brand contamination — OpenClaw has a strong personality that conflicts with Civicognita's values-based positioning

**What to take as reference:**
- Plugin manifest schema pattern (`openclaw.plugin.json`)
- Channel adapter interface contract (ChannelPlugin with ~15 optional adapters)
- Gateway-as-control-plane concept
- Session key encoding pattern
- `doctor` diagnostics command pattern
- Pairing code flow for unknown senders

### Proposed Architecture

```
External Channels (Telegram, Discord, Signal, ...)
        |
  [ Channel Adapters ]       <- thin, per-channel normalization
        |
  [ 0R Gateway ]             <- core control plane
  |-- Entity Resolver         <- #E/#R/@N identification + 0R verification
  |-- Message Router          <- COA-aware routing to agent workspaces
  |-- Session Manager         <- BAIF-aware sessions with STATE-GATING
  |-- Impact Ledger           <- tracks interactions for scoring
  |-- WebSocket Control API   <- CLI, WebUI, external tools
        |
  [ Agent Runtime ]          <- BAIF + TASKMASTER execution layer
  |-- TERMINAL agents         <- nexus, analyst, strategist, etc.
  |-- WORKER agents           <- $W.* ephemeral, parallel
  |-- Dispatch system         <- existing handoff/dispatch JSON protocol
  |-- Memory bridge           <- Cognee + .nexus/.mem/ local
        |
  [ Tynn ]                   <- work management (already integrated)
```

### Tech Stack

| Layer | Recommendation | Rationale |
|-------|---------------|-----------|
| Language | TypeScript | Existing team expertise, channel library ecosystem |
| Runtime | Node.js 22 | Native fetch, ESM, WebSockets |
| Package mgr | pnpm | Monorepo workspaces, OpenClaw-validated |
| Build | tsdown / tsup | esbuild-based, fast iteration |
| Database | SQLite (better-sqlite3) | Local-first, zero-dependency, OFFLINE-compatible |
| Vectors | sqlite-vec | Keep vector search local |
| Telegram | grammy | Best Telegram library |
| Discord | discord.js | Standard |
| Event bus | Node.js EventEmitter | No external broker at MVP |
| Test | Vitest | Modern, fast, TypeScript-native |

### MVP Definition (Phase 1)

**One channel. One agent. COA working.**

- Telegram channel adapter (grammy)
- 0R Gateway with entity resolution + COA generation
- Single TERMINAL agent (nexus) via BAIF
- TASKMASTER connector for worker dispatch
- SQLite for entity store + COA chain logging
- Local memory (.nexus/.mem/)
- Basic WebChat control UI
- Human operator in the loop (full agentic automation is Phase 2)

**What is NOT MVP:** Multiple channels, voice, mobile apps, impact scoring algorithm, 0R seal issuance, Canvas/A2UI, public service

### Phased Roadmap

| Phase | Duration | Goal | Key Deliverable |
|-------|----------|------|-----------------|
| **1: Foundation** | Months 1-3 | Working single-channel assistant with 0R identity + COA | Telegram + nexus + COA logging |
| **2: Core Features** | Months 4-7 | Multi-channel, voice, impact scoring v1, 0R verification | 3 channels + voice + scoring |
| **3: Differentiators** | Months 8-14 | Impact dashboard, Canvas, mobile, plugin SDK | Impactinomics visible in product |
| **4: Scale** | Months 15+ | Multi-user service, governance, federation | Public platform |

### Key Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| **Scope collapse** (two projects in one) | HIGH | Strict phase separation — assistant first, impactinomics second |
| **BAIF integration complexity** | HIGH | MVP uses human-in-loop gateway; full automation Phase 2 |
| **Channel API instability** (Baileys/WhatsApp) | MEDIUM | MVP on Telegram only; WhatsApp deferred to Phase 3 |
| **0R verification not operationally specified** | MEDIUM | Write 0R Verification Protocol document before Phase 2 |
| **Feature gravity from OpenClaw** | MEDIUM | Every feature must answer: "Does this demonstrate impactinomics?" |
| **Solo founder bottleneck** | MEDIUM | Document BAIF for contributors; separate platform eng from governance design |

### Naming

| Name | Use | Rationale |
|------|-----|-----------|
| **Mycelium** | Platform/project (internal) | Direct connection to Nexus persona, interconnection, resilience |
| **Koru** | Consumer brand (future) | Maori symbol of new growth, community-oriented |

### Resource Estimate

| Phase | Team Size | Timeline |
|-------|-----------|----------|
| Phase 1 | 1-2 developers | 2-3 months |
| Phase 2 | 2-3 developers | 4-5 months |
| Phase 3 | 4-6 developers + designer | 6-8 months |
| Phase 4 | 6-10+ | Ongoing |

### Blockers Before Development

1. **0R Verification Protocol** document (governance, not technical)
2. **Impact scoring definition** (what earns $imp?)
3. **BAIF/API integration decision** (spawn process vs. call API vs. human-in-loop)
4. **WhatsApp legal review** (Baileys TOS risk)
5. **Developer hiring/partnership** (if not solo)

---

## V. Key Files for Reference

### OpenClaw (C:/_Projects/_x/openclaw/)
- `src/gateway/server.impl.ts` — top-level gateway orchestration
- `src/channels/plugins/types.plugin.ts` — the channel adapter contract
- `src/routing/resolve-route.ts` — multi-agent routing logic
- `src/routing/session-key.ts` — session key encoding
- `src/agents/pi-embedded-runner/run/attempt.ts` — per-message agent execution
- `src/agents/pi-embedded-subscribe.ts` — LLM output -> channel delivery
- `src/config/zod-schema.ts` — full config schema
- `src/plugins/types.ts` — plugin extension contract
- `extensions/whatsapp/src/channel.ts` — example channel implementation
- `src/security/audit.ts` — security audit trail

### Civicognita (C:/Users/glenn/.nexus/)
- `core/GOSPEL.md` — authoritative specification
- `core/0SCALE.md` — impact formula
- `core/ENTITY.md` — entity classification
- `core/0TERMS.md` — LAW-status lexicon (35 terms)
- `core/0COA.md` — Chain of Accountability
- `core/0MINT.md` — proof-of-learning ceremony
- `core/MANIFESTO.md` — Prime Directive + impactinomics foundation
- `core/0BONUS.md` — upstream alignment multiplier
- `core/0MYCELIUM.md` — network layer specification
- `core/0STAGE.md` — growth lifecycle

---

## VI. The One-Page Decision

```
WHAT:    Build "Mycelium" — a personal AI assistant powered by impactinomics
WHY:     No competitor has identity verification, impact scoring, or COA chains
HOW:     Ground-up build, TypeScript/Node, OpenClaw as reference only
WHEN:    MVP in 8-10 weeks (Telegram + nexus + COA)
WHO:     1-2 developers for Phase 1
RISK:    Scope — stay disciplined on phasing
```

**The strategic opening:** OpenClaw proved the architecture works. Nobody has built the governance layer. That is the gap Civicognita fills.

---

*Report compiled from three parallel worker analyses. Source transcripts available in .ai/handoff/*
