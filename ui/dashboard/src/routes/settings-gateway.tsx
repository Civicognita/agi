/**
 * Settings > Gateway — tabbed settings page (Owner, Identity, Contributing, Network).
 *
 * Channel settings (Telegram, Discord, etc.) are NOT here — they belong
 * in channel plugin settings pages, not the gateway core.
 */

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useSettingsContext } from "./settings-layout.js";
import { SettingsSaveBar } from "@/components/settings/SettingsSaveBar.js";
import { OwnerSettings } from "@/components/settings/OwnerSettings.js";
import { DevSettings } from "@/components/settings/DevSettings.js";
import { GatewayNetworkSettings } from "@/components/settings/GatewayNetworkSettings.js";
import { IdentitySettings } from "@/components/settings/IdentitySettings.js";
import type { AionimaConfig } from "../types.js";

type Tab = "owner" | "identity" | "dev" | "network";

const tabs: { id: Tab; label: string }[] = [
  { id: "owner", label: "Owner" },
  { id: "identity", label: "Identity" },
  { id: "dev", label: "Contributing" },
  { id: "network", label: "Network" },
];

export default function SettingsGatewayPage() {
  const { configHook } = useSettingsContext();
  const [activeTab, setActiveTab] = useState<Tab>("owner");
  const [draft, setDraft] = useState<AionimaConfig>(configHook.data ?? ({} as AionimaConfig));
  const [dirty, setDirty] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (configHook.data) {
      setDraft(configHook.data);
      setDirty(false);
    }
  }, [configHook.data]);

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
      await configHook.save(draft);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    }
  }, [draft, configHook]);

  if (!configHook.data) return null;

  const owner = draft.owner ?? { displayName: "", channels: {}, dmPolicy: "pairing" as const };
  const gateway = draft.gateway ?? { host: "127.0.0.1", port: 3100, state: "OFFLINE" as const };

  return (
    <div className="flex flex-col">
      <SettingsSaveBar
        dirty={dirty}
        saving={configHook.saving}
        saveMessage={configHook.saveMessage}
        saveError={saveError}
        onSave={() => void handleSave()}
      />

      {/* Tab bar */}
      <div className="flex gap-1 mb-6 border-b border-border">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "px-4 py-2 text-[13px] font-medium border-b-2 transition-colors cursor-pointer bg-transparent",
              activeTab === tab.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "owner" && (
        <OwnerSettings owner={owner} update={update} />
      )}

      {activeTab === "identity" && (
        <IdentitySettings config={draft} update={update} />
      )}

      {activeTab === "dev" && (
        <DevSettings config={draft} update={update} />
      )}

      {activeTab === "network" && (
        <GatewayNetworkSettings gateway={gateway} config={draft} update={update} />
      )}
    </div>
  );
}
