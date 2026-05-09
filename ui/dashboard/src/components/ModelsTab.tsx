/**
 * ModelsTab — unified model management UI under Providers page.
 *
 * Owner directive cycle 129: "Move the Model management to a Models tab.
 * Models are downloaded using the HF Marketplace and then managed in the
 * Provider page. No other pages manage models."
 *
 * This is the consolidated entry point for installed-model lifecycle:
 * list, start/stop, uninstall. Discovery + initial download stays at
 * /hf-marketplace (link prominently). Subsequent slices will:
 *   - Migrate Ollama / Lemonade per-runtime model UIs into this tab
 *   - Add cloud-Provider plugin model lists (the ones that ship a
 *     model-list endpoint or subscription)
 *   - Remove model loading from the runtime-specific pages
 */

import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Card } from "./ui/card.js";
import { Button } from "./ui/button.js";
import { DevNotes } from "./ui/dev-notes.js";
import {
  fetchHFInstalledModels,
  fetchHFRunningModels,
  uninstallHFModel,
  startHFModel,
  stopHFModel,
  fetchProvidersCatalog,
  fetchProviderModels,
} from "../api.js";
import type { HFInstalledModel, HFRunningModel, ProviderCatalogEntry } from "../types.js";
import type { ProviderModelInfo } from "../api.js";

/** Per-Provider live model list state. Null = unavailable; [] = empty; populated = live. */
interface ProviderModels {
  provider: ProviderCatalogEntry;
  models: ProviderModelInfo[] | null;
  loading: boolean;
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b}B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)}KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)}MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)}GB`;
}

export function ModelsTab() {
  const [installed, setInstalled] = useState<HFInstalledModel[]>([]);
  const [running, setRunning] = useState<HFRunningModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  // Cycle 141 — by-provider live model lists. Each entry tracks loading +
  // result; null result means unavailable/unauth/no list endpoint.
  const [providerModels, setProviderModels] = useState<ProviderModels[]>([]);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const [inst, run] = await Promise.all([
        fetchHFInstalledModels(),
        fetchHFRunningModels().catch(() => []),
      ]);
      setInstalled(inst);
      setRunning(run);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  // Cycle 141 — fetch the canonical catalog then live models per provider in
  // parallel. Per-provider failures don't block siblings (each promise resolves
  // independently into its own ProviderModels entry).
  const refreshProviderModels = async () => {
    try {
      const catalog = await fetchProvidersCatalog();
      // Seed loading state immediately so the UI shows skeleton placeholders
      // while each fetch is in flight.
      setProviderModels(
        catalog.providers.map((p) => ({ provider: p, models: null, loading: true })),
      );
      // Fetch all in parallel; update each entry as it resolves.
      await Promise.all(
        catalog.providers.map(async (p) => {
          const models = await fetchProviderModels(p.id).catch(() => null);
          setProviderModels((prev) =>
            prev.map((entry) =>
              entry.provider.id === p.id ? { ...entry, models, loading: false } : entry,
            ),
          );
        }),
      );
    } catch {
      // Catalog fetch failed — leave the section empty rather than blocking
      // the HF installed-models view.
    }
  };

  useEffect(() => { void refresh(); void refreshProviderModels(); }, []);

  const runningSet = new Set(running.map((r) => r.modelId));

  const handleStart = async (id: string) => {
    setPendingId(id);
    try {
      await startHFModel(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingId(null);
    }
  };

  const handleStop = async (id: string) => {
    setPendingId(id);
    try {
      await stopHFModel(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingId(null);
    }
  };

  const handleUninstall = async (id: string) => {
    if (!confirm(`Uninstall ${id}? This deletes its files from ~/.agi/models/`)) return;
    setPendingId(id);
    try {
      await uninstallHFModel(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingId(null);
    }
  };

  return (
    <div className="space-y-4" data-testid="models-tab">
      {/* Header — clarifies the consolidation policy */}
      <Card className="p-4 border-blue/30 bg-blue/5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-[15px] font-semibold">Models</h2>
              <DevNotes title="Models tab — dev notes">
                <DevNotes.Item kind="info" heading="Cycle 141 — By Provider section">
                  Live per-provider model lists from `/api/providers/:id/models`. Per-provider fetch
                  in parallel via Promise.all so a slow provider doesn't block siblings. Pill list
                  capped at 12 with "+N more" overflow.
                </DevNotes.Item>
                <DevNotes.Item kind="info" heading="Cycle 142 — cloud REST /v1/models live">
                  Anthropic + OpenAI now report live model lists when an API key is configured.
                  OpenAI filtered to chat-capable id patterns (`gpt-*`/`o1-*`/`o3-*`/`o4-*`/`chatgpt-*`)
                  to exclude whisper/dall-e/embeddings/tts/moderation.
                </DevNotes.Item>
                <DevNotes.Item kind="todo" heading="Cycle-129 sub-task 5 — plugin SDK adoption">
                  Ollama + Lemonade providers should adopt the `defineProvider().fetchModels(fn)`
                  SDK contract (cycle 139, v0.4.407). Currently the gateway has built-in switch
                  logic for them in `getModelsForBuiltin`; moving to the plugin path generalizes
                  to Linear/Jira-style PM providers in the future.
                </DevNotes.Item>
                <DevNotes.Item kind="todo" heading="Cycle-129 sub-task 6 — remove legacy per-runtime UIs">
                  The old "load model" UI on the Ollama / Lemonade provider settings pages should
                  redirect here once the plugin SDK adoption lands. Models tab becomes the single
                  source of truth for model lifecycle.
                </DevNotes.Item>
                <DevNotes.Item kind="info" heading="HF marketplace stays separate">
                  Discovery + initial download stays at `/hf-marketplace`; this tab manages the
                  lifecycle of installed models (start/stop/uninstall) and shows what each
                  Provider can serve.
                </DevNotes.Item>
              </DevNotes>
            </div>
            <p className="text-[12px] text-muted-foreground leading-relaxed max-w-[60ch]">
              Single source of truth for installed local models. Download new models from the
              HF Marketplace; manage their lifecycle (start, stop, uninstall) here.
              Runtime providers like Ollama and Lemonade execute these models — they don't
              load their own.
            </p>
          </div>
          <Link to="/hf-marketplace">
            <Button size="sm">Browse HF Marketplace →</Button>
          </Link>
        </div>
      </Card>

      {error && (
        <Card className="p-3 text-sm text-destructive border-destructive/50">
          {error}
        </Card>
      )}

      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">Installed models</h3>
          <span className="text-[11px] text-muted-foreground">
            {installed.length} installed · {running.length} running
          </span>
        </div>

        {loading && <div className="text-sm text-muted-foreground py-6 text-center">Loading…</div>}

        {!loading && installed.length === 0 && (
          <div className="text-sm text-muted-foreground py-6 text-center">
            No models installed. <Link to="/hf-marketplace" className="text-blue underline">Browse the HF Marketplace</Link> to get started.
          </div>
        )}

        {!loading && installed.length > 0 && (
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
                <th className="py-2 pr-2 font-medium">Model</th>
                <th className="py-2 pr-2 font-medium">Type</th>
                <th className="py-2 pr-2 font-medium">Size</th>
                <th className="py-2 pr-2 font-medium">Quantization</th>
                <th className="py-2 pr-2 font-medium">Status</th>
                <th className="py-2 pr-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {installed.map((m) => {
                const isRunning = runningSet.has(m.id);
                const isPending = pendingId === m.id;
                return (
                  <tr key={m.id} className="border-b border-border/40 hover:bg-secondary/30">
                    <td className="py-2 pr-2">
                      <div className="font-medium">{m.displayName ?? m.id}</div>
                      <div className="text-[11px] text-muted-foreground font-mono">{m.id}</div>
                    </td>
                    <td className="py-2 pr-2">{m.runtimeType}</td>
                    <td className="py-2 pr-2 text-muted-foreground">{formatBytes(m.fileSizeBytes)}</td>
                    <td className="py-2 pr-2 text-muted-foreground">{m.quantization ?? "—"}</td>
                    <td className="py-2 pr-2">
                      {isRunning ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-green/15 text-green font-semibold">running</span>
                      ) : (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">stopped</span>
                      )}
                    </td>
                    <td className="py-2 pr-2 text-right">
                      {isRunning ? (
                        <Button size="sm" variant="ghost" onClick={() => void handleStop(m.id)} disabled={isPending}>
                          Stop
                        </Button>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => void handleStart(m.id)} disabled={isPending}>
                          Start
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => void handleUninstall(m.id)} disabled={isPending}>
                        Uninstall
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {/* Cycle 141 — By-provider live model lists. Reads from /api/providers/:id/models
          (cycle 140 endpoint). Per-provider null state shown as "unavailable" with
          the reason inferable from the provider's tier (cloud → "Cloud API not yet
          wired"; local → "Provider unreachable"). */}
      <Card className="p-4" data-testid="models-tab-by-provider">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">By Provider</h3>
          <span className="text-[11px] text-muted-foreground">
            {providerModels.filter((p) => p.models !== null).length}/{providerModels.length} reporting
          </span>
        </div>
        {providerModels.length === 0 && (
          <div className="text-sm text-muted-foreground py-4 text-center">Loading providers…</div>
        )}
        {providerModels.length > 0 && (
          <div className="space-y-3">
            {providerModels.map((entry) => {
              const { provider: p, models, loading: pLoading } = entry;
              return (
                <div key={p.id} className="border-b border-border/40 pb-2 last:border-b-0 last:pb-0" data-testid={`provider-models-${p.id}`}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-semibold">{p.name}</span>
                      <span
                        className={
                          p.tier === "cloud"
                            ? "text-[10px] px-1.5 py-0.5 rounded bg-blue/15 text-blue font-medium"
                            : p.tier === "floor"
                              ? "text-[10px] px-1.5 py-0.5 rounded bg-yellow/15 text-yellow font-medium"
                              : "text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground font-medium"
                        }
                      >
                        {p.tier}
                      </span>
                    </div>
                    <span className="text-[11px] text-muted-foreground">
                      {pLoading ? "…" : models === null ? "unavailable" : `${models.length} model${models.length === 1 ? "" : "s"}`}
                    </span>
                  </div>
                  {!pLoading && models !== null && models.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {models.slice(0, 12).map((m) => (
                        <span
                          key={m.id}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-secondary/60 font-mono text-muted-foreground"
                          title={m.label ?? m.id}
                        >
                          {m.label ?? m.id}
                        </span>
                      ))}
                      {models.length > 12 && (
                        <span className="text-[10px] px-1.5 py-0.5 text-muted-foreground italic">
                          +{models.length - 12} more
                        </span>
                      )}
                    </div>
                  )}
                  {!pLoading && models === null && (
                    <div className="text-[11px] text-muted-foreground italic">
                      {p.tier === "cloud"
                        ? "Cloud REST /v1/models not yet wired (cycle 141+)"
                        : p.health === "no-key"
                          ? "Configure API key to see models"
                          : "Provider unreachable or no list endpoint"}
                    </div>
                  )}
                  {!pLoading && models !== null && models.length === 0 && (
                    <div className="text-[11px] text-muted-foreground italic">No models loaded</div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
