/**
 * Resources route — system resource monitoring (CPU, RAM, disk, uptime).
 * Also includes a Database Storage section showing aggregate DB volume usage,
 * and a Running Model Containers section with per-container CPU/RAM stats.
 */

import { useEffect, useState } from "react";
import { ResourceUsage } from "@/components/ResourceUsage.js";
import { PageScroll } from "@/components/PageScroll.js";
import { Card } from "@/components/ui/card.js";
import { fetchDatabaseStorage } from "@/api.js";
import { useHFContainerStats, useMachineHardware } from "@/hooks.js";
import type { HFContainerStats } from "@/api.js";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(1)} GB`;
}

function DatabaseStorageSection() {
  const [data, setData] = useState<{
    projectBytes: number | null;
    totalBytes: number | null;
    volumeName: string | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDatabaseStorage()
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <p className="text-[11px] text-muted-foreground">Loading database storage...</p>;
  }

  if (!data || data.totalBytes === null) {
    return <p className="text-[11px] text-muted-foreground">No database volumes found.</p>;
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <span className="text-[9px] text-muted-foreground uppercase tracking-wider">Total Volume Usage</span>
          <div className="text-[22px] font-bold text-foreground mt-0.5">{formatBytes(data.totalBytes)}</div>
          {data.volumeName && (
            <div className="text-[10px] text-muted-foreground font-mono mt-0.5">{data.volumeName}</div>
          )}
        </div>
        {data.projectBytes !== null && (
          <div>
            <span className="text-[9px] text-muted-foreground uppercase tracking-wider">Project Data</span>
            <div className="text-[22px] font-bold text-foreground mt-0.5">{formatBytes(data.projectBytes)}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">across all hosted projects</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bar gauge — renders a horizontal percentage bar (0 to 100)
// ---------------------------------------------------------------------------

function BarGauge({ pct }: { pct: number }) {
  const clamped = Math.min(100, Math.max(0, pct));
  const colour =
    clamped >= 80 ? "bg-red-500" : clamped >= 60 ? "bg-amber-400" : "bg-emerald-500";
  return (
    <div className="w-full h-1.5 rounded-full bg-surface0 overflow-hidden">
      <div className={`h-full rounded-full ${colour}`} style={{ width: `${String(clamped)}%` }} />
    </div>
  );
}

function parsePct(s: string): number {
  return parseFloat(s.replace("%", "")) || 0;
}

function parseMemPct(usage: string): number {
  const parts = usage.split("/").map((p) => p.trim());
  if (parts.length < 2) return 0;
  const toBytes = (s: string): number => {
    const m = /^([\d.]+)\s*([a-zA-Z]*)$/.exec(s);
    if (!m) return 0;
    const n = parseFloat(m[1]!);
    const unit = (m[2] ?? "").toUpperCase();
    if (unit === "GIB" || unit === "GB") return n * 1024 ** 3;
    if (unit === "MIB" || unit === "MB") return n * 1024 ** 2;
    if (unit === "KIB" || unit === "KB") return n * 1024;
    return n;
  };
  const used = toBytes(parts[0]!);
  const limit = toBytes(parts[1]!);
  if (!limit) return 0;
  return Math.min(100, (used / limit) * 100);
}

// ---------------------------------------------------------------------------
// Running model containers section
// ---------------------------------------------------------------------------

function ContainerStatsRow({ c }: { c: HFContainerStats }) {
  const cpuPct = parsePct(c.cpuPct);
  const memPct = parseMemPct(c.memUsage);

  return (
    <tr className="border-b border-border last:border-0">
      <td className="py-2 pr-4">
        <div className="text-[11px] font-mono text-foreground truncate max-w-[160px]" title={c.modelId}>
          {c.name}
        </div>
        <div className="text-[9px] text-muted-foreground truncate max-w-[160px]">{c.modelId}</div>
      </td>
      <td className="py-2 pr-4 min-w-[80px]">
        <div className="text-[11px] text-foreground mb-1">{c.cpuPct}</div>
        <BarGauge pct={cpuPct} />
      </td>
      <td className="py-2 min-w-[120px]">
        <div className="text-[11px] text-foreground mb-1">{c.memUsage}</div>
        <BarGauge pct={memPct} />
      </td>
    </tr>
  );
}

function ModelContainerStatsSection() {
  const { data, isLoading, error } = useHFContainerStats();

  if (isLoading) {
    return <p className="text-[11px] text-muted-foreground">Loading container stats...</p>;
  }

  if (error) {
    return <p className="text-[11px] text-muted-foreground">Could not load container stats.</p>;
  }

  const containers = data?.containers ?? [];

  if (containers.length === 0) {
    return <p className="text-[11px] text-muted-foreground">No active model containers.</p>;
  }

  return (
    <table className="w-full">
      <thead>
        <tr className="border-b border-border">
          <th className="pb-1.5 text-left text-[9px] text-muted-foreground uppercase tracking-wider pr-4">Container</th>
          <th className="pb-1.5 text-left text-[9px] text-muted-foreground uppercase tracking-wider pr-4">CPU</th>
          <th className="pb-1.5 text-left text-[9px] text-muted-foreground uppercase tracking-wider">RAM</th>
        </tr>
      </thead>
      <tbody>
        {containers.map((c) => (
          <ContainerStatsRow key={c.name} c={c} />
        ))}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
// Power gauge — t378. Reads cpuWatts + gpuWatts from /api/system/stats, plus
// energy-used-today from /api/providers/cost/today (cost ledger watt totals).
// Both degrade to "—" when null (test VM has no RAPL exposure / no GPU; some
// hosts lack one or both samplers). System line item on True Cost graphs lands
// in a follow-up when the Impactinomics Resources tab is built.
// ---------------------------------------------------------------------------

function PowerGaugeSection() {
  const [power, setPower] = useState<{ cpuWatts: number | null; gpuWatts: number | null } | null>(null);
  const [energyToday, setEnergyToday] = useState<number | null>(null);
  const hw = useMachineHardware();

  // Detect-driven sub-labels: replace the previous hardcoded "RAPL / intel-rapl"
  // and "NVML / nvidia-smi" strings with what's actually present on this box.
  const cpuVendor = hw.data?.cpu.vendorId.toLowerCase() ?? "";
  const cpuSubLabel =
    cpuVendor.includes("intel") ? "RAPL / intel-rapl" :
    cpuVendor.includes("amd")   ? "RAPL / amd-rapl" :
    cpuVendor !== ""            ? "RAPL" :
                                  "—";
  const gpus = hw.data?.gpus ?? [];
  const nvidiaGpu = gpus.find((g) => g.driver === "nvidia");
  const otherGpu  = gpus.find((g) => g.driver !== null && g.driver !== "nvidia");
  const gpuSubLabel =
    nvidiaGpu ? `NVML — ${nvidiaGpu.model.replace(/^[A-Z0-9]+\s+\[/, "").replace(/\]\s*\(rev.*$/, "").replace(/\s*\(rev.*$/, "")}` :
    otherGpu  ? `${otherGpu.driver} — power not sampled` :
    gpus.length > 0 ? "no power sampler for detected GPU" :
                      "no GPU detected";

  useEffect(() => {
    let cancelled = false;
    const refresh = async (): Promise<void> => {
      try {
        const [statsRes, costRes] = await Promise.all([
          fetch("/api/system/stats").then((r) => r.ok ? r.json() as Promise<{ power?: { cpuWatts: number | null; gpuWatts: number | null } }> : null).catch(() => null),
          fetch("/api/providers/cost/today").then((r) => r.ok ? r.json() as Promise<{ watts: number }> : null).catch(() => null),
        ]);
        if (!cancelled) {
          setPower(statsRes?.power ?? null);
          setEnergyToday(costRes?.watts ?? null);
        }
      } catch { /* ignore */ }
    };
    void refresh();
    const id = window.setInterval(() => { void refresh(); }, 5_000);
    return (): void => { cancelled = true; window.clearInterval(id); };
  }, []);

  const cpuStr = power?.cpuWatts !== null && power?.cpuWatts !== undefined ? `${power.cpuWatts.toFixed(1)} W` : "—";
  const gpuStr = power?.gpuWatts !== null && power?.gpuWatts !== undefined ? `${power.gpuWatts.toFixed(1)} W` : "—";
  const energyStr = energyToday !== null && energyToday > 0 ? `${energyToday.toFixed(2)} Wh` : "—";

  const allNull = (power?.cpuWatts === null || power?.cpuWatts === undefined) && (power?.gpuWatts === null || power?.gpuWatts === undefined);

  return (
    <div className="grid grid-cols-3 gap-4" data-testid="power-gauge">
      <div>
        <span className="text-[9px] text-muted-foreground uppercase tracking-wider">CPU power</span>
        <div className="text-[22px] font-bold text-foreground mt-0.5 tabular-nums">{cpuStr}</div>
        <div className="text-[10px] text-muted-foreground mt-0.5">{cpuSubLabel}</div>
      </div>
      <div>
        <span className="text-[9px] text-muted-foreground uppercase tracking-wider">GPU power</span>
        <div className="text-[22px] font-bold text-foreground mt-0.5 tabular-nums">{gpuStr}</div>
        <div className="text-[10px] text-muted-foreground mt-0.5">{gpuSubLabel}</div>
      </div>
      <div>
        <span className="text-[9px] text-muted-foreground uppercase tracking-wider">Energy today</span>
        <div className="text-[22px] font-bold text-foreground mt-0.5 tabular-nums">{energyStr}</div>
        <div className="text-[10px] text-muted-foreground mt-0.5">cost ledger</div>
      </div>
      {allNull && (
        <div className="col-span-3 mt-2 text-[10px] text-muted-foreground">
          Power tracking unavailable on this machine — see <span className="font-mono">agi doctor</span> for details. Hardware-bound (RAPL + NVML); test VMs and machines without those samplers report null.
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// GPU live stats — per-GPU utilization, VRAM, temperature, power. Polls
// /api/system/stats every 5s. Hidden when no GPUs report stats (no
// nvidia-smi installed or no NVIDIA hardware). AMD ROCm enrichment is a
// follow-up; today only NVIDIA fills these fields.
// ---------------------------------------------------------------------------

interface GpuLiveRow {
  busId: string;
  name: string;
  gpuUtilPct: number | null;
  memUtilPct: number | null;
  memUsedMB: number | null;
  memTotalMB: number | null;
  tempC: number | null;
  powerW: number | null;
  powerLimitW: number | null;
}

function GpuLiveSection() {
  const [gpus, setGpus] = useState<GpuLiveRow[]>([]);
  const hw = useMachineHardware();

  useEffect(() => {
    let cancelled = false;
    const refresh = async (): Promise<void> => {
      try {
        const r = await fetch("/api/system/stats");
        if (!r.ok) return;
        const j = await r.json() as { gpus?: GpuLiveRow[] };
        if (!cancelled) setGpus(j.gpus ?? []);
      } catch { /* ignore */ }
    };
    void refresh();
    const id = window.setInterval(() => { void refresh(); }, 5_000);
    return (): void => { cancelled = true; window.clearInterval(id); };
  }, []);

  // Surface non-NVIDIA GPUs the static hardware probe found, even when we
  // have no live stats for them — owner can see they exist + which driver.
  const detected = hw.data?.gpus ?? [];
  const nonNvidiaDetected = detected.filter((g) => g.driver !== null && g.driver !== "nvidia");

  if (gpus.length === 0 && nonNvidiaDetected.length === 0) {
    return (
      <div className="text-[11px] text-muted-foreground">
        No GPU stats available. Install nvidia-smi or rocm-smi to surface live utilization, VRAM, and temperature.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {gpus.map((g) => {
        const memPct = g.memTotalMB && g.memUsedMB !== null
          ? Math.round((g.memUsedMB / g.memTotalMB) * 100) : null;
        const memUsedGB = g.memUsedMB !== null  ? (g.memUsedMB  / 1024).toFixed(1) : "—";
        const memTotalGB = g.memTotalMB !== null ? (g.memTotalMB / 1024).toFixed(1) : "—";
        return (
          <div key={g.busId} className="border border-border rounded p-3">
            <div className="flex items-center justify-between mb-2">
              <div>
                <div className="text-[12px] font-medium text-foreground">{g.name}</div>
                <code className="text-[10px] text-muted-foreground">{g.busId}</code>
              </div>
              <div className="text-right text-[10px] text-muted-foreground">
                {g.tempC !== null ? <span className="mr-3">{g.tempC}°C</span> : null}
                {g.powerW !== null
                  ? <span>{g.powerW.toFixed(1)} W{g.powerLimitW !== null ? <span className="text-muted-foreground"> / {g.powerLimitW.toFixed(0)} W</span> : null}</span>
                  : null}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
                  <span>Core utilization</span>
                  <span className="tabular-nums text-foreground">{g.gpuUtilPct !== null ? `${g.gpuUtilPct}%` : "—"}</span>
                </div>
                <BarGauge pct={g.gpuUtilPct ?? 0} />
              </div>
              <div>
                <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
                  <span>VRAM</span>
                  <span className="tabular-nums text-foreground">{memUsedGB} / {memTotalGB} GB{memPct !== null ? ` (${String(memPct)}%)` : ""}</span>
                </div>
                <BarGauge pct={memPct ?? 0} />
              </div>
            </div>
          </div>
        );
      })}
      {nonNvidiaDetected.map((g) => (
        <div key={g.busId} className="border border-border rounded p-3 opacity-70">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[12px] font-medium text-foreground">
                {g.vendor.replace(/, Inc\.\s*\[AMD\/ATI\]$/, " (AMD)").replace(/ Corporation$/, "").replace(/, Inc\.$/, "")} — {g.model.replace(/\s*\(rev.*$/, "")}
              </div>
              <code className="text-[10px] text-muted-foreground">{g.busId}</code>
            </div>
            <div className="text-[10px] text-muted-foreground">
              driver: <span className="text-foreground">{g.driver}</span>
            </div>
          </div>
          <div className="text-[10px] text-muted-foreground mt-1">
            Live stats not yet sampled for this driver — utilization/VRAM/temp/power need rocm-smi or i915-perf integration (planned).
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------

export default function ResourcesPage() {
  return (
    <PageScroll>
      <ResourceUsage />
      <div className="mt-4">
        <Card className="p-4">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Power</h3>
          <PowerGaugeSection />
        </Card>
      </div>
      <div className="mt-4">
        <Card className="p-4">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">GPUs</h3>
          <GpuLiveSection />
        </Card>
      </div>
      <div className="mt-4">
        <Card className="p-4">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Running model containers</h3>
          <ModelContainerStatsSection />
        </Card>
      </div>
      <div className="mt-4">
        <Card className="p-4">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Database Storage</h3>
          <DatabaseStorageSection />
        </Card>
      </div>
    </PageScroll>
  );
}
