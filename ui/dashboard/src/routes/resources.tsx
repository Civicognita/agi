/**
 * Resources route — system resource monitoring (CPU, RAM, disk, uptime).
 * Also includes a Database Storage section showing aggregate DB volume usage,
 * and a Running Model Containers section with per-container CPU/RAM stats.
 */

import { useEffect, useMemo, useState } from "react";
import { ResourceUsage } from "@/components/ResourceUsage.js";
import { PageScroll } from "@/components/PageScroll.js";
import { Card } from "@/components/ui/card.js";
import { fetchDatabaseStorage } from "@/api.js";
import { useHFContainerStats, useMachineHardware } from "@/hooks.js";
import type { HFContainerStats } from "@/api.js";
// fancy-echarts (npm published as @particle-academy/react-echarts pending
// rename per CLAUDE.md § 1.5 — package is the canonical PAx EChart wrapper).
import { EChart } from "@particle-academy/react-echarts";

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
//
// Visualization: ECharts heatmap that renders one cell per "activity unit"
// (10×10 = 100 cells = percentage points of GPU compute). Cells <= util
// are green (active), cells > util are blue (idle). Mirrors the calendar-
// simple aesthetic from echarts.apache.org. NVML doesn't expose per-SM
// utilization; this is an approximate visualization of aggregate util.
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

const HEATMAP_COLS = 10;
const HEATMAP_ROWS = 10;
const COLOR_ACTIVE = "#10b981"; // emerald-500
const COLOR_IDLE   = "#1e3a8a"; // blue-900

// Build a 10×10 grid of cells where cells <= pct are 1 ("active") and the
// rest are 0 ("idle"). Returns ECharts heatmap data shape: [x, y, value].
function buildActivityHeatmap(pct: number): [number, number, number][] {
  const filled = Math.round(Math.max(0, Math.min(100, pct)));
  const data: [number, number, number][] = [];
  for (let i = 0; i < HEATMAP_COLS * HEATMAP_ROWS; i++) {
    const x = i % HEATMAP_COLS;
    const y = Math.floor(i / HEATMAP_COLS);
    data.push([x, y, i < filled ? 1 : 0]);
  }
  return data;
}

function activityHeatmapOption(pct: number, tooltipLabel: string): Record<string, unknown> {
  return {
    grid: { left: 4, right: 4, top: 4, bottom: 4, containLabel: false },
    tooltip: {
      formatter: (): string => `${tooltipLabel}: ${String(Math.round(pct))}%`,
    },
    xAxis: {
      type: "category",
      data: Array.from({ length: HEATMAP_COLS }, (_, i) => String(i)),
      show: false,
      splitArea: { show: false },
    },
    yAxis: {
      type: "category",
      data: Array.from({ length: HEATMAP_ROWS }, (_, i) => String(i)),
      show: false,
      splitArea: { show: false },
      inverse: true,
    },
    visualMap: {
      show: false,
      min: 0,
      max: 1,
      calculable: false,
      pieces: [
        { value: 0, color: COLOR_IDLE },
        { value: 1, color: COLOR_ACTIVE },
      ],
    },
    series: [
      {
        type: "heatmap",
        data: buildActivityHeatmap(pct),
        itemStyle: {
          borderColor: "rgba(0,0,0,0.4)",
          borderWidth: 2,
          borderRadius: 2,
        },
        progressive: 0,
        animationDuration: 600,
      },
    ],
  };
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
    <div className="space-y-4">
      {gpus.map((g) => {
        const memPct = g.memTotalMB && g.memUsedMB !== null
          ? (g.memUsedMB / g.memTotalMB) * 100 : 0;
        const memUsedGB = g.memUsedMB !== null  ? (g.memUsedMB  / 1024).toFixed(1) : "—";
        const memTotalGB = g.memTotalMB !== null ? (g.memTotalMB / 1024).toFixed(1) : "—";
        const corePct = g.gpuUtilPct ?? 0;
        return (
          <div key={g.busId} className="border border-border rounded-md p-4">
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="text-[13px] font-semibold text-foreground">{g.name}</div>
                <code className="text-[10px] text-muted-foreground">{g.busId}</code>
              </div>
              <div className="flex items-center gap-4 text-[11px]">
                {g.tempC !== null && (
                  <div className="text-right">
                    <div className="text-[9px] text-muted-foreground uppercase tracking-wider">temp</div>
                    <div className="font-bold text-foreground tabular-nums">{g.tempC}°C</div>
                  </div>
                )}
                {g.powerW !== null && (
                  <div className="text-right">
                    <div className="text-[9px] text-muted-foreground uppercase tracking-wider">power</div>
                    <div className="font-bold text-foreground tabular-nums">
                      {g.powerW.toFixed(1)}<span className="text-muted-foreground text-[10px]"> / {g.powerLimitW !== null ? g.powerLimitW.toFixed(0) : "—"} W</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Core activity</span>
                  <span className="text-[18px] font-bold text-foreground tabular-nums">{Math.round(corePct)}%</span>
                </div>
                <EChart option={activityHeatmapOption(corePct, "Core")} style={{ height: 140 }} />
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider">VRAM</span>
                  <span className="text-[18px] font-bold text-foreground tabular-nums">
                    {memUsedGB}<span className="text-muted-foreground text-[12px]"> / {memTotalGB} GB ({Math.round(memPct)}%)</span>
                  </span>
                </div>
                <EChart option={activityHeatmapOption(memPct, "VRAM")} style={{ height: 140 }} />
              </div>
            </div>
            <div className="mt-2 text-[9px] text-muted-foreground">
              Heatmap = aggregate utilization rendered as 100 cells (each = 1%). NVML doesn't expose per-SM utilization, so per-core breakdown is approximate.
            </div>
          </div>
        );
      })}
      {nonNvidiaDetected.map((g) => (
        <div key={g.busId} className="border border-border rounded-md p-4 opacity-70">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[13px] font-semibold text-foreground">
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
// CPU per-core heatmap — one cell per logical CPU, colored by per-core
// utilization. Real data from /proc/stat sampling, not approximated.
// Layout: ceil(sqrt(N)) × ceil(N/cols) so 24 cores fit a 5×5 grid with
// one empty slot. Updates every 5s in step with /api/system/stats.
// ---------------------------------------------------------------------------

function cpuPerCoreHeatmapOption(perCore: number[]): Record<string, unknown> {
  // Wider-than-tall grid suits a full-width card better than a square grid.
  // Target 2-3 rows for typical core counts; fall back to sqrt for ≤6 cores.
  const N = perCore.length;
  const targetRows = N > 16 ? 3 : N > 6 ? 2 : 1;
  const cols = Math.ceil(N / targetRows);
  const rows = Math.ceil(N / cols);
  const data: [number, number, number, number][] = perCore.map((pct, i) => [
    i % cols,
    Math.floor(i / cols),
    pct,
    i, // 4th element carries the original core index for the tooltip
  ]);
  return {
    grid: { left: 4, right: 4, top: 4, bottom: 4, containLabel: false },
    tooltip: {
      formatter: (params: { value: [number, number, number, number] }): string =>
        `core ${String(params.value[3])}: ${String(params.value[2])}%`,
    },
    xAxis: { type: "category", data: Array.from({ length: cols }, (_, i) => String(i)), show: false },
    yAxis: { type: "category", data: Array.from({ length: rows }, (_, i) => String(i)), show: false, inverse: true },
    visualMap: {
      show: false,
      min: 0,
      max: 100,
      calculable: false,
      inRange: { color: [COLOR_IDLE, "#3b82f6", "#0ea5a0", COLOR_ACTIVE, "#fbbf24", "#ef4444"] },
    },
    series: [
      {
        type: "heatmap",
        data,
        label: { show: false },
        itemStyle: { borderColor: "rgba(0,0,0,0.4)", borderWidth: 2, borderRadius: 4 },
        progressive: 0,
        animationDuration: 400,
      },
    ],
  };
}

function CpuPerCoreSection() {
  const [perCore, setPerCore] = useState<number[]>([]);

  useEffect(() => {
    let cancelled = false;
    const refresh = async (): Promise<void> => {
      try {
        const r = await fetch("/api/system/stats");
        if (!r.ok) return;
        const j = await r.json() as { cpu?: { perCore?: number[] } };
        if (!cancelled && Array.isArray(j.cpu?.perCore)) setPerCore(j.cpu.perCore);
      } catch { /* ignore */ }
    };
    void refresh();
    const id = window.setInterval(() => { void refresh(); }, 5_000);
    return (): void => { cancelled = true; window.clearInterval(id); };
  }, []);

  const option = useMemo(() => cpuPerCoreHeatmapOption(perCore), [perCore]);
  const avg = perCore.length > 0 ? Math.round(perCore.reduce((a, b) => a + b, 0) / perCore.length) : 0;
  const peak = perCore.length > 0 ? Math.max(...perCore) : 0;

  if (perCore.length === 0) {
    return <div className="text-[11px] text-muted-foreground">Loading per-core stats...</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-4 text-[11px]">
          <div>
            <div className="text-[9px] text-muted-foreground uppercase tracking-wider">cores</div>
            <div className="font-bold text-foreground tabular-nums">{perCore.length}</div>
          </div>
          <div>
            <div className="text-[9px] text-muted-foreground uppercase tracking-wider">avg</div>
            <div className="font-bold text-foreground tabular-nums">{avg}%</div>
          </div>
          <div>
            <div className="text-[9px] text-muted-foreground uppercase tracking-wider">peak</div>
            <div className="font-bold text-foreground tabular-nums">{peak}%</div>
          </div>
        </div>
        <div className="text-[9px] text-muted-foreground">blue = idle · green = active · yellow/red = saturated</div>
      </div>
      <EChart option={option} style={{ height: 180 }} />
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
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">CPU per-core activity</h3>
          <CpuPerCoreSection />
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
