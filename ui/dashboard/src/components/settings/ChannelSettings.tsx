/**
 * ChannelSettings — Telegram + Discord channel configuration cards.
 *
 * Cycle 226 (2026-05-14) — Discord status card added below the token
 * fields. Fetches `/api/channels/discord/state` to show live connection
 * state + guild list + per-guild channel/forum listing. Owner-facing
 * surface for the "setup before bed" UX (s163 CHN-B partial slice).
 */

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "./SettingsShared.js";
import type { AionimaConfig, ChannelConfig } from "../../types.js";

interface DiscordChannelDescriptor {
  id: string;
  name: string;
  kind: "text" | "forum" | "voice" | "category" | "other";
  parent?: string;
}

interface DiscordGuildDescriptor {
  id: string;
  name: string;
  iconUrl?: string;
  memberCount?: number;
  channels: DiscordChannelDescriptor[];
}

interface DiscordStateDescriptor {
  connected: boolean;
  user?: { id: string; tag: string; avatarUrl?: string };
  guilds: DiscordGuildDescriptor[];
  snapshotAt: string;
}

function DiscordStatusBlock({ enabled }: { enabled: boolean }) {
  const [state, setState] = useState<DiscordStateDescriptor | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchState = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/channels/discord/state");
      if (!res.ok) throw new Error(`HTTP ${String(res.status)}`);
      setState((await res.json()) as DiscordStateDescriptor);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void fetchState();
  }, [enabled, fetchState]);

  if (!enabled) {
    return (
      <div className="mt-4 text-[12px] text-muted-foreground italic">
        Enable Discord above to see connection status + guild list.
      </div>
    );
  }

  return (
    <div className="mt-4 pt-4 border-t border-border">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[13px] font-semibold text-card-foreground">Connection Status</span>
        <Button variant="outline" size="xs" onClick={() => void fetchState()} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh"}
        </Button>
      </div>
      {error !== null && (
        <div className="text-[11px] text-red mb-2" data-testid="discord-status-error">
          Error: {error}
        </div>
      )}
      {state !== null && (
        <>
          <div className="flex items-center gap-2 text-[12px] mb-3">
            <span
              className={cn(
                "w-2 h-2 rounded-full",
                state.connected ? "bg-green" : "bg-red",
              )}
              aria-hidden
            />
            <span className={state.connected ? "text-green" : "text-red"} data-testid="discord-status-text">
              {state.connected ? "Connected" : "Disconnected"}
            </span>
            {state.user && (
              <>
                <span className="text-muted-foreground">·</span>
                <span className="font-mono text-foreground">{state.user.tag}</span>
              </>
            )}
            {!state.connected && (
              <span className="text-muted-foreground text-[11px] ml-2">
                (privileged intents may need enabling at discord.com/developers/applications)
              </span>
            )}
          </div>
          {state.connected && state.guilds.length === 0 && (
            <div className="text-[11px] text-muted-foreground italic">
              No guilds — invite the bot to a server. Invite URL pattern:{" "}
              <code className="font-mono">
                https://discord.com/oauth2/authorize?client_id=&lt;applicationId&gt;&amp;scope=bot+applications.commands&amp;permissions=8
              </code>
            </div>
          )}
          {state.connected && state.guilds.length > 0 && (
            <div className="space-y-3" data-testid="discord-guilds">
              {state.guilds.map((g) => (
                <div key={g.id} className="rounded border border-border/60 p-3">
                  <div className="flex items-center gap-2 mb-2">
                    {g.iconUrl !== undefined && (
                      <img src={g.iconUrl} alt="" className="w-5 h-5 rounded" />
                    )}
                    <span className="text-[12px] font-semibold text-foreground">{g.name}</span>
                    {g.memberCount !== undefined && (
                      <span className="text-[10px] text-muted-foreground">· {g.memberCount} members</span>
                    )}
                    <span className="text-[10px] text-muted-foreground ml-auto font-mono">{g.id}</span>
                  </div>
                  {g.channels.length === 0 ? (
                    <div className="text-[10px] text-muted-foreground italic">No channels visible</div>
                  ) : (
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                      {g.channels.map((c) => (
                        <div key={c.id} className="text-[10px] text-muted-foreground flex items-center gap-1.5 truncate">
                          <span className="text-blue font-mono shrink-0">
                            {c.kind === "forum" ? "📁" : c.kind === "voice" ? "🔊" : "#"}
                          </span>
                          <span className="text-foreground truncate" title={c.parent !== undefined ? `${c.parent}/${c.name}` : c.name}>
                            {c.parent !== undefined && <span className="text-muted-foreground">{c.parent}/</span>}
                            {c.name}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="text-[10px] text-muted-foreground mt-2">
            Snapshot at {new Date(state.snapshotAt).toLocaleTimeString()}
          </div>
        </>
      )}
    </div>
  );
}

function getChannelConfig(channels: ChannelConfig[], id: string): ChannelConfig {
  return channels.find((c) => c.id === id) ?? { id, enabled: false, config: {} };
}

function setChannelConfig(
  channels: ChannelConfig[],
  id: string,
  upd: Partial<ChannelConfig>,
): ChannelConfig[] {
  const existing = channels.findIndex((c) => c.id === id);
  if (existing >= 0) {
    const updated = [...channels];
    updated[existing] = { ...updated[existing]!, ...upd };
    return updated;
  }
  return [...channels, { id, enabled: false, config: {}, ...upd }];
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

interface Props {
  config: AionimaConfig;
  update: (fn: (prev: AionimaConfig) => AionimaConfig) => void;
}

export function ChannelSettings({ config, update }: Props) {
  const telegram = getChannelConfig(config.channels ?? [], "telegram");
  const discord = getChannelConfig(config.channels ?? [], "discord");

  return (
    <>
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
        <DiscordStatusBlock enabled={discord.enabled} />
      </Card>
    </>
  );
}
