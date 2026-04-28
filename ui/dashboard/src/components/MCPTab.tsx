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

      <section data-testid="mcp-servers">
        {servers.length === 0 ? (
          <div className="text-[12px] text-muted-foreground py-2">No MCP servers configured.</div>
        ) : (
          <table className="w-full text-[12px]" data-testid="mcp-servers-table">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left pb-1">Server</th>
                <th className="text-left pb-1">Transport</th>
                <th className="text-left pb-1">Auth</th>
                <th className="text-left pb-1">State</th>
                <th className="text-left pb-1">Actions</th>
              </tr>
            </thead>
            <tbody>
              {servers.map((s) => (
                <tr key={s.id} className="border-b border-border/50 align-top">
                  <td className="py-2">
                    <div className="font-mono">{s.name}</div>
                    <div className="text-[10px] text-muted-foreground">id: {s.id}</div>
                  </td>
                  <td className="py-2 font-mono">{s.transport}</td>
                  <td className="py-2 text-[11px]">
                    {s.hasAuthToken ? <span className="text-green">configured</span> : <span className="text-muted-foreground">none</span>}
                  </td>
                  <td className="py-2">
                    <span className={
                      s.state === "connected" ? "text-green" :
                      s.state === "error" ? "text-red" :
                      "text-muted-foreground"
                    }>{s.state}</span>
                    {testResult[s.id] && (
                      <div className={"text-[10px] mt-0.5 " + (testResult[s.id]!.ok ? "text-green" : "text-red")}>
                        {testResult[s.id]!.message}
                      </div>
                    )}
                  </td>
                  <td className="py-2">
                    <div className="flex gap-2">
                      {s.state === "error" && (
                        <Button onClick={() => { void reconnectServer(s.id); }} disabled={testing === s.id} data-testid={`mcp-reconnect-${s.id}`}>
                          {testing === s.id ? "Reconnecting…" : "Reconnect"}
                        </Button>
                      )}
                      <Button onClick={() => { void testServer(s.id); }} disabled={testing === s.id} data-testid={`mcp-test-${s.id}`}>
                        {testing === s.id ? "Testing…" : "Test"}
                      </Button>
                      <Button onClick={() => { void removeServer(s.id); }} data-testid={`mcp-remove-${s.id}`}>
                        Remove
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
