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
import { Link } from "react-router-dom";
import { Card } from "./ui/card.js";
import { Button } from "./ui/button.js";
import {
  fetchHFInstalledModels,
  fetchHFRunningModels,
  uninstallHFModel,
  startHFModel,
  stopHFModel,
} from "../api.js";
import type { HFInstalledModel, HFRunningModel } from "../types.js";

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

  useEffect(() => { void refresh(); }, []);

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
            <h2 className="text-[15px] font-semibold mb-1">Models</h2>
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

      <Card className="p-4 border-amber-400/30 bg-amber-400/5">
        <h3 className="text-[13px] font-semibold mb-2 text-amber-400 uppercase tracking-wider">Coming next</h3>
        <ul className="text-[12px] text-muted-foreground space-y-1 list-disc pl-5">
          <li>Cloud providers (OpenAI, Anthropic, etc.) report their model lists here via plugin API</li>
          <li>Ollama and Lemonade UIs lose their per-runtime model-install paths — those redirect here</li>
          <li>Per-model attach-to-Provider mapping (which Provider serves which model)</li>
        </ul>
      </Card>
    </div>
  );
}
