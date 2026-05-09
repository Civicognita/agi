/**
 * LemonadeTab — manage Lemonade local AI server through AGI.
 *
 * All operations route through /api/lemonade/* (the AGI-side proxy);
 * never hits Lemonade's :13305 directly. This is the dashboard mirror
 * of the `agi lemonade <cmd>` CLI surface.
 */

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface LemonadeStatus {
  installed: boolean;
  running: boolean;
  baseUrl?: string;
  version?: string;
  modelLoaded?: string | null;
  allModelsLoaded?: Array<{ model_name: string; device?: string; recipe?: string }>;
  devices?: Record<string, unknown> | null;
  recipes?: Record<string, { backends: Record<string, { state: string; message?: string; devices?: string[]; release_url?: string }> }> | null;
  error?: string;
}

interface LemonadeModel {
  id: string;
  recipe?: string;
  size?: number;
  downloaded?: boolean;
  suggested?: boolean;
  labels?: string[];
  owned_by?: string;
}

async function api<T>(path: string, init?: RequestInit): Promise<T | { error: string }> {
  try {
    const res = await fetch(path, init);
    const text = await res.text();
    let parsed: unknown;
    try { parsed = text.length > 0 ? JSON.parse(text) : {}; } catch { parsed = text; }
    if (!res.ok) {
      const err = (typeof parsed === "object" && parsed !== null && "error" in parsed)
        ? String((parsed as { error: unknown }).error)
        : `HTTP ${res.status}`;
      return { error: err };
    }
    return parsed as T;
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export function LemonadeTab() {
  const [status, setStatus] = useState<LemonadeStatus | null>(null);
  const [models, setModels] = useState<LemonadeModel[]>([]);
  const [pullName, setPullName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  const refresh = useCallback(async () => {
    const [s, m] = await Promise.all([
      api<LemonadeStatus>("/api/lemonade/status"),
      api<{ models: LemonadeModel[] }>("/api/lemonade/models"),
    ]);
    if ("error" in s) {
      setStatus({ installed: false, running: false, error: s.error });
    } else {
      setStatus(s);
    }
    if (!("error" in m)) {
      setModels(m.models ?? []);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = setInterval(() => { void refresh(); }, 10_000);
    return () => clearInterval(interval);
  }, [refresh]);

  const showToast = (kind: "ok" | "err", msg: string) => {
    setToast({ kind, msg });
    setTimeout(() => setToast(null), 4_000);
  };

  const doPull = async () => {
    const m = pullName.trim();
    if (!m) return;
    setBusy(`pull:${m}`);
    const r = await api<{ ok: boolean; result?: unknown }>("/api/lemonade/models/pull", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: m }),
    });
    setBusy(null);
    if ("error" in r) {
      showToast("err", `Pull failed: ${r.error}`);
    } else {
      showToast("ok", `Pulled ${m}`);
      setPullName("");
      void refresh();
    }
  };

  const doAction = async (model: string, action: "load" | "unload" | "delete") => {
    setBusy(`${action}:${model}`);
    const r = await api<{ ok: boolean }>(`/api/lemonade/models/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
    });
    setBusy(null);
    if ("error" in r) {
      showToast("err", `${action} failed: ${r.error}`);
    } else {
      showToast("ok", `${action}: ${model}`);
      void refresh();
    }
  };

  const installBackend = async (recipe: string, backend: string) => {
    setBusy(`install:${recipe}:${backend}`);
    const r = await api<{ ok: boolean }>("/api/lemonade/backends/install", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipe, backend }),
    });
    setBusy(null);
    if ("error" in r) {
      showToast("err", `Install failed: ${r.error}`);
    } else {
      showToast("ok", `Installed ${recipe}:${backend}`);
      void refresh();
    }
  };

  if (!status) {
    return <p className="text-[13px] text-muted-foreground">Loading Lemonade status…</p>;
  }

  if (!status.running) {
    return (
      <Card className="p-6 text-center">
        <p className="text-sm font-semibold text-foreground mb-2">Lemonade not reachable</p>
        <p className="text-[13px] text-muted-foreground mb-4">
          {status.error ?? "AGI couldn't reach the Lemonade server. Install the agi-lemonade-runtime plugin from the Plugin Marketplace, or check that lemonade-server is running."}
        </p>
        <Button variant="outline" size="sm" onClick={() => { void refresh(); }}>Retry</Button>
      </Card>
    );
  }

  const loadedSet = new Set((status.allModelsLoaded ?? []).map((m) => m.model_name));
  const installedBackends: Array<{ recipe: string; backend: string; devices?: string[] }> = [];
  const installableBackends: Array<{ recipe: string; backend: string; message?: string }> = [];
  for (const [recipe, info] of Object.entries(status.recipes ?? {})) {
    for (const [backend, bi] of Object.entries(info.backends ?? {})) {
      if (bi.state === "installed") installedBackends.push({ recipe, backend, devices: bi.devices });
      else if (bi.state === "installable") installableBackends.push({ recipe, backend, message: bi.message });
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {toast && (
        <div className={cn(
          "rounded-md border p-3 text-[13px]",
          toast.kind === "ok" ? "border-green/40 bg-green/10 text-green" : "border-red/40 bg-red/10 text-red"
        )}>
          {toast.msg}
        </div>
      )}

      {/* Status header */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-sm font-semibold text-foreground">Lemonade Server</p>
            <p className="text-[12px] text-muted-foreground">
              v{status.version} · {status.baseUrl}
            </p>
          </div>
          <Badge variant="default">Running</Badge>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[13px]">
          <div>
            <p className="text-[11px] uppercase text-muted-foreground mb-1">Loaded</p>
            <p className="text-foreground">{status.modelLoaded ?? "(none)"}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase text-muted-foreground mb-1">Installed Backends</p>
            <p className="text-foreground">
              {installedBackends.length === 0
                ? "(none)"
                : installedBackends.map((b) => `${b.recipe}:${b.backend}`).join(", ")}
            </p>
          </div>
        </div>
      </Card>

      {/* Pull a new model */}
      <Card className="p-4">
        <p className="text-sm font-semibold text-foreground mb-1">Pull a model</p>
        <p className="text-[12px] text-muted-foreground mb-3">
          Use a Lemonade catalog name (e.g. <code className="text-foreground">Gemma-4-E2B-it-GGUF</code>) or a HuggingFace checkpoint with <code className="text-foreground">user.</code> prefix.
        </p>
        <div className="flex gap-2">
          <Input
            value={pullName}
            onChange={(e) => setPullName(e.target.value)}
            placeholder="Gemma-4-E2B-it-GGUF"
            disabled={busy?.startsWith("pull:") ?? false}
            className="flex-1"
          />
          <Button
            onClick={() => { void doPull(); }}
            disabled={!pullName.trim() || busy?.startsWith("pull:")}
            size="sm"
          >
            {busy?.startsWith("pull:") ? "Pulling…" : "Pull"}
          </Button>
        </div>
      </Card>

      {/* Installed models */}
      <Card className="p-4">
        <p className="text-sm font-semibold text-foreground mb-3">
          Installed models ({models.length})
        </p>
        {models.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">No models pulled yet. Use the form above to pull one.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {models.map((m) => {
              const isLoaded = loadedSet.has(m.id);
              return (
                <div key={m.id} className="flex items-center justify-between gap-3 p-2 rounded border border-border bg-background/40">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-foreground truncate">{m.id}</span>
                      {isLoaded && <Badge variant="default" className="text-[10px]">Loaded</Badge>}
                      {m.recipe && <Badge variant="outline" className="text-[10px]">{m.recipe}</Badge>}
                      {(m.labels ?? []).map((l) => (
                        <Badge key={l} variant="outline" className="text-[10px]">{l}</Badge>
                      ))}
                    </div>
                    {m.size !== undefined && (
                      <p className="text-[11px] text-muted-foreground mt-1">
                        {m.size.toFixed(1)} GB
                      </p>
                    )}
                  </div>
                  <div className="flex gap-1.5 flex-shrink-0">
                    {!isLoaded && (
                      <Button size="sm" variant="outline"
                        disabled={busy === `load:${m.id}`}
                        onClick={() => { void doAction(m.id, "load"); }}>
                        {busy === `load:${m.id}` ? "Loading…" : "Load"}
                      </Button>
                    )}
                    {isLoaded && (
                      <Button size="sm" variant="outline"
                        disabled={busy === `unload:${m.id}`}
                        onClick={() => { void doAction(m.id, "unload"); }}>
                        {busy === `unload:${m.id}` ? "Unloading…" : "Unload"}
                      </Button>
                    )}
                    <Button size="sm" variant="ghost"
                      disabled={busy === `delete:${m.id}`}
                      onClick={() => { void doAction(m.id, "delete"); }}>
                      Delete
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Backends */}
      <Card className="p-4">
        <p className="text-sm font-semibold text-foreground mb-1">Serving backends</p>
        <p className="text-[12px] text-muted-foreground mb-3">
          Install additional backends (e.g. CPU fallback, Vulkan for non-AMD GPUs). Already installed: <span className="text-foreground">{installedBackends.length}</span>.
        </p>
        {installableBackends.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">All available backends installed for your hardware.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {installableBackends.map((b) => (
              <div key={`${b.recipe}:${b.backend}`} className="flex items-center justify-between gap-3 p-2 rounded border border-border bg-background/40">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{b.recipe}:{b.backend}</p>
                  {b.message && <p className="text-[11px] text-muted-foreground">{b.message}</p>}
                </div>
                <Button size="sm" variant="outline"
                  disabled={busy === `install:${b.recipe}:${b.backend}`}
                  onClick={() => { void installBackend(b.recipe, b.backend); }}>
                  {busy === `install:${b.recipe}:${b.backend}` ? "Installing…" : "Install"}
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
