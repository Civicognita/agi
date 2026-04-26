# ADF — Agent Development Framework

The **Agent Development Framework (ADF)** is the whole framework for building agentic applications like Aionima — classes, components, safety gates, and tools that let an AI safely extend its own functionality as its owner needs.

**Aionima is the reference implementation, not the only consumer.** Other agentic applications can be built on top of ADF. The framework is *in its infancy* — the current shape (mostly backend invocation pipeline) is the starting point, not the mature form.

> The mature ADF is **an AI operating system that can propose, train, verify, and adopt its own upgrades under constitutional and cryptographic constraints.**
> Until then, every ADF surface that ships is a step toward that target.

The ADF is a **sibling to the SDK**, not a layer above or below it. They solve different problems for different audiences:

| | ADF | SDK |
|---|---|---|
| Audience | AGI core engineers + framework adopters | Plugin authors |
| Surface | Internal framework facades + ADF Context + Intelligence Protocols | `@aionima/sdk` `define*()` builders |
| Entry | `initADF()` / `getADF()` (module singleton) | `createPlugin({ define*() })` |
| Changes | Treated like core platform changes | Versioned per-plugin |
| Example use | A new invocation stage, Intelligence Protocol, safety gate | A new `defineTool`, `defineProvider`, `defineMagicApp` |

The **SDK** asks "how does someone outside of core add behavior to the gateway?" — the **ADF** asks "how does the agent itself work, learn, govern, and extend?"

---

## What ADF includes (the whole framework)

ADF is not a single module — it's the whole stack the agent runs on. As the framework matures, each category below grows. The current shape of each is captured under "Current shape" further down.

### 1. Backend pipeline
The invocation flow. agent-invoker, agent-router, tool-registry, agent-session, llm/factory. This is what exists today (see "Current shape" below for file map).

### 2. Safety + governance
The gates that keep self-extension from becoming self-sabotage. Per `_discovery/aion-blockchain-memory-draft-a.md`'s 4-gate model: data-quality, reward, governance, rollback. Plus TrueCost recording (every action → COA<>COI), PRIME drift detection, COA<>COI per-action audit chain. Tracked in tynn s112 (memory + learning) and s117 (TRUECOST).

### 3. Memory & Learning Framework
The 4-layer memory model from `_discovery/aion-blockchain-memory-draft-a.md`:
- Layer A — Working memory (current task)
- Layer B — Episodic memory (summarized events with primeAlignment scores)
- Layer C — **PRIME** (the seed; doctrine; constitution)
- Layer D — Anchor stub in v0.4.0 → live blockchain anchor in v0.6.0

Plus the LoRA training pipeline + candidate-dataset accumulator + 4 eval gates. Tracked in tynn s112 (scaffolding ships in alpha-stable-1; live training + auto-promotion in v0.6.0).

### 4. Provider/Runtime layer
Three distinct concepts that earlier ADF iterations conflated:
- **Providers** are core-agi catalogs of models — HF, Anthropic, OpenAI, **aion-micro** (the off-grid floor).
- **Runtimes** are 0RUN plugins — Ollama, Lemonade, llama.cpp.
- **Agent Router** picks Provider + model per turn based on cost mode + complexity.

Tracked in tynn s111. The owner-facing UX for this lives in the Settings → Providers page; canonical visual design at `~/_dropbox/providers-mockup.html` (DESIGN APPROVED 2026-04-25).

### 5. UI components
The dashboard surfaces an owner uses to inspect and control the agent: live decision feed, what-if router simulator, cost-aware dial, off-grid mode toggle, provider shelf, runtimes strip, decision-explanation panels. Today most of these don't exist — they ship as part of s111 (Providers page) and forward as ADF UI primitives. Built on `@particle-academy/react-fancy` + `@/components/ui/card`.

### 6. SDK contracts
The `define*()` builders plugins use to extend the agent: `defineTool`, `defineProvider`, `defineRuntime`, `defineSkill`, `defineMagicApp`, `defineEmbedder` (s116), `defineAnchor` (s113), `defineScanProvider` (security). Each builder is a contract between SDK and ADF.

### 7. Intelligence Protocols
A class within ADF that governs how an agent senses, decides, learns, coordinates, and shares trust with other agents. **MPx (Mycelium Protocol)** is the first — used by aion/prime; enables HIVE alignment + COA<>COI indexing + FRAME-SHIFT impact QUANT. See [Intelligence Protocols](#intelligence-protocols) section below.

### 8. Self-extension safety primitives
The composition of categories 2 + 3 + 7 that make safe AI self-extension possible. Without ADF's gates + audit trail + UI surfaces, an agent extending itself is a runaway risk; with ADF, it's a governed process. Per draft-a's "blunt recommendation": "self-curation first, self-judgment second, self-training third, self-promotion last." Each step is an ADF surface.

---

## Intelligence Protocols

Intelligence Protocols are versioned protocols within ADF that govern specific agent capabilities — sensing, deciding, learning, coordinating, sharing trust. Each protocol is a self-contained spec with a name, version, and contract that other ADF surfaces consume.

### MPx — Mycelium Protocol (the first Intelligence Protocol)

MPx is used by aion/prime. It defines:
- Boot sequence (Initial → Limbo → Online state machine, with COA<>COI validation at each transition)
- Operational states + capabilities table
- Entity architecture (#E people, #O orgs, $A agents, $M MApps, ~ local-only prefix)
- Memory protocol (multi-file + `_map.md` index)
- HIVE alignment primitive (cross-instance trust + COA<>COI indexing + FRAME-SHIFT impact QUANT)

Canonical doc: `aionima-prime/core/0MYCELIUM.md`. The agi-side state machine that consumes MPx: `agi/docs/agents/state-machine.md`.

### Future Intelligence Protocols

ADF is in infancy — the catalog of Intelligence Protocols will grow. Adding a new one requires:
1. A canonical spec in `aionima-prime/core/` (PRIME canon) or `agi/docs/agents/` (agi-implementation canon)
2. ADF integration: a typed protocol surface in `packages/aion-sdk/src/` that other ADF surfaces consume
3. A versioning convention so protocol revisions are observable + rollback-able
4. Cross-reference here

Don't speculate on future Intelligence Protocols in this doc — ship them when their need is concrete.

---

## Current shape — distributed across `@agi/gateway-core`

Today the ADF does not live in its own package. Its files are distributed inside `packages/gateway-core/src/` (with a thin context facade exposed from `packages/aion-sdk/src/adf-context.ts`). Promotion to `packages/adf/` is tracked as Phase 6b below.

File map for category 1 (Backend pipeline):

| File | Role |
|---|---|
| `packages/gateway-core/src/agent-invoker.ts` | Main invocation pipeline — assembles the system prompt, runs the tool loop, emits TASKMASTER jobs, captures the final response. |
| `packages/gateway-core/src/agent-session.ts` | Per-entity-per-channel session state — turn history, context-window budgeting, compaction when the window gets tight. |
| `packages/gateway-core/src/tool-registry.ts` | Tool registration, execution dispatch, COA chain logging, result sanitization. |
| `packages/gateway-core/src/llm/agent-router.ts` | Multi-model routing — selects which Provider + model per turn based on cost mode + complexity. |
| `packages/gateway-core/src/llm/provider.ts` | Provider abstraction — common interface for Anthropic / OpenAI / Ollama / Lemonade / HF-local / aion-micro. |
| `packages/gateway-core/src/llm/request-classifier.ts` | Classifies an incoming agent request for routing (heavy reasoning vs. chat vs. tool-heavy). |
| `packages/gateway-core/src/llm/failover-provider.ts` | Wraps a provider list so transient errors transparently fail over to the next provider. |
| `packages/gateway-core/src/ws-server.ts` | Realtime event plane — pushes agent events to dashboard clients and human-in-the-loop operators. |
| `packages/gateway-core/src/plan-tynn-mapper.ts` | Bridge between agent-emitted plans and tynn story/task entities. |
| `packages/agent-bridge/src/` | MCP + human-in-the-loop bridge surface. |
| `packages/aion-sdk/src/adf-context.ts` | The only piece of the ADF that plugins and other packages are allowed to reach into — the framework context singleton. |

The end-to-end path through these files is documented in [agent-pipeline.md](./agent-pipeline.md). This doc describes the *framework*; that doc describes the *flow*.

Categories 2–8 (safety, memory, Provider/Runtime, UI, SDK contracts, Intelligence Protocols, self-extension primitives) are partially implemented and partially scaffolded — see the relevant tynn stories under v0.4.0 and v0.6.0 for current status.

---

## ADF Context — the framework singleton

Plugins never call into the ADF directly. They get `AionimaPluginAPI` via the SDK. But core code inside the gateway (workers, runtime state, tool implementations) needs access to framework-level services like logging, config, workspace info, and security scanning — without threading every dependency through every function signature.

That's what `ADFContext` is. It is initialized once at gateway boot via `initADF(context)` and accessed via `getADF()` throughout core.

```typescript
import { initADF, getADF } from "@aionima/sdk/adf-context";

// At boot
initADF({
  logger: rootLogger,
  config: resolvedConfig,
  workspaceRoot: "/home/wishborn/.agi",
  projectDirs: [...],
  security: securityFacade,      // optional — present when @agi/security is loaded
  projectConfig: projectCfg,     // optional — present when ProjectConfigManager is initialized
  systemConfig: systemCfg,       // optional — present when SystemConfigService is initialized
});

// Anywhere in core
const adf = getADF();
adf.logger.info("hello");
adf.systemConfig?.patch("agent.replyMode", "autonomous");
```

Facades exposed today:

- **`logger`** — structured logging with severity levels (required).
- **`config`** — read-only snapshot of the resolved gateway config (required).
- **`workspaceRoot`** + **`projectDirs`** — filesystem scopes the agent may touch (required).
- **`security`** — run scans, query findings, list providers (optional).
- **`projectConfig`** — read per-project config + hosting + stacks (optional).
- **`systemConfig`** — read/write `gateway.json` by dot-path (optional).

Adding a new facade is an ADF-level change: extend `ADFContext`, wire it into `initADF` at boot, and document it here. Do not add plugin-facing APIs this way — those go through the SDK `define*()` builders.

---

## Extending the ADF

Common extension points:

### Add a new LLM provider

1. Implement the `Provider` interface from `packages/gateway-core/src/llm/provider.ts`.
2. Register it in `packages/gateway-core/src/llm/factory.ts` under a new provider key.
3. Update `packages/gateway-core/src/llm/agent-router.ts` if the new provider needs special routing rules (e.g. local-only, GPU-only).
4. Document the config keys in [agent-pipeline.md § Providers](./agent-pipeline.md#stage-5--invocation).
5. Plugin authors who want to *use* the new provider do so through their existing `defineProvider` in the SDK — they don't touch the ADF.

### Add a new tool

There are two paths, and the ADF/SDK boundary determines which:

- **Tool that lives in a plugin** → SDK path. Use `defineTool({ ... })` and let the plugin lifecycle register it. Most tools should go here.
- **Tool that lives in core** (e.g. `search_prime`, `tynn_*`) → ADF path. Register directly via `toolRegistry.register({ ... })` in a boot-time module. Core tools can read from `getADF()`.

### Add a new invocation stage

This is a rare, high-impact change. Every stage is enumerated in [agent-pipeline.md](./agent-pipeline.md). Adding one means editing `agent-invoker.ts`, possibly `agent-session.ts`, and updating the pipeline doc in the same commit. Do not add stages without a corresponding plan entry in tynn.

### Add a new Intelligence Protocol

See [Intelligence Protocols](#intelligence-protocols) above for the criteria. New Intelligence Protocols are framework-level changes; expect owner review.

### Add a new safety gate

The 4-gate model from draft-a is the canon. To extend:
1. Identify which gate category the new check belongs to (data-quality, reward, governance, rollback).
2. Add it as a step inside that gate's evaluation, not as a sibling gate.
3. New top-level gates require a doc-level change to draft-a + this doc.

---

## Phase 6b — promote to `packages/adf/`

The fact that the ADF doesn't have its own package directory is a known deferral, not an accident. The current distribution across `gateway-core/` keeps the change surface small while the ADF's shape is still stabilizing. Promotion to `packages/adf/` is tracked as **Phase 6b** of the alpha-stable-1 sweep and will happen after the milestone cut.

Boundaries that would need to be drawn cleanly for the split:

1. **Public ADF API** — exactly which symbols plugins and other `packages/*` can import. Today they mostly reach through `@aionima/sdk/adf-context`. Post-split, this would become `@agi/adf`.
2. **Invocation pipeline vs. HTTP/WS wiring** — the pipeline is ADF, the request intake that feeds it is gateway. The split is cleaner than it looks; `agent-invoker.ts` already does no HTTP.
3. **Provider interface vs. provider implementations** — the interface belongs to ADF, implementations could ship separately as `@agi/provider-anthropic`, `@agi/provider-ollama`, etc. This is the heaviest refactor and may be deferred further.
4. **Intelligence Protocols** — MPx already lives in `aionima-prime/`. Future protocols may need their own `packages/protocols/` directory; deferred.

If you are about to do work that materially changes the ADF's surface before 6b lands, file a tynn task under the relevant story so the promotion plan stays current.

---

## Why this framing matters

ADF is what makes safe AI self-extension possible. Without ADF's gates + audit trail + UI surfaces, an agent extending itself is a runaway risk; with ADF, it's a governed process.

The risk of misframing ADF as just "an invocation pipeline" is sprawl: many backend pieces, no shared substrate, no UI surfaces to inspect/control, no Intelligence Protocols to coordinate, no eval gates to govern. The corrected framing makes ADF the load-bearing concept everything else hangs from. Aionima succeeds when ADF works; ADF works when its 8 categories above coalesce into a usable framework.

Per draft-a's blunt recommendation:
> "self-curation first, self-judgment second, self-training third, self-promotion last"

Each step is an ADF surface. The whole stack is the framework. ADF's job is to make that whole sequence trustworthy.

---

## Related docs

- [agent-pipeline.md](./agent-pipeline.md) — step-by-step flow through the ADF backend pipeline at runtime.
- [plugins.md](./plugins.md) — SDK-side plugin authoring (the other side of the boundary).
- [skills.md](./skills.md) — how skill files are matched and injected into the system prompt.
- [taskmaster.md](./taskmaster.md) — how `q:>` jobs emitted from the agent flow back into the task system.
- [system-prompt-assembly.md](../agents/system-prompt-assembly.md) — the system-prompt construction process; consumes Provider config + PRIME via Layer C.
- `aionima-prime/core/0MYCELIUM.md` — MPx (the first Intelligence Protocol) canonical spec.
- `_discovery/aion-blockchain-memory-draft-a.md` — the source pattern for ADF's safety + memory + learning categories (the architecture this doc implements).
- tynn s111 — Provider/Runtime architecture overhaul (categories 4 + 5).
- tynn s112 — Memory & Learning Framework scaffolding (categories 2 + 3).
- tynn s117 — TRUECOST measurements (cross-cutting category 2 enabler).
