/**
 * OwnerSettings — Owner identity + channel IDs configuration.
 */

import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SectionHeading, FieldGroup } from "./SettingsShared.js";
import type { AionimaConfig, OwnerConfig } from "../../types.js";

interface Props {
  owner: OwnerConfig;
  update: (fn: (prev: AionimaConfig) => AionimaConfig) => void;
}

export function OwnerSettings({ owner, update }: Props) {
  return (
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
  );
}
