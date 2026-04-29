/**
 * GatewayNetworkSettings — Host, port, release channel, Cloudflare tunnels,
 * plus a read-only operational-state pill and a Restart button.
 *
 * The gateway `state` field is NOT a user setting — it reflects AGI's
 * connection to Aionima-prime + Hive-ID (see docs/agents/state-machine.md).
 * Initial / Limbo / Offline / Online are computed; the dashboard exposes
 * them as a status, not a select.
 */

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { SectionHeading, FieldGroup } from "./SettingsShared.js";
import {
  fetchCloudflaredStatus,
  startCloudflaredLogin,
  cloudflaredLogout,
  fetchMachineNetwork,
  setMachineNetwork,
  fetchGatewayState,
  restartGateway,
  type CloudflaredStatus,
  type MachineNetworkInfo,
  type GatewayStateResponse,
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

  // Live operational state (read-only, polled) + restart button state
  const [liveState, setLiveState] = useState<GatewayStateResponse | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [restartError, setRestartError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const s = await fetchGatewayState();
        if (!cancelled) setLiveState(s);
      } catch {
        /* best-effort */
      }
    };
    void poll();
    const t = setInterval(() => void poll(), 5000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  const handleRestart = useCallback(async () => {
    setRestartError(null);
    setRestarting(true);
    try {
      await restartGateway();
      // Expect a ~3–5s gap while systemd brings the service back up.
      // Keep the button in "Restarting..." state and poll /api/gateway/state
      // until it answers again; restore the button on reconnect.
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 1000));
        try {
          const s = await fetchGatewayState();
          setLiveState(s);
          break;
        } catch {
          /* still restarting */
        }
      }
    } catch (err) {
      setRestartError(err instanceof Error ? err.message : "Restart failed");
    } finally {
      setRestarting(false);
    }
  }, []);

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
  const autoSync = gateway.autoSyncMarketplace !== false;
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
                  <Select
                    className="font-mono"
                    list={[
                      { value: "static", label: "Static" },
                      { value: "dhcp", label: "DHCP" },
                    ]}
                    value={netMethod}
                    onValueChange={(v) => setNetMethod(v as "static" | "dhcp")}
                  />
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
          <FieldGroup label="Operational State">
            <div className="flex items-center gap-3 h-9">
              <GatewayStatePill state={liveState?.state ?? "UNKNOWN"} />
              <Button
                size="sm"
                variant="outline"
                disabled={restarting}
                onClick={() => void handleRestart()}
                title="Graceful restart: writes the shutdown marker, exits, and lets the service supervisor bring the gateway back up."
              >
                {restarting ? "Restarting..." : "Restart gateway"}
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              Read-only. Reflects AGI's connection to Aionima-prime + Hive-ID.
            </p>
          </FieldGroup>
        </div>
        {restartError && <p className="text-xs text-red mt-2">{restartError}</p>}
      </Card>}

      {/* Release Channel */}
      {showGeneral && <Card className="p-6 gap-0 mb-4">
        <SectionHeading>Release Channel</SectionHeading>
        <div className="grid grid-cols-2 gap-4">
          <FieldGroup label="Update Channel">
            <Select
              className="font-mono"
              list={[
                { value: "main", label: "main (stable)" },
                { value: "dev", label: "dev (bleeding edge)" },
              ]}
              value={channel}
              onValueChange={(v) => update((prev) => ({
                ...prev,
                gateway: {
                  ...(prev.gateway ?? { host: "127.0.0.1", port: 3100, state: "OFFLINE" as const }),
                  updateChannel: v as "main" | "dev",
                },
              }))}
            />
          </FieldGroup>
        </div>
        <p className="text-[12px] text-muted-foreground">
          {channel === "dev"
            ? "Tracking the dev branch. Updates may include untested changes."
            : "Tracking the main branch. Updates are manually merged and stable."}
        </p>
      </Card>}

      {/* Marketplace auto-sync */}
      {showGeneral && <Card className="p-6 gap-0 mb-4">
        <SectionHeading>Marketplace</SectionHeading>
        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={autoSync}
            onChange={(e) => update((prev) => ({
              ...prev,
              gateway: {
                ...(prev.gateway ?? { host: "127.0.0.1", port: 3100, state: "OFFLINE" as const }),
                autoSyncMarketplace: e.target.checked,
              },
            }))}
            className="w-4 h-4 rounded border-input cursor-pointer"
          />
          <div>
            <div className="text-[13px] font-medium text-foreground">Auto-sync marketplaces</div>
            <div className="text-[11px] text-muted-foreground">Periodically check for new plugins and updates (every 30 min)</div>
          </div>
        </div>
      </Card>}

      {/* Agent behavior */}
      {showGeneral && <Card className="p-6 gap-0 mb-4">
        <SectionHeading>Agent Behavior</SectionHeading>
        <div className="grid grid-cols-2 gap-4">
          <FieldGroup label="Max Tool Loops per Turn">
            <Input
              type="number"
              min={0}
              step={1}
              className="font-mono"
              value={gateway.maxToolLoops ?? 0}
              onChange={(e) => {
                const n = Number.parseInt(e.target.value, 10);
                const val = Number.isFinite(n) && n >= 0 ? n : 0;
                update((prev) => ({
                  ...prev,
                  gateway: {
                    ...(prev.gateway ?? { host: "127.0.0.1", port: 3100, state: "OFFLINE" as const }),
                    maxToolLoops: val,
                  },
                }));
              }}
              data-testid="gateway-max-tool-loops"
            />
          </FieldGroup>
        </div>
        <p className="text-[12px] text-muted-foreground mt-1">
          Maximum number of tool iterations the agent can perform in a single turn.
          <strong> 0 = uncapped (recommended).</strong> The circuit breaker already stops
          runaway loops on duplicate tool calls, so this is purely a per-turn cost ceiling
          for users who want one.
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
                <Select
                  className="font-mono"
                  list={[
                    { value: "named", label: "Named (persistent URL, requires auth + domain)" },
                    { value: "quick", label: "Quick (ephemeral URL, no auth needed)" },
                  ]}
                  value={tunnelMode}
                  onValueChange={(v) => update((prev) => ({
                    ...prev,
                    hosting: { ...(prev.hosting as Record<string, unknown>), tunnelMode: v },
                  }))}
                />
              </FieldGroup>
              <FieldGroup label="Cloudflare Domain">
                <Input
                  className="font-mono"
                  value={tunnelDomain}
                  onChange={(e) => update((prev) => ({
                    ...prev,
                    hosting: { ...(prev.hosting as Record<string, unknown>), tunnelDomain: e.target.value || undefined },
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

// ---------------------------------------------------------------------------
// GatewayStatePill — read-only indicator for the operational state.
// Semantics (see docs/agents/state-machine.md):
//   INITIAL / UNKNOWN — boot not yet complete
//   LIMBO             — running but local COA<>COI not validated with 0PRIME
//                       Schema; expected steady state until 0PRIME is live
//   OFFLINE           — local-id or local-prime unavailable
//   ONLINE            — future; requires 0PRIME Hive mind
// ---------------------------------------------------------------------------

function GatewayStatePill({ state }: { state: string }) {
  const info: Record<string, { label: string; classes: string; title: string }> = {
    ONLINE: {
      label: "Online",
      classes: "border-green text-green",
      title: "HIVE-aligned: local COA<>COI validates against 0PRIME Schema",
    },
    LIMBO: {
      label: "Limbo",
      classes: "border-yellow text-yellow",
      title: "Local running; COA<>COI not yet validated with 0PRIME Schema (0PRIME Hive mind is not operational yet)",
    },
    OFFLINE: {
      label: "Offline",
      classes: "border-red text-red",
      title: "local-id or local-prime is unavailable",
    },
    INITIAL: {
      label: "Initial",
      classes: "border-overlay0 text-overlay0",
      title: "Gateway is booting; state has not yet resolved",
    },
    UNKNOWN: {
      label: "Initial",
      classes: "border-overlay0 text-overlay0",
      title: "Gateway is booting; state has not yet resolved",
    },
  };
  const i = info[state] ?? info.UNKNOWN!;
  return (
    <span
      className={cn(
        "inline-flex items-center h-7 px-3 rounded-full border text-xs font-mono",
        i.classes,
      )}
      title={i.title}
    >
      {i.label}
    </span>
  );
}
