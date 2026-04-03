/**
 * WorkerFlyout — slide-in panel showing worker metadata and model override form.
 */

import { useCallback, useEffect, useState } from "react";
import { FlyoutPanel, FlyoutHeader, FlyoutBody, FlyoutFooter } from "@/components/ui/flyout-panel";
import { WORKER_META, type WorkerMeta } from "./worker-meta";
import { fetchModels, type ModelEntry } from "@/api";
import type { AionimaConfig, WorkerModelOverride } from "@/types";

export interface SelectedWorker {
  nodeId: string;
  domain: string;
  worker: string;
  color: string;
}

interface WorkerFlyoutProps {
  selected: SelectedWorker | null;
  onClose: () => void;
  config: AionimaConfig | null;
  onSaveConfig: (config: AionimaConfig) => Promise<void>;
}

type Provider = WorkerModelOverride["provider"];

const PROVIDER_OPTIONS: { value: Provider; label: string }[] = [
  { value: "anthropic", label: "Anthropic" },
  { value: "openai", label: "OpenAI" },
  { value: "ollama", label: "Ollama" },
];

export function WorkerFlyout({ selected, onClose, config, onSaveConfig }: WorkerFlyoutProps) {
  const workerKey = selected ? `${selected.domain}.${selected.worker}` : null;
  const meta: WorkerMeta | undefined = workerKey ? WORKER_META[workerKey] : undefined;
  const currentOverride = workerKey ? config?.bots?.workerModels?.[workerKey] : undefined;

  const [overrideEnabled, setOverrideEnabled] = useState(false);
  const [provider, setProvider] = useState<Provider>("anthropic");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Model list state
  const [availableModels, setAvailableModels] = useState<ModelEntry[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);

  // Fetch models when provider changes
  useEffect(() => {
    if (!overrideEnabled) return;
    let cancelled = false;
    setModelsLoading(true);
    setModelsError(null);
    fetchModels(provider)
      .then((models) => {
        if (cancelled) return;
        setAvailableModels(models);
        // If current model isn't in the fetched list, select the first available
        if (models.length > 0 && !models.some((m) => m.id === model)) {
          setModel(models[0]!.id);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setAvailableModels([]);
        setModelsError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setModelsLoading(false);
      });
    return () => { cancelled = true; };
  }, [provider, overrideEnabled]);

  // Sync form state when selection or config changes
  useEffect(() => {
    if (currentOverride) {
      setOverrideEnabled(true);
      setProvider(currentOverride.provider);
      setModel(currentOverride.model);
      setApiKey(currentOverride.apiKey ?? "");
      setBaseUrl(currentOverride.baseUrl ?? "");
    } else {
      setOverrideEnabled(false);
      setProvider("anthropic");
      setModel("");
      setApiKey("");
      setBaseUrl("");
    }
    setDirty(false);
  }, [workerKey, currentOverride?.provider, currentOverride?.model, currentOverride?.apiKey, currentOverride?.baseUrl]);

  const handleSave = useCallback(async () => {
    if (!config || !workerKey) return;
    setSaving(true);
    try {
      const updated = { ...config };
      if (!overrideEnabled) {
        // Remove override
        if (updated.bots?.workerModels?.[workerKey]) {
          const models = { ...updated.bots.workerModels };
          delete models[workerKey];
          updated.bots = { ...updated.bots, workerModels: Object.keys(models).length > 0 ? models : undefined };
          if (!updated.bots.workerModels) delete updated.bots;
        }
      } else {
        // Set override
        const override: WorkerModelOverride = { provider, model };
        if (apiKey) override.apiKey = apiKey;
        if (baseUrl) override.baseUrl = baseUrl;
        updated.bots = {
          ...updated.bots,
          workerModels: { ...updated.bots?.workerModels, [workerKey]: override },
        };
      }
      await onSaveConfig(updated);
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }, [config, workerKey, overrideEnabled, provider, model, apiKey, baseUrl, onSaveConfig]);

  const displayModel = currentOverride ? currentOverride.model : meta?.defaultModel ?? "sonnet";

  return (
    <FlyoutPanel open={!!selected} onClose={onClose} position="right" width="380px" backdrop={false}>
      {selected && meta && (
        <>
          <FlyoutHeader>
            <div className="flex items-center gap-2 min-w-0">
              <span
                className="shrink-0 w-3 h-3 rounded-full"
                style={{ background: selected.color }}
              />
              <span className="font-semibold text-sm truncate">{selected.worker}</span>
              <span className="text-xs text-muted-foreground">{selected.domain}</span>
              <span
                className="ml-auto text-[10px] font-medium px-1.5 py-0.5 rounded"
                style={{
                  background: "var(--color-surface1)",
                  color: "var(--color-foreground)",
                }}
              >
                {displayModel}
              </span>
            </div>
            <button
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground ml-2 shrink-0"
              aria-label="Close"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="4" y1="4" x2="12" y2="12" />
                <line x1="12" y1="4" x2="4" y2="12" />
              </svg>
            </button>
          </FlyoutHeader>

          <FlyoutBody>
            <div className="space-y-4">
              {/* Description */}
              <section>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Description</h4>
                <p className="text-sm">{meta.description}</p>
              </section>

              {/* Purpose */}
              <section>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Purpose</h4>
                <p className="text-sm">{meta.purpose}</p>
              </section>

              {/* Enforced Chain */}
              {(meta.chainFrom.length > 0 || meta.chainTo.length > 0) && (
                <section>
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Enforced Chain</h4>
                  <div className="space-y-1 text-sm">
                    {meta.chainFrom.length > 0 && (
                      <div>
                        <span className="text-muted-foreground">Triggered by: </span>
                        {meta.chainFrom.map((w) => (
                          <code key={w} className="text-xs bg-surface1 px-1 py-0.5 rounded mr-1" style={{ background: "var(--color-surface1)" }}>
                            $W.{w}
                          </code>
                        ))}
                      </div>
                    )}
                    {meta.chainTo.length > 0 && (
                      <div>
                        <span className="text-muted-foreground">Triggers: </span>
                        {meta.chainTo.map((w) => (
                          <code key={w} className="text-xs bg-surface1 px-1 py-0.5 rounded mr-1" style={{ background: "var(--color-surface1)" }}>
                            $W.{w}
                          </code>
                        ))}
                      </div>
                    )}
                  </div>
                </section>
              )}

              {/* Model Override */}
              <section>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Model Override</h4>

                <label className="flex items-center gap-2 text-sm cursor-pointer mb-3">
                  <input
                    type="checkbox"
                    checked={overrideEnabled}
                    onChange={(e) => {
                      setOverrideEnabled(e.target.checked);
                      setDirty(true);
                    }}
                    className="accent-[var(--color-blue)]"
                  />
                  <span>{overrideEnabled ? "Custom model" : "Use default"}</span>
                  {!overrideEnabled && (
                    <span className="text-muted-foreground">({meta.defaultModel})</span>
                  )}
                </label>

                {overrideEnabled && (
                  <div className="space-y-2 pl-0.5">
                    {/* Provider */}
                    <div>
                      <label className="text-xs text-muted-foreground block mb-0.5">Provider</label>
                      <select
                        value={provider}
                        onChange={(e) => {
                          const next = e.target.value as Provider;
                          setProvider(next);
                          setModel("");
                          setDirty(true);
                        }}
                        className="w-full text-sm rounded border border-border bg-card text-foreground px-2 py-1.5"
                      >
                        {PROVIDER_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </div>

                    {/* Model */}
                    <div>
                      <label className="text-xs text-muted-foreground block mb-0.5">Model</label>
                      {modelsLoading ? (
                        <div className="text-xs text-muted-foreground py-1.5">Loading models...</div>
                      ) : modelsError ? (
                        <div className="text-xs text-red py-1.5">{modelsError}</div>
                      ) : availableModels.length > 0 ? (
                        <select
                          value={model}
                          onChange={(e) => { setModel(e.target.value); setDirty(true); }}
                          className="w-full text-sm rounded border border-border bg-card text-foreground px-2 py-1.5"
                        >
                          {availableModels.map((m) => (
                            <option key={m.id} value={m.id}>{m.name}</option>
                          ))}
                        </select>
                      ) : (
                        <div className="text-xs text-muted-foreground py-1.5">No models available</div>
                      )}
                    </div>

                    {/* API Key (optional per-worker override) */}
                    <div>
                      <label className="text-xs text-muted-foreground block mb-0.5">API Key (optional)</label>
                      <input
                        type="password"
                        value={apiKey}
                        onChange={(e) => { setApiKey(e.target.value); setDirty(true); }}
                        placeholder="Leave blank to use provider-level key"
                        className="w-full text-sm rounded border border-border bg-card text-foreground px-2 py-1.5"
                      />
                    </div>

                    {/* Base URL (Ollama) */}
                    {provider === "ollama" && (
                      <div>
                        <label className="text-xs text-muted-foreground block mb-0.5">Base URL</label>
                        <input
                          type="text"
                          value={baseUrl}
                          onChange={(e) => { setBaseUrl(e.target.value); setDirty(true); }}
                          placeholder="http://localhost:11434"
                          className="w-full text-sm rounded border border-border bg-card text-foreground px-2 py-1.5"
                        />
                      </div>
                    )}
                  </div>
                )}
              </section>
            </div>
          </FlyoutBody>

          {dirty && (
            <FlyoutFooter>
              <button
                onClick={handleSave}
                disabled={saving}
                className="w-full text-sm font-medium rounded px-3 py-1.5 transition-colors"
                style={{
                  background: saving ? "var(--color-surface1)" : "var(--color-blue)",
                  color: saving ? "var(--color-muted-foreground)" : "var(--color-crust)",
                  cursor: saving ? "not-allowed" : "pointer",
                }}
              >
                {saving ? "Saving..." : "Save"}
              </button>
            </FlyoutFooter>
          )}
        </>
      )}
    </FlyoutPanel>
  );
}
