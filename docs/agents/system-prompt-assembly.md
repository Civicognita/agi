# System Prompt Assembly: How the System Prompt Is Built and Extended

This document describes how the agent's system prompt is constructed in `packages/agent-bridge/`, how context is injected, and how to add new sections.

## Overview

The agent pipeline operates through `AgentBridge` in `packages/agent-bridge/src/bridge.ts`. When the gateway receives an inbound message from the queue, it calls `bridge.notify(queueMessage)`, which holds the message for operator review. When a reply is dispatched (autonomous or operator-approved), the agent is invoked through the session pipeline in `packages/gateway-core/src/agent-session.ts`.

The system prompt is assembled each time a new agent session is created or when a session receives a new message. It draws from multiple sources:

1. Core identity and behavior instructions (hardcoded)
2. PRIME knowledge corpus (external repo, resolved via `prime.dir` config)
3. Skills (loaded from `skills/` via `packages/skills/`)
4. Composite memory (via `packages/memory/`)
5. Entity context (from the entity model)
6. Channel-specific context
7. Developer mode context (if `agent.devMode` is enabled in config)

## Bridge and Session Architecture

```
InboundRouter → MessageQueue → QueueConsumer → AgentBridge.notify()
                                                     ↓
                                           HeldMessage (in-memory map)
                                                     ↓
                                        AgentBridge.handleReply()
                                                     ↓
                                       BridgeDispatcher.dispatch()
                                                     ↓
                                       AgentSessionManager.invoke()
                                                     ↓
                                         System prompt assembly
                                                     ↓
                                           LLM API call (Claude)
```

`AgentBridge` in `packages/agent-bridge/src/bridge.ts` is the central hub. It receives messages via `notify()`, holds them in a `Map<string, HeldMessage>`, and sends replies via `handleReply()`. It does not itself build the system prompt — that happens in the session manager.

## Context Sanitization

Before any user-supplied content enters the system prompt, it passes through `packages/agent-bridge/src/sanitize.ts`:

```ts
import { sanitizeForPromptLiteral, sanitizeRecord } from "@aionima/agent-bridge";

// Sanitize a string before injecting into system prompt
const safeText = sanitizeForPromptLiteral(userInput);

// Sanitize a metadata record
const safeMeta = sanitizeRecord(rawMetadata);
```

`sanitizeForPromptLiteral` strips:
- Unicode direction-override characters (U+202A–U+202E, U+2066–U+2069, U+200B, U+FEFF)
- Null bytes
- Other control characters that could manipulate prompt rendering

Always sanitize before injecting user-controlled content.

## Context Budget Management

`ContextGuard` in `packages/agent-bridge/src/context-guard.ts` tracks token usage and enforces the session context window budget:

```ts
import { ContextGuard } from "@aionima/agent-bridge";

const guard = new ContextGuard({
  contextWindowTokens: 200000,  // from sessions.contextWindowTokens in config
  maxSystemPromptTokens: 40000,
  maxMessageTokens: 150000,
  tokenEstimateCharsPerToken: 4,
});

const budgetResult = guard.checkBudget(systemPrompt, messages);
if (budgetResult.systemPromptExceeded) {
  // Truncate or summarize system prompt sections
}
```

When adding new system prompt sections, be mindful of token budget. Large dynamic sections (PRIME knowledge, memory context) should be capped.

## How to Add a New System Prompt Section

System prompt assembly happens in `packages/gateway-core/src/agent-session.ts` (the `AgentSessionManager` class). Find the method that builds the prompt string (typically `buildSystemPrompt()` or a method called during `invoke()`).

### Pattern: Static section

Add a constant string to the assembled prompt:

```ts
// packages/gateway-core/src/agent-session.ts

function buildSystemPrompt(context: SessionContext): string {
  const sections: string[] = [
    buildCoreIdentity(context.agentConfig),
    buildPrimeContext(context.primeKnowledge),
    buildSkillsContext(context.skills),
    buildMyNewSection(context),   // add here
    buildEntityContext(context.entity),
    buildChannelContext(context.channel),
  ];

  return sections.filter(Boolean).join("\n\n---\n\n");
}

function buildMyNewSection(context: SessionContext): string {
  const { myFeatureConfig } = context;
  if (!myFeatureConfig?.enabled) return "";

  return [
    "## My Feature Context",
    "",
    `Current mode: ${myFeatureConfig.mode}`,
    `Active since: ${myFeatureConfig.activeSince}`,
  ].join("\n");
}
```

### Pattern: Dynamic section from entity model

```ts
function buildEntityContext(entity: Entity | null): string {
  if (!entity) return "";

  return [
    "## Entity Context",
    "",
    `You are speaking with: ${sanitizeForPromptLiteral(entity.displayName)}`,
    `Entity ID: ${entity.id}`,
    `Verification tier: ${entity.verificationTier}`,
    `COA alias: ${entity.coaAlias}`,
  ].join("\n");
}
```

### Pattern: Channel-specific context

Different channels provide different metadata. Inject channel-specific instructions based on `channelId`:

```ts
function buildChannelContext(channel: ChannelContext): string {
  const base = [
    "## Channel Context",
    "",
    `Active channel: ${channel.id}`,
    `Capabilities: ${Object.entries(channel.capabilities).filter(([,v]) => v).map(([k]) => k).join(", ")}`,
  ];

  if (channel.id === "telegram") {
    base.push("", "Telegram note: You can use *bold*, _italic_, and `code` formatting in replies.");
  } else if (channel.id === "gmail") {
    base.push("", "Gmail note: Replies will be sent as email. Keep responses structured and professional.");
  }

  return base.join("\n");
}
```

### Pattern: Injecting PRIME knowledge

PRIME knowledge lives in an external repo (resolved via `resolvePrimeDir()` from `packages/gateway-core/src/resolve-paths.ts`). Load it via the `PrimeLoader`:

```ts
import { PrimeLoader } from "./prime-loader.js";
import { resolvePrimeDir } from "./resolve-paths.js";

const primeDir = resolvePrimeDir(config);
const primeLoader = new PrimeLoader(primeDir);
primeLoader.index();
```

Never write runtime data to the PRIME directory. It is a knowledge corpus — read-only at runtime.

### Pattern: Injecting skills

Skills live in `skills/` and are loaded via `packages/skills/`. The `SkillLoader` in that package reads `.md` and `.ts` skill files:

```ts
// In agent-session.ts
import { SkillLoader } from "@aionima/skills";

const loader = new SkillLoader({ skillsDir: join(workspaceRoot, "skills") });
const skills = await loader.loadAll();

function buildSkillsContext(skills: Skill[]): string {
  if (skills.length === 0) return "";

  const skillList = skills
    .map((s) => `- **${s.name}**: ${sanitizeForPromptLiteral(s.description)}`)
    .join("\n");

  return ["## Available Skills", "", skillList].join("\n");
}
```

### Pattern: Memory context injection

`packages/memory/` provides a composite memory adapter. It aggregates multiple memory backends (local file, Cognee, etc.):

```ts
import type { MemoryAdapter } from "@aionima/memory";

async function buildMemoryContext(memory: MemoryAdapter, entityId: string, query: string): Promise<string> {
  const memories = await memory.recall({ entityId, query, limit: 10 });
  if (memories.length === 0) return "";

  const items = memories
    .map((m) => `- ${sanitizeForPromptLiteral(m.content)}`)
    .join("\n");

  return ["## Relevant Memory", "", items].join("\n");
}
```

## Developer Mode Context

When `agent.devMode` is `true` in `gateway.json`, the agent receives additional workspace context:

```ts
function buildDevModeContext(config: AgentConfig, workspaceRoot: string): string {
  if (!config.devMode) return "";

  return [
    "## Developer Context",
    "",
    `Workspace root: ${workspaceRoot}`,
    `Agent resource ID: ${config.resourceId}`,
    `Agent node ID: ${config.nodeId}`,
    `Reply mode: ${config.replyMode}`,
  ].join("\n");
}
```

## Prompt Section Ordering

The assembled system prompt should follow this order, from most static to most dynamic:

1. Core identity and persona (from PRIME repo persona files or hardcoded)
2. Behavioral rules and constraints
3. Skills list
4. PRIME knowledge excerpts (static, from PRIME repo)
5. Memory context (dynamic, per-entity)
6. Entity context (who is the user)
7. Channel context (what channel, what capabilities)
8. Session context (recent history summary if any)
9. Developer mode additions (if enabled)

This ordering ensures that the most important instructions (identity, rules) are at the top where most LLMs pay closest attention, and dynamic context fills in below.

## Files to Modify

| File | Change |
|------|--------|
| `packages/gateway-core/src/agent-session.ts` | Add new section builder function; call it in `buildSystemPrompt()` |
| `packages/agent-bridge/src/sanitize.ts` | Add new sanitization patterns if new content types are injected |
| `packages/agent-bridge/src/context-guard.ts` | Adjust token budgets if new sections are large |
| `packages/gateway-core/src/agent-session.ts` | Add new context fields to `SessionContext` type if needed |
| `config/src/schema.ts` | Add config fields to enable/disable or tune the new section |

## Verification Checklist

- [ ] All user-supplied strings pass through `sanitizeForPromptLiteral()` before injection
- [ ] New section has a guard that returns `""` when disabled or when data is unavailable
- [ ] `pnpm typecheck` — passes
- [ ] `pnpm build` — no compile errors
- [ ] Start the gateway with `pnpm dev` — no errors
- [ ] Send a test message through a channel and verify the new section appears in the prompt (enable request logging or add a temporary `console.log`)
- [ ] Token budget stays under `sessions.contextWindowTokens` — measure with `ContextGuard.checkBudget()`
- [ ] Content from PRIME repo is loaded read-only; no writes to that directory
