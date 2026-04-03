/**
 * ChannelSettings — Telegram + Discord channel configuration cards.
 */

import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "./SettingsShared.js";
import type { AionimaConfig, ChannelConfig } from "../../types.js";

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
  const cfg = { ...(ch.config ?? {}), [field]: value };
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
      </Card>
    </>
  );
}
