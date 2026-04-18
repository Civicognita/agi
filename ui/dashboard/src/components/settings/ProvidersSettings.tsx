/**
 * ProvidersSettings — Gateway Settings > Providers tab.
 *
 * Section 1: Aion's active LLM provider (dropdown populated from catalog)
 * Section 2: Per-worker provider overrides (default: "Inherited" from Aion)
 */

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { SectionHeading, FieldGroup } from "./SettingsShared.js";
import { fetchHfProviders } from "../../api.js";
import type { HfProviderOption } from "../../api.js";
import type { AionimaConfig } from "../../types.js";

interface WorkerEntry {
  id: string;
  title: string;
  domain: string;
  role: string;
}

interface ProviderOption {
  id: string;
  name: string;
}

const BUILTIN_PROVIDERS: ProviderOption[] = [
  { id: "anthropic", name: "Anthropic (API key)" },
  { id: "openai", name: "OpenAI" },
  { id: "ollama", name: "Ollama (local)" },
];

const MODELS_BY_PROVIDER: Record<string, { id: string; name: string }[]> = {
  anthropic: [
    { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6 (balanced)" },
    { id: "claude-opus-4-6", name: "Claude Opus 4.6 (most capable)" },
    { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5 (fast)" },
  ],
  openai: [
    { id: "gpt-4o", name: "GPT-4o (balanced)" },
    { id: "gpt-4o-mini", name: "GPT-4o Mini (fast)" },
    { id: "gpt-4-turbo", name: "GPT-4 Turbo" },
  ],
  ollama: [
    { id: "llama3.1", name: "Llama 3.1" },
    { id: "mistral", name: "Mistral" },
    { id: "codellama", name: "Code Llama" },
  ],
};

interface Props {
  config: AionimaConfig;
  update: (fn: (prev: AionimaConfig) => AionimaConfig) => void;
}

export function ProvidersSettings({ config, update }: Props) {
  const [workers, setWorkers] = useState<WorkerEntry[]>([]);
  const [hfProviders, setHfProviders] = useState<HfProviderOption[]>([]);

  const agentProvider = (config.agent as Record<string, unknown> | undefined)?.provider as string ?? "anthropic";
  const agentModel = (config.agent as Record<string, unknown> | undefined)?.model as string ?? "claude-sonnet-4-6";
  const modelOverrides = ((config.workers as Record<string, unknown> | undefined)?.modelOverrides ?? {}) as Record<string, { provider?: string; model?: string }>;

  const routerCostMode = ((config.agent as Record<string, unknown> | undefined)?.router as Record<string, unknown> | undefined)?.costMode as string ?? "balanced";
  const routerEscalation = ((config.agent as Record<string, unknown> | undefined)?.router as Record<string, unknown> | undefined)?.escalation as boolean ?? false;

  const [workerError, setWorkerError] = useState<string | null>(null);

  // Fetch running HF text-generation models to show in provider dropdowns
  useEffect(() => {
    fetchHfProviders().then(setHfProviders).catch(() => {});
    // Re-check every 30s in case models start/stop
    const interval = setInterval(() => {
      fetchHfProviders().then(setHfProviders).catch(() => {});
    }, 30_000);
    return () => clearInterval(interval);
  }, []);

  // Build combined provider list: built-in + running HF models
  const allProviders: ProviderOption[] = [
    ...BUILTIN_PROVIDERS,
    ...hfProviders.map((hf) => ({ id: `hf-local:${hf.id}`, name: hf.name })),
  ];

  // Build combined model list: include HF models
  const allModels: Record<string, { id: string; name: string }[]> = { ...MODELS_BY_PROVIDER };
  for (const hf of hfProviders) {
    allModels[`hf-local:${hf.id}`] = [{ id: hf.id, name: hf.name }];
  }

  useEffect(() => {
    fetch("/api/workers/catalog")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        setWorkers(data as WorkerEntry[]);
        setWorkerError(null);
      })
      .catch((err) => setWorkerError(err instanceof Error ? err.message : "Failed to load workers"));
  }, []);

  const setAionProvider = useCallback((providerKey: string) => {
    // HF local models use "hf-local:{modelId}" as the key. Split it so
    // config gets provider: "hf-local" + model: "{modelId}" + baseUrl.
    if (providerKey.startsWith("hf-local:")) {
      const modelId = providerKey.slice("hf-local:".length);
      const hf = hfProviders.find((h) => h.id === modelId);
      update((prev) => ({
        ...prev,
        agent: {
          ...(prev.agent ?? {}),
          provider: "hf-local",
          model: modelId,
          baseUrl: hf?.baseUrl ?? `http://127.0.0.1:6000`,
        },
      }));
      return;
    }
    const models = MODELS_BY_PROVIDER[providerKey];
    const defaultModel = models?.[0]?.id ?? "claude-sonnet-4-6";
    update((prev) => ({
      ...prev,
      agent: { ...(prev.agent ?? {}), provider: providerKey, model: defaultModel },
    }));
  }, [update, hfProviders]);

  const setAionModel = useCallback((model: string) => {
    update((prev) => ({
      ...prev,
      agent: { ...(prev.agent ?? {}), model },
    }));
  }, [update]);

  const setWorkerOverride = useCallback((workerKey: string, field: "provider" | "model", value: string) => {
    update((prev) => {
      const prevWorkers = (prev.workers ?? {}) as Record<string, unknown>;
      const prevOverrides = (prevWorkers.modelOverrides ?? {}) as Record<string, Record<string, unknown>>;

      if (field === "provider" && value === "inherited") {
        const { [workerKey]: _, ...rest } = prevOverrides;
        return {
          ...prev,
          workers: { ...prevWorkers, modelOverrides: rest },
        };
      }

      const existing = prevOverrides[workerKey] ?? {};
      const updated = { ...existing, [field]: value };

      // When switching provider, set a default model for that provider
      if (field === "provider") {
        const models = MODELS_BY_PROVIDER[value];
        updated.model = models?.[0]?.id ?? "claude-sonnet-4-6";
      }

      return {
        ...prev,
        workers: {
          ...prevWorkers,
          modelOverrides: {
            ...prevOverrides,
            [workerKey]: updated,
          },
        },
      };
    });
  }, [update]);

  const setCostMode = useCallback((mode: string) => {
    update((prev) => ({
      ...prev,
      agent: {
        ...(prev.agent ?? {}),
        router: {
          ...((prev.agent as Record<string, unknown> | undefined)?.router ?? {}),
          costMode: mode,
        },
      },
    }));
  }, [update]);

  const setEscalation = useCallback((enabled: boolean) => {
    update((prev) => ({
      ...prev,
      agent: {
        ...(prev.agent ?? {}),
        router: {
          ...((prev.agent as Record<string, unknown> | undefined)?.router ?? {}),
          escalation: enabled,
        },
      },
    }));
  }, [update]);

  const setProviderKey = useCallback((provider: string, apiKey: string) => {
    if (!apiKey) return;
    update((prev) => ({
      ...prev,
      providers: {
        ...((prev.providers ?? {}) as Record<string, unknown>),
        [provider]: {
          ...(((prev.providers ?? {}) as Record<string, Record<string, unknown>>)[provider] ?? {}),
          apiKey,
        },
      },
    }));
  }, [update]);

  const setProviderThreshold = useCallback((provider: string, threshold: number | undefined) => {
    update((prev) => ({
      ...prev,
      providers: {
        ...((prev.providers ?? {}) as Record<string, unknown>),
        [provider]: {
          ...(((prev.providers ?? {}) as Record<string, Record<string, unknown>>)[provider] ?? {}),
          balanceAlertThreshold: threshold,
        },
      },
    }));
  }, [update]);

  // Group workers by domain
  const domains = new Map<string, WorkerEntry[]>();
  for (const w of workers) {
    const list = domains.get(w.domain) ?? [];
    list.push(w);
    domains.set(w.domain, list);
  }

  return (
    <div className="space-y-6">
      {/* Routing Mode */}
      <Card className="p-6 gap-0">
        <SectionHeading>Routing Mode</SectionHeading>
        <p className="text-[12px] text-muted-foreground mb-4">
          Controls how the router selects models for each request. The router classifies request
          complexity and picks the right model tier automatically.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-2xl">
          {([
            { mode: "local" as const, label: "Local Only", cost: "Free", desc: "Ollama / HF models only" },
            { mode: "economy" as const, label: "Economy", cost: "$", desc: "Haiku / GPT-4o Mini first" },
            { mode: "balanced" as const, label: "Balanced", cost: "$$", desc: "Route by complexity" },
            { mode: "max" as const, label: "Max Quality", cost: "$$$", desc: "Always strongest model" },
          ] as const).map((m) => {
            const isActive = routerCostMode === m.mode;
            return (
              <button
                key={m.mode}
                type="button"
                className={`text-left p-3 rounded-lg border cursor-pointer transition-colors ${
                  isActive
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50"
                }`}
                onClick={() => setCostMode(m.mode)}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[12px] font-semibold text-foreground">{m.label}</span>
                  <span className="text-[10px] text-muted-foreground font-mono">{m.cost}</span>
                </div>
                <div className="text-[10px] text-muted-foreground">{m.desc}</div>
              </button>
            );
          })}
        </div>
        {(routerCostMode === "economy" || routerCostMode === "balanced") && (
          <label className="flex items-center gap-2 mt-4 cursor-pointer">
            <input
              type="checkbox"
              checked={routerEscalation}
              onChange={(e) => setEscalation(e.target.checked)}
              className="rounded border-input"
            />
            <span className="text-[12px] text-foreground">Enable escalation</span>
            <span className="text-[10px] text-muted-foreground">(auto-upgrade to stronger model when response quality is low)</span>
          </label>
        )}
      </Card>

      {/* Provider API Keys */}
      <Card className="p-6 gap-0">
        <SectionHeading>Provider API Keys</SectionHeading>
        <p className="text-[12px] text-muted-foreground mb-4">
          The router can use multiple providers. Enter API keys for each provider you want available.
        </p>
        <div className="space-y-2 max-w-lg">
          {[
            { id: "anthropic", label: "Anthropic", needsKey: true },
            { id: "openai", label: "OpenAI", needsKey: true },
            { id: "ollama", label: "Ollama", needsKey: false },
          ].map((p) => {
            const providersCred = (config.providers ?? {}) as Record<string, { apiKey?: string; balanceAlertThreshold?: number }>;
            const rawKey = providersCred[p.id]?.apiKey;
            const hasKey = !!rawKey && rawKey !== "••••••••";
            const isRedacted = rawKey === "••••••••";
            const threshold = providersCred[p.id]?.balanceAlertThreshold;
            return (
              <div key={p.id} className="flex items-center gap-3 py-1.5">
                <div className="w-20 text-[12px] text-foreground">{p.label}</div>
                {p.needsKey ? (
                  <>
                    <input
                      type="password"
                      placeholder={isRedacted || hasKey ? "Key is set — enter new to replace" : "Enter API key"}
                      className="flex-1 h-8 rounded-md border border-input bg-transparent px-2 py-0.5 text-[12px] font-mono"
                      value=""
                      onChange={(e) => setProviderKey(p.id, e.target.value)}
                    />
                    <span className={`text-[12px] ${isRedacted || hasKey ? "text-green-500" : "text-muted-foreground"}`}>
                      {isRedacted || hasKey ? "✓ Set" : "—"}
                    </span>
                    <input
                      type="number"
                      placeholder="Alert $"
                      step="1"
                      min="0"
                      title="Alert when monthly spend reaches this USD amount"
                      className="w-24 h-8 rounded-md border border-input bg-transparent px-2 py-0.5 text-[12px] font-mono"
                      value={threshold ?? ""}
                      onChange={(e) => setProviderThreshold(p.id, e.target.value ? Number(e.target.value) : undefined)}
                    />
                  </>
                ) : (
                  <span className="text-[10px] text-muted-foreground italic">No key needed</span>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {/* Default Provider & Model */}
      <Card className="p-6 gap-0">
        <SectionHeading>Default Provider & Model</SectionHeading>
        <p className="text-[12px] text-muted-foreground mb-4">
          Preferred provider within your cost mode. The router uses this when multiple providers are eligible.
          Workers inherit this by default unless overridden below.
        </p>
        <div className="grid grid-cols-2 gap-4 max-w-lg">
          <FieldGroup label="Active Provider">
            <select
              className="w-full h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm font-mono cursor-pointer"
              value={agentProvider}
              onChange={(e) => setAionProvider(e.target.value)}
            >
              {allProviders.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </FieldGroup>
          <FieldGroup label="Model">
            <select
              className="w-full h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm font-mono cursor-pointer"
              value={agentModel}
              onChange={(e) => setAionModel(e.target.value)}
            >
              {(allModels[agentProvider] ?? allModels[`hf-local:${agentModel}`] ?? []).map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </FieldGroup>
        </div>
      </Card>

      {/* HF Local Models */}
      <Card className="p-6 gap-0">
        <SectionHeading>HuggingFace Local Models</SectionHeading>
        <p className="text-[12px] text-muted-foreground mb-4">
          Downloaded text-generation models running locally can be used as Aion's provider.
          Start a model from the HF Models page, then select it above.
        </p>
        {hfProviders.length > 0 ? (
          <div className="space-y-2">
            {hfProviders.map((hf) => (
              <div key={hf.id} className="flex items-center justify-between py-2 border-b border-border last:border-b-0">
                <div>
                  <div className="text-[12px] text-foreground">{hf.name}</div>
                  <div className="text-[10px] text-muted-foreground font-mono">{hf.baseUrl}</div>
                </div>
                <button
                  className="text-[11px] px-3 py-1 rounded-md border border-input bg-transparent hover:bg-accent cursor-pointer"
                  onClick={() => setAionProvider(`hf-local:${hf.id}`)}
                >
                  Use as Provider
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-[12px] text-muted-foreground italic">
            No text-generation models running. Download and start a model from the HF Models page to use it as a provider.
          </div>
        )}
      </Card>

      {/* Worker Overrides */}
      <Card className="p-6 gap-0">
        <SectionHeading>Worker Provider Overrides</SectionHeading>
        <p className="text-[12px] text-muted-foreground mb-4">
          Override the LLM provider and model for specific TaskMaster workers.
          "Inherited" uses Aion's provider and model. Workers that need cheaper/faster
          models can use a different provider or model.
        </p>
        {workerError && (
          <div className="text-[12px] text-red mb-3">{workerError}</div>
        )}
        {workers.length === 0 && !workerError && (
          <div className="text-[12px] text-muted-foreground italic">No workers discovered. Workers load from prompts/workers/ on boot.</div>
        )}

          <div className="space-y-4">
            {[...domains.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([domain, domainWorkers]) => (
              <div key={domain}>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  {domain}
                </div>
                <div className="space-y-1">
                  {domainWorkers.sort((a, b) => a.role.localeCompare(b.role)).map((w) => {
                    const key = `${w.domain}.${w.role}`;
                    const override = modelOverrides[key];
                    const currentProvider = override?.provider ?? "inherited";

                    const currentModel = override?.model ?? "";
                    const workerProviderModels = currentProvider !== "inherited" ? (allModels[currentProvider] ?? []) : [];

                    return (
                      <div key={w.id} className="flex items-center gap-4 py-1.5 border-b border-border last:border-b-0">
                        <div className="flex-1 min-w-0">
                          <div className="text-[12px] text-foreground">{w.title}</div>
                          <div className="text-[10px] text-muted-foreground font-mono">{key}</div>
                        </div>
                        <select
                          className="h-8 rounded-md border border-input bg-transparent px-2 py-0.5 text-[12px] font-mono cursor-pointer min-w-[150px]"
                          value={currentProvider}
                          onChange={(e) => setWorkerOverride(key, "provider", e.target.value)}
                        >
                          <option value="inherited">Inherited ({agentProvider})</option>
                          {allProviders.map((p) => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                        {currentProvider !== "inherited" && workerProviderModels.length > 0 && (
                          <select
                            className="h-8 rounded-md border border-input bg-transparent px-2 py-0.5 text-[12px] font-mono cursor-pointer min-w-[150px]"
                            value={currentModel}
                            onChange={(e) => setWorkerOverride(key, "model", e.target.value)}
                          >
                            {workerProviderModels.map((m) => (
                              <option key={m.id} value={m.id}>{m.name}</option>
                            ))}
                          </select>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </Card>
    </div>
  );
}
