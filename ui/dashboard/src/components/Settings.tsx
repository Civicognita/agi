/**
 * Settings — Config management UI for gateway.json.
 *
 * Sections: Owner, Channels (Telegram, Discord), Gateway, Agent.
 * Reads/writes config via GET/PUT /api/config (loopback-only).
 */

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { fetchModels, fetchPluginSettings, type ModelEntry } from "@/api";
import { useTheme } from "@/lib/theme-provider";
import type {
  AionimaConfig,
  ChannelConfig,
  GatewayConfig,
  PluginSettingsSection,
  ProviderCredential,
} from "../types.js";

type Provider = "anthropic" | "openai" | "ollama";

export interface SettingsProps {
  config: AionimaConfig;
  saving: boolean;
  saveMessage: string | null;
  onSave: (config: AionimaConfig) => Promise<void>;
  theme?: "light" | "dark";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getChannelConfig(channels: ChannelConfig[], id: string): ChannelConfig {
  return channels.find((c) => c.id === id) ?? { id, enabled: false, config: {} };
}

function setChannelConfig(
  channels: ChannelConfig[],
  id: string,
  update: Partial<ChannelConfig>,
): ChannelConfig[] {
  const existing = channels.findIndex((c) => c.id === id);
  if (existing >= 0) {
    const updated = [...channels];
    updated[existing] = { ...updated[existing]!, ...update };
    return updated;
  }
  return [...channels, { id, enabled: false, config: {}, ...update }];
}

function setChannelField(
  channels: ChannelConfig[],
  id: string,
  field: string,
  value: unknown,
): ChannelConfig[] {
  const ch = getChannelConfig(channels, id);
  const cfg = { ...ch.config, [field]: value };
  return setChannelConfig(channels, id, { config: cfg });
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionHeading({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("text-base font-semibold text-card-foreground mb-4 pb-2 border-b border-border", className)}>
      {children}
    </div>
  );
}

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <label className="block text-[13px] text-muted-foreground mb-1.5">{label}</label>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function Settings({ config, saving, saveMessage, onSave }: SettingsProps) {
  const { themeId, setTheme, themes } = useTheme();
  const [draft, setDraft] = useState<AionimaConfig>(config);
  const [dirty, setDirty] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Sync when upstream config changes (after save or refresh)
  useEffect(() => {
    setDraft(config);
    setDirty(false);
  }, [config]);

  const update = useCallback((fn: (prev: AionimaConfig) => AionimaConfig) => {
    setDraft((prev) => {
      const next = fn(prev);
      setDirty(true);
      return next;
    });
  }, []);

  const handleSave = useCallback(async () => {
    setSaveError(null);
    try {
      await onSave(draft);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    }
  }, [draft, onSave]);

  // Agent model list state
  const [agentModels, setAgentModels] = useState<ModelEntry[]>([]);
  const [agentModelsLoading, setAgentModelsLoading] = useState(false);
  const [agentModelsError, setAgentModelsError] = useState<string | null>(null);

  // PRIME source state — removed. PRIME is part of the Aionima core
  // collection; its repo source is owned by Dev Mode's unified
  // provisioning (see DevSettings / `_aionima/` collection). Leaving a
  // second switcher here conflicted with the source of truth.

  // Plugin settings sections
  const [pluginSettingsSections, setPluginSettingsSections] = useState<PluginSettingsSection[]>([]);

  useEffect(() => {
    fetchPluginSettings().then(setPluginSettingsSections).catch(() => {});
  }, []);

  const agentProvider = ((draft.agent as Record<string, unknown> | undefined)?.["provider"] as Provider) ?? "anthropic";

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

  // Derived values
  const owner = draft.owner ?? { displayName: "", channels: {}, dmPolicy: "pairing" as const };
  const gateway = draft.gateway ?? { host: "127.0.0.1", port: 3100, state: "OFFLINE" as const };
  const telegram = getChannelConfig(draft.channels ?? [], "telegram");
  const discord = getChannelConfig(draft.channels ?? [], "discord");

  return (
    <div className="flex flex-col">
      {/* Save bar */}
      <Card className="flex-row items-center gap-3 p-3 px-4 mb-6">
        <Button
          onClick={() => void handleSave()}
          disabled={saving || !dirty}
          variant={dirty ? "default" : "secondary"}
        >
          {saving ? "Saving..." : "Save Config"}
        </Button>
        {dirty && (
          <span className="text-[13px] text-yellow">Unsaved changes</span>
        )}
        {!dirty && saveMessage !== null && (
          <span className="text-[13px] text-green">{saveMessage}</span>
        )}
        {saveError !== null && (
          <span className="text-[13px] text-red">{saveError}</span>
        )}
      </Card>

      {/* Theme Section */}
      <Card className="p-6 gap-0 mb-4">
        <SectionHeading>Theme</SectionHeading>
        {(() => {
          const builtIn = themes.filter((t) => t.source === "built-in");
          const plugin = themes.filter((t) => t.source === "plugin");
          return (
            <>
              <div className="grid grid-cols-5 gap-3">
                {builtIn.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTheme(t.id)}
                    className={cn(
                      "rounded-lg border-2 p-3 text-left transition-colors cursor-pointer",
                      themeId === t.id
                        ? "border-primary ring-2 ring-ring/30"
                        : "border-border hover:border-muted-foreground",
                    )}
                  >
                    {/* Color swatches */}
                    <div className="flex gap-1 mb-2">
                      {["--color-background", "--color-primary", "--color-success", "--color-destructive", "--color-warning"].map((key) => (
                        <div
                          key={key}
                          className="h-4 w-4 rounded-full border border-black/10"
                          style={{ backgroundColor: t.properties[key] }}
                        />
                      ))}
                    </div>
                    <div className="text-xs font-medium truncate">{t.name}</div>
                    <div className="text-[10px] text-muted-foreground">{t.dark ? "Dark" : "Light"}</div>
                    {themeId === t.id && (
                      <div className="text-[10px] text-primary font-medium mt-1">Active</div>
                    )}
                  </button>
                ))}
              </div>
              {plugin.length > 0 && (
                <>
                  <div className="text-xs font-medium text-muted-foreground mt-4 mb-2">Plugin Themes</div>
                  <div className="grid grid-cols-5 gap-3">
                    {plugin.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setTheme(t.id)}
                        className={cn(
                          "rounded-lg border-2 p-3 text-left transition-colors cursor-pointer",
                          themeId === t.id
                            ? "border-primary ring-2 ring-ring/30"
                            : "border-border hover:border-muted-foreground",
                        )}
                      >
                        <div className="flex gap-1 mb-2">
                          {["--color-background", "--color-primary", "--color-success", "--color-destructive", "--color-warning"].map((key) => (
                            <div
                              key={key}
                              className="h-4 w-4 rounded-full border border-black/10"
                              style={{ backgroundColor: t.properties[key] }}
                            />
                          ))}
                        </div>
                        <div className="text-xs font-medium truncate">{t.name}</div>
                        <div className="text-[10px] text-muted-foreground">{t.dark ? "Dark" : "Light"}</div>
                        {themeId === t.id && (
                          <div className="text-[10px] text-primary font-medium mt-1">Active</div>
                        )}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </>
          );
        })()}
      </Card>

      {/* Owner Section */}
      <Card className="p-6 gap-0 mb-4">
        <SectionHeading>Owner Identity</SectionHeading>
        <div className="grid grid-cols-2 gap-4">
          <FieldGroup label="Display Name">
            <Input
              className="font-mono"
              value={owner.displayName}
              onChange={(e) => update((prev) => ({
                ...prev,
                owner: { ...owner, displayName: e.target.value },
              }))}
              placeholder="Your name"
            />
          </FieldGroup>
          <FieldGroup label="DM Policy">
            <select
              className="w-full h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm font-mono cursor-pointer"
              value={owner.dmPolicy}
              onChange={(e) => update((prev) => ({
                ...prev,
                owner: { ...owner, dmPolicy: e.target.value as "pairing" | "open" },
              }))}
            >
              <option value="pairing">Pairing (require approval)</option>
              <option value="open">Open (allow all)</option>
            </select>
          </FieldGroup>
        </div>
        <SectionHeading className="text-sm mt-2">Owner Channel IDs</SectionHeading>
        <div className="grid grid-cols-2 gap-4">
          <FieldGroup label="Telegram User ID">
            <Input
              className="font-mono"
              value={owner.channels.telegram ?? ""}
              onChange={(e) => update((prev) => ({
                ...prev,
                owner: {
                  ...owner,
                  channels: { ...owner.channels, telegram: e.target.value || undefined },
                },
              }))}
              placeholder="e.g. 368731068"
            />
          </FieldGroup>
          <FieldGroup label="Discord User ID">
            <Input
              className="font-mono"
              value={owner.channels.discord ?? ""}
              onChange={(e) => update((prev) => ({
                ...prev,
                owner: {
                  ...owner,
                  channels: { ...owner.channels, discord: e.target.value || undefined },
                },
              }))}
              placeholder="e.g. 123456789012345678"
            />
          </FieldGroup>
          <FieldGroup label="Signal Phone (E.164)">
            <Input
              className="font-mono"
              value={owner.channels.signal ?? ""}
              onChange={(e) => update((prev) => ({
                ...prev,
                owner: {
                  ...owner,
                  channels: { ...owner.channels, signal: e.target.value || undefined },
                },
              }))}
              placeholder="e.g. +1234567890"
            />
          </FieldGroup>
          <FieldGroup label="WhatsApp Phone (E.164)">
            <Input
              className="font-mono"
              value={owner.channels.whatsapp ?? ""}
              onChange={(e) => update((prev) => ({
                ...prev,
                owner: {
                  ...owner,
                  channels: { ...owner.channels, whatsapp: e.target.value || undefined },
                },
              }))}
              placeholder="e.g. +1234567890"
            />
          </FieldGroup>
        </div>
      </Card>

      {/* Telegram Channel */}
      <Card className="p-6 gap-0 mb-4">
        <div className="flex items-center justify-between mb-4 pb-2 border-b border-border">
          <span className="text-base font-semibold text-card-foreground">Telegram Channel</span>
          <Button
            variant="outline"
            size="xs"
            className={cn(
              telegram.enabled && "border-green bg-green/10 text-green hover:bg-green/20 hover:text-green",
            )}
            onClick={() => update((prev) => ({
              ...prev,
              channels: setChannelConfig(prev.channels ?? [], "telegram", { enabled: !telegram.enabled }),
            }))}
          >
            {telegram.enabled ? "Enabled" : "Disabled"}
          </Button>
        </div>
        <FieldGroup label="Bot Token">
          <Input
            className="font-mono"
            type="password"
            value={(telegram.config?.["botToken"] as string) ?? ""}
            onChange={(e) => update((prev) => ({
              ...prev,
              channels: setChannelField(prev.channels ?? [], "telegram", "botToken", e.target.value),
            }))}
            placeholder="Bot token from @BotFather"
          />
        </FieldGroup>
      </Card>

      {/* Discord Channel */}
      <Card className="p-6 gap-0 mb-4">
        <div className="flex items-center justify-between mb-4 pb-2 border-b border-border">
          <span className="text-base font-semibold text-card-foreground">Discord Channel</span>
          <Button
            variant="outline"
            size="xs"
            className={cn(
              discord.enabled && "border-green bg-green/10 text-green hover:bg-green/20 hover:text-green",
            )}
            onClick={() => update((prev) => ({
              ...prev,
              channels: setChannelConfig(prev.channels ?? [], "discord", { enabled: !discord.enabled }),
            }))}
          >
            {discord.enabled ? "Enabled" : "Disabled"}
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FieldGroup label="Bot Token">
            <Input
              className="font-mono"
              type="password"
              value={(discord.config?.["botToken"] as string) ?? ""}
              onChange={(e) => update((prev) => ({
                ...prev,
                channels: setChannelField(prev.channels ?? [], "discord", "botToken", e.target.value),
              }))}
              placeholder="Discord bot token"
            />
          </FieldGroup>
          <FieldGroup label="Application ID">
            <Input
              className="font-mono"
              value={(discord.config?.["applicationId"] as string) ?? ""}
              onChange={(e) => update((prev) => ({
                ...prev,
                channels: setChannelField(prev.channels ?? [], "discord", "applicationId", e.target.value),
              }))}
              placeholder="Discord application ID"
            />
          </FieldGroup>
        </div>
      </Card>

      {/* AI Providers Section */}
      <Card className="p-6 gap-0 mb-4">
        <SectionHeading>AI Providers</SectionHeading>
        <p className="text-[13px] text-muted-foreground mb-4">
          LLM provider credentials used system-wide. Per-worker overrides take priority.
        </p>
        {(["anthropic", "openai", "ollama"] as const).map((providerName) => {
          const cred: ProviderCredential = draft.providers?.[providerName] ?? {};
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

      {/* Gateway Section */}
      <Card className="p-6 gap-0 mb-4">
        <SectionHeading>Gateway</SectionHeading>
        <div className="grid grid-cols-3 gap-4">
          <FieldGroup label="Host">
            <Input
              className="font-mono"
              value={gateway.host}
              onChange={(e) => update((prev) => ({
                ...prev,
                gateway: { ...gateway, host: e.target.value },
              }))}
            />
          </FieldGroup>
          <FieldGroup label="Port">
            <Input
              className="font-mono"
              type="number"
              value={gateway.port}
              onChange={(e) => update((prev) => ({
                ...prev,
                gateway: { ...gateway, port: parseInt(e.target.value, 10) || 3100 },
              }))}
            />
          </FieldGroup>
          <FieldGroup label="Initial State">
            <select
              className="w-full h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm font-mono cursor-pointer"
              value={gateway.state}
              onChange={(e) => update((prev) => ({
                ...prev,
                gateway: { ...gateway, state: e.target.value as GatewayConfig["state"] },
              }))}
            >
              <option value="ONLINE">ONLINE</option>
              <option value="LIMBO">LIMBO</option>
              <option value="OFFLINE">OFFLINE</option>
            </select>
          </FieldGroup>
        </div>
      </Card>

      {/* Agent Section */}
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
                  agent: { ...prev.agent, provider: next, model: "" },
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
                value={(draft.agent as Record<string, unknown> | undefined)?.["model"] as string ?? ""}
                onChange={(e) => update((prev) => ({
                  ...prev,
                  agent: { ...prev.agent, model: e.target.value },
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
              value={(draft.agent as Record<string, unknown> | undefined)?.["replyMode"] as string ?? "autonomous"}
              onChange={(e) => update((prev) => ({
                ...prev,
                agent: { ...prev.agent, replyMode: e.target.value },
              }))}
            >
              <option value="autonomous">Autonomous</option>
              <option value="human-in-loop">Human-in-Loop</option>
            </select>
          </FieldGroup>
        </div>
      </Card>

      {/* Plugin-registered settings sections */}
      {pluginSettingsSections.map((section) => (
        <Card key={section.id} className="p-5">
          <SectionHeading>{section.label}</SectionHeading>
          {section.description && (
            <p className="text-[12px] text-muted-foreground mb-4">{section.description}</p>
          )}
          <div className="grid grid-cols-2 gap-x-6">
            {section.fields.map((field) => (
              <FieldGroup key={field.id} label={field.label}>
                {field.type === "toggle" ? (
                  <button
                    type="button"
                    onClick={() => {
                      const path = `${section.configPath}.${field.configKey ?? field.id}`;
                      const current = getNestedValue(draft, path);
                      update((prev) => setNestedValue(prev, path, !current));
                    }}
                    className={cn(
                      "w-8 h-5 rounded-full transition-colors relative",
                      getNestedValue(draft, `${section.configPath}.${field.configKey ?? field.id}`)
                        ? "bg-green" : "bg-surface1",
                    )}
                  >
                    <span className={cn(
                      "block w-3.5 h-3.5 rounded-full bg-white absolute top-0.5 transition-all",
                      getNestedValue(draft, `${section.configPath}.${field.configKey ?? field.id}`)
                        ? "left-4" : "left-0.5",
                    )} />
                  </button>
                ) : field.type === "select" && field.options ? (
                  <select
                    className="w-full h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm font-mono cursor-pointer"
                    value={String(getNestedValue(draft, `${section.configPath}.${field.configKey ?? field.id}`) ?? field.defaultValue ?? "")}
                    onChange={(e) => {
                      const path = `${section.configPath}.${field.configKey ?? field.id}`;
                      update((prev) => setNestedValue(prev, path, e.target.value));
                    }}
                  >
                    {field.options.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                ) : field.type === "readonly" ? (
                  <div className="h-9 flex items-center text-sm text-foreground font-mono">
                    {String(getNestedValue(draft, `${section.configPath}.${field.configKey ?? field.id}`) ?? field.defaultValue ?? "")}
                  </div>
                ) : (
                  <Input
                    type={field.type === "password" ? "password" : field.type === "number" ? "number" : "text"}
                    value={String(getNestedValue(draft, `${section.configPath}.${field.configKey ?? field.id}`) ?? field.defaultValue ?? "")}
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
        </Card>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers for nested config access
// ---------------------------------------------------------------------------

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function setNestedValue(obj: AionimaConfig, path: string, value: unknown): AionimaConfig {
  const parts = path.split(".");
  const result = { ...obj };
  let current: Record<string, unknown> = result;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    current[part] = { ...(current[part] as Record<string, unknown>) };
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]!] = value;
  return result;
}
