/**
 * Settings > HF Marketplace — hardware profile, capabilities, storage, and authentication.
 */

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useSettingsContext } from "./settings-layout.js";
import { SettingsSaveBar } from "@/components/settings/SettingsSaveBar.js";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useHFHardwareProfile } from "../hooks.js";
import { rescanHFHardware, fetchHFCapabilities, fetchHFAuthStatus } from "../api.js";
import type { AionimaConfig, HFCapabilityEntry, HFCapabilityStatus } from "../types.js";

type Tab = "hardware" | "capabilities" | "storage" | "authentication";

const tabs: { id: Tab; label: string }[] = [
  { id: "hardware", label: "Hardware" },
  { id: "capabilities", label: "Capabilities" },
  { id: "storage", label: "Storage" },
  { id: "authentication", label: "Authentication" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(0)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

const tierVariant: Record<string, "default" | "secondary" | "outline"> = {
  pro: "default",
  accelerated: "default",
  standard: "secondary",
  minimal: "outline",
};

const capabilityDot: Record<HFCapabilityStatus, string> = {
  on: "bg-green-500",
  limited: "bg-yellow-400",
  off: "bg-muted-foreground/40",
};

// ---------------------------------------------------------------------------
// HardwareTab
// ---------------------------------------------------------------------------

function HardwareTab() {
  const { data, isLoading, error, refetch } = useHFHardwareProfile();
  const [rescanning, setRescanning] = useState(false);
  const [rescanError, setRescanError] = useState<string | null>(null);

  const handleRescan = useCallback(async () => {
    setRescanning(true);
    setRescanError(null);
    try {
      await rescanHFHardware();
      await refetch();
    } catch (err) {
      setRescanError(err instanceof Error ? err.message : "Rescan failed");
    } finally {
      setRescanning(false);
    }
  }, [refetch]);

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading hardware profile...</p>;
  }

  if (error) {
    return <p className="text-sm text-destructive">{error.message}</p>;
  }

  if (!data) return null;

  const { cpu, ram, gpu, disk, podman, capabilities } = data;
  const gpuPresent = gpu.length > 0;

  return (
    <div className="space-y-4">
      {/* Summary */}
      <Card className="p-4 flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-semibold">System Tier</span>
            <Badge variant={tierVariant[capabilities.tier] ?? "outline"}>
              {capabilities.tier}
            </Badge>
          </div>
          <p className="text-[13px] text-muted-foreground">{capabilities.summary}</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void handleRescan()}
          disabled={rescanning}
        >
          {rescanning ? "Scanning..." : "Re-scan Hardware"}
        </Button>
      </Card>
      {rescanError && (
        <p className="text-sm text-destructive">{rescanError}</p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* CPU */}
        <Card className="p-4 space-y-1">
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">CPU</p>
          <p className="text-sm font-medium truncate">{cpu.model}</p>
          <p className="text-[13px] text-muted-foreground">
            {cpu.cores} cores / {cpu.threads} threads
          </p>
          <div className="flex gap-1 flex-wrap mt-1">
            {cpu.avx2 && <Badge variant="outline" className="text-[11px]">AVX2</Badge>}
            {cpu.avx512 && <Badge variant="outline" className="text-[11px]">AVX-512</Badge>}
          </div>
        </Card>

        {/* RAM */}
        <Card className="p-4 space-y-1">
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">RAM</p>
          <p className="text-sm font-medium">{formatBytes(ram.totalBytes)} total</p>
          <p className="text-[13px] text-muted-foreground">
            {formatBytes(ram.availableBytes)} available
          </p>
        </Card>

        {/* GPU */}
        <Card className="p-4 space-y-1">
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">GPU</p>
          {gpuPresent ? (
            gpu.map((g) => (
              <div key={g.index}>
                <p className="text-sm font-medium truncate">{g.name}</p>
                <p className="text-[13px] text-muted-foreground">
                  {formatBytes(g.vramBytes)} VRAM &bull; {g.vendor}
                </p>
                {g.driverVersion && (
                  <p className="text-[11px] text-muted-foreground">Driver {g.driverVersion}</p>
                )}
              </div>
            ))
          ) : (
            <p className="text-[13px] text-muted-foreground">No GPU detected — CPU inference only</p>
          )}
        </Card>

        {/* Disk */}
        <Card className="p-4 space-y-1">
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Disk (model cache)</p>
          <p className="text-sm font-medium">{formatBytes(disk.availableBytes)} free</p>
          <p className="text-[13px] text-muted-foreground">
            of {formatBytes(disk.totalBytes)} total
          </p>
          <p className="text-[11px] text-muted-foreground truncate">{disk.modelCachePath}</p>
        </Card>

        {/* Podman */}
        <Card className="p-4 space-y-1">
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Podman</p>
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "inline-block w-2 h-2 rounded-full",
                podman.available ? "bg-green-500" : "bg-muted-foreground/40",
              )}
            />
            <p className="text-sm font-medium">{podman.available ? "Available" : "Not available"}</p>
          </div>
          {podman.version && (
            <p className="text-[13px] text-muted-foreground">Version {podman.version}</p>
          )}
          {podman.available && (
            <p className="text-[11px] text-muted-foreground">
              GPU runtime: {podman.gpuRuntime ? "yes" : "no"}
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CapabilitiesTab
// ---------------------------------------------------------------------------

function CapabilitiesTab() {
  const [capabilities, setCapabilities] = useState<HFCapabilityEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetchHFCapabilities()
      .then(setCapabilities)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load capabilities"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-sm text-muted-foreground">Loading capabilities...</p>;
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!capabilities) return null;

  return (
    <div className="space-y-3">
      {capabilities.map((cap) => (
        <Card key={cap.id} className="p-4">
          <div className="flex items-start gap-3">
            <span
              className={cn("mt-0.5 shrink-0 w-2.5 h-2.5 rounded-full", capabilityDot[cap.status])}
            />
            <div className="flex-1 min-w-0 space-y-0.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold">{cap.label}</span>
                <Badge
                  variant={cap.status === "on" ? "default" : "outline"}
                  className="text-[11px]"
                >
                  {cap.status}
                </Badge>
              </div>
              <p className="text-[13px] text-muted-foreground">{cap.description}</p>
              <p className="text-[13px]">{cap.reason}</p>
              {cap.unlockHint && (
                <div className="mt-2 rounded-md bg-muted px-3 py-2 text-[12px] text-muted-foreground">
                  {cap.unlockHint}
                </div>
              )}
              <p className="text-[11px] text-muted-foreground">
                Required: {cap.hardwareRequired}
              </p>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// StorageTab
// ---------------------------------------------------------------------------

interface StorageTabProps {
  draft: AionimaConfig;
}

function StorageTab({ draft }: StorageTabProps) {
  const { data: hardware } = useHFHardwareProfile();

  const cacheDir = (draft as AionimaConfig & { hf?: { cacheDir?: string } }).hf?.cacheDir;
  const resolvedPath = cacheDir ?? hardware?.disk.modelCachePath ?? "~/.cache/huggingface/hub";

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-3">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-1">
            Model Cache Path
          </p>
          <p className="text-sm font-mono bg-secondary rounded px-2 py-1 break-all">{resolvedPath}</p>
          <p className="text-[12px] text-muted-foreground mt-1">
            Read-only. To change the cache location, update <span className="font-mono">hf.cacheDir</span> in your config file.
          </p>
        </div>

        {hardware && (
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-1">
              Disk Space
            </p>
            <div className="flex items-center gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Available: </span>
                <span className="font-medium">{formatBytes(hardware.disk.availableBytes)}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Total: </span>
                <span className="font-medium">{formatBytes(hardware.disk.totalBytes)}</span>
              </div>
            </div>
            {/* Disk usage bar */}
            <div className="mt-2 h-1.5 w-full rounded-full bg-secondary overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all"
                style={{
                  width: `${Math.min(100, ((hardware.disk.totalBytes - hardware.disk.availableBytes) / hardware.disk.totalBytes) * 100).toFixed(1)}%`,
                }}
              />
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AuthenticationTab
// ---------------------------------------------------------------------------

function AuthenticationTab() {
  const [authStatus, setAuthStatus] = useState<{ authenticated: boolean; username?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetchHFAuthStatus()
      .then(setAuthStatus)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load auth status"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-sm text-muted-foreground">Checking authentication...</p>;
  if (error) return <p className="text-sm text-destructive">{error}</p>;

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-3">
        <div>
          <p className="text-sm font-semibold mb-0.5">Connect HuggingFace</p>
          <p className="text-[13px] text-muted-foreground">
            Only needed for gated or private models. Public models are available without authentication.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <span
            className={cn(
              "inline-block w-2.5 h-2.5 rounded-full shrink-0",
              authStatus?.authenticated ? "bg-green-500" : "bg-muted-foreground/40",
            )}
          />
          {authStatus?.authenticated ? (
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <span className="text-sm font-medium">Connected</span>
              {authStatus.username && (
                <Badge variant="secondary" className="text-[11px]">
                  {authStatus.username}
                </Badge>
              )}
            </div>
          ) : (
            <span className="text-sm text-muted-foreground">Not connected</span>
          )}
        </div>

        {authStatus?.authenticated ? (
          <Button size="sm" variant="outline" disabled>
            Disconnect (coming soon)
          </Button>
        ) : (
          <div className="space-y-2">
            <Button size="sm" variant="outline" disabled>
              Connect HuggingFace (coming soon)
            </Button>
            <p className="text-[12px] text-muted-foreground">
              OAuth connection flow will be available in a future update.
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SettingsHFPage() {
  const { configHook } = useSettingsContext();
  const [activeTab, setActiveTab] = useState<Tab>("hardware");
  const [draft, setDraft] = useState<AionimaConfig>(configHook.data ?? ({} as AionimaConfig));
  const [dirty, setDirty] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (configHook.data) {
      setDraft(configHook.data);
      setDirty(false);
    }
  }, [configHook.data]);

  const update = useCallback((fn: (prev: AionimaConfig) => AionimaConfig) => {
    setDraft((prev) => {
      const next = fn(prev);
      setDirty(true);
      return next;
    });
  }, []);

  const handleSave = useCallback(async () => {
    setSaveError(null);
    try {
      await configHook.save(draft);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    }
  }, [draft, configHook]);

  void update; // referenced by StorageTab in future when config fields are editable

  if (!configHook.data) return null;

  const hfEnabled = Boolean((configHook.data as Record<string, unknown>).hf && ((configHook.data as Record<string, unknown>).hf as Record<string, unknown>).enabled);

  // When HF is not enabled, only show config-based tabs (no API calls)
  const availableTabs = hfEnabled ? tabs : tabs.filter((t) => t.id === "storage");
  const safeTab = availableTabs.some((t) => t.id === activeTab) ? activeTab : (availableTabs[0]?.id ?? "storage");

  return (
    <div className="flex flex-col">
      <SettingsSaveBar
        dirty={dirty}
        saving={configHook.saving}
        saveMessage={configHook.saveMessage}
        saveError={saveError}
        onSave={() => void handleSave()}
      />

      {/* Enable/disable toggle */}
      <Card className="p-4 mb-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">HuggingFace Model Runtime</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {hfEnabled
                ? "Browse, download, and run HuggingFace models locally."
                : "Enable to browse, download, and serve ML models from HuggingFace Hub via local containers."}
            </p>
          </div>
          <Button
            size="sm"
            variant={hfEnabled ? "outline" : "default"}
            onClick={() => {
              update((prev) => ({
                ...prev,
                hf: { ...(prev as Record<string, unknown>).hf as Record<string, unknown> | undefined, enabled: !hfEnabled },
              } as AionimaConfig));
            }}
          >
            {hfEnabled ? "Disable" : "Enable"}
          </Button>
        </div>
        {!hfEnabled && dirty && (
          <p className="text-xs text-muted-foreground mt-2">
            Save and restart the gateway to activate HF Marketplace.
          </p>
        )}
      </Card>

      {/* Tab bar */}
      <div className="flex gap-1 mb-6 border-b border-border">
        {availableTabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "px-4 py-2 text-[13px] font-medium border-b-2 transition-colors cursor-pointer bg-transparent",
              safeTab === tab.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {safeTab === "hardware" && hfEnabled && <HardwareTab />}
      {safeTab === "capabilities" && hfEnabled && <CapabilitiesTab />}
      {safeTab === "storage" && <StorageTab draft={draft} />}
      {safeTab === "authentication" && hfEnabled && <AuthenticationTab />}
    </div>
  );
}
