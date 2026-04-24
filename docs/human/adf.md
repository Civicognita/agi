# ADF — Agent Development Framework

The Agent Development Framework (ADF) is the conceptual framework that governs how Aionima invokes agents, executes tool loops, manages sessions, and bridges to MCP and human-in-the-loop workflows. It is the ".NET for .agi" — the substrate that every agent-driven capability in the gateway sits on top of.

The ADF is a **sibling to the SDK**, not a layer above or below it. They solve different problems for different audiences:

| | ADF | SDK |
|---|---|---|
| Audience | AGI core engineers | Plugin authors |
| Surface | Internal framework facades | `@aionima/sdk` public API |
| Entry | `initADF()` / `getADF()` (module singleton) | `createPlugin({ define*() })` |
| Changes | Treated like core platform changes | Versioned per-plugin |
| Example use | A new invocation stage, provider router, tool gate | A new `defineTool`, `defineChannel`, `defineMagicApp` |

Think of it this way: the **SDK** asks "how does someone outside of core add behavior to the gateway?" — the **ADF** asks "how does the agent itself work?"

---

## Current shape — distributed across `@agi/gateway-core`

Today the ADF does not live in its own package. Its files are distributed inside `packages/gateway-core/src/` (with a thin context facade exposed from `packages/aion-sdk/src/adf-context.ts`). Promoting it to `packages/adf/` is a post-alpha-stable-1 candidate (see Phase 6b below).

File map — each entry is a load-bearing part of the ADF:

| File | Role |
|---|---|
| `packages/gateway-core/src/agent-invoker.ts` | Main invocation pipeline — assembles the system prompt, runs the tool loop, emits TASKMASTER jobs, captures the final response. |
| `packages/gateway-core/src/agent-session.ts` | Per-entity-per-channel session state — turn history, context-window budgeting, compaction when the window gets tight. |
| `packages/gateway-core/src/tool-registry.ts` | Tool registration, execution dispatch, COA chain logging, result sanitization. |
| `packages/gateway-core/src/llm/agent-router.ts` | Multi-model routing — selects which provider to hit based on request classification + config. |
| `packages/gateway-core/src/llm/provider.ts` | Provider abstraction — common interface for Anthropic / OpenAI / Ollama / Lemonade / HF-local. |
| `packages/gateway-core/src/llm/request-classifier.ts` | Classifies an incoming agent request for routing (e.g. heavy reasoning vs. chat vs. tool-heavy). |
| `packages/gateway-core/src/llm/failover-provider.ts` | Wraps a provider list so transient errors transparently fail over to the next provider. |
| `packages/gateway-core/src/ws-server.ts` | Realtime event plane — pushes agent events to dashboard clients and human-in-the-loop operators. |
| `packages/gateway-core/src/plan-tynn-mapper.ts` | Bridge between agent-emitted plans and tynn story/task entities. |
| `packages/agent-bridge/src/` | MCP + human-in-the-loop bridge surface. |
| `packages/aion-sdk/src/adf-context.ts` | The only piece of the ADF that plugins and other packages are allowed to reach into — the framework context singleton. |

The end-to-end path through these files is documented in [agent-pipeline.md](./agent-pipeline.md). This doc describes the *framework*; that doc describes the *flow*.

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

---

## Phase 6b — promote to `packages/adf/`

The fact that the ADF doesn't have its own package directory is a known deferral, not an accident. The current distribution across `gateway-core/` keeps the change surface small while the ADF's shape is still stabilizing. Promotion to `packages/adf/` is tracked as **Phase 6b** of the alpha-stable-1 sweep and will happen after the milestone cut.

Boundaries that would need to be drawn cleanly for the split:

1. **Public ADF API** — exactly which symbols plugins and other `packages/*` can import. Today they mostly reach through `@aionima/sdk/adf-context`. Post-split, this would become `@agi/adf`.
2. **Invocation pipeline vs. HTTP/WS wiring** — the pipeline is ADF, the request intake that feeds it is gateway. The split is cleaner than it looks; `agent-invoker.ts` already does no HTTP.
3. **Provider interface vs. provider implementations** — the interface belongs to ADF, implementations could ship separately as `@agi/provider-anthropic`, `@agi/provider-ollama`, etc. This is the heaviest refactor and may be deferred further.

If you are about to do work that materially changes the ADF's surface before 6b lands, file a tynn task under the sweep story that captures the new shape, so the promotion plan stays current.

---

## Related docs

- [agent-pipeline.md](./agent-pipeline.md) — step-by-step flow through the ADF at runtime.
- [plugins.md](./plugins.md) — SDK-side plugin authoring (the other side of the boundary).
- [skills.md](./skills.md) — how skill files are matched and injected into the system prompt.
- [taskmaster.md](./taskmaster.md) — how `q:>` jobs emitted from the agent flow back into the task system.
