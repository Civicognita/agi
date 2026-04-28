# Agent Tools Reference

The Aionima agent has access to a set of built-in tools registered during gateway boot. Tools are gated by two criteria: the gateway's current **state** and the entity's **verification tier**. A tool is only presented to the LLM if both conditions are met for the active session.

**States:** `LIMBO` (unconfigured), `ONLINE` (fully operational)

**Tiers:** `unverified`, `verified`, `sealed` (owner-level)

Tools are registered in two batches:

- `registerAllTools()` — core tools (dev, git, canvas, workers, knowledge, plans, projects, browser, web)
- `registerAgentTools()` — management tools (marketplace, settings, system, hosting, stacks, builder)

The second batch is registered after services are available.

---

## Shell Exec Policy — agi bash passthrough

Every shell exec from any agent context (chat tool runtime, Taskmaster shell-exec plugin, cron-fired prompt runner, plugin SDK) must route through the `agi bash` passthrough rather than spawning a child process directly. This is the single secure entryway rule — the canonical reason it exists is documented in `~/temp_core/CLAUDE.md` § 3 and § 4.

The passthrough surface (story **#104**, v0.4.0) provides:

- Structured per-invocation logging at `~/.agi/logs/agi-bash-YYYY-MM-DD.jsonl` with caller attribution (set `AGI_CALLER` to a stable identifier — `chat-agent:<session>`, `taskmaster:<task-id>`, `cron-prompt:<cron-id>`)
- Default deny patterns protecting production paths and destructive idioms
- User-configurable extensions via `bash.policy` in `~/.agi/gateway.json`

The caller migrations themselves (replacing direct `child_process.spawn("bash", …)` with calls through `agi bash`) are tracked under story **#105** (lockdown phase 2). Until that ships, individual `shell_exec`-style tools below are honest about whether they currently route through `agi bash` or fall back to direct execution.

For full subcommand reference see `agi/docs/human/cli.md` § `agi bash`.

---

## Dev Tools

### `shell_exec`

Execute a shell command on the host machine.

| Field | Value |
|-------|-------|
| States | `ONLINE` |
| Tiers | `verified`, `sealed` |

**Key parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `command` | string (required) | Shell command to execute |
| `timeout_ms` | number | Timeout in milliseconds (default: 30000, max: 120000) |
| `cwd` | string | Working directory — must be within the workspace root |

The tool blocks a list of destructive commands (`rm -rf /`, `mkfs`, `shutdown`, `reboot`, etc.). Output is capped at 16KB. Commands that exceed the timeout return an error rather than partial output.

---

### `file_read`

Read a file from the workspace.

| Field | Value |
|-------|-------|
| States | `ONLINE`, `LIMBO` |
| Tiers | `verified`, `sealed` |

**Key parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `path` | string (required) | File path relative to workspace root |
| `offset` | number | Line number to start reading from |
| `limit` | number | Maximum number of lines to read |

---

### `file_write`

Write content to a file in the workspace.

| Field | Value |
|-------|-------|
| States | `ONLINE` |
| Tiers | `verified`, `sealed` |

**Key parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `path` | string (required) | File path relative to workspace root |
| `content` | string (required) | File content to write |

---

### `dir_list`

List files and directories.

| Field | Value |
|-------|-------|
| States | `ONLINE`, `LIMBO` |
| Tiers | `verified`, `sealed` |

**Key parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `path` | string (required) | Directory path relative to workspace root |
| `recursive` | boolean | Whether to list recursively |

---

### `grep_search`

Search file contents by regex pattern.

| Field | Value |
|-------|-------|
| States | `ONLINE`, `LIMBO` |
| Tiers | `verified`, `sealed` |

**Key parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `pattern` | string (required) | Regular expression to search for |
| `path` | string | Directory to search in (defaults to workspace root) |
| `include` | string | Glob pattern to filter files (e.g. `*.ts`) |

---

## Git Tools

All git tools use `execFile` (not `exec`) to prevent shell injection. Push, force operations, and `reset --hard` are blocked.

### `git_status`

Show the current git status of the workspace.

| Field | Value |
|-------|-------|
| States | `ONLINE`, `LIMBO` |
| Tiers | `verified`, `sealed` |

No required parameters.

---

### `git_diff`

Show unstaged or staged changes.

| Field | Value |
|-------|-------|
| States | `ONLINE`, `LIMBO` |
| Tiers | `verified`, `sealed` |

**Key parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `staged` | boolean | If true, shows staged diff (`--cached`) |
| `path` | string | Limit diff to a specific file or directory |

---

### `git_add`

Stage files for the next commit. Requires explicit file paths — glob patterns and `-A` are not accepted.

| Field | Value |
|-------|-------|
| States | `ONLINE`, `LIMBO` |
| Tiers | `verified`, `sealed` |

**Key parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `paths` | string[] (required) | Array of file paths relative to workspace root |

All paths are validated to be within the workspace boundary before staging.

---

### `git_commit`

Create a git commit with currently staged changes.

| Field | Value |
|-------|-------|
| States | `ONLINE`, `LIMBO` |
| Tiers | `verified`, `sealed` |

**Key parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `message` | string (required) | Commit message (max 4096 chars; shell-dangerous characters are stripped) |

---

### `git_branch`

Manage branches. Push and force operations are blocked.

| Field | Value |
|-------|-------|
| States | `ONLINE`, `LIMBO` |
| Tiers | `verified`, `sealed` |

**Key parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `action` | string | One of `"list"` (default), `"create"`, `"checkout"` |
| `name` | string | Branch name (required for `create` and `checkout`) |

Branch names are validated: only alphanumeric characters, underscores, hyphens, dots, and forward slashes are allowed.

---

## Knowledge Tools

### `search_prime`

Search the PRIME knowledge corpus by keyword query.

| Field | Value |
|-------|-------|
| States | `ONLINE`, `LIMBO` |
| Tiers | `verified`, `sealed` |

Only registered when a `primeLoader` is configured at boot.

**Key parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `query` | string (required) | Keywords to search for |
| `limit` | number | Maximum results to return (default: 10, max: 50) |

Returns entries with `title`, `category`, `path`, and a 500-character `excerpt`.

---

### `lookup_knowledge`

Read a specific file from the PRIME corpus by relative path.

| Field | Value |
|-------|-------|
| States | `ONLINE`, `LIMBO` |
| Tiers | `verified`, `sealed` |

Only registered when a `primeLoader` is configured at boot.

**Key parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `path` | string (required) | Relative path within the PRIME corpus (e.g. `core/truth/.persona.md`) |

Path traversal sequences (`..`, absolute paths) are rejected.

---

## Project Tools

### `manage_project`

Manage workspace projects (list, create, update, inspect, delete, host, unhost, restart, diagnose).

| Field | Value |
|-------|-------|
| States | `ONLINE` |
| Tiers | `verified`, `sealed` |

Only registered when `workspace.projects` directories are configured.

**Key parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `action` | string (required) | One of `"list"`, `"create"`, `"update"`, `"info"`, `"delete"`, `"host"`, `"unhost"`, `"restart"`, `"diagnose"` |
| `name` | string | Project name (for `create` and `update`) |
| `path` | string | Project path (for `update`, `info`, `delete`, `restart`, `diagnose`) |
| `repoRemote` | string | Git clone URL (for `create` only) |
| `category` | string | Project category: `"web"`, `"app"`, `"literature"`, `"media"`, `"administration"`, `"ops"`, `"monorepo"` |
| `tynnToken` | string | Tynn project token (for `create` and `update`; empty string or `null` to clear) |
| `confirm` | boolean | Must be `true` to confirm a `delete` operation |

Sacred projects (`agi`, `prime`, `id`, `marketplace`, `mapp-marketplace`) cannot be modified or deleted.

#### `diagnose` action

Use `diagnose` when a hosted project container is failing to start or crashing. The tool reads the last 50 lines of container logs and checks `dmesg` for OOM events, then classifies the failure into one of:

| Class | Trigger | Remediation |
|-------|---------|-------------|
| `disk_full` | `ENOSPC`, `no space left on device` | Free disk space; prune unused images |
| `port_conflict` | `EADDRINUSE` | Stop conflicting process or change port |
| `missing_build_artifact` | `MODULE_NOT_FOUND`, missing `dist/` | Run the project build and restart |
| `oom_killed` | OOM kill in logs or dmesg | Increase memory limit or reduce usage |
| `connection_refused` | `ECONNREFUSED` | Verify dependent services are running |
| `permission_denied` | `EACCES`, `EPERM` | Fix file/socket permissions |
| `container_exited` | Generic exit, no pattern match | Review raw log tail |
| `healthy` | No error signals | Check DNS and Caddy routing |

**Output shape:**

```json
{
  "class": "missing_build_artifact",
  "message": "Build artifact missing",
  "remediation": "Run pnpm build and restart the container.",
  "rawLogTail": "...last 50 log lines..."
}
```

---

## Plan Tools

### `create_plan`

Create a structured multi-step plan for a task.

| Field | Value |
|-------|-------|
| States | `ONLINE` |
| Tiers | `verified`, `sealed` |

Only registered when a project path is configured.

**Key parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `title` | string (required) | Plan title |
| `body` | string (required) | Plan description |
| `steps` | array (required) | Array of step objects with `title` and `type` |

Step types: `"plan"`, `"implement"`, `"test"`, `"review"`, `"deploy"`.

Plans are stored at `~/.agi/{projectSlug}/plans/` and are presented to the user for review before execution.

---

### `update_plan`

Update the status of a plan or its individual steps.

| Field | Value |
|-------|-------|
| States | `ONLINE` |
| Tiers | `verified`, `sealed` |

Only registered when a project path is configured.

**Key parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `planId` | string (required) | Plan identifier |
| `status` | string | New plan status: `"draft"`, `"reviewing"`, `"approved"`, `"executing"`, `"testing"`, `"complete"`, `"failed"` |
| `stepUpdates` | array | Array of step status updates with `stepId` and `status` |

Step statuses: `"pending"`, `"running"`, `"complete"`, `"failed"`, `"skipped"`.

---

## Worker Tools

### `taskmaster_dispatch`

Queue a background task with TaskMaster. The worker runs with Aion's full tool registry, scoped to the same project.

| Field | Value |
|-------|-------|
| States | *(audit-only — see compute-available-tools.ts)* |
| Tiers | `verified`, `sealed` |

**Key parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `projectPath` | string (required) | Absolute path of the project the task belongs to. Read from Project Context. |
| `description` | string (required) | Human-readable task description |
| `domain` | string | Worker domain: `"code"`, `"k"`, `"ux"`, `"strat"`, `"comm"`, `"ops"`, `"gov"`, `"data"` (defaults to `"code"`) |
| `worker` | string | Worker role within the domain (defaults to `"engineer"`) |
| `priority` | string | One of `"low"`, `"normal"`, `"high"`, `"critical"` (defaults to `"normal"`) |

Writes a job file to `~/.agi/{projectSlug}/dispatch/jobs/{jobId}.json` and notifies `WorkerRuntime` via callback. Returns the `jobId`.

---

### `taskmaster_status`

Check the status of the current project's background jobs.

| Field | Value |
|-------|-------|
| States | *(audit-only)* |
| Tiers | `unverified`, `verified`, `sealed` |

**Key parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `projectPath` | string (required) | Absolute path of the project whose jobs to list. |
| `jobId` | string | If provided, returns details for that job. If omitted, lists all jobs for the project. |

Reads from `.dispatch/jobs/`. This is a read-only tool — it does not modify job state.

---

## Canvas Tool

### `canvas_emit`

Produce structured visual output (Canvas document).

| Field | Value |
|-------|-------|
| States | `ONLINE` |
| Tiers | `unverified`, `verified`, `sealed` |

Use `canvas_emit` instead of plain text when the response benefits from interactive visual components. Canvas sections render as components in WebChat and iOS; Telegram receives a text fallback.

**Key parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `title` | string (required) | Document title |
| `sections` | array (required) | Ordered list of typed sections |
| `metadata` | object | Optional metadata for tracking |

**Section types:** `"text"`, `"chart"`, `"coa-chain"`, `"entity-card"`, `"seal"`, `"metric"`, `"table"`, `"form"`

---

## GitHub Tool

### `gh_cli`

Read-only GitHub CLI operations.

| Field | Value |
|-------|-------|
| States | `ONLINE` |
| Tiers | `verified`, `sealed` |

Write operations (`--create`, `--merge`, `--close`, `--reopen`, `--edit`) are blocked at the flag level.

**Key parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `command` | string (required) | One of `"pr_view"`, `"pr_list"`, `"pr_diff"` |
| `prNumber` | number | Pull request number (for `pr_view` and `pr_diff`) |
| `flags` | string[] | Additional flags (write-intent flags are blocked) |

---

## User Context Tool

### `update_user_context`

Save relationship notes for the current entity.

| Field | Value |
|-------|-------|
| States | `ONLINE`, `LIMBO` |
| Tiers | `verified`, `sealed` |

Only registered when a `UserContextStore` is configured.

**Key parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `content` | string (required) | Markdown content to store as per-entity context |

Content is written to a per-entity `USER.md` file and injected into the system prompt on the next invocation. This is how the agent builds persistent relationship memory with entities.

---

## Browser Tools

### `browser_session`

Persistent Playwright browser session for multi-step web interaction. The session stays open across tool calls, enabling workflows like navigate, fill a form, click submit, screenshot the result.

| Field | Value |
|-------|-------|
| States | `ONLINE` |
| Tiers | `verified`, `sealed` |

Only registered when `imageBlobStore` is configured (needed for screenshot storage). Playwright runs on the host machine, not inside project containers. Sessions auto-close after 5 minutes of inactivity.

**Key parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `action` | string (required) | One of: `"open"`, `"navigate"`, `"click"`, `"type"`, `"fill"`, `"select"`, `"screenshot"`, `"read_text"`, `"read_html"`, `"evaluate"`, `"wait"`, `"close"` |
| `url` | string | URL for `open`/`navigate` (http:// or https://) |
| `selector` | string | CSS selector for `click`, `fill`, `select`, `read_text`, `read_html`, `wait` |
| `text` | string | Text to type (for `type` action) |
| `value` | string | Value for `fill` or `select` actions |
| `script` | string | JavaScript to evaluate in page context (for `evaluate`) |
| `viewport` | object | Viewport dimensions `{ width, height }` (default: 1280x720, `open` only) |
| `timeout` | number | Action timeout in ms (default: 10000) |
| `fullPage` | boolean | Capture full-page screenshot (default: false) |
| `includeScreenshot` | boolean | Auto-capture screenshot with the action result (default: true) |

**Action details:**

| Action | Description |
|--------|-------------|
| `open` | Launch browser and navigate to URL. Creates a new session (closes any existing one). |
| `navigate` | Navigate to a new URL in the current session. |
| `click` | Click an element by CSS selector. |
| `type` | Type text into the currently focused element. |
| `fill` | Fill an input identified by CSS selector with a value. |
| `select` | Select an option from a `<select>` dropdown by value. |
| `screenshot` | Capture current page state as PNG. |
| `read_text` | Read visible text content (all page text, or from a specific selector). |
| `read_html` | Read innerHTML of an element by selector. |
| `evaluate` | Run JavaScript in the page context and return the result. |
| `wait` | Wait for a selector to appear (or a timeout if no selector given). |
| `close` | Close the browser session and release resources. |

---

### `get_web_page`

Fetch and sanitize web page content. Strips HTML, scripts, and styles. Scans for prompt injection and malicious payloads before returning content.

| Field | Value |
|-------|-------|
| States | `ONLINE` |
| Tiers | `verified`, `sealed` |

**Key parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `url` | string (required) | URL to fetch (http:// or https:// only) |

Only `http://` and `https://` schemes are allowed; `file:`, `javascript:`, `data:`, `ftp:`, `blob:` are blocked. Raw fetch limit is 512KB, output is capped at 32KB. Content is scanned for prompt injection patterns before being returned.

Returns `{ url, title, metaDescription, content, truncated, wasInjectionBlocked }`.

---

## Hosting Tools

### `manage_hosting`

Manage project hosting infrastructure (Caddy, Podman, Cloudflare tunnels).

| Field | Value |
|-------|-------|
| States | `ONLINE` |
| Tiers | `verified`, `sealed` |

Only registered when a `HostingManager` is available.

**Key parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `action` | string (required) | One of: `"status"`, `"enable"`, `"disable"`, `"restart"`, `"info"`, `"tunnel_enable"` |
| `path` | string | Absolute project path (for `enable`/`disable`/`restart`/`info`/`tunnel_enable`) |
| `type` | string | Project type e.g. `"node"`, `"php"`, `"static"` (for `enable`) |
| `hostname` | string | Custom hostname (for `enable`) |
| `docRoot` | string | Document root relative to project (for `enable`, PHP/static) |
| `startCommand` | string | Custom start command (for `enable`) |
| `mode` | string | Hosting mode: `"container"` or `"process"` (for `enable`) |
| `internalPort` | number | Internal port the app listens on (for `enable`) |
| `runtimeId` | string | Runtime ID to use (for `enable`) |

---

### `manage_stacks`

Manage technology stacks (frameworks, databases, caches, tools).

| Field | Value |
|-------|-------|
| States | `ONLINE` |
| Tiers | `verified`, `sealed` |

Only registered when a `PluginRegistry` with stack providers is available.

**Key parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `action` | string (required) | One of: `"list"`, `"get"`, `"add"`, `"remove"`, `"project_stacks"` |
| `stackId` | string | Stack ID (for `get`/`add`/`remove`) |
| `path` | string | Project path (for `add`/`remove`/`project_stacks`) |
| `category` | string | Filter by project category (for `list`) |
| `stackCategory` | string | Filter by stack category: `"framework"`, `"database"`, `"cache"`, `"tool"` (for `list`) |

---

## Agent Management Tools

### `manage_marketplace`

Search, install, and uninstall plugins from the marketplace.

| Field | Value |
|-------|-------|
| States | `ONLINE` |
| Tiers | `sealed` |

Only registered when a `MarketplaceManager` is available.

**Actions:** `"search"`, `"install"`, `"uninstall"`, `"list_sources"`

---

### `manage_settings`

Read and patch gateway configuration, and manage plugin enabled/disabled state.

| Field | Value |
|-------|-------|
| States | `ONLINE` |
| Tiers | `sealed` |

Only registered when a `SystemConfigService` is available. This tool consolidates the former `manage_config` and `manage_plugins` tools.

**Actions:** `"config_read"`, `"config_patch"`, `"plugins_list"`, `"plugin_enable"`, `"plugin_disable"`

---

### `manage_system`

Gateway status and upgrade control.

| Field | Value |
|-------|-------|
| States | `ONLINE`, `LIMBO` |
| Tiers | `sealed` |

**Actions:** `"status"`, `"upgrade"`

---

## Builder Tools (MagicApp)

Builder tools are only registered when a `PluginRegistry` is present. They are used by the BuilderChat agent to create and manage MApps (MagicApps).

| Tool | Description |
|------|-------------|
| `validate_magic_app` | Validate a MApp JSON definition against the `mapp/1.0` schema |
| `list_magic_apps` | List all registered MApps |
| `get_magic_app` | Get details of a specific MApp by ID |
| `create_magic_app` | Validate, security-scan, persist, and register a new MApp immediately |

All builder tools require `ONLINE` state and `verified` or `sealed` tier.

The `create_magic_app` tool runs a security scan via `mapp-security-scanner.ts` before persisting. MApps that fail the scan are rejected with a score, findings, and recommendation.

---

## Tool Result Handling

### Sanitization

All user-supplied input passes through `sanitizer.ts` before reaching the system prompt or LLM API. The sanitizer:

1. Coerces input to a string
2. Strips null bytes
3. Normalizes whitespace (collapses runs, trims)
4. Redacts PII patterns (SSNs, phone numbers, email addresses)
5. Truncates content exceeding 32KB

### Injection Scanning

Tool results (output returned from tool calls) are scanned for prompt injection before being appended to the conversation. The scanner looks for:

- Lines starting with known injection prefixes (`you are`, `system:`, `[INST]`, `<|im_start|>system`, `### Instruction`, `Human:`, `Assistant:`)
- JSON objects containing `"system"`, `"role"`, or `"instruction"` keys at the top level
- XML tags `<system>`, `<role>`, `<instruction>`

Matched patterns are removed and logged. The `InjectionScanResult` records `wasModified` and `removedPatterns` for auditability.
