/**
 * ProvidersSettings — Gateway Settings > Providers tab.
 *
 * Section 1: Aion's active LLM provider (dropdown populated from catalog)
 * Section 2: Per-worker provider overrides (default: "Inherited" from Aion)
 */

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { SectionHeading, FieldGroup } from "./SettingsShared.js";
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
  { id: "claude-max", name: "Claude Max (subscription)" },
  { id: "openai", name: "OpenAI" },
  { id: "ollama", name: "Ollama (local)" },
];

const MODELS_BY_PROVIDER: Record<string, { id: string; name: string }[]> = {
  anthropic: [
    { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6 (balanced)" },
    { id: "claude-opus-4-6", name: "Claude Opus 4.6 (most capable)" },
    { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5 (fast)" },
  ],
  "claude-max": [
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

  const agentProvider = (config.agent as Record<string, unknown> | undefined)?.provider as string ?? "anthropic";
  const agentModel = (config.agent as Record<string, unknown> | undefined)?.model as string ?? "claude-sonnet-4-6";
  const modelOverrides = ((config.workers as Record<string, unknown> | undefined)?.modelOverrides ?? {}) as Record<string, { provider?: string; model?: string }>;

  useEffect(() => {
    fetch("/api/workers/catalog")
      .then((r) => r.json())
      .then((data) => setWorkers(data as WorkerEntry[]))
      .catch(() => {});
  }, []);

  const setAionProvider = useCallback((provider: string) => {
    // When switching provider, also set a sensible default model
    const models = MODELS_BY_PROVIDER[provider];
    const defaultModel = models?.[0]?.id ?? "claude-sonnet-4-6";
    update((prev) => ({
      ...prev,
      agent: { ...(prev.agent ?? {}), provider, model: defaultModel },
    }));
  }, [update]);

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

  // Group workers by domain
  const domains = new Map<string, WorkerEntry[]>();
  for (const w of workers) {
    const list = domains.get(w.domain) ?? [];
    list.push(w);
    domains.set(w.domain, list);
  }

  return (
    <div className="space-y-6">
      {/* Aion's Provider */}
      <Card className="p-6 gap-0">
        <SectionHeading>Aion's LLM Provider</SectionHeading>
        <p className="text-[12px] text-muted-foreground mb-4">
          The primary provider used for all chat conversations and agent tool calls.
          Workers inherit this by default unless overridden below.
        </p>
        <div className="grid grid-cols-2 gap-4 max-w-lg">
          <FieldGroup label="Active Provider">
            <select
              className="w-full h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm font-mono cursor-pointer"
              value={agentProvider}
              onChange={(e) => setAionProvider(e.target.value)}
            >
              {BUILTIN_PROVIDERS.map((p) => (
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
              {(MODELS_BY_PROVIDER[agentProvider] ?? []).map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </FieldGroup>
        </div>
      </Card>

      {/* Worker Overrides */}
      {workers.length > 0 && (
        <Card className="p-6 gap-0">
          <SectionHeading>Worker Provider Overrides</SectionHeading>
          <p className="text-[12px] text-muted-foreground mb-4">
            Override the LLM provider for specific TaskMaster workers.
            "Inherited" uses Aion's provider. Workers that need cheaper/faster
            models can use a different provider.
          </p>

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
                    const workerProviderModels = currentProvider !== "inherited" ? (MODELS_BY_PROVIDER[currentProvider] ?? []) : [];

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
                          {BUILTIN_PROVIDERS.map((p) => (
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
      )}
    </div>
  );
}
