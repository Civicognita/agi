# Config Schema Changes: Extending Zod Schema + Hot-Reload

This guide covers how to extend `gateway.json` — the primary runtime config file — by editing the Zod schema in `config/src/schema.ts`, and explains how hot-reload works.

## Config Flow

```
gateway.json  →  ConfigWatcher (file watcher)  →  Zod parse  →  AionimaConfig  →  runtime
```

1. `gateway.json` is read from disk at startup (from `DEPLOY_DIR` in production, from `REPO_DIR` in dev)
2. The file is parsed and validated by `AionimaConfigSchema.parse()` in `config/src/schema.ts`
3. Zod provides defaults for any missing fields — you never have to set every field
4. `ConfigWatcher` watches the file for changes and re-parses on write
5. The validated `AionimaConfig` object is passed to the gateway, plugins, and the tRPC context

## Schema Structure

`config/src/schema.ts` defines the full config schema as a hierarchy of Zod schemas. The top-level export is:

```ts
export const AionimaConfigSchema = z.object({
  gateway: GatewayConfigSchema.default({}),
  channels: z.array(ChannelConfigSchema).default([]),
  entityStore: EntityStoreConfigSchema.default({}),
  auth: AuthConfigSchema.default({}),
  agent: AgentConfigSchema.default({}),
  queue: QueueConfigSchema.default({}),
  sessions: SessionsConfigSchema.default({}),
  dashboard: DashboardConfigSchema.default({}),
  skills: SkillsConfigSchema.default({}),
  memory: MemoryConfigSchema.default({}),
  workspace: WorkspaceConfigSchema.default({}),
  voice: VoiceConfigSchema.default({}),
  persona: PersonaConfigSchema.default({}),
  heartbeat: HeartbeatConfigSchema.default({}),
  prime: PrimeConfigSchema.default({}),
  logging: LoggingConfigSchema.default({}),
  // ...
}).strip();
```

The `.strip()` at the end discards any unknown keys in `gateway.json` rather than throwing.

### Key Sub-schemas

**`GatewayConfigSchema`** — HTTP server settings:
```ts
{ host: z.string().default("127.0.0.1"), port: z.number().default(3100), state: ... }
```

**`ChannelConfigSchema`** — Per-channel config (in the `channels` array):
```ts
{ id: z.string(), enabled: z.boolean().default(true), config: z.record(z.unknown()).optional() }
```

**`AgentConfigSchema`** — LLM provider and agent settings:
```ts
{ provider: z.enum(["anthropic","openai","ollama"]).default("anthropic"), model: z.string().default("claude-sonnet-4-6"), maxTokens: z.number().default(8192), replyMode: z.enum(["autonomous","human-in-loop"]).default("autonomous"), devMode: z.boolean().default(false), ... }
```

**`AuthConfigSchema`** — API auth tokens and rate limits:
```ts
{ tokens: z.array(z.string()).default([]), password: z.string().optional(), maxAttemptsPerWindow: z.number().default(10), ... }
```

## How to Add a New Config Field

### Adding to an existing sub-schema

Find the relevant schema in `config/src/schema.ts` and add a field with `.default()`:

```ts
// Before
const AgentConfigSchema = z.object({
  provider: z.enum(["anthropic", "openai", "ollama"]).default("anthropic"),
  model: z.string().default("claude-sonnet-4-6"),
  maxTokens: z.number().int().positive().default(8192),
  // ...
}).strict();

// After — adding a new field
const AgentConfigSchema = z.object({
  provider: z.enum(["anthropic", "openai", "ollama"]).default("anthropic"),
  model: z.string().default("claude-sonnet-4-6"),
  maxTokens: z.number().int().positive().default(8192),
  /** Enable streaming responses for compatible providers. */
  streamingEnabled: z.boolean().default(false),   // new field
  // ...
}).strict();
```

The `.strict()` call on a sub-schema means unknown keys inside that object will throw a validation error. Add your field before the closing `.strict()`.

### Adding a new top-level config section

1. Define a new schema:

```ts
// config/src/schema.ts

const MyFeatureConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    endpoint: z.string().url().optional(),
    maxRetries: z.number().int().min(0).max(10).default(3),
    /** Timeout in ms for each request. */
    timeoutMs: z.number().int().positive().default(5000),
  })
  .strict();
```

2. Add to `AionimaConfigSchema`:

```ts
export const AionimaConfigSchema = z.object({
  // ...existing fields...
  myFeature: MyFeatureConfigSchema.default({}),
}).strip();
```

3. Export the type:

```ts
// config/src/schema.ts
export type MyFeatureConfig = z.infer<typeof MyFeatureConfigSchema>;
```

4. Re-export from `config/src/index.ts`:

```ts
// config/src/index.ts
export {
  AionimaConfigSchema,
  type AionimaConfig,
  // ...existing exports...
  type MyFeatureConfig,   // add this line
} from "./schema.js";
```

5. Use in a plugin:

```ts
// packages/plugin-<name>/src/index.ts
const config = api.getConfig() as { myFeature?: { enabled?: boolean; endpoint?: string } };
const myConfig = config.myFeature;
if (myConfig?.enabled) {
  initWithEndpoint(myConfig.endpoint);
}
```

Or type it properly:

```ts
import type { AionimaConfig } from "@agi/config";

const rawConfig = api.getConfig() as Partial<AionimaConfig>;
const myFeature = rawConfig.myFeature;
```

## Default Values

Every field in every sub-schema must have a `.default()` so that a minimal `gateway.json` (even `{}`) produces a valid `AionimaConfig`. The top-level schema uses `.default({})` on each sub-schema, which invokes the sub-schema with an empty object, triggering all nested defaults.

**Correct:**
```ts
timeout: z.number().int().positive().default(5000),
```

**Wrong — will error when field is missing from gateway.json:**
```ts
timeout: z.number().int().positive(),  // no default — breaks bare configs
```

For optional string fields that have no sensible default:
```ts
apiKey: z.string().optional(),  // OK — undefined is valid
```

For booleans:
```ts
enabled: z.boolean().default(false),  // always provide a default
```

## Validation Patterns

### Enum fields

```ts
mode: z.enum(["fast", "careful", "balanced"]).default("balanced"),
```

### Nested objects

```ts
const ProviderConfigSchema = z.object({
  type: z.enum(["anthropic", "openai", "ollama"]),
  model: z.string(),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
}).strict();

const AgentConfigSchema = z.object({
  // ...
  providers: z.array(ProviderConfigSchema).optional(),
}).strict();
```

### URL validation

```ts
webhookUrl: z.string().url().optional(),
```

### Range validation

```ts
port: z.number().int().min(1).max(65535).default(3100),
concurrency: z.number().int().positive().default(10),
```

### String patterns

```ts
resourceId: z.string().regex(/^\$[A-Z0-9]+$/).default("$A0"),
```

## Hot-Reload Behavior

`ConfigWatcher` in `config/src/hot-reload.ts` watches `gateway.json` for changes using Node.js `fs.watch`. When the file changes:

1. It reads the new content from disk
2. Parses it through `AionimaConfigSchema.safeParse()`
3. If valid, emits a `config:changed` event with the new config
4. If invalid (Zod validation error), it logs the error and keeps the previous config

The gateway subscribes to `config:changed` and:
- Updates in-memory config references
- Fires the `"config:changed"` plugin hook for each changed key
- Does NOT restart the process — hot-reload is truly live

Plugins can react to config changes via the hook:

```ts
api.registerHook("config:changed", async (key, value) => {
  if (key === "agent") {
    const agentConfig = value as { model?: string };
    updateModel(agentConfig.model);
  }
});
```

### What hot-reload does NOT cover

- Adding a new channel (requires channel discovery to re-run — restart the service)
- Changes to plugin manifests (require restart)
- Changes to `gateway.host` or `gateway.port` (require restart — the HTTP server cannot rebind)
- Changes to `auth.tokens` (takes effect immediately via hot-reload)

## `dev` Config Section

The `dev` section controls Contributing Mode — toggling between the production and development directory for PRIME.

```ts
const DevConfigSchema = z.object({
  enabled: z.boolean().default(false),
  primeDir: z.string().default("/opt/agi-prime_dev"),
}).strict();
```

Added to `AionimaConfigSchema` as `dev: DevConfigSchema.optional()`.

### Contributing Mode Config Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | `boolean` | `false` | Toggle contributing mode on/off |
| `primeDir` | `string` | `"/opt/agi-prime_dev"` | Path to dev PRIME corpus directory |

When `dev.enabled` is `true`, `resolvePrimeDir()` (in `packages/gateway-core/src/resolve-paths.ts`) returns the dev path instead of the production path. COA audit records include a `fork_id` for traceability.

### Migration: `agent.devMode` -> `dev.enabled`

The `agent.devMode` boolean is preserved for backward compatibility. The system prompt resolution reads `dev.enabled` first, falling back to `agent.devMode`:

```ts
// packages/gateway-core/src/server.ts
const devMode = config.dev?.enabled ?? config.agent?.devMode ?? false;
```

The `POST /api/dev/switch` endpoint updates `dev.enabled` in `gateway.json` and triggers a config reload. A service restart is required for the change to take full effect (path resolution happens at boot).

### API Endpoints

- `GET /api/dev/status` — returns `{ enabled, primeDir }`
- `POST /api/dev/switch` — body `{ enabled: boolean }` — toggles `dev.enabled` in config. Requires a service restart to apply

## Files to Modify

| File | Change |
|------|--------|
| `config/src/schema.ts` | Add field to existing sub-schema OR define new sub-schema + add to root |
| `config/src/index.ts` | Re-export new type if you added a new schema/type |
| `gateway.json` | Add the new field with your chosen value (optional if there's a default) |

## Verification Checklist

- [ ] New field has a `.default()` (or is explicitly `.optional()`)
- [ ] Schema is still `.strict()` if applicable — no typos in field names
- [ ] `pnpm typecheck` — `AionimaConfig` type includes the new field correctly
- [ ] `pnpm build` — no compile errors
- [ ] Remove the new field from `gateway.json` — gateway still starts (default applies)
- [ ] Add an invalid value to `gateway.json` — gateway logs a Zod validation error and falls back to previous config (hot-reload path) or exits with a clear error (startup path)
- [ ] Verify via `GET /api/config` (tRPC) or read `gateway.json` from the editor API that the config round-trips correctly
- [ ] If the field affects plugin behavior, test the plugin reacts correctly on both startup and hot-reload
