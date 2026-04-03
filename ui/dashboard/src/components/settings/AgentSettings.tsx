/**
 * AgentSettings — Provider, model, reply mode.
 */

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
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
          <select
            className="w-full h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm font-mono cursor-pointer"
            value={agentProvider}
            onChange={(e) => {
              const next = e.target.value as Provider;
              update((prev) => ({
                ...prev,
                agent: { ...(prev.agent ?? {}), provider: next, model: "" },
              }));
            }}
          >
            <option value="anthropic">Anthropic</option>
            <option value="openai">OpenAI</option>
            <option value="ollama">Ollama</option>
          </select>
        </FieldGroup>
        <FieldGroup label="Model">
          {agentModelsLoading ? (
            <div className="h-9 flex items-center text-sm text-muted-foreground font-mono">Loading models...</div>
          ) : agentModelsError ? (
            <div className="h-9 flex items-center text-sm text-red font-mono">{agentModelsError}</div>
          ) : agentModels.length > 0 ? (
            <select
              className="w-full h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm font-mono cursor-pointer"
              value={(config.agent as Record<string, unknown> | undefined)?.["model"] as string ?? ""}
              onChange={(e) => update((prev) => ({
                ...prev,
                agent: { ...(prev.agent ?? {}), model: e.target.value },
              }))}
            >
              {agentModels.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          ) : (
            <div className="h-9 flex items-center text-sm text-muted-foreground font-mono">No models available</div>
          )}
        </FieldGroup>
        <FieldGroup label="Reply Mode">
          <select
            className="w-full h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm font-mono cursor-pointer"
            value={(config.agent as Record<string, unknown> | undefined)?.["replyMode"] as string ?? "autonomous"}
            onChange={(e) => update((prev) => ({
              ...prev,
              agent: { ...(prev.agent ?? {}), replyMode: e.target.value },
            }))}
          >
            <option value="autonomous">Autonomous</option>
            <option value="human-in-loop">Human-in-Loop</option>
          </select>
        </FieldGroup>
      </div>
    </Card>
  );
}
