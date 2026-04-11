/**
 * ResourceUsage — system resource monitoring with historical charts.
 * Uses @particle-academy/react-echarts with gauge meters and area charts.
 */

import { useCallback, useEffect, useState } from "react";
import { EChart } from "@particle-academy/react-echarts";

import { Card } from "@/components/ui/card";
import { useSystemStats } from "../hooks.js";
import { fetchStatsHistory } from "../api.js";

interface DataPoint {
  ts: string;
  cpu: number;
  mem: number;
  disk: number;
  diskRead: number;
  diskWrite: number;
  load1: number;
  load5: number;
  load15: number;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function formatTime(ts: string): string {
  return new Date(ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

// Resolved hex colors (CSS variables don't work inside canvas)
const COLORS = {
  blue: "#5b8def",
  green: "#22c55e",
  yellow: "#eab308",
  red: "#ef4444",
  mauve: "#c084fc",
  text: "#8b8fa3",
  border: "#262a35",
  card: "#181b23",
  foreground: "#e1e4ea",
};

function makeGaugeOption(value: number, label: string, color: string) {
  return {
    series: [{
      type: "gauge" as const,
      startAngle: 220,
      endAngle: -40,
      radius: "90%",
      center: ["50%", "55%"],
      min: 0,
      max: 100,
      progress: { show: true, width: 12, roundCap: true, itemStyle: { color } },
      axisLine: { lineStyle: { width: 12, color: [[1, COLORS.border]] } },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: { show: false },
      pointer: { show: false },
      title: { show: true, offsetCenter: [0, "75%"], fontSize: 11, color: COLORS.text },
      detail: {
        valueAnimation: true,
        offsetCenter: [0, "30%"],
        fontSize: 22,
        fontWeight: "bold" as const,
        formatter: "{value}%",
        color: COLORS.foreground,
      },
      data: [{ value, name: label }],
    }],
  };
}

function makeAreaOption(
  data: DataPoint[],
  series: { key: keyof DataPoint; name: string; color: string }[],
  yMax?: number,
  yFormatter?: (v: number) => string,
) {
  return {
    grid: { top: 35, right: 16, bottom: 24, left: 50 },
    tooltip: {
      trigger: "axis" as const,
      backgroundColor: COLORS.card,
      borderColor: COLORS.border,
      textStyle: { color: COLORS.foreground, fontSize: 12 },
      valueFormatter: yFormatter as ((value: number) => string) | undefined,
    },
    legend: {
      data: series.map((s) => s.name),
      textStyle: { color: COLORS.text, fontSize: 11 },
      top: 0,
    },
    xAxis: {
      type: "category" as const,
      data: data.map((d) => formatTime(d.ts)),
      axisLabel: { color: COLORS.text, fontSize: 10, interval: "auto" },
      axisLine: { lineStyle: { color: COLORS.border } },
      boundaryGap: false,
    },
    yAxis: {
      type: "value" as const,
      max: yMax,
      axisLabel: {
        color: COLORS.text,
        fontSize: 10,
        formatter: yFormatter ?? ((v: number) => String(v)),
      },
      splitLine: { lineStyle: { color: COLORS.border, type: "dashed" as const } },
    },
    series: series.map((s) => ({
      name: s.name,
      type: "line" as const,
      data: data.map((d) => d[s.key] as number),
      smooth: true,
      showSymbol: false,
      lineStyle: { width: 2, color: s.color },
      areaStyle: {
        color: {
          type: "linear" as const,
          x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: s.color + "40" },
            { offset: 1, color: s.color + "05" },
          ],
        },
      },
    })),
  };
}

export function ResourceUsage() {
  const { data, loading, error } = useSystemStats();
  const [history, setHistory] = useState<DataPoint[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [hours, setHours] = useState(1);

  const loadHistory = useCallback(async () => {
    const points = await fetchStatsHistory(hours);
    setHistory(points);
    setHistoryLoaded(true);
  }, [hours]);

  useEffect(() => { void loadHistory(); }, [loadHistory]);

  useEffect(() => {
    if (!data || !historyLoaded) return;
    const point: DataPoint = {
      ts: new Date().toISOString(),
      cpu: data.cpu.usage,
      mem: data.memory.percent,
      disk: data.disk.percent,
      diskRead: data.diskIO?.readBytesPerSec ?? 0,
      diskWrite: data.diskIO?.writeBytesPerSec ?? 0,
      load1: Math.round(data.cpu.loadAvg[0] * 100) / 100,
      load5: Math.round(data.cpu.loadAvg[1] * 100) / 100,
      load15: Math.round(data.cpu.loadAvg[2] * 100) / 100,
    };
    setHistory((prev) => {
      const last = prev[prev.length - 1];
      if (last && Math.abs(new Date(last.ts).getTime() - new Date(point.ts).getTime()) < 4000) return prev;
      return [...prev, point].slice(-2880);
    });
  }, [data, historyLoaded]);

  if (loading && !data && !historyLoaded) {
    return <div className="text-center py-12 text-muted-foreground">Loading system stats...</div>;
  }

  if (error && !historyLoaded) {
    return <div className="px-3.5 py-2.5 rounded-lg bg-surface0 text-red text-[13px]">Failed to load system stats: {error}</div>;
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        {data && (
          <div className="text-[11px] text-muted-foreground">
            Host: <span className="font-mono text-foreground">{data.hostname}</span>
            {" | "}
            Uptime: <span className="text-foreground">{formatUptime(data.uptime)}</span>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          {[1, 6, 12, 24].map((h) => (
            <button
              key={h}
              onClick={() => setHours(h)}
              className={`text-[11px] px-2 py-1 rounded ${hours === h ? "bg-primary text-primary-foreground" : "bg-surface0 text-muted-foreground hover:text-foreground"}`}
            >
              {h}h
            </button>
          ))}
        </div>
      </div>

      {/* Gauge meters */}
      {data && (
        <div className="grid grid-cols-4 gap-4 mb-6">
          <Card className="p-2">
            <EChart
              option={makeGaugeOption(
                data.cpu.usage,
                `CPU (${data.cpu.cores} cores)`,
                data.cpu.usage > 80 ? COLORS.red : data.cpu.usage > 50 ? COLORS.yellow : COLORS.green,
              )}
              style={{ height: 160 }}
            />
          </Card>
          <Card className="p-2">
            <EChart
              option={makeGaugeOption(
                data.memory.percent,
                `RAM (${formatBytes(data.memory.used)})`,
                data.memory.percent > 85 ? COLORS.red : data.memory.percent > 60 ? COLORS.yellow : COLORS.green,
              )}
              style={{ height: 160 }}
            />
          </Card>
          <Card className="p-2">
            <EChart
              option={makeGaugeOption(
                data.disk.percent,
                `Disk (${formatBytes(data.disk.used)})`,
                data.disk.percent > 90 ? COLORS.red : data.disk.percent > 70 ? COLORS.yellow : COLORS.green,
              )}
              style={{ height: 160 }}
            />
          </Card>
          <Card className="p-2 flex flex-col items-center">
            <EChart
              option={{
                tooltip: {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  formatter: (params: any) => `${params.name}: ${formatBytes(params.value as number)}`,
                },
                series: [{
                  type: "pie",
                  radius: "70%",
                  center: ["50%", "50%"],
                  label: { show: false },
                  emphasis: { scale: false },
                  data: [
                    {
                      value: data.disk.used,
                      name: "Used",
                      itemStyle: { color: data.disk.percent > 90 ? COLORS.red : data.disk.percent > 70 ? COLORS.yellow : COLORS.blue },
                    },
                    { value: data.disk.free, name: "Free", itemStyle: { color: COLORS.border } },
                  ],
                }],
              }}
              style={{ height: 116 }}
            />
            <div className="text-center -mt-1">
              <div className="text-lg font-bold text-foreground">{data.disk.percent}%</div>
              <div className="text-[10px] text-muted-foreground">{formatBytes(data.disk.used)} / {formatBytes(data.disk.total)}</div>
              <div className="text-[11px] text-muted-foreground">Disk Volume</div>
            </div>
          </Card>
        </div>
      )}

      {/* CPU History */}
      <Card className="p-4 mb-4">
        <h3 className="text-[13px] font-semibold text-foreground mb-2">CPU Usage</h3>
        <EChart
          option={makeAreaOption(history, [{ key: "cpu", name: "CPU %", color: COLORS.blue }], 100, (v) => `${v}%`)}
          style={{ height: 200 }}
        />
      </Card>

      {/* Load Average History */}
      <Card className="p-4 mb-4">
        <h3 className="text-[13px] font-semibold text-foreground mb-2">Load Average</h3>
        <EChart
          option={makeAreaOption(history, [
            { key: "load1", name: "1 min", color: COLORS.green },
            { key: "load5", name: "5 min", color: COLORS.yellow },
            { key: "load15", name: "15 min", color: COLORS.red },
          ])}
          style={{ height: 200 }}
        />
      </Card>

      {/* Memory History */}
      <Card className="p-4 mb-4">
        <h3 className="text-[13px] font-semibold text-foreground mb-2">Memory Usage</h3>
        <EChart
          option={makeAreaOption(history, [{ key: "mem", name: "RAM %", color: COLORS.mauve }], 100, (v) => `${v}%`)}
          style={{ height: 200 }}
        />
      </Card>

      {/* Disk I/O History */}
      <Card className="p-4">
        <h3 className="text-[13px] font-semibold text-foreground mb-2">Disk I/O</h3>
        <EChart
          option={makeAreaOption(
            history,
            [
              { key: "diskRead", name: "Read", color: COLORS.green },
              { key: "diskWrite", name: "Write", color: COLORS.yellow },
            ],
            undefined,
            (v) => `${formatBytes(v)}/s`,
          )}
          style={{ height: 160 }}
        />
      </Card>
    </div>
  );
}
