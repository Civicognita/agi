/**
 * Settings > Gateway — tabbed settings page (Owner, Identity, Channels,
 * Contributing, Network).
 *
 * Channels tab added 2026-05-14 (s163 CHN-B fix): owner needed a surface
 * to enter Discord/Telegram bot tokens + see connection status. The
 * canonical long-term home is per-channel plugin settings pages, but
 * those don't exist yet. Until the channel plugins migrate to
 * defineChannelV2 + register their own SettingsPage component, this
 * gateway-side fallback provides token entry + status UX.
 */

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useSettingsContext } from "./settings-layout.js";
import { SettingsSaveBar } from "@/components/settings/SettingsSaveBar.js";
import { OwnerSettings } from "@/components/settings/OwnerSettings.js";
import { DevSettings } from "@/components/settings/DevSettings.js";
import { GatewayNetworkSettings } from "@/components/settings/GatewayNetworkSettings.js";
import { IdentitySettings } from "@/components/settings/IdentitySettings.js";
import { ChannelSettings } from "@/components/settings/ChannelSettings.js";
import { DevNote } from "@/components/ui/dev-notes";
import type { AionimaConfig } from "../types.js";

// s135 — the deprecated Providers tab has been removed. Canonical
// Providers UX lives at /settings/providers (Mission Control hero,
// range dial, escalation triggers, provider catalog shelf).
type Tab = "general" | "identity" | "channels" | "dev" | "network";

const tabs: { id: Tab; label: string }[] = [
  { id: "general", label: "General" },
  { id: "identity", label: "Identity" },
  { id: "channels", label: "Channels" },
  { id: "dev", label: "Contributing" },
  { id: "network", label: "Network" },
];

export default function SettingsGatewayPage() {
  const { configHook } = useSettingsContext();
  const [activeTab, setActiveTab] = useState<Tab>("general");
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
      <DevNote heading="Cycle 135 — Providers tab removed" kind="info" scope="settings/gateway">
        Deprecated Providers tab removed from this page. Canonical Providers UX lives at /settings/providers
        (Mission Control hero, range dial, escalation triggers, provider catalog shelf, Models tab).
      </DevNote>
      <DevNote heading="Contributing/Dev Mode gates DevNotes visibility" kind="info" scope="settings/gateway">
        Toggle "Contributing" tab → enable Dev Mode. Notes only render when this is on. Production users
        running the gateway never see DevNotes; you (with Contributing on) see them on every page+tab.
      </DevNote>
      <DevNote heading="Project folder restructure incoming (s140)" kind="warning" scope="settings/gateway">
        After running `agi project-migrate s140 --execute`, this page's project list reflects the new
        layout: every project gets {"{k/, repos/, sandbox/, project.json}"} at root (chat stays at k/chat/). Stacks attach
        per-repo (s141 follow-up). Sacred projects (Aionima 5 + PAx 4) untouched.
      </DevNote>
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
      {activeTab === "general" && (
        <GatewayNetworkSettings gateway={gateway} config={draft} update={update} section="general" />
      )}

      {activeTab === "identity" && (
        <>
          <OwnerSettings owner={owner} update={update} />
          <IdentitySettings config={draft} update={update} />
        </>
      )}

      {activeTab === "channels" && (
        <ChannelSettings config={draft} update={update} />
      )}

      {activeTab === "dev" && (
        <DevSettings config={draft} update={update} />
      )}

      {activeTab === "network" && (
        <GatewayNetworkSettings gateway={gateway} config={draft} update={update} section="network" />
      )}
    </div>
  );
}
