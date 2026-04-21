/**
 * HardwareScanner — standalone hardware profile card cluster.
 *
 * Shows CPU, RAM, GPU, disk, Podman runtime, and the overall capability tier
 * from the HardwareProfiler. Originally lived in the HF Marketplace settings;
 * lifted to a shared component so System > Machine can host it as the primary
 * surface while specific settings pages can still reuse it if needed.
 */

import { useCallback, useState } from "react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useHFHardwareProfile } from "@/hooks.js";
import { rescanHFHardware } from "@/api.js";

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

export function HardwareScanner() {
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
    <div className="space-y-4" data-testid="hardware-scanner">
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
