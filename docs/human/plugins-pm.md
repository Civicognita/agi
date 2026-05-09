# PM Providers

PM providers back Aionima's tynn workflow with arbitrary storage. The
workflow is canonical (versions → stories → tasks, transitioning through
backlog → doing → qa → done); storage is pluggable.

This doc covers PM providers from the **owner's** perspective. For the
plugin-author's view (the SDK builder, registration call, factory shape),
see **[Adding a Plugin](../agents/adding-a-plugin.md)** and
**[`tynn-and-related-concepts.md`](../agents/tynn-and-related-concepts.md)**.

---

## Available PM providers

| Provider     | Source                  | Status   | Storage             | Config                 |
|--------------|-------------------------|----------|---------------------|------------------------|
| `tynn-lite`  | Built-in (always-on)    | Default  | File-based          | None — works out-of-box |
| `tynn-pm`    | Plugin Marketplace      | Optional | tynn.ai via MCP     | Install + API key      |
| `linear`     | *(future plugin)*       | Planned  | Linear via MCP      | API key + team id      |
| `jira`       | *(future plugin)*       | Planned  | Jira via API        | Workspace + token      |

The dashboard's per-project **PM provider** dropdown lists the registered
providers. Switching providers is a per-project setting (`agent.pm.provider`)
that takes effect on the next chat turn — no restart needed.

---

## tynn-lite (default)

Tynn-lite ships baked into Aionima. Every project gets it automatically;
no install step. It stores PM state in the project's `.agi/tynn/` folder
as JSON, which means:

- **Always available**, including off-grid
- **Survives upgrades** (data is in your project, not in `~/.agi`)
- **Per-project isolation** — each project's PM state is independent
- **Limitation:** no cross-project search, no Kanban view, no real-time
  sync between two clients editing the same project

For a single-developer workflow on the off-grid floor, tynn-lite is
usually enough. Owners who want the full PM experience (MCP-backed
operations + future Kanban MApp) install the **Tynn** plugin.

---

## Tynn (`tynn-pm` plugin)

The Tynn plugin gives you the canonical Aionima PM workflow against
the hosted **tynn.ai** service via MCP. Compared to tynn-lite, it adds:

- **Cross-project search** — `pm.list-all-tasks` across every workspace project
- **Real-time sync** — tynn.ai is the source of truth; multiple clients see live updates
- **Active-focus progress** — chat surfaces the project's race-to-DONE bar
- **Future Kanban MApp** *(deferred)* — visual per-project task management

### Installation

1. Open the dashboard's **Plugin Marketplace** tab.
2. Search for **Tynn** (or `agi-tynn-pm`).
3. Click **Install**. The plugin auto-activates after install — no restart.

### Per-project configuration

After install, configure the provider per project:

1. Open your project's detail page.
2. **MCP** tab → click **Configure server** → pick **Tynn** from the dropdown.
3. The form pre-fills with the default Tynn URL (`https://tynn.ai/mcp/tynn`)
   and the env-var name `TYNN_API_KEY`.
4. Add your Tynn API key to the project's `.env` file under that var name.
5. **Settings → Provider** for the project → set PM provider to **Tynn**.

The dashboard validates the connection by hitting tynn.ai's MCP
introspection endpoint; you'll see a green check or a specific error
within ~2 seconds.

### What gets stored where

| What                    | Where                                       |
|-------------------------|---------------------------------------------|
| Project PM data         | tynn.ai (the hosted service)                |
| API key                 | `<project>/.env` (encrypted at rest by AGI) |
| Provider selection      | `<project>/.agi/project.json` `agent.pm.*`  |
| Server URL + auth shape | Plugin manifest (immutable per install)     |

API keys never leave the project's `.env` — the plugin reads them at
call time via the gateway's secret-resolution path.

---

## Switching providers mid-project

You can switch a project's PM provider at any time. The active provider
serves new chat turns immediately; existing tasks created under one
provider stay in that provider's storage (we don't migrate data).

If you switch from `tynn-lite` → `tynn-pm`, you have two options:

1. **Start fresh** — let the new provider see no tasks. Useful when
   you're moving from a personal scratchpad to a real project tracker.
2. **Manually replicate** — export from tynn-lite (see below), import
   to Tynn via the agent's `pm` tool. Only practical for small task counts.

Reverse direction (`tynn-pm` → `tynn-lite`) drops you back to the
file-based store; tynn.ai data remains intact and rejoinable later.

### Exporting tynn-lite data

```bash
agi projects --pm-export <project-name>
```

Writes the project's `.agi/tynn/` folder content to a portable JSON file.
Re-importable via `agi projects --pm-import`.

---

## ADF classification

The Tynn plugin extends two ADF surfaces:

- **0UX** — the future Kanban MApp (deferred per s127 t490) extends the
  dashboard's project surface with a visual board view.
- **0AGENT** — the registered PmProvider extends Aion's tool palette with
  the canonical PM operations (`list-tasks`, `set-status`, `add-comment`,
  `getActiveFocusProgress`, etc).

Plugin authors declare ADF surfaces via the `adf` field on the plugin
manifest. See **[Adding a Plugin → ADF classification](../agents/adding-a-plugin.md)**.

---

## Troubleshooting

### "Provider unreachable" on the project tile

The dashboard couldn't reach the configured PM server. Check:

1. **API key** — does the project's `.env` have a `TYNN_API_KEY` (or whatever
   `authTokenKey` the template uses)? Stale or rotated keys are the most
   common cause.
2. **Off-grid mode** — if you've enabled off-grid mode (`/settings/providers`
   off-grid toggle), cloud-backed PM providers are filtered. Either disable
   off-grid mode or switch the project to `tynn-lite`.
3. **Network** — `curl -sk https://tynn.ai/mcp/tynn/health` from the host
   should return 200. If it doesn't, the server is the problem, not the plugin.

### "PmProvider id 'tynn' is reserved" when installing

You hit the SDK reservation list. The plugin should claim a different id
(currently `tynn-pm`) until the residual cleanup task ships (see internal
tracking — file with the maintainers if blocked).

### Plugin loads but tools throw "not yet implemented"

The current `tynn-pm` factory is a placeholder during the transition
window — it registers correctly but the methods throw with an "awaiting
real factory" message. Track the maintainers' "tynn migration" cleanup
work for the real factory wiring.

---

## See also

- **[Plugins](./plugins.md)** — general plugin architecture, marketplace, install flow
- **[Project Hosting](./project-hosting.md)** — how per-project provider config flows through
- **[`tynn-and-related-concepts.md`](../agents/tynn-and-related-concepts.md)** — the canonical workflow + parallel concepts
- **[`adding-a-plugin.md`](../agents/adding-a-plugin.md)** — author a new PM provider plugin
