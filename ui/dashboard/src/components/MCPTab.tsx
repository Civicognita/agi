/**
 * MCPTab — per-project MCP server config (Wish #7 / s125 t474).
 *
 * Owner adds/configures MCP servers for THIS project. Servers come from a
 * dropdown of available templates (built-in tynn + plugin-registered later).
 * Auth tokens reference values in the project's .env file via $VAR notation
 * — keys are stored in .env (write-only via UI), never in project.json.
 *
 * Tab is gated on `project.projectType?.hasCode` (only code-bearing projects
 * benefit from MCP integration).
 */

import { useEffect, useState } from "react";
import type { ProjectInfo } from "../types";
import { Button } from "./ui/button";
import { Card, CardHeader, CardContent } from "./ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./ui/tabs";
import { ContentRenderer } from "@particle-academy/react-fancy";

interface McpServerEntry {
  id: string;
  name: string;
  transport: "stdio" | "http" | "websocket";
  command?: string[];
  url?: string;
  envKeys: string[];
  autoConnect: boolean;
  hasAuthToken: boolean;
  state: string;
}

interface McpToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}
interface McpPromptDescriptor {
  name: string;
  description?: string;
  arguments?: Array<{ name: string; required?: boolean; description?: string }>;
}
interface McpResourceDescriptor {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
}
type CardTab = "tools" | "prompts" | "resources";

// MCP wire shapes for rendered content. Tool calls return content blocks per
// the MCP spec (text / image / resource embed); resource reads return a
// `contents` array per resource. We render markdown via ContentRenderer,
// images inline, and fall back to a code block for everything else.
interface McpContentBlock {
  type: string;
  text?: string;
  data?: string; // base64 image data
  mimeType?: string;
  resource?: { uri: string; text?: string; blob?: string; mimeType?: string };
  [k: string]: unknown;
}
interface McpToolResult {
  isError?: boolean;
  content?: McpContentBlock[];
}
interface McpResourceReadResult {
  contents?: Array<{ uri: string; text?: string; blob?: string; mimeType?: string }>;
}
type CallResult =
  | { kind: "ok-tool"; data: McpToolResult }
  | { kind: "ok-resource"; data: McpResourceReadResult }
  | { kind: "error"; message: string }
  | null;

interface McpTemplate {
  id: string;
  name: string;
  description: string;
  transport: "stdio" | "http" | "websocket";
  defaultCommand?: string[];
  defaultEnv?: Record<string, string>;
  defaultUrl?: string;
  authTokenKey?: string;
  pluginId?: string;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${String(res.status)}`);
  }
  return res.json() as Promise<T>;
}

export function MCPTab({ project }: { project: ProjectInfo }): JSX.Element {
  const [servers, setServers] = useState<McpServerEntry[]>([]);
  const [envKeys, setEnvKeys] = useState<string[]>([]);
  const [templates, setTemplates] = useState<McpTemplate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Add-server form state
  const [showAdd, setShowAdd] = useState(false);
  const [tplId, setTplId] = useState<string>("");
  const [keyValue, setKeyValue] = useState("");
  const [saving, setSaving] = useState(false);

  // Test-connection state
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; message: string }>>({});

  const refresh = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const [list, envList, tplList] = await Promise.all([
        fetchJson<{ servers: McpServerEntry[] }>(`/api/projects/mcp/list?path=${encodeURIComponent(project.path)}`),
        fetchJson<{ keys: string[] }>(`/api/projects/mcp/env?path=${encodeURIComponent(project.path)}`),
        fetchJson<{ templates: McpTemplate[] }>(`/api/projects/mcp/available`),
      ]);
      setServers(list.servers);
      setEnvKeys(envList.keys);
      setTemplates(tplList.templates);
      if (tplList.templates.length > 0 && tplId === "") setTplId(tplList.templates[0]!.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => { void refresh(); }, 30_000);
    return (): void => { window.clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.path]);

  const addServer = async (): Promise<void> => {
    const tpl = templates.find((t) => t.id === tplId);
    if (!tpl) return;
    setSaving(true);
    setError(null);
    try {
      // 1) Save the key to .env (if template has authTokenKey + user provided value).
      if (tpl.authTokenKey && keyValue.length > 0) {
        await fetchJson(`/api/projects/mcp/env`, {
          method: "POST",
          body: JSON.stringify({ path: project.path, key: tpl.authTokenKey, value: keyValue }),
        });
      }
      // 2) Save server config to project.json.
      await fetchJson(`/api/projects/mcp/server`, {
        method: "PUT",
        body: JSON.stringify({
          path: project.path,
          server: {
            id: tpl.id,
            name: tpl.name,
            transport: tpl.transport,
            command: tpl.defaultCommand,
            env: tpl.defaultEnv,
            url: tpl.defaultUrl,
            autoConnect: true,
            authToken: tpl.authTokenKey ? `$${tpl.authTokenKey}` : undefined,
          },
        }),
      });
      setShowAdd(false);
      setKeyValue("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const removeServer = async (id: string): Promise<void> => {
    if (!confirm(`Remove MCP server "${id}"? Its env keys stay in .env (use the env list below to clear them).`)) return;
    try {
      await fetch(`/api/projects/mcp/server?path=${encodeURIComponent(project.path)}&id=${encodeURIComponent(id)}`, { method: "DELETE" });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const testServer = async (id: string): Promise<void> => {
    setTesting(id);
    try {
      const res = await fetch(`/api/projects/mcp/server/test?path=${encodeURIComponent(project.path)}&id=${encodeURIComponent(id)}`, { method: "POST" });
      const body = await res.json() as { ok: boolean; toolCount?: number; tools?: string[]; error?: string };
      setTestResult((prev) => ({
        ...prev,
        [id]: body.ok
          ? { ok: true, message: `Connected — ${String(body.toolCount ?? 0)} tools (${(body.tools ?? []).slice(0, 3).join(", ")}${body.tools && body.tools.length > 3 ? "…" : ""})` }
          : { ok: false, message: body.error ?? "Test failed" },
      }));
    } catch (err) {
      setTestResult((prev) => ({ ...prev, [id]: { ok: false, message: err instanceof Error ? err.message : String(err) } }));
    } finally {
      setTesting(null);
    }
  };

  const reconnectServer = async (id: string): Promise<void> => {
    setTesting(id);
    try {
      const res = await fetch(`/api/projects/mcp/server/reconnect?path=${encodeURIComponent(project.path)}&id=${encodeURIComponent(id)}`, { method: "POST" });
      const body = await res.json() as { ok: boolean; error?: string };
      if (!body.ok && body.error) {
        setTestResult((prev) => ({ ...prev, [id]: { ok: false, message: body.error! } }));
      }
      await refresh();
    } catch (err) {
      setTestResult((prev) => ({ ...prev, [id]: { ok: false, message: err instanceof Error ? err.message : String(err) } }));
    } finally {
      setTesting(null);
    }
  };

  const removeEnvKey = async (key: string): Promise<void> => {
    if (!confirm(`Remove env key "${key}" from this project's .env?`)) return;
    try {
      await fetch(`/api/projects/mcp/env?path=${encodeURIComponent(project.path)}&key=${encodeURIComponent(key)}`, { method: "DELETE" });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="rounded-xl bg-card border border-border p-4 space-y-6" data-testid="mcp-tab">
      <div>
        <h3 className="text-[13px] font-semibold mb-2">MCP Servers</h3>
        <p className="text-[12px] text-muted-foreground">
          Model Context Protocol servers expand this project's agent capabilities. Add a server (e.g. Tynn for PM tools), provide its auth key — keys are written to this project's <span className="font-mono">.env</span> file (never to <span className="font-mono">project.json</span>) for per-project isolation.
        </p>
      </div>

      {error && <div className="text-[12px] text-red">{error}</div>}
      {loading && servers.length === 0 && <div className="text-[12px] text-muted-foreground">Loading…</div>}

      <section data-testid="mcp-servers" className="space-y-3">
        {servers.length === 0 ? (
          <div className="text-[12px] text-muted-foreground py-2">No MCP servers configured.</div>
        ) : (
          servers.map((s) => (
            <McpServerCard
              key={s.id}
              server={s}
              projectPath={project.path}
              testing={testing === s.id}
              testResult={testResult[s.id]}
              onTest={() => { void testServer(s.id); }}
              onReconnect={() => { void reconnectServer(s.id); }}
              onRemove={() => { void removeServer(s.id); }}
            />
          ))
        )}

        <div className="mt-3">
          {!showAdd ? (
            <Button onClick={() => setShowAdd(true)} data-testid="mcp-add-button">Add MCP Server</Button>
          ) : (
            <div className="rounded border border-border p-3 mt-2 space-y-3">
              <div>
                <label className="block text-[11px] font-semibold text-muted-foreground mb-1">Service</label>
                <select
                  value={tplId}
                  onChange={(e) => setTplId(e.target.value)}
                  className="w-full text-[12px] rounded border border-border bg-background px-2 py-1"
                  data-testid="mcp-add-template"
                >
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}{t.pluginId ? ` (via ${t.pluginId})` : ""}</option>
                  ))}
                </select>
                {(() => {
                  const tpl = templates.find((t) => t.id === tplId);
                  return tpl ? <div className="text-[11px] text-muted-foreground mt-1">{tpl.description}</div> : null;
                })()}
              </div>
              {(() => {
                const tpl = templates.find((t) => t.id === tplId);
                if (!tpl?.authTokenKey) return null;
                return (
                  <div>
                    <label className="block text-[11px] font-semibold text-muted-foreground mb-1">
                      {tpl.authTokenKey} <span className="font-normal">(saved to <span className="font-mono">.env</span>; never echoed back)</span>
                    </label>
                    <input
                      type="password"
                      value={keyValue}
                      onChange={(e) => setKeyValue(e.target.value)}
                      placeholder="paste key…"
                      className="w-full text-[12px] rounded border border-border bg-background px-2 py-1 font-mono"
                      data-testid="mcp-add-key"
                    />
                  </div>
                );
              })()}
              <div className="flex gap-2">
                <Button onClick={() => { void addServer(); }} disabled={saving} data-testid="mcp-add-save">
                  {saving ? "Saving…" : "Save + Connect"}
                </Button>
                <Button onClick={() => { setShowAdd(false); setKeyValue(""); }}>Cancel</Button>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="pt-2 border-t border-border" data-testid="mcp-env-keys">
        <h4 className="text-[12px] font-semibold mb-2">.env keys (this project)</h4>
        {envKeys.length === 0 ? (
          <div className="text-[12px] text-muted-foreground">No keys set.</div>
        ) : (
          <ul className="text-[12px] space-y-1">
            {envKeys.map((k) => (
              <li key={k} className="flex items-center justify-between">
                <span className="font-mono">{k}</span>
                <button
                  onClick={() => { void removeEnvKey(k); }}
                  className="text-[11px] text-muted-foreground hover:text-red"
                  data-testid={`mcp-env-remove-${k}`}
                >
                  remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// -------------------------------------------------------------------------
// McpServerCard — one card per configured server. Header is always visible
// (name/transport/auth/state + actions). When the server is connected the
// card is expandable to browse Tools/Prompts/Resources via the inspector.
// -------------------------------------------------------------------------

function McpServerCard({
  server,
  projectPath,
  testing,
  testResult,
  onTest,
  onReconnect,
  onRemove,
}: {
  server: McpServerEntry;
  projectPath: string;
  testing: boolean;
  testResult?: { ok: boolean; message: string };
  onTest: () => void;
  onReconnect: () => void;
  onRemove: () => void;
}): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<CardTab>("tools");
  const [tools, setTools] = useState<McpToolDescriptor[] | null>(null);
  const [prompts, setPrompts] = useState<McpPromptDescriptor[] | null>(null);
  const [resources, setResources] = useState<McpResourceDescriptor[] | null>(null);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const [selectedItem, setSelectedItem] = useState<{ kind: CardTab; key: string } | null>(null);
  const [callArgs, setCallArgs] = useState("{}");
  const [callResult, setCallResult] = useState<CallResult>(null);
  const [calling, setCalling] = useState(false);

  const isConnected = server.state === "connected";

  const loadTab = async (tab: CardTab): Promise<void> => {
    setBrowsing(true);
    setBrowseError(null);
    try {
      const url = `/api/projects/mcp/server/${tab}?path=${encodeURIComponent(projectPath)}&id=${encodeURIComponent(server.id)}`;
      const res = await fetch(url);
      const body = await res.json() as { ok: boolean; tools?: McpToolDescriptor[]; prompts?: McpPromptDescriptor[]; resources?: McpResourceDescriptor[]; error?: string };
      if (!body.ok) {
        setBrowseError(body.error ?? `Failed to load ${tab}`);
        return;
      }
      if (tab === "tools") setTools(body.tools ?? []);
      else if (tab === "prompts") setPrompts(body.prompts ?? []);
      else setResources(body.resources ?? []);
    } catch (err) {
      setBrowseError(err instanceof Error ? err.message : String(err));
    } finally {
      setBrowsing(false);
    }
  };

  const onExpand = async (): Promise<void> => {
    const next = !expanded;
    setExpanded(next);
    if (next && isConnected && tools === null) {
      await loadTab("tools");
    }
  };

  const onSwitchTab = async (tab: CardTab): Promise<void> => {
    setActiveTab(tab);
    setSelectedItem(null);
    setCallResult(null);
    if (tab === "tools" && tools === null) await loadTab("tools");
    if (tab === "prompts" && prompts === null) await loadTab("prompts");
    if (tab === "resources" && resources === null) await loadTab("resources");
  };

  const onCallTool = async (toolName: string): Promise<void> => {
    setCalling(true);
    setCallResult(null);
    try {
      let parsedArgs: Record<string, unknown> = {};
      if (callArgs.trim().length > 0) {
        try {
          parsedArgs = JSON.parse(callArgs) as Record<string, unknown>;
        } catch {
          setCallResult({ kind: "error", message: "Arguments must be valid JSON" });
          setCalling(false);
          return;
        }
      }
      const res = await fetch(`/api/projects/mcp/server/call-tool`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: projectPath, id: server.id, toolName, arguments: parsedArgs }),
      });
      const body = await res.json() as { ok: boolean; result?: McpToolResult; error?: string };
      setCallResult(body.ok && body.result
        ? { kind: "ok-tool", data: body.result }
        : { kind: "error", message: body.error ?? "unknown error" });
    } catch (err) {
      setCallResult({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    } finally {
      setCalling(false);
    }
  };

  const onReadResource = async (uri: string): Promise<void> => {
    setCalling(true);
    setCallResult(null);
    try {
      const res = await fetch(`/api/projects/mcp/server/read-resource`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: projectPath, id: server.id, uri }),
      });
      const body = await res.json() as { ok: boolean; result?: McpResourceReadResult; error?: string };
      setCallResult(body.ok && body.result
        ? { kind: "ok-resource", data: body.result }
        : { kind: "error", message: body.error ?? "unknown error" });
    } catch (err) {
      setCallResult({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    } finally {
      setCalling(false);
    }
  };

  const stateColor =
    server.state === "connected" ? "text-green" :
    server.state === "error" ? "text-red" :
    "text-muted-foreground";

  return (
    <Card className="overflow-hidden" data-testid={`mcp-card-${server.id}`}>
      <CardHeader className="px-3 py-2">
        <div className="flex items-center gap-3">
          <button
            onClick={() => { void onExpand(); }}
            className="text-muted-foreground hover:text-foreground text-[14px] font-mono w-4"
            aria-label={expanded ? "Collapse" : "Expand"}
            data-testid={`mcp-card-toggle-${server.id}`}
          >
            {expanded ? "▾" : "▸"}
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="text-[13px] font-semibold">{server.name}</span>
              <span className="text-[10px] text-muted-foreground font-mono">id: {server.id.split(":").pop()}</span>
            </div>
            <div className="flex gap-3 text-[10px] text-muted-foreground mt-0.5">
              <span className="font-mono">{server.transport}</span>
              <span>•</span>
              <span>auth: {server.hasAuthToken ? <span className="text-green">configured</span> : "none"}</span>
              <span>•</span>
              <span className={stateColor}>{server.state}</span>
            </div>
            {testResult && (
              <div className={"text-[10px] mt-1 " + (testResult.ok ? "text-green" : "text-red")}>
                {testResult.message}
              </div>
            )}
          </div>
          <div className="flex gap-2 shrink-0">
            {server.state === "error" && (
              <Button onClick={onReconnect} disabled={testing} data-testid={`mcp-reconnect-${server.id}`}>
                {testing ? "Reconnecting…" : "Reconnect"}
              </Button>
            )}
            <Button onClick={onTest} disabled={testing} data-testid={`mcp-test-${server.id}`}>
              {testing ? "Testing…" : "Test"}
            </Button>
            <Button onClick={onRemove} data-testid={`mcp-remove-${server.id}`}>
              Remove
            </Button>
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="border-t border-border px-3 py-3 space-y-3" data-testid={`mcp-card-body-${server.id}`}>
          {!isConnected && (
            <div className="text-[12px] text-muted-foreground italic">
              Server is not connected. Reconnect to browse its tools, prompts, and resources.
            </div>
          )}
          {isConnected && (
            <Tabs value={activeTab} onValueChange={(v) => { void onSwitchTab(v as CardTab); }}>
              <div className="flex items-center">
                <TabsList variant="line">
                  <TabsTrigger value="tools" data-testid={`mcp-card-tab-tools-${server.id}`}>
                    Tools{tools !== null ? ` (${String(tools.length)})` : ""}
                  </TabsTrigger>
                  <TabsTrigger value="prompts" data-testid={`mcp-card-tab-prompts-${server.id}`}>
                    Prompts{prompts !== null ? ` (${String(prompts.length)})` : ""}
                  </TabsTrigger>
                  <TabsTrigger value="resources" data-testid={`mcp-card-tab-resources-${server.id}`}>
                    Resources{resources !== null ? ` (${String(resources.length)})` : ""}
                  </TabsTrigger>
                </TabsList>
                <button
                  onClick={() => { void loadTab(activeTab); }}
                  disabled={browsing}
                  className="ml-auto text-[10px] text-muted-foreground hover:text-foreground"
                >
                  {browsing ? "Loading…" : "Refresh"}
                </button>
              </div>

              {browseError && <div className="text-[11px] text-red mt-2">{browseError}</div>}

              <TabsContent value="tools" className="mt-3">
                {tools === null ? (
                  <div className="text-[11px] text-muted-foreground italic">Loading…</div>
                ) : tools.length === 0 ? (
                  <div className="text-[11px] text-muted-foreground italic">No tools.</div>
                ) : (
                  <ul className="space-y-1.5">
                    {tools.map((t) => {
                      const isSelected = selectedItem?.kind === "tools" && selectedItem.key === t.name;
                      return (
                        <li key={t.name} className="text-[11px]">
                          <button
                            onClick={() => {
                              setSelectedItem(isSelected ? null : { kind: "tools", key: t.name });
                              setCallResult(null);
                              setCallArgs("{}");
                            }}
                            className="flex items-baseline gap-2 hover:text-foreground text-left w-full"
                          >
                            <span className="font-mono text-foreground">{t.name}</span>
                            {t.description && <span className="text-muted-foreground truncate">— {t.description}</span>}
                          </button>
                          {isSelected && (
                            <div className="ml-2 mt-1.5 p-2 rounded border border-border bg-background space-y-2">
                              {t.inputSchema && (
                                <details className="text-[10px]">
                                  <summary className="text-muted-foreground cursor-pointer">Input schema</summary>
                                  <pre className="overflow-x-auto mt-1 font-mono">{JSON.stringify(t.inputSchema, null, 2)}</pre>
                                </details>
                              )}
                              <label className="text-[10px] text-muted-foreground">Arguments (JSON)</label>
                              <textarea
                                className="w-full text-[11px] font-mono p-1.5 rounded border border-border bg-background"
                                rows={3}
                                value={callArgs}
                                onChange={(e) => setCallArgs(e.target.value)}
                                data-testid={`mcp-tool-args-${t.name}`}
                              />
                              <div className="flex gap-2">
                                <Button onClick={() => { void onCallTool(t.name); }} disabled={calling} data-testid={`mcp-tool-call-${t.name}`}>
                                  {calling ? "Calling…" : "Call tool"}
                                </Button>
                              </div>
                              <McpResultRenderer result={callResult} />
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </TabsContent>

              <TabsContent value="prompts" className="mt-3">
                {prompts === null ? (
                  <div className="text-[11px] text-muted-foreground italic">Loading…</div>
                ) : prompts.length === 0 ? (
                  <div className="text-[11px] text-muted-foreground italic">No prompts.</div>
                ) : (
                  <ul className="space-y-1">
                    {prompts.map((p) => (
                      <li key={p.name} className="text-[11px]">
                        <span className="font-mono text-foreground">{p.name}</span>
                        {p.description && <span className="text-muted-foreground"> — {p.description}</span>}
                        {p.arguments && p.arguments.length > 0 && (
                          <div className="ml-2 text-[10px] text-muted-foreground">
                            args: {p.arguments.map((a) => a.required ? a.name : `${a.name}?`).join(", ")}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </TabsContent>

              <TabsContent value="resources" className="mt-3">
                {resources === null ? (
                  <div className="text-[11px] text-muted-foreground italic">Loading…</div>
                ) : resources.length === 0 ? (
                  <div className="text-[11px] text-muted-foreground italic">No resources.</div>
                ) : (
                  <ul className="space-y-1.5">
                    {resources.map((r) => {
                      const isSelected = selectedItem?.kind === "resources" && selectedItem.key === r.uri;
                      return (
                        <li key={r.uri} className="text-[11px]">
                          <div className="flex items-baseline gap-2">
                            <span className="font-mono text-foreground truncate">{r.name ?? r.uri}</span>
                            {r.mimeType && <span className="text-[10px] text-muted-foreground">({r.mimeType})</span>}
                            <button
                              onClick={() => {
                                setSelectedItem(isSelected ? null : { kind: "resources", key: r.uri });
                                setCallResult(null);
                                if (!isSelected) void onReadResource(r.uri);
                              }}
                              className="text-[10px] text-muted-foreground hover:text-foreground ml-auto"
                              data-testid={`mcp-resource-read-${r.uri}`}
                            >
                              {isSelected ? "hide" : "read"}
                            </button>
                          </div>
                          {r.description && <div className="text-[10px] text-muted-foreground ml-2">{r.description}</div>}
                          <div className="text-[10px] text-muted-foreground font-mono ml-2">{r.uri}</div>
                          {isSelected && (
                            <div className="ml-2 mt-1">
                              <McpResultRenderer result={callResult} />
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </TabsContent>
            </Tabs>
          )}
        </CardContent>
      )}
    </Card>
  );
}

// -------------------------------------------------------------------------
// McpResultRenderer — renders a tool-call or resource-read result properly:
// markdown via react-fancy ContentRenderer, plain text in a <pre>, images
// inline, and unknown shapes pretty-printed as a JSON fallback. The owner
// directive (cycle 68): "the resource readers should actually be rendered
// content, not the raw json package".
// -------------------------------------------------------------------------
function McpResultRenderer({ result }: { result: CallResult }): JSX.Element | null {
  if (!result) return null;
  if (result.kind === "error") {
    return <div className="text-[11px] text-red mt-1">Error: {result.message}</div>;
  }
  const blocks: McpContentBlock[] = result.kind === "ok-tool"
    ? (result.data.content ?? [])
    : (result.data.contents ?? []).map((c) => ({
        type: "text",
        text: c.text,
        data: c.blob,
        mimeType: c.mimeType,
      } as McpContentBlock));
  if (blocks.length === 0) {
    return <div className="text-[11px] text-muted-foreground italic mt-1">(empty result)</div>;
  }
  return (
    <div className="space-y-2 mt-1">
      {result.kind === "ok-tool" && result.data.isError && (
        <div className="text-[11px] text-red">Tool reported an error.</div>
      )}
      {blocks.map((b, i) => (
        <McpContentBlockRenderer key={i} block={b} />
      ))}
    </div>
  );
}

function McpContentBlockRenderer({ block }: { block: McpContentBlock }): JSX.Element {
  // Resource embed (tool result with type=resource): unwrap + recurse.
  if (block.type === "resource" && block.resource) {
    return <McpContentBlockRenderer block={{ type: "text", text: block.resource.text, data: block.resource.blob, mimeType: block.resource.mimeType }} />;
  }
  // Image: render inline if we have base64 data + a media type.
  if (block.type === "image" && block.data && block.mimeType) {
    return <img src={`data:${block.mimeType};base64,${block.data}`} alt="MCP resource" className="max-w-full rounded border border-border" />;
  }
  // Text: route by mime type. Markdown → ContentRenderer; HTML/JSON → labeled <pre>;
  // anything else → <pre>. If text is missing entirely, show a hint.
  if (block.type === "text" || block.text !== undefined) {
    const text = block.text ?? "";
    const mime = (block.mimeType ?? "").toLowerCase();
    if (mime.includes("markdown") || mime === "text/md") {
      return (
        <div className="text-[12px] leading-relaxed prose prose-sm max-w-none">
          <ContentRenderer value={text} format="markdown" />
        </div>
      );
    }
    if (mime.includes("json") || /^\s*[{[]/.test(text)) {
      // Pretty-print if it parses cleanly; otherwise show raw.
      let pretty = text;
      try {
        pretty = JSON.stringify(JSON.parse(text) as unknown, null, 2);
      } catch { /* leave as-is */ }
      return <pre className="text-[10px] font-mono p-2 rounded bg-surface1 overflow-x-auto whitespace-pre-wrap max-h-96 overflow-y-auto">{pretty}</pre>;
    }
    if (mime.includes("html")) {
      return <pre className="text-[10px] font-mono p-2 rounded bg-surface1 overflow-x-auto whitespace-pre-wrap max-h-96 overflow-y-auto">{text}</pre>;
    }
    return <pre className="text-[11px] font-mono p-2 rounded bg-surface1 overflow-x-auto whitespace-pre-wrap max-h-96 overflow-y-auto">{text}</pre>;
  }
  // Unknown shape — fall back to JSON dump so nothing is silently swallowed.
  return <pre className="text-[10px] font-mono p-2 rounded bg-surface1 overflow-x-auto whitespace-pre-wrap max-h-64 overflow-y-auto">{JSON.stringify(block, null, 2)}</pre>;
}
