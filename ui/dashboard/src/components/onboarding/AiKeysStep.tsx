/**
 * AiKeysStep — Provider selection, credential entry, and model picker.
 *
 * Three inline phases within one step:
 *   1. Provider cards (Anthropic, OpenAI, Ollama)
 *   2. Credential entry per selected provider
 *   3. Primary provider + model selection
 */

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils.js";
import { Button } from "@/components/ui/button.js";
import { Card } from "@/components/ui/card.js";
import { Input as FancyInput, Select as FancySelect, Callout } from "@particle-academy/react-fancy";
import { fetchModels, type ModelEntry } from "../../api.js";
import type { OnboardingStepStatus } from "@/types.js";
import { Sparkles, BrainCircuit, Server } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ProviderKey = "anthropic" | "openai" | "ollama";

interface ProviderDef {
  key: ProviderKey;
  label: string;
  description: string;
  icon: typeof Sparkles;
  isLocal?: boolean;
}

interface ProviderState {
  selected: boolean;
  credential: string; // API key or base URL for Ollama
  valid: boolean | null; // null = not tested
  testing: boolean;
  message: string;
}

interface Props {
  onNext: () => void;
  status?: OnboardingStepStatus;
}

// ---------------------------------------------------------------------------
// Provider definitions
// ---------------------------------------------------------------------------

const PROVIDERS: ProviderDef[] = [
  { key: "anthropic", label: "Anthropic", description: "Claude models — advanced reasoning", icon: Sparkles },
  { key: "openai", label: "OpenAI", description: "GPT models — versatile generation", icon: BrainCircuit },
  { key: "ollama", label: "Ollama", description: "Run models locally", icon: Server, isLocal: true },
];

function makeDefaultState(): Record<ProviderKey, ProviderState> {
  return {
    anthropic: { selected: false, credential: "", valid: null, testing: false, message: "" },
    openai: { selected: false, credential: "", valid: null, testing: false, message: "" },
    ollama: { selected: false, credential: "http://localhost:11434", valid: null, testing: false, message: "" },
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AiKeysStep({ onNext, status }: Props) {
  const [providers, setProviders] = useState(makeDefaultState);
  const [primaryProvider, setPrimaryProvider] = useState<ProviderKey | null>(null);
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [selectedModel, setSelectedModel] = useState("");
  const [saving, setSaving] = useState(false);

  const isCompleted = status === "completed";
  const validProviders = PROVIDERS.filter((p) => providers[p.key].valid === true);
  const hasAnyValid = validProviders.length > 0;

  // Auto-set primary provider when first provider validates
  useEffect(() => {
    if (primaryProvider && providers[primaryProvider].valid === true) return;
    const first = validProviders[0];
    if (first) setPrimaryProvider(first.key);
  }, [validProviders, primaryProvider, providers]);

  // Fetch models when primary provider changes
  useEffect(() => {
    if (!primaryProvider) { setModels([]); return; }
    let cancelled = false;
    setModelsLoading(true);
    setSelectedModel("");
    fetchModels(primaryProvider)
      .then((m) => { if (!cancelled) { setModels(m); if (m.length > 0) setSelectedModel(m[0]!.id); } })
      .catch(() => { if (!cancelled) setModels([]); })
      .finally(() => { if (!cancelled) setModelsLoading(false); });
    return () => { cancelled = true; };
  }, [primaryProvider]);

  const toggleProvider = (key: ProviderKey) => {
    setProviders((prev) => ({
      ...prev,
      [key]: { ...prev[key], selected: !prev[key].selected },
    }));
  };

  const setCredential = (key: ProviderKey, value: string) => {
    setProviders((prev) => ({
      ...prev,
      [key]: { ...prev[key], credential: value, valid: null, message: "" },
    }));
  };

  const testProvider = async (key: ProviderKey) => {
    setProviders((prev) => ({ ...prev, [key]: { ...prev[key], testing: true, valid: null, message: "" } }));
    try {
      // Step 1: Validate the key/connection
      const payload: Record<string, unknown> = {};
      if (key === "anthropic") payload.anthropic = providers[key].credential;
      else if (key === "openai") payload.openai = providers[key].credential;
      else payload.ollama = { baseUrl: providers[key].credential || undefined };

      const res = await fetch("/api/onboarding/ai-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { validated: Record<string, boolean> };
      const ok = data.validated[key] === true;

      // Step 2: If valid, persist immediately so /api/models can reach the provider
      if (ok) {
        const savePayload: Record<string, unknown> = { saveOnly: true };
        if (key === "anthropic") savePayload.anthropic = providers[key].credential;
        else if (key === "openai") savePayload.openai = providers[key].credential;
        else savePayload.ollama = { baseUrl: providers[key].credential || undefined };

        await fetch("/api/onboarding/ai-keys", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(savePayload),
        });
      }

      setProviders((prev) => ({
        ...prev,
        [key]: { ...prev[key], valid: ok, testing: false, message: ok ? "Connected" : "Validation failed" },
      }));
    } catch {
      setProviders((prev) => ({
        ...prev,
        [key]: { ...prev[key], valid: false, testing: false, message: "Connection error" },
      }));
    }
  };

  const handleContinue = async () => {
    if (isCompleted && !hasAnyValid) { onNext(); return; }

    setSaving(true);
    try {
      const payload: Record<string, unknown> = { saveOnly: true };
      if (providers.anthropic.valid) payload.anthropic = providers.anthropic.credential;
      if (providers.openai.valid) payload.openai = providers.openai.credential;
      if (providers.ollama.valid) payload.ollama = { baseUrl: providers.ollama.credential };
      if (primaryProvider) payload.agentProvider = primaryProvider;
      if (selectedModel) payload.agentModel = selectedModel;

      await fetch("/api/onboarding/ai-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      onNext();
    } catch {
      onNext();
    } finally {
      setSaving(false);
    }
  };

  const canContinue = isCompleted || hasAnyValid;
  const selectedProviders = PROVIDERS.filter((p) => providers[p.key].selected);

  return (
    <div className="flex flex-col gap-5 sm:gap-6">
      {/* Header */}
      <div className="onboard-animate-in">
        <h2 className="text-xl sm:text-2xl font-semibold mb-1">Awaken the oracle</h2>
        <p className="text-[13px] sm:text-sm text-muted-foreground leading-relaxed">
          Choose your AI providers. Aionima needs at least one to think, create, and act on your behalf.
        </p>
      </div>

      {isCompleted && (
        <Callout color="green" className="text-sm text-muted-foreground onboard-animate-in">
          AI providers already configured. Continue to keep existing config, or reconfigure below.
        </Callout>
      )}

      {/* Phase 1: Provider cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 onboard-animate-in onboard-stagger-1">
        {PROVIDERS.map((p) => {
          const state = providers[p.key];
          const Icon = p.icon;
          return (
            <Card
              key={p.key}
              onClick={() => toggleProvider(p.key)}
              className={cn(
                "relative p-4 cursor-pointer transition-all hover:border-primary/50",
                state.selected
                  ? "border-primary bg-primary/5"
                  : "border-border",
              )}
            >
              <div className="flex items-start gap-3">
                <Icon className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{p.label}</span>
                    {p.isLocal && (
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-blue/10 text-blue border border-blue/30">
                        Local
                      </span>
                    )}
                  </div>
                  <p className="text-[12px] text-muted-foreground mt-0.5">{p.description}</p>
                </div>
              </div>
              {state.valid === true && (
                <span className="absolute top-2 right-2 text-[10px] font-medium px-1.5 py-0.5 rounded bg-green/10 text-green border border-green/30">
                  Valid
                </span>
              )}
              {state.valid === false && (
                <span className="absolute top-2 right-2 text-[10px] font-medium px-1.5 py-0.5 rounded bg-destructive/10 text-destructive border border-destructive/30">
                  Invalid
                </span>
              )}
            </Card>
          );
        })}
      </div>

      {/* Phase 2: Credential entry for selected providers */}
      {selectedProviders.length > 0 && (
        <div className="flex flex-col gap-4 onboard-animate-in onboard-stagger-2">
          {selectedProviders.map((p) => {
            const state = providers[p.key];
            const isOllama = p.key === "ollama";
            return (
              <div key={p.key} className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{p.label}</span>
                  {state.valid === true && (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-green/10 text-green border border-green/30">
                      Valid
                    </span>
                  )}
                  {state.valid === false && (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-destructive/10 text-destructive border border-destructive/30">
                      Invalid
                    </span>
                  )}
                </div>
                <div className="flex gap-2">
                  <FancyInput
                    className="font-mono flex-1"
                    type={isOllama ? "text" : "password"}
                    placeholder={isOllama ? "http://localhost:11434" : `sk-${p.key === "anthropic" ? "ant-..." : "..."}`}
                    value={state.credential}
                    onValueChange={(v) => setCredential(p.key, v)}
                  />
                  <Button
                    variant="outline"
                    onClick={() => void testProvider(p.key)}
                    disabled={state.testing || (!isOllama && !state.credential)}
                  >
                    {state.testing ? "Testing..." : "Test"}
                  </Button>
                </div>
                {state.valid === false && state.message && (
                  <p className="text-xs text-destructive">{state.message}</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Phase 3: Primary provider + model selection */}
      {hasAnyValid && (
        <div className="flex flex-col gap-4 onboard-animate-in">
          {validProviders.length > 1 && (
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">Primary Provider</span>
              <div className="flex gap-2">
                {validProviders.map((p) => (
                  <button
                    key={p.key}
                    onClick={() => setPrimaryProvider(p.key)}
                    className={cn(
                      "px-3 py-1.5 rounded-md text-sm transition-colors cursor-pointer",
                      primaryProvider === p.key
                        ? "bg-primary text-primary-foreground font-medium"
                        : "bg-secondary text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Model</span>
            {modelsLoading ? (
              <div className="h-9 flex items-center text-sm text-muted-foreground font-mono">Loading models...</div>
            ) : models.length > 0 ? (
              <FancySelect
                className="font-mono"
                list={models.map((m) => ({ value: m.id, label: m.name }))}
                placeholder="Select a model..."
                value={selectedModel}
                onValueChange={setSelectedModel}
              />
            ) : (
              <div className="h-9 flex items-center text-sm text-muted-foreground font-mono">No models available</div>
            )}
          </div>
        </div>
      )}

      {/* Continue */}
      <div className="onboard-animate-in onboard-stagger-2">
        <Button
          onClick={() => void handleContinue()}
          disabled={saving || !canContinue}
          className="w-full sm:w-auto"
        >
          {saving ? "Saving..." : "Continue"}
        </Button>
      </div>
    </div>
  );
}
