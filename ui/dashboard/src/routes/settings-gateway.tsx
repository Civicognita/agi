/**
 * Settings > Gateway — tabbed settings page (Owner, Identity, Contributing, Network).
 */

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { cn } from "@/lib/utils";
import { useSettingsContext } from "./settings-layout.js";
import { SettingsSaveBar } from "@/components/settings/SettingsSaveBar.js";
import { CompanionDevicesCard } from "@/components/CompanionDevicesCard.js";
import { OwnerSettings } from "@/components/settings/OwnerSettings.js";
import { GatewayNetworkSettings } from "@/components/settings/GatewayNetworkSettings.js";
import { DevNote } from "@/components/ui/dev-notes";
import { Button } from "@/components/ui/button";
import type { AionimaConfig } from "../types.js";

type Tab = "general" | "dev" | "network";

const tabs: { id: Tab; label: string }[] = [
  { id: "general", label: "General" },
  { id: "dev", label: "Contributing" },
  { id: "network", label: "Network" },
];

export default function SettingsGatewayPage() {
  const { configHook, onOpenUpgradeWizard } = useSettingsContext();
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
      <DevNote heading="Cycle 262 — Channels tab removed" kind="info" scope="settings/gateway">
        Channels tab removed from this page. Channel config, token entry, status, and workflow bindings
        live at Settings → Channels (plugin-driven, one tab per installed channel). Gateway settings no
        longer has a hardcoded Telegram/Discord config surface.
      </DevNote>
      <DevNote heading="2026-06-08 — Contributing GitHub connect is AGI-native (no more id.ai.on)" kind="info" scope="settings/gateway">
        The Contributing tab's GitHub auth gate no longer pops the retired Local-ID service at
        id.ai.on. It now runs AGI's own device flow (device-flow-api.ts, absorbed from Local-ID):
        click "Connect GitHub" → enter the shown code at github.com/login/device → the token lands
        in the connections table and Dev Mode unlocks. Backend already read githubAuthenticated from
        the connections table directly; only this UI was stuck on the dead popup.
      </DevNote>
      <DevNote heading="Contributing/Dev Mode gates DevNotes visibility" kind="info" scope="settings/gateway">
        Dev Mode gates DevNotes visibility — notes only render when it's on. The toggle moved to the
        dedicated Contributing page (/contribute, Repos &amp; Mode tab). Production users never see DevNotes.
      </DevNote>
      <DevNote heading="2026-06-18 — Contributing moved to /contribute (Wave 2)" kind="info" scope="settings/gateway">
        The Contributing tab here is now just a pointer. Contributing mode, GitHub connect, fork/repo
        status, incoming + outbound PRs, and the test VM live on the dedicated /contribute page (Outbound /
        Incoming / Repos &amp; Mode tabs) — less scroll, plus contribution metrics + PR comments.
      </DevNote>
      <DevNote heading="Project folder restructure incoming (s140)" kind="warning" scope="settings/gateway">
        After running `agi project-migrate s140 --execute`, this page's project list reflects the new
        layout: every project gets {"{k/, repos/, sandbox/, project.json}"} at root (chat stays at k/chat/). Stacks attach
        per-repo (s141 follow-up). Sacred projects (Aionima 5 + PAx 4) untouched.
      </DevNote>
      <DevNote heading="2026-06-07 — Companion device pairing (Genie / mobile)" kind="info" scope="settings/gateway">
        General tab now has a Companion devices card: generate a 6-digit code, read it to a LAN
        companion (e.g. Genie desktop), and it pairs for a per-device session token. Manage/revoke
        devices here. Pairing lives in AGI (Local-ID deprecated); answers agi#178 Q5.2a. In-memory
        for now — devices re-pair after a gateway restart (persistence is a follow-up).
      </DevNote>
      <DevNote heading="Manage Upgrade — review action only for real upgrades" kind="info" scope="settings/gateway">
        The upgrade wizard now lists every source (commit deltas always shown) but only renders a
        Review action for a real upgrade (commitsBehind &gt; 0 → fast-forward / 3-way). Up-to-date and
        "behind" sources are non-interactive info rows; an up-to-date install sees a "nothing to review"
        state instead of a dangling Preview button.
      </DevNote>
      <SettingsSaveBar
        dirty={dirty}
        saving={configHook.saving}
        saveMessage={configHook.saveMessage}
        saveError={saveError}
        onSave={() => void handleSave()}
      />

      {/* Tab bar */}
      <div role="tablist" className="flex gap-1 mb-6 border-b border-border">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
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
        <>
          <OwnerSettings owner={owner} update={update} />
          <GatewayNetworkSettings gateway={gateway} config={draft} update={update} section="general" />
          {/* Upgrade management — always accessible regardless of pending updates */}
          <div className="mt-6 rounded-lg border border-border bg-card p-4 flex items-center justify-between gap-4">
            <div>
              <div className="text-[13px] font-semibold text-foreground">Upgrade Manager</div>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                View fork status, preview upcoming changes, and manage upgrades across origin and upstream branches.
              </p>
            </div>
            <Button
              data-testid="upgrade-wizard-trigger"
              size="sm"
              variant="outline"
              onClick={onOpenUpgradeWizard}
              className="shrink-0"
            >
              Manage Upgrade
            </Button>
          </div>
          {/* Companion device pairing (gateway ↔ desktop/mobile, e.g. Genie) */}
          <div className="mt-6">
            <CompanionDevicesCard />
          </div>
        </>
      )}

      {activeTab === "dev" && (
        <div className="rounded-lg border border-border bg-card p-4" data-testid="contribute-moved-pointer">
          <div className="text-[13px] font-semibold text-foreground">Contributing has its own page now</div>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Contributing mode, GitHub connect, fork/repo status, incoming &amp; outbound PRs, and the test VM
            moved to a dedicated page (Wave 2 — less scroll, contribution metrics, PR comments).
          </p>
          <Link to="/contribute" className="inline-block mt-2 text-[12px] text-primary hover:underline" data-testid="contribute-page-link">
            Open Contributing →
          </Link>
        </div>
      )}

      {activeTab === "network" && (
        <GatewayNetworkSettings gateway={gateway} config={draft} update={update} section="network" />
      )}
    </div>
  );
}
