/**
 * ProvidersSettings — Gateway Settings > Providers tab.
 *
 * Layout (top → bottom):
 *   1. Default Provider & Model — most common action
 *   2. Routing Mode — cost mode selector
 *   3. Providers — collapsible accordion rows with status dots
 *   4. Worker Provider Overrides — per-worker model overrides
 */

import { useCallback, useEffect, useState } from "react";
import { Accordion, Chart } from "@particle-academy/react-fancy";
import { Card } from "@/components/ui/card";
import { SectionHeading, FieldGroup } from "./SettingsShared.js";
import { fetchHfProviders, fetchRegisteredProviders, fetchProviderBalances, fetchBalanceHistory } from "../../api.js";
import type { HfProviderOption, RegisteredProvider } from "../../api.js";
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
  ollama: [],
};

// --- Status dot component ---

interface StatusDotProps {
  requiresApiKey: boolean;
  hasApiKey: boolean;
  balance: number | null | undefined;
  threshold: number;
  isLocal?: boolean;
}

function StatusDot({ requiresApiKey, hasApiKey, balance, threshold, isLocal }: StatusDotProps) {
  let color = "bg-muted-foreground";
  let title = "Not configured";

  if (isLocal) {
    color = "bg-green-500";
    title = "Running locally";
  } else if (requiresApiKey && !hasApiKey) {
    color = "bg-muted-foreground";
    title = "No API key";
  } else if (balance !== null && balance !== undefined && balance < threshold) {
    color = "bg-red-500";
    title = `Low balance ($${balance.toFixed(2)})`;
  } else if (balance !== null && balance !== undefined) {
    color = "bg-green-500";
    title = "Active";
  } else if (hasApiKey) {
    color = "bg-yellow-500";
    title = "Key set, no balance data";
  }

  return (
    <span
      data-testid="provider-status-dot"
      className={`inline-block w-2 h-2 rounded-full shrink-0 ${color}`}
      title={title}
    />
  );
}

// --- Main component ---

interface Props {
  config: AionimaConfig;
  update: (fn: (prev: AionimaConfig) => AionimaConfig) => void;
}

export function ProvidersSettings({ config, update }: Props) {
  const [workers, setWorkers] = useState<WorkerEntry[]>([]);
  const [hfProviders, setHfProviders] = useState<HfProviderOption[]>([]);
  const [registeredProviders, setRegisteredProviders] = useState<RegisteredProvider[]>([]);
  const [workerError, setWorkerError] = useState<string | null>(null);
  const [balanceHistories, setBalanceHistories] = useState<Record<string, number[]>>({});
  const [currentBalances, setCurrentBalances] = useState<Record<string, number | null>>({});

  const agentProvider = (config.agent as Record<string, unknown> | undefined)?.provider as string ?? "anthropic";
  const agentModel = (config.agent as Record<string, unknown> | undefined)?.model as string ?? "claude-sonnet-4-6";
  const modelOverrides = ((config.workers as Record<string, unknown> | undefined)?.modelOverrides ?? {}) as Record<string, { provider?: string; model?: string }>;

  const routerCostMode = ((config.agent as Record<string, unknown> | undefined)?.router as Record<string, unknown> | undefined)?.costMode as string ?? "balanced";
  const routerEscalation = ((config.agent as Record<string, unknown> | undefined)?.router as Record<string, unknown> | undefined)?.escalation as boolean ?? false;

  // --- Data fetching ---

  useEffect(() => {
    fetchHfProviders().then(setHfProviders).catch(() => {});
    const interval = setInterval(() => {
      fetchHfProviders().then(setHfProviders).catch(() => {});
    }, 30_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    fetchRegisteredProviders().then(setRegisteredProviders).catch(() => {});
  }, []);

  useEffect(() => {
    fetchProviderBalances().then(balances => {
      const current: Record<string, number | null> = {};
      for (const b of balances) current[b.providerId] = b.balance;
      setCurrentBalances(current);

      Promise.all(
        balances.filter(b => b.balance !== null).map(async b => {
          const history = await fetchBalanceHistory(b.providerId);
          return { id: b.providerId, data: history.map(h => h.balance) };
        })
      ).then(results => {
        const histories: Record<string, number[]> = {};
        for (const r of results) histories[r.id] = r.data;
        setBalanceHistories(histories);
      }).catch(() => {});
    }).catch(() => {});
  }, []);

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

  // --- Combined provider lists ---

  // Separate Ollama models from HF-local container models
  const ollamaProviders = hfProviders.filter((p) => p.id.startsWith("ollama:"));
  const hfLocalProviders = hfProviders.filter((p) => !p.id.startsWith("ollama:"));

  const allProviders: ProviderOption[] = [
    ...BUILTIN_PROVIDERS,
    ...hfLocalProviders.map((hf) => ({ id: `hf-local:${hf.id}`, name: hf.name })),
  ];

  const allModels: Record<string, { id: string; name: string }[]> = { ...MODELS_BY_PROVIDER };
  // Populate Ollama models dynamically
  if (ollamaProviders.length > 0) {
    allModels.ollama = ollamaProviders.map((p) => ({
      id: p.id.replace("ollama:", ""),
      name: p.name,
    }));
  }
  for (const hf of hfLocalProviders) {
    allModels[`hf-local:${hf.id}`] = [{ id: hf.id, name: hf.name }];
  }

  // Merge HF + Ollama models into the accordion provider list
  const allRegistered: RegisteredProvider[] = [
    ...registeredProviders,
    ...ollamaProviders.map((p): RegisteredProvider => ({
      id: p.id,
      name: p.name,
      fields: [],
      requiresApiKey: false,
      currentValues: { _isLocal: true, _isOllama: true, _baseUrl: p.baseUrl },
    })),
    ...hfLocalProviders.map((hf): RegisteredProvider => ({
      id: `hf-local:${hf.id}`,
      name: hf.name,
      fields: [],
      requiresApiKey: false,
      currentValues: { _isLocal: true, _baseUrl: hf.baseUrl },
    })),
  ];

  // Quick-switch: current provider's models
  const currentModels = allModels[agentProvider] ?? allModels[`hf-local:${agentModel}`] ?? [];

  // --- Updaters ---

  const setAionProvider = useCallback((providerKey: string) => {
    if (providerKey.startsWith("hf-local:")) {
      const modelId = providerKey.slice("hf-local:".length);
      const hf = hfProviders.find((h) => h.id === modelId);
      update((prev) => ({
        ...prev,
        agent: {
          ...(prev.agent ?? {}),
          provider: "hf-local",
          model: modelId,
          baseUrl: hf?.baseUrl ?? "http://127.0.0.1:6000",
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

  const updateProviderField = useCallback((providerId: string, fieldId: string, value: unknown) => {
    update((prev) => ({
      ...prev,
      providers: {
        ...((prev.providers ?? {}) as Record<string, unknown>),
        [providerId]: {
          ...(((prev.providers ?? {}) as Record<string, Record<string, unknown>>)[providerId] ?? {}),
          [fieldId]: value,
        },
      },
    }));
  }, [update]);

  const setWorkerOverride = useCallback((workerKey: string, field: "provider" | "model", value: string) => {
    update((prev) => {
      const prevWorkers = (prev.workers ?? {}) as Record<string, unknown>;
      const prevOverrides = (prevWorkers.modelOverrides ?? {}) as Record<string, Record<string, unknown>>;

      if (field === "provider" && value === "inherited") {
        const { [workerKey]: _, ...rest } = prevOverrides;
        return { ...prev, workers: { ...prevWorkers, modelOverrides: rest } };
      }

      const existing = prevOverrides[workerKey] ?? {};
      const updated = { ...existing, [field]: value };
      if (field === "provider") {
        const models = MODELS_BY_PROVIDER[value];
        updated.model = models?.[0]?.id ?? "claude-sonnet-4-6";
      }

      return {
        ...prev,
        workers: { ...prevWorkers, modelOverrides: { ...prevOverrides, [workerKey]: updated } },
      };
    });
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
      {/* 1. Default Provider & Model — topmost card */}
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
              {currentModels.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </FieldGroup>
        </div>
        {currentModels.length > 0 && (
          <div className="flex gap-2 mt-2 flex-wrap" data-testid="model-quick-switch">
            {currentModels.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`text-[11px] px-2 py-1 rounded border cursor-pointer transition-colors ${
                  m.id === agentModel
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border text-muted-foreground hover:border-primary/50"
                }`}
                onClick={() => setAionModel(m.id)}
              >
                {m.name}
              </button>
            ))}
          </div>
        )}
      </Card>

      {/* 2. Routing Mode */}
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

      {/* 3. Providers — collapsible accordion rows */}
      <Card className="p-6 gap-0">
        <SectionHeading>Providers</SectionHeading>
        <p className="text-[12px] text-muted-foreground mb-4">
          Configure API credentials and settings for each provider. Expand a row to see fields and balance.
        </p>
        {allRegistered.length === 0 ? (
          <div className="text-[12px] text-muted-foreground italic">No providers registered. Install a provider plugin.</div>
        ) : (
          <div data-testid="provider-accordion">
          <Accordion type="multiple" defaultOpen={[]} className="max-w-xl">
            {allRegistered.map((provider) => {
              const isLocal = !!provider.currentValues?._isLocal;
              const hasApiKey = !!provider.currentValues?.apiKey;
              const balance = currentBalances[provider.id] ?? null;
              const threshold = (provider.currentValues?.balanceAlertThreshold as number | undefined) ?? 0;

              return (
                <div key={provider.id} data-testid={`provider-row-${provider.id}`}>
                <Accordion.Item
                  value={provider.id}
                  className="border-b border-border last:border-b-0"
                >
                  <Accordion.Trigger className="flex items-center gap-3 py-3 w-full text-left">
                    <StatusDot
                      requiresApiKey={provider.requiresApiKey}
                      hasApiKey={hasApiKey}
                      balance={balance}
                      threshold={threshold}
                      isLocal={isLocal}
                    />
                    <span className="text-[12px] font-semibold text-foreground flex-1">{provider.name}</span>
                    {balance !== null && balance !== undefined && (
                      <span className="text-[11px] font-mono text-muted-foreground mr-2">
                        ${balance.toFixed(2)}
                      </span>
                    )}
                    {isLocal && (
                      <span className="text-[10px] text-green-500 font-mono mr-2">local</span>
                    )}
                  </Accordion.Trigger>
                  <Accordion.Content className="pb-4 pl-5">
                    {/* Config fields */}
                    {provider.fields.length > 0 && (
                      <div className="flex flex-wrap gap-2 items-center mb-2">
                        {provider.fields.map((field) => {
                          const currentVal = provider.currentValues[field.id];
                          const isRedacted = currentVal === "••••••••";

                          if (field.type === "password") {
                            return (
                              <input key={field.id}
                                type="password"
                                placeholder={isRedacted ? "Key is set — enter new to replace" : (field.placeholder ?? field.label)}
                                className="flex-1 min-w-[200px] h-8 rounded-md border border-input bg-transparent px-2 py-0.5 text-[12px] font-mono"
                                value=""
                                onChange={(e) => { if (e.target.value) updateProviderField(provider.id, field.id, e.target.value); }}
                              />
                            );
                          }
                          if (field.type === "number") {
                            return (
                              <input key={field.id}
                                type="number"
                                placeholder={field.placeholder ?? field.label}
                                min={field.min}
                                max={field.max}
                                step={field.step}
                                title={field.description ?? field.label}
                                className="w-28 h-8 rounded-md border border-input bg-transparent px-2 py-0.5 text-[12px] font-mono"
                                value={(currentVal as number | undefined) ?? ""}
                                onChange={(e) => updateProviderField(provider.id, field.id, e.target.value ? Number(e.target.value) : undefined)}
                              />
                            );
                          }
                          if (field.type === "text") {
                            return (
                              <input key={field.id}
                                type="text"
                                placeholder={field.placeholder ?? field.label}
                                className="flex-1 min-w-[200px] h-8 rounded-md border border-input bg-transparent px-2 py-0.5 text-[12px] font-mono"
                                value={(currentVal as string | undefined) ?? ""}
                                onChange={(e) => updateProviderField(provider.id, field.id, e.target.value || undefined)}
                              />
                            );
                          }
                          return null;
                        })}
                        {provider.requiresApiKey && (
                          <span className={`text-[12px] ${hasApiKey ? "text-green-500" : "text-muted-foreground"}`}>
                            {hasApiKey ? "✓ Set" : "—"}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Balance sparkline */}
                    {balance !== null && balance !== undefined && (
                      <div className="flex items-center gap-2 mt-1">
                        {(balanceHistories[provider.id]?.length ?? 0) > 1 && (
                          <Chart.Sparkline
                            data={balanceHistories[provider.id]!}
                            width={80}
                            height={20}
                            color={balance < threshold ? "var(--color-red)" : "var(--color-green)"}
                          />
                        )}
                        <span className="text-[11px] font-mono text-muted-foreground">
                          ${balance.toFixed(2)} remaining
                        </span>
                      </div>
                    )}

                    {/* HF local: "Use as Provider" button */}
                    {isLocal && (
                      <button
                        className="mt-2 text-[11px] px-3 py-1 rounded-md border border-input bg-transparent hover:bg-accent cursor-pointer"
                        onClick={() => setAionProvider(`hf-local:${provider.id.replace("hf-local:", "")}`)}
                      >
                        Use as Provider
                      </button>
                    )}

                    {/* No fields and not local */}
                    {provider.fields.length === 0 && !isLocal && (
                      <div className="text-[11px] text-muted-foreground italic">No configuration required.</div>
                    )}
                  </Accordion.Content>
                </Accordion.Item>
                </div>
              );
            })}
          </Accordion>
          </div>
        )}
      </Card>

      {/* 4. Worker Provider Overrides */}
      <Card className="p-6 gap-0">
        <SectionHeading>Worker Provider Overrides</SectionHeading>
        <p className="text-[12px] text-muted-foreground mb-4">
          Override the LLM provider and model for specific TaskMaster workers.
          "Inherited" uses Aion's provider and model.
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
