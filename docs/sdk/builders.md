# Builder Reference

All 16 `define*()` builders follow the same pattern: construct with required identifiers, chain configuration methods, and call `.build()` to produce a definition object. Calling `.build()` validates required fields and throws if any are missing.

---

## defineStack(id, label)

Defines a framework/runtime/database stack (e.g., TALL, Next.js).

**Required:** `description`, `category`, `projectCategories`

```typescript
import { defineStack } from "@agi/sdk";

const stack = defineStack("nextjs", "Next.js")
  .description("React framework with SSR and API routes")
  .category("framework")
  .projectCategories(["web"])
  .icon("nextjs")
  .requirement({ type: "runtime", id: "node-22" })
  .container({ image: "ghcr.io/civicognita/node:22", internalPort: 3000 })
  .devCommands({ dev: "npm run dev", build: "npm run build", start: "npm start" })
  .build();

api.registerStack(stack);
```

| Method | Parameter | Description |
|--------|-----------|-------------|
| `.description(desc)` | `string` | Stack description |
| `.category(cat)` | `StackCategory` | Category: `"framework"`, `"runtime"`, `"database"`, `"cms"`, etc. |
| `.projectCategories(cats)` | `ProjectCategory[]` | Project types this stack applies to |
| `.icon(icon)` | `string` | Icon identifier |
| `.requirement(req)` | `StackRequirement` | Add a dependency requirement |
| `.guide(guide)` | `StackGuide` | Add a setup guide |
| `.container(config)` | `StackContainerConfig` | Container configuration |
| `.database(config)` | `StackDatabaseConfig` | Database configuration |
| `.scaffolding(config)` | `StackScaffoldingConfig` | Project scaffolding config |
| `.tool(tool)` | `ProjectTypeTool` | Add a project tool |
| `.installAction(action)` | `StackInstallAction` | Post-install action |
| `.devCommands(commands)` | `StackDevCommands` | Dev/build/start commands |

---

## defineRuntime(id, label)

Defines a container runtime for a language (e.g., Node.js 22, PHP 8.5).

**Required:** `language`, `version`, `containerImage`, `internalPort`

```typescript
import { defineRuntime } from "@agi/sdk";

const runtime = defineRuntime("node-22", "Node.js 22 LTS")
  .language("node")
  .version("22")
  .containerImage("ghcr.io/civicognita/node:22")
  .internalPort(3000)
  .projectTypes(["node"])
  .installable()
  .build();

api.registerRuntime(runtime);
```

| Method | Parameter | Description |
|--------|-----------|-------------|
| `.language(lang)` | `string` | Language identifier |
| `.version(ver)` | `string` | Version string |
| `.containerImage(image)` | `string` | Container image |
| `.internalPort(port)` | `number` | Port the container listens on |
| `.projectTypes(types)` | `string[]` | Compatible project types |
| `.dependency(dep)` | `RuntimeDependency` | Add a dependency |
| `.installable(val?)` | `boolean` | Whether the runtime can be installed (default `true`) |

---

## defineService(id, name)

Defines an infrastructure service (MySQL, Redis, PostgreSQL).

**Required:** `description`, `containerImage`, `defaultPort`

```typescript
import { defineService } from "@agi/sdk";

const service = defineService("mysql", "MySQL")
  .description("Relational database")
  .containerImage("ghcr.io/civicognita/mariadb:11.4")
  .defaultPort(3306)
  .env({ MARIADB_ROOT_PASSWORD: "aionima", MARIADB_DATABASE: "aionima" })
  .volume("/var/lib/mysql")
  .healthCheck("mariadb-admin ping -h localhost")
  .build();

api.registerService(service);
```

| Method | Parameter | Description |
|--------|-----------|-------------|
| `.description(desc)` | `string` | Service description |
| `.containerImage(image)` | `string` | Container image |
| `.defaultPort(port)` | `number` | Default port |
| `.env(env)` | `Record<string, string>` | Environment variables |
| `.volume(vol)` | `string` | Container volume mount path |
| `.healthCheck(cmd)` | `string` | Health check command |

---

## defineAction(id, label)

Defines an action button that can execute shell commands, API calls, or hooks.

**Required:** `scope`, `handler`

```typescript
import { defineAction } from "@agi/sdk";

const action = defineAction("restart-redis", "Restart Redis")
  .description("Stop and restart the Redis container")
  .icon("refresh")
  .scope({ type: "service", serviceId: "redis" })
  .handler({ kind: "shell", command: "podman restart redis" })
  .confirm("Are you sure you want to restart Redis?")
  .destructive()
  .build();

api.registerAction(action);
```

| Method | Parameter | Description |
|--------|-----------|-------------|
| `.description(desc)` | `string` | Action description |
| `.icon(icon)` | `string` | Icon identifier |
| `.scope(scope)` | `ActionScope` | `{ type: "global" }`, `{ type: "project" }`, or `{ type: "service", serviceId }` |
| `.handler(handler)` | `ActionHandler` | `{ kind: "shell", command }`, `{ kind: "api", endpoint }`, or `{ kind: "hook", hookName }` |
| `.confirm(message)` | `string` | Confirmation dialog message |
| `.group(group)` | `string` | Action group for UI grouping |
| `.destructive(val?)` | `boolean` | Mark as destructive (default `true`) |

---

## definePanel(id, label)

Defines a project panel with widgets.

**Required:** `projectTypes`

```typescript
import { definePanel } from "@agi/sdk";

const panel = definePanel("redis-panel", "Redis")
  .projectTypes(["node", "php"])
  .widget({ type: "status-display", statusEndpoint: "/api/redis/status", title: "Service Status" })
  .widget({ type: "action-bar", actionIds: ["restart-redis"] })
  .position(10)
  .build();

api.registerProjectPanel(panel);
```

| Method | Parameter | Description |
|--------|-----------|-------------|
| `.projectTypes(types)` | `string[]` | Project types this panel appears on |
| `.widget(widget)` | `PanelWidget` | Add a widget to the panel |
| `.position(pos)` | `number` | Sort order in the panel list |

---

## defineSettings(id, label)

Defines a settings section on the Settings page.

**Required:** `configPath`

```typescript
import { defineSettings } from "@agi/sdk";

const settings = defineSettings("redis-settings", "Redis")
  .description("Configure Redis service")
  .configPath("services.overrides.redis")
  .field({ key: "enabled", label: "Enable Redis", type: "boolean", default: true })
  .field({ key: "port", label: "Port", type: "number", default: 6379 })
  .position(5)
  .build();

api.registerSettingsSection(settings);
```

| Method | Parameter | Description |
|--------|-----------|-------------|
| `.description(desc)` | `string` | Section description |
| `.configPath(path)` | `string` | Dot-path into `gateway.json` |
| `.field(field)` | `UIField` | Add a form field |
| `.position(pos)` | `number` | Sort order |

---

## defineTool(name, description)

Defines an agent tool — a function the AI agent can invoke during conversations.

**Required:** `inputSchema`, `handler`

```typescript
import { defineTool } from "@agi/sdk";

const tool = defineTool("check_redis", "Check if Redis is running and responsive")
  .inputSchema({
    type: "object",
    properties: {
      host: { type: "string", default: "localhost" },
      port: { type: "number", default: 6379 },
    },
  })
  .handler(async (input, context) => {
    // Check Redis connectivity
    return { healthy: true, latencyMs: 2 };
  })
  .build();

api.registerAgentTool(tool);
```

| Method | Parameter | Description |
|--------|-----------|-------------|
| `.inputSchema(schema)` | `Record<string, unknown>` | JSON Schema for the tool's input |
| `.handler(handler)` | `AgentToolHandler` | Async function that executes the tool |

---

## defineSkill(name)

Defines an agent skill — knowledge injected into the system prompt when triggered.

**Required:** `domain`, `content`

```typescript
import { defineSkill } from "@agi/sdk";

const skill = defineSkill("redis-management")
  .description("How to manage Redis containers")
  .domain("infrastructure")
  .trigger("redis")
  .trigger("cache")
  .content("Redis is an in-memory data store. To restart: `podman restart redis`. ...")
  .build();

api.registerSkill(skill);
```

| Method | Parameter | Description |
|--------|-----------|-------------|
| `.description(desc)` | `string` | Skill description |
| `.domain(domain)` | `string` | Knowledge domain |
| `.trigger(trigger)` | `string` | Keyword that activates this skill (call multiple times for multiple triggers) |
| `.content(content)` | `string` | Markdown content injected into the system prompt |

---

## defineTheme(id, name)

Defines a visual color theme for the dashboard. Themes must define all 21 semantic CSS custom properties and correctly set `dark` to control both CSS `color-scheme` and Tailwind's `class="dark"` on `<html>` (required by react-fancy components).

**See [Theming Guide](./theming.md) for the full property reference, react-fancy/react-echarts integration, chart theming, and plugin seal compliance requirements.**

```typescript
import { defineTheme } from "@agi/sdk";

const theme = defineTheme("solarized-dark", "Solarized Dark")
  .description("Solarized dark color scheme")
  .dark()
  .properties({
    "--color-background":           "#002b36",
    "--color-foreground":           "#839496",
    "--color-card":                 "#073642",
    "--color-card-foreground":      "#839496",
    "--color-popover":              "#073642",
    "--color-popover-foreground":   "#839496",
    "--color-primary":              "#268bd2",
    "--color-primary-foreground":   "#002b36",
    "--color-secondary":            "#073642",
    "--color-secondary-foreground": "#839496",
    "--color-muted":                "#073642",
    "--color-muted-foreground":     "#586e75",
    "--color-accent":               "#073642",
    "--color-accent-foreground":    "#839496",
    "--color-destructive":          "#dc322f",
    "--color-destructive-foreground":"#002b36",
    "--color-border":               "#073642",
    "--color-input":                "#073642",
    "--color-ring":                 "#268bd2",
    "--color-success":              "#859900",
    "--color-warning":              "#b58900",
  })
  .build();

api.registerTheme(theme);
```

| Method | Parameter | Description |
|--------|-----------|-------------|
| `.description(desc)` | `string` | Theme description |
| `.dark(isDark?)` | `boolean` | Dark theme flag — controls `class="dark"` on `<html>` and `color-scheme`. Default `false` |
| `.property(key, value)` | `string, string` | Set a single CSS custom property |
| `.properties(props)` | `Record<string, string>` | Set all 21 semantic CSS custom properties |

---

## defineKnowledge(id, label)

Defines a documentation namespace with topics.

**Required:** `contentDir`

```typescript
import { defineKnowledge } from "@agi/sdk";

const knowledge = defineKnowledge("redis-docs", "Redis Documentation")
  .description("Redis usage and configuration guides")
  .contentDir("/opt/agi-marketplace/plugins/plugin-redis/docs")
  .topic({ id: "setup", title: "Setup Guide", file: "setup.md" })
  .topic({ id: "config", title: "Configuration", file: "config.md" })
  .build();

api.registerKnowledge(knowledge);
```

| Method | Parameter | Description |
|--------|-----------|-------------|
| `.description(desc)` | `string` | Namespace description |
| `.contentDir(dir)` | `string` | Directory containing documentation files |
| `.topic(topic)` | `KnowledgeTopic` | Add a documentation topic |

---

## defineWorkflow(id, name)

Defines a multi-step automation with shell, API, agent, and approval steps.

```typescript
import { defineWorkflow } from "@agi/sdk";

const workflow = defineWorkflow("deploy-redis", "Deploy Redis")
  .description("Install and configure Redis")
  .trigger("manual")
  .step({ type: "shell", id: "install", label: "Install Redis", command: "apt-get install -y redis-server" })
  .step({ type: "shell", id: "configure", label: "Configure", command: "redis-cli CONFIG SET maxmemory 256mb", dependsOn: ["install"] })
  .step({ type: "approval", id: "verify", label: "Verify Setup", message: "Redis is installed. Proceed?", dependsOn: ["configure"] })
  .build();

api.registerWorkflow(workflow);
```

| Method | Parameter | Description |
|--------|-----------|-------------|
| `.description(desc)` | `string` | Workflow description |
| `.trigger(trigger)` | `"manual" \| "event" \| "scheduled"` | Trigger type (default `"manual"`) |
| `.triggerEvent(event)` | `string` | Event name for `"event"` trigger |
| `.step(step)` | `WorkflowStep` | Add a workflow step |

---

## defineSidebar(id, title)

Defines a navigation section in the dashboard sidebar.

```typescript
import { defineSidebar } from "@agi/sdk";

const sidebar = defineSidebar("monitoring", "Monitoring")
  .item({ label: "Redis", path: "/monitoring/redis", icon: "database" })
  .item({ label: "System", path: "/monitoring/system", icon: "cpu" })
  .position(50)
  .build();

api.registerSidebarSection(sidebar);
```

| Method | Parameter | Description |
|--------|-----------|-------------|
| `.item(item)` | `SidebarItem` | Add a navigation item |
| `.position(pos)` | `number` | Sort order in the sidebar |

---

## defineChannel(id, name)

Defines a messaging channel adapter. Channel builders require multiple adapter implementations.

**Required:** `configAdapter`, `gatewayAdapter`, `outboundAdapter`, `messagingAdapter`

```typescript
import { defineChannel } from "@agi/sdk";

const channel = defineChannel("slack", "Slack")
  .version("1.0.0")
  .description("Slack workspace integration")
  .author("Your Name")
  .capabilities({ text: true, media: true, voice: false })
  .configAdapter({ /* ... */ })
  .gatewayAdapter({ /* ... */ })
  .outboundAdapter({ /* ... */ })
  .messagingAdapter({ /* ... */ })
  .build();

api.registerChannel(channel);
```

| Method | Parameter | Description |
|--------|-----------|-------------|
| `.version(v)` | `string` | Channel version |
| `.description(desc)` | `string` | Channel description |
| `.author(author)` | `string` | Author name |
| `.capabilities(caps)` | `Partial<ChannelCapabilities>` | Supported capabilities |
| `.configAdapter(adapter)` | `ChannelConfigAdapter` | Config reading/validation |
| `.gatewayAdapter(adapter)` | `ChannelGatewayAdapter` | Start/stop/status lifecycle |
| `.outboundAdapter(adapter)` | `ChannelOutboundAdapter` | Send messages |
| `.messagingAdapter(adapter)` | `ChannelMessagingAdapter` | Receive and parse messages |
| `.securityAdapter(adapter)` | `ChannelSecurityAdapter` | Security/verification |
| `.entityResolver(adapter)` | `EntityResolverAdapter` | Entity lookup |
| `.impactHook(adapter)` | `ImpactHookAdapter` | Impact scoring |
| `.coaEmitter(adapter)` | `COAEmitterAdapter` | Chain of Accountability events |

---

## defineProvider(id, name)

Defines an LLM provider integration.

**Required:** `defaultModel`, `factory`; also `envKey` if `requiresApiKey` is true

```typescript
import { defineProvider } from "@agi/sdk";

const provider = defineProvider("anthropic", "Anthropic")
  .description("Claude models by Anthropic")
  .defaultModel("claude-sonnet-4-6")
  .envKey("ANTHROPIC_API_KEY")
  .requiresApiKey(true)
  .model("claude-opus-4-6")
  .model("claude-sonnet-4-6")
  .model("claude-haiku-4-5")
  .factory((config) => {
    // Return provider instance
    return createAnthropicProvider(config);
  })
  .build();

api.registerProvider(provider);
```

| Method | Parameter | Description |
|--------|-----------|-------------|
| `.description(desc)` | `string` | Provider description |
| `.defaultModel(model)` | `string` | Default model identifier |
| `.envKey(key)` | `string` | Environment variable for the API key |
| `.requiresApiKey(required)` | `boolean` | Whether an API key is required |
| `.defaultBaseUrl(url)` | `string` | Default base URL for the API |
| `.model(modelId)` | `string` | Add a supported model (call multiple times) |
| `.factory(fn)` | `LLMProviderFactory` | Factory function that creates the provider |

---

## defineScan(id, name)

Defines a security scan provider that can be registered via `api.registerScanProvider()`.

**Required:** `scanType`, `handler`

```typescript
import { defineScan } from "@agi/sdk";

const phpScanner = defineScan("php-sast", "PHP SAST")
  .description("Static analysis for PHP projects")
  .scanType("sast")
  .projectCategories(["web", "app"])
  .handler(async (config, ctx) => {
    ctx.logger.info("Scanning PHP files...");
    // Walk files, find vulnerabilities, return SecurityFinding[]
    return [];
  })
  .icon("shield")
  .build();

api.registerScanProvider(phpScanner);
```

| Method | Parameter | Description |
|--------|-----------|-------------|
| `.description(desc)` | `string` | Scanner description |
| `.scanType(type)` | `ScanType` | Scan type: `"sast"`, `"dast"`, `"sca"`, `"secrets"`, `"config"`, `"container"`, `"custom"` |
| `.projectCategories(cats)` | `string[]` | Project categories this scanner applies to (empty = all) |
| `.handler(fn)` | `ScanProviderHandler` | Async function: `(config, ctx) => Promise<SecurityFinding[]>` |
| `.icon(icon)` | `string` | Icon identifier for the dashboard |

The handler receives a `ScanConfig` (with `targetPath`, `scanTypes`, `excludePaths`, etc.) and a `ScanProviderContext` (with `logger`, `workspaceRoot`, `abortSignal`). Return an array of `SecurityFinding` objects — the scan runner handles ID stamping, persistence, and severity filtering.

---

## defineWorker(id, name)

Defines a background task worker that Taskmaster can dispatch.

**Required:** `domain`, `role`, `description`, `prompt`

```typescript
import { defineWorker } from "@agi/sdk";

const hacker = defineWorker("code.hacker", "Code Hacker")
  .domain("code")
  .role("hacker")
  .description("Implementation worker for code tasks")
  .prompt(hackerPromptMarkdown)
  .modelTier("capable")
  .allowedTools(["Read", "Write", "Edit", "Bash", "Glob", "Grep"])
  .chainTarget("code.tester")
  .requiredTier("verified")
  .keywords(["implement", "build", "code", "fix"])
  .build();

api.registerWorker(hacker);
```

| Method | Parameter | Description |
|--------|-----------|-------------|
| `.domain(d)` | `WorkerDomain` | Domain: "code", "k", "ux", "strat", "comm", "ops", "gov", "data" |
| `.role(r)` | `string` | Role identifier within the domain |
| `.description(desc)` | `string` | Human-readable description |
| `.prompt(p)` | `string` | Full system prompt (markdown) |
| `.modelTier(tier)` | `"fast" \| "balanced" \| "capable"` | Model preference |
| `.allowedTools(tools)` | `string[]` | Tools this worker can use |
| `.chainTarget(target)` | `string` | Worker that must follow (enforced chain) |
| `.requiredTier(tier)` | `"verified" \| "sealed"` | Minimum entity verification tier |
| `.keywords(kw)` | `string[]` | Keywords for auto-routing dispatch |
