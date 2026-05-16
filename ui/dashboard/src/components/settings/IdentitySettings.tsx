/**
 * IdentitySettings — HIVE-ID connection status + federation config.
 *
 * Shows federation settings and OAuth provider configuration.
 * Identity is now handled directly by the gateway (absorbed from agi-local-id).
 */

import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SectionHeading, FieldGroup } from "./SettingsShared.js";
import type { AionimaConfig } from "../../types.js";

export function IdentitySettings({
  config,
  update,
}: {
  config: AionimaConfig;
  update: (fn: (prev: AionimaConfig) => AionimaConfig) => void;
}) {
  const federation = (config as Record<string, unknown>).federation as {
    enabled?: boolean;
    publicUrl?: string;
    seedPeers?: string[];
    autoGeid?: boolean;
    allowVisitors?: boolean;
  } | undefined;

  const setNested = (path: string, value: unknown) => {
    update((prev) => {
      const result = { ...prev } as Record<string, unknown>;
      const parts = path.split(".");
      let cur = result;
      for (let i = 0; i < parts.length - 1; i++) {
        cur[parts[i]!] = { ...(cur[parts[i]!] as Record<string, unknown>) };
        cur = cur[parts[i]!] as Record<string, unknown>;
      }
      cur[parts[parts.length - 1]!] = value;
      return result as AionimaConfig;
    });
  };

  return (
    <div className="space-y-6">
      {/* Federation / HIVE Network */}
      <Card className="p-4">
        <SectionHeading>HIVE Network (Federation)</SectionHeading>
        <p className="text-[12px] text-muted-foreground mb-3">
          Participate in the HIVE network to enable cross-node entity resolution, federated messaging, and Global Entity IDs (GEIDs).
        </p>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-foreground">Enable Federation</span>
            <button
              type="button"
              onClick={() => setNested("federation.enabled", !federation?.enabled)}
              className={cn(
                "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
                federation?.enabled ? "bg-green" : "bg-surface1",
              )}
            >
              <span className={cn("inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform", federation?.enabled ? "translate-x-4" : "translate-x-0.5")} />
            </button>
          </div>
          {federation?.enabled && (
            <>
              <FieldGroup label="Public URL">
                <Input
                  type="text"
                  value={federation.publicUrl ?? ""}
                  onChange={(e) => setNested("federation.publicUrl", e.target.value)}
                  placeholder="https://your-node.example.com"
                  className="text-[13px]"
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  Your node's public URL for HIVE registration and peer discovery.
                </p>
              </FieldGroup>
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[13px] text-foreground">Auto-generate GEIDs</span>
                  <p className="text-[10px] text-muted-foreground">Automatically assign Global Entity IDs to new entities.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setNested("federation.autoGeid", !(federation.autoGeid !== false))}
                  className={cn(
                    "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
                    (federation.autoGeid !== false) ? "bg-green" : "bg-surface1",
                  )}
                >
                  <span className={cn("inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform", (federation.autoGeid !== false) ? "translate-x-4" : "translate-x-0.5")} />
                </button>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[13px] text-foreground">Allow Visitors</span>
                  <p className="text-[10px] text-muted-foreground">Accept authentication from federated nodes.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setNested("federation.allowVisitors", !(federation.allowVisitors !== false))}
                  className={cn(
                    "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
                    (federation.allowVisitors !== false) ? "bg-green" : "bg-surface1",
                  )}
                >
                  <span className={cn("inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform", (federation.allowVisitors !== false) ? "translate-x-4" : "translate-x-0.5")} />
                </button>
              </div>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
