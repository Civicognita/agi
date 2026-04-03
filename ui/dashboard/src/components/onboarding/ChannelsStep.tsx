/**
 * ChannelsStep — Configure messaging channels during onboarding.
 *
 * Discovers available channel plugins from the marketplace catalog
 * instead of hardcoding channels. Renders appropriate setup flow per auth type:
 * - OAuth (Gmail, Discord): "Authenticate via ID" button → handoff popup
 * - Token (Telegram, WhatsApp): credential fields from plugin manifest
 * - API (Signal): URL + credential fields
 *
 * Falls back to hardcoded definitions if marketplace is unavailable.
 */

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils.js";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import type { OnboardingStepStatus } from "@/types.js";

interface Props {
  onNext: () => void;
  onSkip: () => void;
  status?: OnboardingStepStatus;
}

interface ChannelDef {
  id: string;
  label: string;
  icon: string;
  description: string;
  authType: "oauth" | "token" | "api";
  oauthProvider?: string;
  fields: Array<{ key: string; label: string; placeholder: string; type?: string; secret?: boolean }>;
  ownerIdLabel: string;
  ownerIdPlaceholder: string;
  installed?: boolean;
}

// Fallback channel definitions — used when marketplace catalog is unavailable
const FALLBACK_CHANNELS: ChannelDef[] = [
  {
    id: "telegram",
    label: "Telegram",
    icon: "T",
    description: "Connect via Telegram Bot API. Create a bot with @BotFather to get a token.",
    authType: "token",
    fields: [
      { key: "botToken", label: "Bot Token", placeholder: "123456789:AAF...", secret: true },
    ],
    ownerIdLabel: "Your Telegram User ID",
    ownerIdPlaceholder: "368731068",
  },
  {
    id: "discord",
    label: "Discord",
    icon: "D",
    description: "Connect via Discord Bot. Create an application at discord.com/developers.",
    authType: "token",
    fields: [
      { key: "botToken", label: "Bot Token", placeholder: "MTIzNDU2...", secret: true },
      { key: "applicationId", label: "Application ID", placeholder: "1234567890123456789" },
    ],
    ownerIdLabel: "Your Discord User ID",
    ownerIdPlaceholder: "196170122770120704",
  },
  {
    id: "email",
    label: "Email",
    icon: "E",
    description: "Gmail integration via OAuth through Aionima ID.",
    authType: "oauth",
    oauthProvider: "google",
    fields: [],
    ownerIdLabel: "Your Email Address",
    ownerIdPlaceholder: "you@example.com",
  },
  {
    id: "signal",
    label: "Signal",
    icon: "S",
    description: "Connect via signal-cli REST API. Requires signal-cli running locally.",
    authType: "api",
    fields: [
      { key: "signalCliUrl", label: "signal-cli REST URL", placeholder: "http://localhost:8080" },
      { key: "accountNumber", label: "Signal Account Number", placeholder: "+15555550100" },
    ],
    ownerIdLabel: "Your Signal Number",
    ownerIdPlaceholder: "+15555550100",
  },
  {
    id: "whatsapp",
    label: "WhatsApp",
    icon: "W",
    description: "Connect via WhatsApp Business API. Requires a Meta Business account.",
    authType: "token",
    fields: [
      { key: "accessToken", label: "Access Token", placeholder: "EAA...", secret: true },
      { key: "phoneNumberId", label: "Phone Number ID", placeholder: "123456789012345" },
      { key: "verifyToken", label: "Verify Token", placeholder: "your-verify-token" },
      { key: "appSecret", label: "App Secret", placeholder: "abc123...", secret: true },
    ],
    ownerIdLabel: "Your WhatsApp Number",
    ownerIdPlaceholder: "+15555550100",
  },
];

interface ChannelState {
  enabled: boolean;
  config: Record<string, string>;
  ownerId: string;
  expanded: boolean;
  saved: boolean;
}

export function ChannelsStep({ onNext, onSkip, status }: Props) {
  const [channelDefs, setChannelDefs] = useState<ChannelDef[]>(FALLBACK_CHANNELS);
  const [channels, setChannels] = useState<Record<string, ChannelState>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [oauthConnecting, setOauthConnecting] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load channel definitions from marketplace, then existing config
  useEffect(() => {
    // Attempt to fetch channel plugins from marketplace catalog
    fetch("/api/marketplace/catalog?type=channel")
      .then((r) => r.json() as Promise<{
        items?: Array<{
          id: string;
          name: string;
          description?: string;
          icon?: string;
          installed?: boolean;
          metadata?: {
            authType?: string;
            oauthProvider?: string;
            credentialFields?: Array<{ key: string; label: string; type?: string; placeholder?: string }>;
            ownerIdLabel?: string;
            ownerIdPlaceholder?: string;
          };
        }>;
      }>)
      .then((data) => {
        if (data.items && data.items.length > 0) {
          const defs: ChannelDef[] = data.items.map((item) => ({
            id: item.id.replace("channel-", ""),
            label: item.name,
            icon: item.icon ?? item.name.charAt(0).toUpperCase(),
            description: item.description ?? "",
            authType: (item.metadata?.authType as ChannelDef["authType"]) ?? "token",
            oauthProvider: item.metadata?.oauthProvider,
            fields: (item.metadata?.credentialFields ?? []).map((f) => ({
              key: f.key,
              label: f.label,
              placeholder: f.placeholder ?? "",
              type: f.type,
              secret: f.type === "password" || f.type === "secret",
            })),
            ownerIdLabel: item.metadata?.ownerIdLabel ?? "Your User ID",
            ownerIdPlaceholder: item.metadata?.ownerIdPlaceholder ?? "",
            installed: item.installed,
          }));
          setChannelDefs(defs);
        }
        // If marketplace returned empty or failed, fallback is already set
      })
      .catch(() => {
        // Marketplace unavailable — use fallback definitions
      });

    // Load existing channel config
    fetch("/api/onboarding/channels")
      .then((r) => r.json() as Promise<{
        channels: Array<{ id: string; enabled: boolean; config: Record<string, string> }>;
        ownerChannels: Record<string, string>;
      }>)
      .then((data) => {
        const state: Record<string, ChannelState> = {};
        for (const ch of channelDefs) {
          const existing = data.channels.find((c) => c.id === ch.id);
          state[ch.id] = {
            enabled: existing?.enabled ?? false,
            config: existing?.config ?? {},
            ownerId: data.ownerChannels[ch.id] ?? "",
            expanded: false,
            saved: !!existing,
          };
        }
        setChannels(state);
      })
      .catch(() => {
        const state: Record<string, ChannelState> = {};
        for (const ch of channelDefs) {
          state[ch.id] = { enabled: false, config: {}, ownerId: "", expanded: false, saved: false };
        }
        setChannels(state);
      })
      .finally(() => setLoaded(true));

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [channelDefs]);

  const updateChannel = (id: string, patch: Partial<ChannelState>) => {
    setChannels((prev) => ({ ...prev, [id]: { ...prev[id]!, ...patch } }));
  };

  const updateChannelConfig = (channelId: string, key: string, value: string) => {
    setChannels((prev) => ({
      ...prev,
      [channelId]: {
        ...prev[channelId]!,
        config: { ...prev[channelId]!.config, [key]: value },
      },
    }));
  };

  const handleSaveChannel = async (channelId: string) => {
    const ch = channels[channelId];
    if (!ch) return;

    setSaving(channelId);
    try {
      const res = await fetch("/api/onboarding/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelId,
          enabled: true,
          config: ch.config,
          ownerId: ch.ownerId,
        }),
      });
      if (res.ok) {
        updateChannel(channelId, { enabled: true, saved: true });
      }
    } catch {
      // ignore
    } finally {
      setSaving(null);
    }
  };

  const handleOauthConnect = async (channelId: string) => {
    setOauthConnecting(channelId);
    try {
      const res = await fetch("/api/onboarding/channels/oauth-start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId }),
      });

      if (!res.ok) {
        setOauthConnecting(null);
        return;
      }

      const { url } = (await res.json()) as { url: string };
      const popup = window.open(url, "channel-oauth", "width=600,height=700");

      if (!popup) {
        setOauthConnecting(null);
        return;
      }

      // Poll for completion
      pollRef.current = setInterval(async () => {
        if (popup.closed) {
          if (pollRef.current) clearInterval(pollRef.current);
          setOauthConnecting(null);
          return;
        }

        try {
          const pollRes = await fetch("/api/onboarding/aionima-id/poll");
          if (!pollRes.ok) return;
          const data = (await pollRes.json()) as { status: string };
          if (data.status === "completed") {
            if (pollRef.current) clearInterval(pollRef.current);
            popup.close();
            setOauthConnecting(null);
            updateChannel(channelId, { enabled: true, saved: true });
          }
        } catch {
          // keep polling
        }
      }, 2000);
    } catch {
      setOauthConnecting(null);
    }
  };

  const anyConfigured = Object.values(channels).some((ch) => ch.saved && ch.enabled);
  const isCompleted = status === "completed";
  const canContinue = isCompleted || anyConfigured;

  if (!loaded) return null;

  return (
    <div className="flex flex-col gap-5 sm:gap-6">
      <div className="onboard-animate-in">
        <h2 className="text-xl sm:text-2xl font-semibold mb-1">
          Connect your channels
        </h2>
        <p className="text-[13px] sm:text-sm text-muted-foreground leading-relaxed">
          Configure at least one messaging channel so Aionima can communicate.
          Each channel connects you to the people and conversations that matter.
        </p>
      </div>

      {isCompleted && (
        <div className="p-3 rounded-lg bg-green/5 border border-green/20 text-sm text-muted-foreground onboard-animate-in">
          Channels already configured. Continue to keep existing connections, or update below.
        </div>
      )}

      <div className="flex flex-col gap-2 onboard-animate-in onboard-stagger-1">
        {channelDefs.map((def) => {
          const ch = channels[def.id];
          if (!ch) return null;
          const isExpanded = ch.expanded;

          return (
            <div
              key={def.id}
              className={cn(
                "rounded-lg border transition-colors",
                ch.saved && ch.enabled ? "border-green/30 bg-green/5" : "border-border",
              )}
            >
              {/* Header */}
              <button
                type="button"
                onClick={() => updateChannel(def.id, { expanded: !isExpanded })}
                className="flex items-center gap-3 w-full p-3 sm:p-4 text-left"
              >
                <div
                  className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0",
                    ch.saved && ch.enabled
                      ? "bg-green/10 text-green"
                      : "bg-secondary text-foreground",
                  )}
                >
                  {ch.saved && ch.enabled ? "\u2713" : def.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">{def.label}</p>
                    {def.authType === "oauth" && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">
                        OAuth
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {ch.saved && ch.enabled ? "Configured" : def.description}
                  </p>
                </div>
                <svg
                  className={cn(
                    "w-4 h-4 text-muted-foreground transition-transform shrink-0",
                    isExpanded && "rotate-180",
                  )}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {/* Expanded config */}
              {isExpanded && (
                <div className="px-3 sm:px-4 pb-3 sm:pb-4 flex flex-col gap-3 border-t border-border pt-3">
                  {/* OAuth channels: show connect button */}
                  {def.authType === "oauth" && (
                    <div className="flex flex-col gap-2">
                      <p className="text-xs text-muted-foreground">
                        Authenticate through Aionima ID to connect {def.label}.
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleOauthConnect(def.id)}
                        disabled={oauthConnecting !== null}
                        className="w-full sm:w-auto"
                      >
                        {oauthConnecting === def.id
                          ? "Connecting..."
                          : `Authenticate ${def.label} via ID`}
                      </Button>
                    </div>
                  )}

                  {/* Token/API channels: show credential fields */}
                  {def.authType !== "oauth" && def.fields.map((field) => (
                    <div key={field.key} className="flex flex-col gap-1">
                      <label className="text-xs font-medium text-muted-foreground">
                        {field.label}
                      </label>
                      <Input
                        type={field.secret ? "password" : "text"}
                        placeholder={field.placeholder}
                        value={ch.config[field.key] ?? ""}
                        onChange={(e) => updateChannelConfig(def.id, field.key, e.target.value)}
                        className="font-mono text-sm"
                      />
                    </div>
                  ))}

                  {/* Owner ID field (all channels) */}
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-muted-foreground">
                      {def.ownerIdLabel}
                    </label>
                    <Input
                      type="text"
                      placeholder={def.ownerIdPlaceholder}
                      value={ch.ownerId}
                      onChange={(e) => updateChannel(def.id, { ownerId: e.target.value })}
                      className="font-mono text-sm"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Your identifier on this platform — so the agent knows messages from you are from the owner.
                    </p>
                  </div>

                  {/* Save button for non-OAuth channels */}
                  {def.authType !== "oauth" && (
                    <Button
                      size="sm"
                      onClick={() => handleSaveChannel(def.id)}
                      disabled={saving !== null}
                      className="w-full sm:w-auto self-end"
                    >
                      {saving === def.id ? "Saving..." : ch.saved ? "Update" : "Save"}
                    </Button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 onboard-animate-in onboard-stagger-2">
        <Button onClick={onNext} disabled={!canContinue} className="w-full sm:w-auto">
          Continue
        </Button>
        <Button variant="ghost" onClick={onSkip} className="w-full sm:w-auto">
          Skip for now
        </Button>
      </div>
    </div>
  );
}
