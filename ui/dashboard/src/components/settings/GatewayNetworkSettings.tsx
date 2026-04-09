/**
 * GatewayNetworkSettings — Host, port, initial state, release channel, and Cloudflare tunnel management.
 */

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SectionHeading, FieldGroup } from "./SettingsShared.js";
import {
  fetchCloudflaredStatus,
  startCloudflaredLogin,
  cloudflaredLogout,
  type CloudflaredStatus,
} from "../../api.js";
import type { AionimaConfig, GatewayConfig } from "../../types.js";

interface Props {
  gateway: GatewayConfig;
  config: AionimaConfig;
  update: (fn: (prev: AionimaConfig) => AionimaConfig) => void;
}

export function GatewayNetworkSettings({ gateway, config, update }: Props) {
  // Cloudflared state
  const [cfStatus, setCfStatus] = useState<CloudflaredStatus | null>(null);
  const [cfLoading, setCfLoading] = useState(false);
  const [cfLoginUrl, setCfLoginUrl] = useState<string | null>(null);
  const [cfLoginPending, setCfLoginPending] = useState(false);
  const [cfError, setCfError] = useState<string | null>(null);

  // Fetch cloudflared status on mount
  useEffect(() => {
    setCfLoading(true);
    fetchCloudflaredStatus()
      .then(setCfStatus)
      .catch(() => { /* hosting API unavailable */ })
      .finally(() => setCfLoading(false));
  }, []);

  // Poll during login flow — check every 3s until authenticated
  useEffect(() => {
    if (!cfLoginPending) return;
    const interval = setInterval(() => {
      fetchCloudflaredStatus()
        .then((status) => {
          setCfStatus(status);
          if (status.authenticated) {
            setCfLoginPending(false);
            setCfLoginUrl(null);
          }
        })
        .catch(() => {});
    }, 3000);
    return () => clearInterval(interval);
  }, [cfLoginPending]);

  const handleCfLogin = useCallback(async () => {
    setCfError(null);
    setCfLoginPending(true);
    try {
      const result = await startCloudflaredLogin();
      setCfLoginUrl(result.loginUrl);
    } catch (err) {
      setCfError(err instanceof Error ? err.message : "Login failed");
      setCfLoginPending(false);
    }
  }, []);

  const handleCfLogout = useCallback(async () => {
    setCfError(null);
    try {
      const result = await cloudflaredLogout();
      if (result.success) {
        setCfStatus((prev) => prev ? { ...prev, authenticated: false } : null);
      } else {
        setCfError(result.error ?? "Disconnect failed");
      }
    } catch (err) {
      setCfError(err instanceof Error ? err.message : "Disconnect failed");
    }
  }, []);

  const channel = gateway.updateChannel ?? "main";
  const tunnelMode = (config.hosting as Record<string, unknown> | undefined)?.["tunnelMode"] as string ?? "named";

  return (
    <>
      {/* Gateway Host/Port/State */}
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

      {/* Release Channel */}
      <Card className="p-6 gap-0 mb-4">
        <SectionHeading>Release Channel</SectionHeading>
        <div className="grid grid-cols-2 gap-4">
          <FieldGroup label="Update Channel">
            <select
              className="w-full h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm font-mono cursor-pointer"
              value={channel}
              onChange={(e) => update((prev) => ({
                ...prev,
                gateway: {
                  ...(prev.gateway ?? { host: "127.0.0.1", port: 3100, state: "OFFLINE" as const }),
                  updateChannel: e.target.value as "main" | "dev",
                },
              }))}
            >
              <option value="main">main (stable)</option>
              <option value="dev">dev (bleeding edge)</option>
            </select>
          </FieldGroup>
        </div>
        <p className="text-[12px] text-muted-foreground">
          {channel === "dev"
            ? "Tracking the dev branch. Updates may include untested changes."
            : "Tracking the main branch. Updates are manually merged and stable."}
        </p>
      </Card>

      {/* Cloudflare Tunnel */}
      <Card className="p-6 gap-0 mb-4">
        <SectionHeading>Cloudflare Tunnel</SectionHeading>

        {cfLoading ? (
          <p className="text-sm text-muted-foreground">Loading tunnel status...</p>
        ) : cfStatus === null ? (
          <p className="text-sm text-muted-foreground">Hosting infrastructure not available</p>
        ) : (
          <>
            {/* Status bar */}
            <div className="flex items-center gap-4 mb-4 text-[13px] text-muted-foreground font-mono bg-surface0 rounded-md px-3 py-2">
              <span>
                cloudflared:{" "}
                <span className={cn("font-medium", cfStatus.binaryInstalled ? "text-green" : "text-red")}>
                  {cfStatus.binaryInstalled ? "Installed" : "Not installed"}
                </span>
              </span>
              <span>
                Account:{" "}
                <span className={cn("font-medium", cfStatus.authenticated ? "text-green" : "text-yellow")}>
                  {cfStatus.authenticated ? "Connected" : "Not connected"}
                </span>
              </span>
            </div>

            {/* Account Binding */}
            {cfStatus.binaryInstalled && (
              <div className="mb-4">
                {cfStatus.authenticated ? (
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-green/10 text-green border border-green/30">
                      Authenticated
                    </span>
                    <span className="text-[12px] text-muted-foreground font-mono">{cfStatus.certPath}</span>
                    <Button variant="outline" size="xs" onClick={() => void handleCfLogout()} className="text-red">
                      Disconnect
                    </Button>
                  </div>
                ) : (
                  <div>
                    {cfLoginUrl ? (
                      <div className="space-y-2">
                        <p className="text-[13px] text-muted-foreground">
                          Complete authentication by visiting this URL in your browser:
                        </p>
                        <div className="flex items-center gap-2">
                          <a
                            href={cfLoginUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[12px] text-primary underline font-mono break-all"
                          >
                            {cfLoginUrl}
                          </a>
                          <button
                            onClick={() => void navigator.clipboard.writeText(cfLoginUrl)}
                            className="text-[10px] text-muted-foreground hover:text-foreground shrink-0 cursor-pointer"
                          >
                            Copy
                          </button>
                        </div>
                        <p className="text-[11px] text-muted-foreground animate-pulse">
                          Waiting for authentication...
                        </p>
                      </div>
                    ) : (
                      <Button onClick={() => void handleCfLogin()} disabled={cfLoginPending}>
                        {cfLoginPending ? "Connecting..." : "Connect Cloudflare Account"}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Default Tunnel Mode */}
            <div className="grid grid-cols-2 gap-4 mb-4">
              <FieldGroup label="Default Tunnel Mode">
                <select
                  className="w-full h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm font-mono cursor-pointer"
                  value={tunnelMode}
                  onChange={(e) => update((prev) => ({
                    ...prev,
                    hosting: { ...(prev.hosting as Record<string, unknown> ?? {}), tunnelMode: e.target.value },
                  }))}
                >
                  <option value="named">Named (persistent URL, requires auth)</option>
                  <option value="quick">Quick (ephemeral URL, no auth needed)</option>
                </select>
              </FieldGroup>
            </div>

            {/* Active Tunnels */}
            {cfStatus.activeTunnels.length > 0 && (
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-2">
                  Active Tunnels ({cfStatus.activeTunnels.length})
                </div>
                <div className="space-y-1.5">
                  {cfStatus.activeTunnels.map((t) => (
                    <div
                      key={t.projectPath}
                      className="flex items-center gap-3 text-[12px] font-mono bg-surface0 rounded-md px-3 py-1.5"
                    >
                      <span className="text-foreground font-medium">{t.hostname}</span>
                      <span
                        className={cn(
                          "text-[10px] px-1 py-0.5 rounded",
                          t.tunnelType === "named"
                            ? "bg-primary/10 text-primary"
                            : "bg-yellow/10 text-yellow",
                        )}
                      >
                        {t.tunnelType}
                      </span>
                      <a
                        href={t.tunnelUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-green underline truncate"
                      >
                        {t.tunnelUrl}
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {cfError && (
              <span className="text-[13px] text-red mt-2 block">{cfError}</span>
            )}
          </>
        )}
      </Card>
    </>
  );
}
