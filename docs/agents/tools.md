# Agent Tools Reference

The Aionima agent has access to a set of built-in tools registered during gateway boot. Tools are gated by two criteria: the gateway's current **state** and the entity's **verification tier**. A tool is only presented to the LLM if both conditions are met for the active session.

**States:** `LIMBO` (unconfigured), `ONLINE` (fully operational)

**Tiers:** `unverified`, `verified`, `sealed` (owner-level)

Tools are registered in two batches:

- `registerAllTools()` — core tools (dev, git, canvas, workers, knowledge, plans, projects)
- `registerAgentTools()` — management tools (marketplace, settings, system, plugins, builder)

The second batch is registered after services are available.

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

Manage workspace projects (list, create, update, inspect, delete).

| Field | Value |
|-------|-------|
| States | `ONLINE` |
| Tiers | `verified`, `sealed` |

Only registered when `workspace.projects` directories are configured.

**Key parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `action` | string (required) | One of `"list"`, `"create"`, `"update"`, `"info"`, `"delete"` |
| `name` | string | Project name (for `create` and `update`) |
| `path` | string | Project path (for `update`, `info`, `delete`) |
| `repoRemote` | string | Git clone URL (for `create` only) |
| `category` | string | Project category: `"web"`, `"app"`, `"literature"`, `"media"`, `"administration"`, `"ops"`, `"monorepo"` |
| `tynnToken` | string | Tynn project token (for `create` and `update`; empty string or `null` to clear) |
| `confirm` | boolean | Must be `true` to confirm a `delete` operation |

Sacred projects (`agi`, `prime`, `bots`, `id`) cannot be modified or deleted.

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

### `worker_dispatch`

Dispatch a background task to a Taskmaster worker.

| Field | Value |
|-------|-------|
| States | `ONLINE` |
| Tiers | `verified`, `sealed` |

**Key parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `description` | string (required) | Human-readable task description |
| `domain` | string | Worker domain: `"code"`, `"k"`, `"ux"`, `"strat"`, `"comm"`, `"ops"`, `"gov"`, `"data"` (defaults to `"code"`) |
| `worker` | string | Worker role within the domain (defaults to `"engineer"`) |
| `priority` | string | One of `"low"`, `"normal"`, `"high"`, `"critical"` (defaults to `"normal"`) |

Writes a job file to `.dispatch/jobs/{jobId}.json` and notifies `WorkerRuntime` via callback. Returns the `jobId`.

---

### `worker_status`

Check the status of background jobs.

| Field | Value |
|-------|-------|
| States | `ONLINE` |
| Tiers | `unverified`, `verified`, `sealed` |

**Key parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `jobId` | string | If provided, returns details for that job. If omitted, lists all jobs. |

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
