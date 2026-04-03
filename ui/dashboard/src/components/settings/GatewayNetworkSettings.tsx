/**
 * GatewayNetworkSettings — Host, port, initial state.
 */

import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SectionHeading, FieldGroup } from "./SettingsShared.js";
import type { AionimaConfig, GatewayConfig } from "../../types.js";

interface Props {
  gateway: GatewayConfig;
  update: (fn: (prev: AionimaConfig) => AionimaConfig) => void;
}

export function GatewayNetworkSettings({ gateway, update }: Props) {
  return (
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
  );
}
