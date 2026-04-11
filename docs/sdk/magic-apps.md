# MagicApps (MApps)

MApps (MagicApps) are declarative, JSON-defined applications that run inside the Aionima platform. They are **not plugins**. Plugins extend AGI's runtime capabilities; MApps are purpose-specific applications — everything from a simple unit converter to a full financial management suite.

Key properties:

- **Declarative** — a single `.json` file, no executable code
- **Scannable** — the security scanner validates every MApp before installation
- **Portable** — copy the file to install; no build step required
- **Attributable** — `author` field is required; MApps are COA-tracked as `$P` resources
- **Eventually on-chain** — the schema is deterministic and compilable for blockchain anchoring

Install path: `~/.agi/mapps/{author}/{slug}.json`

---

## Categories

| Value | Purpose |
|-------|---------|
| `viewer` | Content consumption and display (e-readers, galleries, dashboards) |
| `production` | Asset creation and editing (IDE, mind-mapping, writing suites) |
| `tool` | Stateless input → output utilities (calculators, analyzers, generators) |
| `game` | Interactive games and simulations |
| `custom` | Anything that doesn't fit the above |

---

## Schema Reference

Every MApp file must begin with:

```json
{
  "$schema": "mapp/1.0"
}
```

### Identity Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `$schema` | `"mapp/1.0"` | yes | Schema version. Must be exactly `"mapp/1.0"`. |
| `id` | `string` | yes | Unique slug (e.g. `"reader"`, `"wealth-suite"`). Used as the filename. |
| `name` | `string` | yes | Display name shown in the UI. |
| `author` | `string` | yes | Creator identifier (e.g. `"civicognita"`, `"wishborn"`). |
| `version` | `string` | yes | Semver version string (e.g. `"1.0.0"`). |
| `description` | `string` | yes | One-sentence description of what the MApp does. |
| `icon` | `string` | no | Icon identifier or emoji. |
| `license` | `string` | no | License identifier (e.g. `"MIT"`, `"proprietary"`). |
| `category` | `MAppCategory` | yes | One of the five category values above. |
| `projectTypes` | `string[]` | no | Project types this MApp is compatible with. Empty means all types. |
| `projectCategories` | `string[]` | no | Project categories this MApp is compatible with. |
| `dockable` | `boolean` | no | Whether the MApp can dock to the left panel. Defaults to `true`. |

### Permissions

MApps declare permissions upfront. The user sees and approves them before activation. The security scanner flags dangerous combinations.

```json
"permissions": [
  {
    "id": "container.run",
    "reason": "Serves content via nginx",
    "required": true
  },
  {
    "id": "fs.read",
    "reason": "Reads project files for display",
    "required": true
  }
]
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Permission identifier (see table below). |
| `reason` | `string` | Human-readable justification shown to the user. |
| `required` | `boolean` | If `false`, the MApp operates in degraded mode without this permission. |

Known permission identifiers:

| Permission | Grants |
|-----------|--------|
| `container.run` | Run a container (nginx, custom image) |
| `network.outbound` | Make outbound HTTP requests |
| `fs.read` | Read files from the project directory |
| `fs.write` | Write files to the project directory |
| `agent.prompt` | Inject system prompt context into agent sessions |
| `agent.tools` | Register agent-callable tools |
| `workflow.shell` | Execute shell commands in workflows |
| `workflow.api` | Call external APIs in workflows |

### Container Config

For MApps that serve content via a container. Omit entirely for UI-only MApps.

```json
"container": {
  "image": "nginx:alpine",
  "internalPort": 80,
  "volumeMounts": ["{projectPath}:/usr/share/nginx/html/content:ro,Z"],
  "env": { "NGINX_HOST": "{projectHostname}" },
  "healthCheck": "curl -f http://localhost/ || exit 1"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `image` | `string` | yes | Container image. Must be from a trusted registry. |
| `internalPort` | `number` | yes | Port the container listens on internally. |
| `volumeMounts` | `string[]` | yes | Volume mount templates. Use `{projectPath}` for the project directory. |
| `env` | `Record<string, string>` | no | Environment variable templates. |
| `command` | `string[]` | no | Command override. |
| `healthCheck` | `string` | no | Health check command inside the container. |

### Panel

Every MApp has exactly one panel — the UI rendered when the MApp is opened in a modal.

```json
"panel": {
  "label": "Reader",
  "position": 0,
  "widgets": [
    { "type": "iframe", "src": "https://{projectHostname}.ai.on", "height": "600px" }
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `label` | `string` | yes | Tab label shown in the modal header. |
| `widgets` | `MAppWidget[]` | yes | Declarative widget definitions (see Widget Types below). |
| `position` | `number` | no | Sort priority. Lower values appear first. |

### Theme

Visual overrides applied to the MApp's serving SPA.

```json
"theme": {
  "primaryColor": "#1a1a2e",
  "accentColor": "#e94560",
  "fontFamily": "Georgia, serif",
  "cssProperties": { "--content-width": "720px" }
}
```

### Agent Prompts

Injected into the AI's system prompt when the MApp is active on a project. Requires the `agent.prompt` permission.

```json
"prompts": [
  {
    "id": "reader-context",
    "label": "Reader Context",
    "description": "Gives the agent awareness of the currently open book",
    "systemPrompt": "The user is reading a book in the Reader MApp. When they ask questions, assume they relate to the current text.",
    "allowedTools": ["search_text", "get_chapter"]
  }
]
```

### Workflows

Multi-step automations triggered manually, on file change, or on schedule. Requires `workflow.shell` or `workflow.api` permission depending on step types.

```json
"workflows": [
  {
    "id": "generate-epub",
    "name": "Generate EPUB",
    "description": "Converts the project's markdown files into an EPUB",
    "trigger": "manual",
    "steps": [
      {
        "id": "build",
        "type": "shell",
        "label": "Build EPUB",
        "config": { "command": "pandoc -o output.epub *.md" }
      },
      {
        "id": "notify",
        "type": "agent",
        "label": "Summarize result",
        "config": { "prompt": "The EPUB was built. Notify the user and offer to open it." },
        "dependsOn": ["build"]
      }
    ]
  }
]
```

Workflow step types:

| Type | Description |
|------|-------------|
| `shell` | Execute a shell command. Config: `{ command: string }` |
| `api` | Call an external HTTP endpoint. Config: `{ endpoint: string, method: string, body?: object }` |
| `agent` | Run an agent with a prompt. Config: `{ prompt: string }` |
| `file-transform` | Transform files in the project directory. Config varies. |

Trigger values: `"manual"` | `"on-file-change"` | `"scheduled"`.

Use `dependsOn` to declare step ordering — steps without `dependsOn` run in parallel.

### Tools

Buttons surfaced in the project toolbar when the MApp is active.

```json
"tools": [
  {
    "id": "open-reader",
    "label": "Open Reader",
    "description": "Launch the e-reader view",
    "action": "ui"
  },
  {
    "id": "export-epub",
    "label": "Export EPUB",
    "description": "Run the EPUB export workflow",
    "action": "shell",
    "command": "pandoc -o output.epub *.md"
  }
]
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique tool identifier. |
| `label` | `string` | Button label. |
| `description` | `string` | Tooltip text. |
| `action` | `"shell" \| "api" \| "ui"` | What happens when the button is clicked. |
| `command` | `string` | Shell command for `action: "shell"`. |
| `endpoint` | `string` | URL for `action: "api"`. |

---

## Builder API

The `defineMagicApp()` builder lets you construct a `MAppDefinition` in TypeScript and call `.build()` to get the validated JSON object. This is useful when generating MApp definitions programmatically (e.g. from the `create_magic_app` agent tool).

Import from `@aionima/sdk`:

```typescript
import { defineMagicApp } from "@aionima/sdk";
```

### `defineMagicApp(id, name, author)`

Creates a new builder. All three arguments are required.

```typescript
const mapp = defineMagicApp("reader", "Reader", "civicognita")
```

### Chainable Methods

| Method | Arguments | Description |
|--------|-----------|-------------|
| `.description(desc)` | `string` | Short description (required before `.build()`). |
| `.version(v)` | `string` | Semver version (required before `.build()`). |
| `.icon(icon)` | `string` | Icon identifier or emoji. |
| `.license(lic)` | `string` | License identifier. |
| `.category(cat)` | `MAppCategory` | Application category (required before `.build()`). |
| `.projectTypes(types)` | `string[]` | Compatible project types. |
| `.projectCategories(cats)` | `string[]` | Compatible project categories. |
| `.permission(id, reason, required?)` | `string, string, boolean` | Declare a permission. `required` defaults to `true`. Chainable for multiple permissions. |
| `.container(config)` | `MAppContainerConfig` | Container configuration. |
| `.panel(label, widgets, position?)` | `string, MAppWidget[], number` | Panel definition (required before `.build()`). |
| `.prompt(p)` | `MAppAgentPrompt` | Add an agent prompt. Chainable. |
| `.workflow(wf)` | `MAppWorkflow` | Add a workflow. Chainable. |
| `.tool(t)` | `MAppTool` | Add a toolbar tool. Chainable. |
| `.theme(t)` | `MAppTheme` | Visual theme overrides. |
| `.chain(contentHash?, address?)` | `string?, string?` | On-chain metadata (future use). |
| `.build()` | — | Validates required fields and returns `MAppDefinition`. Throws if `description`, `version`, `category`, or `panel` are missing. |

### Complete Example

```typescript
import { defineMagicApp } from "@aionima/sdk";

const readerApp = defineMagicApp("reader", "Reader", "civicognita")
  .description("E-reader for literature projects")
  .version("1.0.0")
  .icon("📖")
  .license("MIT")
  .category("viewer")
  .projectTypes(["writing", "research"])
  .permission("container.run", "Serves content via nginx", true)
  .permission("fs.read", "Reads project files for display", true)
  .permission("agent.prompt", "Provides reading context to the agent", false)
  .container({
    image: "nginx:alpine",
    internalPort: 80,
    volumeMounts: ["{projectPath}:/usr/share/nginx/html/content:ro,Z"],
    healthCheck: "curl -f http://localhost/ || exit 1",
  })
  .panel("Reader", [
    {
      type: "iframe",
      src: "https://{projectHostname}.ai.on",
      height: "600px",
    },
    {
      type: "action-bar",
      actions: [
        { label: "Export EPUB", workflowId: "generate-epub" },
      ],
    },
  ])
  .prompt({
    id: "reader-context",
    label: "Reader Context",
    systemPrompt:
      "The user is reading a book. Answer questions about the text, help with notes, and suggest related material.",
    allowedTools: ["search_text"],
  })
  .workflow({
    id: "generate-epub",
    name: "Generate EPUB",
    trigger: "manual",
    steps: [
      {
        id: "build",
        type: "shell",
        label: "Build EPUB",
        config: { command: "pandoc -o output.epub *.md" },
      },
    ],
  })
  .theme({
    primaryColor: "#1a1a2e",
    accentColor: "#e94560",
    fontFamily: "Georgia, serif",
  })
  .build();

// Serialize to JSON for the .json file
const json = JSON.stringify(readerApp, null, 2);
```

---

## Form System

Tool and suite MApps can include multi-step forms. The form system uses a three-column cell reference model borrowed from spreadsheets.

### Page Types

| Type | Description |
|------|-------------|
| `standard` | User fills predefined fields. The most common page type. |
| `magic` | AI generates fields at runtime based on prior input. Cannot be the first page — requires a preceding `processPage` result. |
| `embedded` | Display-only iframe (YouTube embed, external tool). Requires a `url` field. |
| `canvas` | Free-form widget layout (charts, diagrams, rich content). Uses the `widgets` array instead of `fields`. |

Page `visibility` values: `"always"` | `"conditional"` | `"auto"` | `"hidden"`.

### Fields (A-Column)

Fields are user inputs. Cell references are auto-assigned in order of appearance: `A1`, `A2`, `A3`, etc.

```json
"fields": [
  {
    "key": "amount",
    "cell": "A1",
    "type": "currency",
    "label": "Invoice Amount",
    "required": true,
    "min": 0
  },
  {
    "key": "category",
    "cell": "A2",
    "type": "select",
    "label": "Category",
    "options": ["Services", "Products", "Other"]
  }
]
```

Available field types:

| Category | Types |
|---------|-------|
| Text | `text`, `textarea` |
| Numbers | `number`, `int`, `currency`, `percentage`, `number_range` |
| Date/Time | `date`, `date_range`, `time`, `duration` |
| Contact | `email`, `phone`, `url` |
| Boolean | `bool` |
| Selection | `select`, `multiselect` |
| Upload | `file` |
| Display | `info` (read-only text, not an input) |

### Formulas (B-Column)

Computed values derived from field inputs and constants. Cell references are auto-assigned: `B1`, `B2`, etc.

**Expressions must use cell references, not field keys.**

```json
"formulas": [
  {
    "cell": "B1",
    "label": "Tax Amount",
    "expression": "A1 * C1",
    "format": "currency",
    "visible": true
  },
  {
    "cell": "B2",
    "label": "Total",
    "expression": "A1 + B1",
    "format": "currency",
    "visible": true
  }
]
```

Right: `A1 * C1`. Wrong: `amount * tax_rate`.

Supported operators and functions: `+`, `-`, `*`, `/`, `^`, `IF()`, `SUM()`.

Formula `format` values: `"number"` | `"currency"` | `"percent"` | `"text"`.

### Constants (C-Column)

Fixed values used in formulas. Cell references are auto-assigned: `C1`, `C2`, etc.

```json
"constants": [
  {
    "key": "tax_rate",
    "cell": "C1",
    "label": "Tax Rate",
    "value": 0.2,
    "format": "percent",
    "visibility": "always"
  }
]
```

Constant `visibility` values: `"always"` | `"hidden"` | `"conditional"`.

### Conditions

Fields and pages can show or hide based on conditions:

```json
"conditions": {
  "showIf": {
    "source": "inputs",
    "field": "category",
    "operator": "equals",
    "value": "Products"
  }
}
```

`source` values: `"inputs"` (other fields on this page), `"process_page"` (AI output from a prior processPage), `"context"` (project context).

### Output Config

Defines what happens after all form pages are collected:

```json
"output": {
  "producesFile": true,
  "fileType": "doc",
  "processingPrompt": "Using the collected invoice data, generate a professional invoice document."
}
```

`fileType` values: `"text"` | `"doc"` | `"csv"` | `"spreadsheet"`.

---

## Widget Types

Widgets are used in panel definitions and canvas pages. Each widget is a plain object with a `type` field.

| Type | Description |
|------|-------------|
| `markdown` | Render static or templated markdown content. |
| `iframe` | Embed an external URL. Supports `src`, `height`. |
| `status-display` | Show a status indicator (running, stopped, error) with a label. |
| `field-group` | Display a set of key-value fields. |
| `action-bar` | Row of action buttons that trigger workflows or shell commands. |
| `table` | Tabular data display with optional sorting. |
| `metric` | Single large-number metric card with a label and optional trend. |
| `chart` | Chart visualization (bar, line, pie). Datasource is a workflow output. |
| `log-stream` | Live-streaming log output from a container or process. |
| `timeline` | Chronological event list. |
| `kanban` | Kanban board with columns and cards. |
| `editor` | Embedded code or text editor. |
| `diagram` | Mermaid or DOT graph diagram. |

The widget schema is intentionally open (`Record<string, unknown>`) — each type has its own set of fields validated by the WidgetRenderer at render time.

---

## Security

Every MApp is security-scanned before installation via `mapp-security-scanner.ts`. The scanner:

1. Validates the JSON against the `MAppDefinitionSchema` (Zod, strict mode).
2. Checks that all declared `permissions` are in the known permission set.
3. Flags dangerous permission combinations (e.g. `fs.write` + `network.outbound` + `workflow.shell` together).
4. Verifies container images against a trusted registry allowlist.
5. Inspects `volumeMounts` for path traversal patterns.
6. Scans `systemPrompt` fields for prompt injection patterns.

The scan result is stored as `scanStatus` on the installed MApp's `MAppInfo`:

| Status | Meaning |
|--------|---------|
| `passed` | Scan completed, no issues found. |
| `review` | Scan completed with warnings — user is shown a summary before activation. |
| `failed` | Scan found critical issues — MApp cannot be activated. |
| `pending` | Scan has not yet run (newly copied file). |

---

## Further Reading

- [Agent-facing MApp docs](../agents/magic-apps.md) — How agents interact with MApps (create, query, activate)
- [Builder tools reference](tools.md) — The `create_magic_app` and related builder tools
- [SDK Overview](overview.md) — Plugin SDK, ADF, and the broader SDK surface
