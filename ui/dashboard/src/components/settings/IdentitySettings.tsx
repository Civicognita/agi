/**
 * IdentitySettings — LOCAL-ID and HIVE-ID connection status + federation config.
 *
 * Shows the identity service mode (local vs central), connection status,
 * federation settings, and OAuth provider configuration.
 */

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SectionHeading, FieldGroup } from "./SettingsShared.js";
import type { AionimaConfig } from "../../types.js";

interface IdServiceStatus {
  status: "connected" | "degraded" | "missing" | "error" | "central";
  mode: "local" | "central";
  url: string;
  version?: string;
}

interface ConnectionsResponse {
  idService?: IdServiceStatus;
}

export function IdentitySettings({
  config,
  update,
}: {
  config: AionimaConfig;
  update: (fn: (prev: AionimaConfig) => AionimaConfig) => void;
}) {
  const [idStatus, setIdStatus] = useState<IdServiceStatus | null>(null);

  useEffect(() => {
    fetch("/api/system/connections")
      .then((res) => res.json() as Promise<ConnectionsResponse>)
      .then((data) => { if (data.idService) setIdStatus(data.idService); })
      .catch(() => {});
  }, []);

  const federation = (config as Record<string, unknown>).federation as {
    enabled?: boolean;
    publicUrl?: string;
    seedPeers?: string[];
    autoGeid?: boolean;
    allowVisitors?: boolean;
  } | undefined;

  const idService = (config as Record<string, unknown>).idService as {
    local?: { enabled?: boolean; port?: number; subdomain?: string };
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

  const statusColor: Record<string, string> = {
    connected: "bg-green",
    central: "bg-blue",
    degraded: "bg-yellow",
    missing: "bg-muted-foreground",
    error: "bg-red",
  };

  const statusLabel: Record<string, string> = {
    connected: "Connected (Local)",
    central: "Connected (HIVE Central)",
    degraded: "Degraded",
    missing: "Not Configured",
    error: "Error",
  };

  return (
    <div className="space-y-6">
      {/* ID Service Status */}
      <Card className="p-4">
        <SectionHeading>Identity Service</SectionHeading>
        {idStatus ? (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <span className={cn("w-2.5 h-2.5 rounded-full", statusColor[idStatus.status] ?? "bg-muted-foreground")} />
              <span className="text-[13px] font-medium text-foreground">
                {statusLabel[idStatus.status] ?? idStatus.status}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 text-[12px]">
              <div>
                <span className="text-muted-foreground">Mode: </span>
                <span className="text-foreground font-medium">
                  {idStatus.mode === "local" ? "LOCAL-ID" : "HIVE-ID (Central)"}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">URL: </span>
                <span className="text-foreground font-mono">{idStatus.url}</span>
              </div>
            </div>
            {idStatus.mode === "central" && (
              <p className="text-[11px] text-muted-foreground">
                Using the central HIVE-ID service at id.aionima.ai. Enable LOCAL-ID below to run your own identity service.
              </p>
            )}
          </div>
        ) : (
          <p className="text-[12px] text-muted-foreground">Loading identity service status...</p>
        )}
      </Card>

      {/* LOCAL-ID Configuration */}
      <Card className="p-4">
        <SectionHeading>LOCAL-ID Service</SectionHeading>
        <p className="text-[12px] text-muted-foreground mb-3">
          Run your own identity service on this node. When enabled, entity registration, OAuth login, and GEID issuance happen locally instead of through the central HIVE-ID.
        </p>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-foreground">Enable LOCAL-ID</span>
            <button
              type="button"
              onClick={() => setNested("idService.local.enabled", !idService?.local?.enabled)}
              className={cn(
                "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
                idService?.local?.enabled ? "bg-green" : "bg-surface1",
              )}
            >
              <span className={cn("inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform", idService?.local?.enabled ? "translate-x-4" : "translate-x-0.5")} />
            </button>
          </div>
          {idService?.local?.enabled && (
            <div className="grid grid-cols-2 gap-3">
              <FieldGroup label="Port">
                <Input
                  type="number"
                  value={idService.local.port ?? 3200}
                  onChange={(e) => setNested("idService.local.port", Number(e.target.value))}
                  className="text-[13px]"
                />
              </FieldGroup>
              <FieldGroup label="Subdomain">
                <Input
                  type="text"
                  value={idService.local.subdomain ?? "id"}
                  onChange={(e) => setNested("idService.local.subdomain", e.target.value)}
                  placeholder="id"
                  className="text-[13px]"
                />
              </FieldGroup>
            </div>
          )}
        </div>
      </Card>

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
