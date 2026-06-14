/**
 * UsageSection — LLM token usage, cost breakdown, and daily trend.
 * Shows True Cost per project on the Overview page with dual bars
 * (chat vs TaskMaster worker) and live WS-driven refresh.
 */

import { useCallback, useEffect, useState } from "react";
import { EChart } from "@particle-academy/fancy-echarts";
import { Card, CardContent } from "@/components/ui/card";
import { useDashboardWS } from "../hooks.js";
import {
  fetchUsageSummary,
  fetchUsageByProjectSource,
  fetchUsageHistory,
} from "../api.js";
import type { UsageSummary, UsageHistoryPoint, ProjectSourceCost } from "../api.js";

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatUsd(n: number): string {
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

const COLORS = {
  blue: "#5b8def",
  green: "#22c55e",
  yellow: "#eab308",
  mauve: "#c084fc",
  red: "#ef4444",
  orange: "#f97316",
  text: "#8b8fa3",
  border: "#262a35",
  card: "#181b23",
  foreground: "#e1e4ea",
};

/** Build the dual-bar chart data from the flat source list. Each project
 *  gets two thin bars: chat (blue) and worker (orange). */
function buildDualBarData(rows: ProjectSourceCost[]): {
  names: string[];
  chatCosts: number[];
  workerCosts: number[];
} {
  const byProject = new Map<string, { chat: number; worker: number }>();
  for (const r of rows) {
    const name = r.projectPath.split("/").pop() ?? r.projectPath;
    const entry = byProject.get(name) ?? { chat: 0, worker: 0 };
    entry[r.source] += r.costUsd;
    byProject.set(name, entry);
  }
  // Sort by total descending.
  const sorted = [...byProject.entries()].sort((a, b) => (b[1].chat + b[1].worker) - (a[1].chat + a[1].worker));
  return {
    names: sorted.map(([n]) => n),
    chatCosts: sorted.map(([, v]) => Math.round(v.chat * 10000) / 10000),
    workerCosts: sorted.map(([, v]) => Math.round(v.worker * 10000) / 10000),
  };
}

export function UsageSection({ days = 30 }: { days?: number }) {
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [projectSource, setProjectSource] = useState<ProjectSourceCost[]>([]);
  const [history, setHistory] = useState<UsageHistoryPoint[]>([]);

  const refresh = useCallback(() => {
    fetchUsageSummary(days).then(setSummary).catch(() => {});
    fetchUsageByProjectSource(days).then(setProjectSource).catch(() => {});
    fetchUsageHistory(days).then(setHistory).catch(() => {});
  }, [days]);

  useEffect(() => {
    refresh();
    // Low-frequency safety-net poll — primary driver is the WS event below.
    const t = setInterval(refresh, 30_000);
    return () => clearInterval(t);
  }, [refresh]);

  // Live refresh on every usage:recorded WS event.
  useDashboardWS(
    useCallback((event) => {
      if (event.type === "usage:recorded") {
        refresh();
      }
    }, [refresh]),
  );

  if (!summary) return null;

  const { names, chatCosts, workerCosts } = buildDualBarData(projectSource);

  return (
    <div className="space-y-4">
      <h3 className="text-[14px] font-bold text-foreground">Usage & Cost</h3>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card className="border-l-4 border-l-blue gap-0 py-0">
          <CardContent className="p-4">
            <div className="text-[11px] text-muted-foreground mb-1">Total Cost</div>
            <div className="text-xl font-bold text-foreground">{formatUsd(summary.totalCostUsd)}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">{days}d window</div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-green gap-0 py-0">
          <CardContent className="p-4">
            <div className="text-[11px] text-muted-foreground mb-1">Invocations</div>
            <div className="text-xl font-bold text-foreground">{String(summary.invocationCount)}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">agent runs</div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-mauve gap-0 py-0">
          <CardContent className="p-4">
            <div className="text-[11px] text-muted-foreground mb-1">Input Tokens</div>
            <div className="text-xl font-bold text-foreground">{formatTokens(summary.totalInputTokens)}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">prompt tokens</div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-yellow gap-0 py-0">
          <CardContent className="p-4">
            <div className="text-[11px] text-muted-foreground mb-1">Output Tokens</div>
            <div className="text-xl font-bold text-foreground">{formatTokens(summary.totalOutputTokens)}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">completion tokens</div>
          </CardContent>
        </Card>
      </div>

      {/* Daily cost trend */}
      {history.length > 0 && (
        <Card className="p-4">
          <h4 className="text-[13px] font-semibold text-foreground mb-2">Daily Cost</h4>
          <EChart
            option={{
              grid: { top: 30, right: 16, bottom: 24, left: 55 },
              tooltip: {
                trigger: "axis" as const,
                backgroundColor: COLORS.card,
                borderColor: COLORS.border,
                textStyle: { color: COLORS.foreground, fontSize: 12 },
                formatter: (params: unknown) => {
                  const p = (params as Array<{ name: string; value: number }>)[0];
                  if (!p) return "";
                  return `${p.name}<br/>Cost: $${p.value.toFixed(4)}`;
                },
              },
              xAxis: {
                type: "category" as const,
                data: history.map((h) => new Date(h.period).toLocaleDateString("en-US", { month: "short", day: "numeric" })),
                axisLabel: { color: COLORS.text, fontSize: 10 },
                axisLine: { lineStyle: { color: COLORS.border } },
                boundaryGap: false,
              },
              yAxis: {
                type: "value" as const,
                axisLabel: { color: COLORS.text, fontSize: 10, formatter: (v: number) => `$${v.toFixed(2)}` },
                splitLine: { lineStyle: { color: COLORS.border, type: "dashed" as const } },
              },
              series: [{
                type: "line" as const,
                data: history.map((h) => Math.round(h.costUsd * 10000) / 10000),
                smooth: true,
                showSymbol: false,
                lineStyle: { width: 2, color: COLORS.blue },
                areaStyle: {
                  color: { type: "linear" as const, x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: COLORS.blue + "40" }, { offset: 1, color: COLORS.blue + "05" }] },
                },
              }],
            }}
            style={{ height: 200 }}
          />
        </Card>
      )}

      {/* Cost by Project — dual bars: chat (blue) + worker (orange) */}
      {names.length > 0 && (
        <Card className="p-4">
          <h4 className="text-[13px] font-semibold text-foreground mb-2">
            Cost by Project
            <span className="ml-3 text-[10px] font-normal text-muted-foreground">
              <span style={{ color: COLORS.blue }}>■</span> Chat
              <span className="ml-2" style={{ color: COLORS.orange }}>■</span> TaskMaster
            </span>
          </h4>
          <EChart
            option={{
              grid: { top: 8, right: 60, bottom: 8, left: 100 },
              tooltip: {
                trigger: "axis" as const,
                backgroundColor: COLORS.card,
                borderColor: COLORS.border,
                textStyle: { color: COLORS.foreground, fontSize: 12 },
              },
              xAxis: {
                type: "value" as const,
                axisLabel: { color: COLORS.text, fontSize: 10, formatter: (v: number) => `$${v.toFixed(2)}` },
                splitLine: { lineStyle: { color: COLORS.border, type: "dashed" as const } },
              },
              yAxis: {
                type: "category" as const,
                data: names,
                axisLabel: { color: COLORS.foreground, fontSize: 11 },
                axisLine: { lineStyle: { color: COLORS.border } },
              },
              series: [
                {
                  name: "Chat",
                  type: "bar" as const,
                  stack: "cost",
                  data: chatCosts,
                  itemStyle: { color: COLORS.blue, borderRadius: [0, 0, 0, 0] },
                  barMaxWidth: 14,
                },
                {
                  name: "TaskMaster",
                  type: "bar" as const,
                  stack: "cost",
                  data: workerCosts,
                  itemStyle: { color: COLORS.orange, borderRadius: [0, 4, 4, 0] },
                  barMaxWidth: 14,
                },
              ],
            }}
            style={{ height: Math.max(100, names.length * 36) }}
          />
        </Card>
      )}
    </div>
  );
}
