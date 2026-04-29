/**
 * AgentSettings — Provider, model, reply mode.
 */

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { SectionHeading, FieldGroup } from "./SettingsShared.js";
import { fetchModels, type ModelEntry } from "../../api.js";
import type { AionimaConfig } from "../../types.js";

type Provider = "anthropic" | "openai" | "ollama";

interface Props {
  config: AionimaConfig;
  update: (fn: (prev: AionimaConfig) => AionimaConfig) => void;
}

export function AgentSettings({ config, update }: Props) {
  const [agentModels, setAgentModels] = useState<ModelEntry[]>([]);
  const [agentModelsLoading, setAgentModelsLoading] = useState(false);
  const [agentModelsError, setAgentModelsError] = useState<string | null>(null);

  const agentProvider = ((config.agent as Record<string, unknown> | undefined)?.["provider"] as Provider) ?? "anthropic";

  useEffect(() => {
    let cancelled = false;
    setAgentModelsLoading(true);
    setAgentModelsError(null);
    fetchModels(agentProvider)
      .then((models) => {
        if (cancelled) return;
        setAgentModels(models);
      })
      .catch((err) => {
        if (cancelled) return;
        setAgentModels([]);
        setAgentModelsError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setAgentModelsLoading(false);
      });
    return () => { cancelled = true; };
  }, [agentProvider]);

  return (
    <Card className="p-6 gap-0 mb-4">
      <SectionHeading>Agent</SectionHeading>
      <div className="grid grid-cols-3 gap-4">
        <FieldGroup label="Provider">
          <Select
            className="font-mono"
            list={[
              { value: "anthropic", label: "Anthropic" },
              { value: "openai", label: "OpenAI" },
              { value: "ollama", label: "Ollama" },
            ]}
            value={agentProvider}
            onValueChange={(v) => {
              update((prev) => ({
                ...prev,
                agent: { ...prev.agent, provider: v as Provider, model: "" },
              }));
            }}
          />
        </FieldGroup>
        <FieldGroup label="Model">
          {agentModelsLoading ? (
            <div className="h-9 flex items-center text-sm text-muted-foreground font-mono">Loading models...</div>
          ) : agentModelsError ? (
            <div className="h-9 flex items-center text-sm text-red font-mono">{agentModelsError}</div>
          ) : agentModels.length > 0 ? (
            <Select
              className="font-mono"
              list={agentModels.map((m) => ({ value: m.id, label: m.name }))}
              value={(config.agent as Record<string, unknown> | undefined)?.["model"] as string ?? ""}
              onValueChange={(v) => update((prev) => ({
                ...prev,
                agent: { ...prev.agent, model: v },
              }))}
            />
          ) : (
            <div className="h-9 flex items-center text-sm text-muted-foreground font-mono">No models available</div>
          )}
        </FieldGroup>
        <FieldGroup label="Reply Mode">
          <Select
            className="font-mono"
            list={[
              { value: "autonomous", label: "Autonomous" },
              { value: "human-in-loop", label: "Human-in-Loop" },
            ]}
            value={(config.agent as Record<string, unknown> | undefined)?.["replyMode"] as string ?? "autonomous"}
            onValueChange={(v) => update((prev) => ({
              ...prev,
              agent: { ...prev.agent, replyMode: v },
            }))}
          />
        </FieldGroup>
      </div>
    </Card>
  );
}
