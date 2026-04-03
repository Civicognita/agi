/**
 * AiProviderSettings — Anthropic / OpenAI / Ollama credentials.
 */

import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SectionHeading, FieldGroup } from "./SettingsShared.js";
import type { AionimaConfig, ProviderCredential } from "../../types.js";

interface Props {
  config: AionimaConfig;
  update: (fn: (prev: AionimaConfig) => AionimaConfig) => void;
}

export function AiProviderSettings({ config, update }: Props) {
  return (
    <Card className="p-6 gap-0 mb-4">
      <SectionHeading>AI Providers</SectionHeading>
      <p className="text-[13px] text-muted-foreground mb-4">
        LLM provider credentials used system-wide. Per-worker overrides take priority.
      </p>
      {(["anthropic", "openai", "ollama"] as const).map((providerName) => {
        const cred: ProviderCredential = config.providers?.[providerName] ?? {};
        const hasKey = !!cred.apiKey;
        const envHints: Record<string, string> = {
          anthropic: "ANTHROPIC_API_KEY",
          openai: "OPENAI_API_KEY",
          ollama: "",
        };
        const labels: Record<string, string> = {
          anthropic: "Anthropic",
          openai: "OpenAI",
          ollama: "Ollama",
        };
        const updateProvider = (field: keyof ProviderCredential, value: string) => {
          update((prev) => {
            const providers = { ...prev.providers };
            const existing = providers[providerName] ?? {};
            if (value) {
              providers[providerName] = { ...existing, [field]: value };
            } else {
              const { [field]: _, ...rest } = existing;
              if (Object.keys(rest).length > 0) {
                providers[providerName] = rest;
              } else {
                delete providers[providerName];
              }
            }
            return {
              ...prev,
              providers: Object.keys(providers).length > 0 ? providers : undefined,
            };
          });
        };
        return (
          <div key={providerName} className="mb-4 last:mb-0">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm font-medium">{labels[providerName]}</span>
              {providerName !== "ollama" && (
                <span
                  className={cn(
                    "text-[10px] font-medium px-1.5 py-0.5 rounded",
                    hasKey
                      ? "bg-green/10 text-green border border-green/30"
                      : "bg-surface1 text-muted-foreground",
                  )}
                  style={!hasKey ? { background: "var(--color-surface1)" } : undefined}
                >
                  {hasKey ? "Configured" : "Not set"}
                </span>
              )}
            </div>
            <div className={cn("grid gap-4", providerName === "ollama" ? "grid-cols-1" : "grid-cols-2")}>
              {providerName !== "ollama" && (
                <FieldGroup label="API Key">
                  <Input
                    className="font-mono"
                    type="password"
                    value={cred.apiKey ?? ""}
                    onChange={(e) => updateProvider("apiKey", e.target.value)}
                    placeholder={envHints[providerName] ? `Falls back to ${envHints[providerName]} env var` : ""}
                  />
                </FieldGroup>
              )}
              {(providerName === "ollama" || providerName === "openai") && (
                <FieldGroup label="Base URL">
                  <Input
                    className="font-mono"
                    value={cred.baseUrl ?? ""}
                    onChange={(e) => updateProvider("baseUrl", e.target.value)}
                    placeholder={providerName === "ollama" ? "http://localhost:11434" : "Optional"}
                  />
                </FieldGroup>
              )}
            </div>
          </div>
        );
      })}
    </Card>
  );
}
