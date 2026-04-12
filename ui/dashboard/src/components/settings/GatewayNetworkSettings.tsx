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
  fetchMachineNetwork,
  setMachineNetwork,
  type CloudflaredStatus,
  type MachineNetworkInfo,
} from "../../api.js";
import type { AionimaConfig, GatewayConfig } from "../../types.js";

interface Props {
  gateway: GatewayConfig;
  config: AionimaConfig;
  update: (fn: (prev: AionimaConfig) => AionimaConfig) => void;
  /** Which section to render: "general" shows release channel + state, "network" shows IP + tunnels. Omit for all. */
  section?: "general" | "network";
}

export function GatewayNetworkSettings({ gateway, config, update, section }: Props) {
  // Machine network state
  const [netInfo, setNetInfo] = useState<MachineNetworkInfo | null>(null);
  const [netMethod, setNetMethod] = useState<"static" | "dhcp">("dhcp");
  const [netIp, setNetIp] = useState("");
  const [netSubnet, setNetSubnet] = useState("24");
  const [netGateway, setNetGateway] = useState("");
  const [netSaving, setNetSaving] = useState(false);
  const [netError, setNetError] = useState<string | null>(null);

  // Fetch machine network info on mount
  useEffect(() => {
    fetchMachineNetwork()
      .then((info) => {
        setNetInfo(info);
        if (info.supported) {
          setNetMethod(info.method ?? "dhcp");
          setNetIp(info.ip ?? "");
          setNetSubnet(info.subnet ?? "24");
          setNetGateway(info.gateway ?? "");
        }
      })
      .catch(() => { /* machine API unavailable */ });
  }, []);

  const handleNetworkSave = useCallback(async () => {
    setNetSaving(true);
    setNetError(null);
    try {
      await setMachineNetwork({
        method: netMethod,
        ip: netMethod === "static" ? netIp : undefined,
        subnet: netMethod === "static" ? netSubnet : undefined,
        gateway: netMethod === "static" ? netGateway : undefined,
      });
      // Refresh network info after change
      const info = await fetchMachineNetwork();
      setNetInfo(info);
    } catch (err) {
      setNetError(err instanceof Error ? err.message : "Failed to update network");
    } finally {
      setNetSaving(false);
    }
  }, [netMethod, netIp, netSubnet, netGateway]);

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
  const tunnelDomain = (config.hosting as Record<string, unknown> | undefined)?.["tunnelDomain"] as string ?? "";

  const showGeneral = !section || section === "general";
  const showNetwork = !section || section === "network";

  return (
    <>
      {/* Machine IP Configuration */}
      {showNetwork && netInfo && (
        <Card className="p-6 gap-0 mb-4">
          <SectionHeading>Machine IP</SectionHeading>
          {!netInfo.supported ? (
            <p className="text-sm text-muted-foreground">{netInfo.reason ?? "Network configuration is managed by your operating system."}</p>
          ) : (
            <>
              <div className="flex items-center gap-3 mb-3">
                <span className="text-xs text-muted-foreground">Interface: {netInfo.interface}</span>
                <span className="text-xs text-muted-foreground">Connection: {netInfo.connection}</span>
              </div>
              <div className="grid grid-cols-4 gap-4">
                <FieldGroup label="Method">
                  <select
                    className="w-full h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm font-mono cursor-pointer"
                    value={netMethod}
                    onChange={(e) => setNetMethod(e.target.value as "static" | "dhcp")}
                  >
                    <option value="static">Static</option>
                    <option value="dhcp">DHCP</option>
                  </select>
                </FieldGroup>
                {netMethod === "static" && (
                  <>
                    <FieldGroup label="IP Address">
                      <Input className="font-mono" value={netIp} onChange={(e) => setNetIp(e.target.value)} />
                    </FieldGroup>
                    <FieldGroup label="Subnet Prefix">
                      <Input className="font-mono" value={netSubnet} onChange={(e) => setNetSubnet(e.target.value)} />
                    </FieldGroup>
                    <FieldGroup label="Gateway">
                      <Input className="font-mono" value={netGateway} onChange={(e) => setNetGateway(e.target.value)} />
                    </FieldGroup>
                  </>
                )}
              </div>
              {netError && <p className="text-xs text-red mt-2">{netError}</p>}
              <div className="mt-3 flex items-center gap-3">
                <Button size="sm" disabled={netSaving} onClick={() => void handleNetworkSave()}>
                  {netSaving ? "Applying..." : "Apply"}
                </Button>
                <span className="text-xs text-yellow">Changing the IP will disconnect your current session. Reconnect at the new address.</span>
              </div>
            </>
          )}
        </Card>
      )}

      {/* Gateway Host/Port/State */}
      {showGeneral && <Card className="p-6 gap-0 mb-4">
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
      </Card>}

      {/* Release Channel */}
      {showGeneral && <Card className="p-6 gap-0 mb-4">
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
      </Card>}

      {/* Cloudflare Tunnel */}
      {showNetwork && <>
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

            {/* Default Tunnel Mode + Domain */}
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
                  <option value="named">Named (persistent URL, requires auth + domain)</option>
                  <option value="quick">Quick (ephemeral URL, no auth needed)</option>
                </select>
              </FieldGroup>
              <FieldGroup label="Cloudflare Domain">
                <Input
                  className="font-mono"
                  value={tunnelDomain}
                  onChange={(e) => update((prev) => ({
                    ...prev,
                    hosting: { ...(prev.hosting as Record<string, unknown> ?? {}), tunnelDomain: e.target.value || undefined },
                  }))}
                  placeholder="example.com"
                />
              </FieldGroup>
            </div>
            {tunnelMode === "named" && !tunnelDomain && (
              <p className="text-[12px] text-yellow mb-4">
                Named tunnels require a Cloudflare-managed domain. Projects will use quick tunnels until a domain is configured.
              </p>
            )}
            {tunnelMode === "named" && tunnelDomain && (
              <p className="text-[12px] text-muted-foreground mb-4">
                Named tunnels will create DNS records as &lt;project&gt;.{tunnelDomain}
              </p>
            )}

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
      </>}
    </>
  );
}
