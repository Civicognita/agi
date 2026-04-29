/**
 * PluginSettingsRenderer — renders plugin-provided settings sections
 * with an enable/disable toggle header.
 */

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Callout } from "@particle-academy/react-fancy";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SectionHeading, FieldGroup } from "./SettingsShared.js";
import { RuntimeManagerSection } from "./RuntimeManagerSection.js";
import { ServiceControlSection } from "./ServiceControlSection.js";
import { RustDeskConnectionSection } from "./RustDeskConnectionSection.js";
import { RustDeskLogsSection } from "./RustDeskLogsSection.js";
import { RustDeskPasswordSection } from "./RustDeskPasswordSection.js";
import { getNestedValue, setNestedValue } from "@/lib/settings-utils.js";
import { fetchPlugins, updatePluginEnabled, fetchModels } from "../../api.js";
import type { AionimaConfig, PluginSettingsSection, PluginInfo, UIField } from "../../types.js";

interface Props {
  pluginId?: string;
  sections: PluginSettingsSection[];
  config: AionimaConfig;
  update: (fn: (prev: AionimaConfig) => AionimaConfig) => void;
}

/** Map custom section IDs to components. */
const customSectionMap: Record<string, React.FC> = {
  "rustdesk-connection": RustDeskConnectionSection,
  "rustdesk-logs": RustDeskLogsSection,
  "rustdesk-password": RustDeskPasswordSection,
};

/** Live model dropdown that fetches available models from the provider API. */
function ModelSelectField({ field, value, onChange }: { field: UIField; value: string; onChange: (v: string) => void }) {
  const [models, setModels] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!field.provider) return;
    setLoading(true);
    setError(null);
    fetchModels(field.provider)
      .then((m) => setModels(m))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load models"))
      .finally(() => setLoading(false));
  }, [field.provider]);

  if (loading) {
    return <div className="h-9 flex items-center text-sm text-muted-foreground">Loading models...</div>;
  }

  if (error) {
    return (
      <div className="space-y-1">
        <div className="text-[11px] text-red">{error}</div>
        <Input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder ?? "Enter model ID manually"}
          className="font-mono"
        />
      </div>
    );
  }

  return (
    <Select
      className="font-mono"
      list={[
        { value: "", label: field.placeholder ?? "Select a model..." },
        ...models.map((m) => ({ value: m.id, label: m.name })),
      ]}
      value={value}
      onValueChange={onChange}
    />
  );
}

function PluginToggleHeader({ pluginId }: { pluginId: string }) {
  const [plugin, setPlugin] = useState<PluginInfo | null>(null);
  const [toggling, setToggling] = useState(false);
  const [restartNeeded, setRestartNeeded] = useState(false);

  useEffect(() => {
    fetchPlugins()
      .then((plugins) => {
        const match = plugins.find((p) => p.id === pluginId);
        if (match) setPlugin(match);
      })
      .catch(() => {});
  }, [pluginId]);

  const handleToggle = useCallback(async () => {
    if (!plugin) return;
    setToggling(true);
    try {
      const result = await updatePluginEnabled(plugin.id, !plugin.enabled);
      setPlugin((prev) => prev ? { ...prev, enabled: !prev.enabled } : prev);
      if (result.requiresRestart) setRestartNeeded(true);
    } catch { /* ignore */ }
    finally { setToggling(false); }
  }, [plugin]);

  if (!plugin) return null;

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className={cn("inline-block w-2.5 h-2.5 rounded-full", plugin.active ? "bg-green" : "bg-muted-foreground")} />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-foreground">{plugin.name}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface1 text-muted-foreground font-mono">
                v{plugin.version}
              </span>
            </div>
            {plugin.description && (
              <p className="text-[12px] text-muted-foreground mt-0.5">{plugin.description}</p>
            )}
          </div>
        </div>
        {!(plugin.bakedIn && !plugin.disableable) && (
          <button
            type="button"
            disabled={toggling}
            onClick={() => void handleToggle()}
            className={cn(
              "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-60",
              plugin.enabled ? "bg-green" : "bg-muted-foreground/30",
            )}
            role="switch"
            aria-checked={plugin.enabled}
          >
            <span
              className={cn(
                "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                plugin.enabled ? "translate-x-4" : "translate-x-0",
              )}
            />
          </button>
        )}
      </div>
      {restartNeeded && (
        <Callout color="amber" className="mt-2 text-[11px] text-yellow">
          Plugin changes require a gateway restart to take effect.
        </Callout>
      )}
    </Card>
  );
}

export function PluginSettingsRenderer({ pluginId, sections, config, update }: Props) {
  return (
    <>
      {pluginId && <PluginToggleHeader pluginId={pluginId} />}
      {sections.map((section) => (
        <Card key={section.id} className="p-5">
          <SectionHeading>{section.label}</SectionHeading>
          {section.description && (
            <p className="text-[12px] text-muted-foreground mb-4">{section.description}</p>
          )}
          {section.type === "runtime-manager" ? (
            <RuntimeManagerSection language={section.language} />
          ) : section.type === "service-control" ? (
            <ServiceControlSection serviceIds={section.serviceIds} />
          ) : section.type === "custom" ? (
            (() => {
              const CustomComponent = customSectionMap[section.id];
              return CustomComponent ? <CustomComponent /> : (
                <div className="text-sm text-muted-foreground">Unknown custom section: {section.id}</div>
              );
            })()
          ) : (
            <div className="grid grid-cols-2 gap-x-6">
              {section.fields.map((field) => (
                <FieldGroup key={field.id} label={field.label}>
                  {field.type === "toggle" ? (
                    <button
                      type="button"
                      onClick={() => {
                        const path = `${section.configPath}.${field.configKey ?? field.id}`;
                        const current = getNestedValue(config as unknown as Record<string, unknown>, path);
                        update((prev) => setNestedValue(prev, path, !current));
                      }}
                      className={cn(
                        "w-8 h-5 rounded-full transition-colors relative",
                        getNestedValue(config as unknown as Record<string, unknown>, `${section.configPath}.${field.configKey ?? field.id}`)
                          ? "bg-green" : "bg-surface1",
                      )}
                    >
                      <span className={cn(
                        "block w-3.5 h-3.5 rounded-full bg-white absolute top-0.5 transition-all",
                        getNestedValue(config as unknown as Record<string, unknown>, `${section.configPath}.${field.configKey ?? field.id}`)
                          ? "left-4" : "left-0.5",
                      )} />
                    </button>
                  ) : field.type === "select" && field.options ? (
                    <Select
                      className="font-mono"
                      list={field.options.map((o) => ({ value: o.value, label: o.label }))}
                      value={String(getNestedValue(config as unknown as Record<string, unknown>, `${section.configPath}.${field.configKey ?? field.id}`) ?? field.defaultValue ?? "")}
                      onValueChange={(v) => {
                        const path = `${section.configPath}.${field.configKey ?? field.id}`;
                        update((prev) => setNestedValue(prev, path, v));
                      }}
                    />
                  ) : field.type === "model-select" ? (
                    <ModelSelectField
                      field={field}
                      value={String(getNestedValue(config as unknown as Record<string, unknown>, `${section.configPath}.${field.configKey ?? field.id}`) ?? field.defaultValue ?? "")}
                      onChange={(v) => {
                        const path = `${section.configPath}.${field.configKey ?? field.id}`;
                        update((prev) => setNestedValue(prev, path, v));
                      }}
                    />
                  ) : field.type === "readonly" ? (
                    <div className="h-9 flex items-center text-sm text-foreground font-mono">
                      {String(getNestedValue(config as unknown as Record<string, unknown>, `${section.configPath}.${field.configKey ?? field.id}`) ?? field.defaultValue ?? "")}
                    </div>
                  ) : (
                    <Input
                      type={field.type === "password" ? "password" : field.type === "number" ? "number" : "text"}
                      value={String(getNestedValue(config as unknown as Record<string, unknown>, `${section.configPath}.${field.configKey ?? field.id}`) ?? field.defaultValue ?? "")}
                      onChange={(e) => {
                        const path = `${section.configPath}.${field.configKey ?? field.id}`;
                        update((prev) => setNestedValue(prev, path, field.type === "number" ? Number(e.target.value) : e.target.value));
                      }}
                      placeholder={field.placeholder}
                      className="font-mono"
                    />
                  )}
                </FieldGroup>
              ))}
            </div>
          )}
        </Card>
      ))}
    </>
  );
}
