/**
 * UsageSection — LLM token usage, cost breakdown, and daily trend.
 * Shows True Cost per project on the Overview page.
 */

import { useCallback, useEffect, useState } from "react";
import { EChart } from "@particle-academy/react-echarts";
import { Card, CardContent } from "@/components/ui/card";
import { fetchUsageSummary, fetchUsageByProject, fetchUsageHistory } from "../api.js";
import type { UsageSummary, ProjectCost, UsageHistoryPoint } from "../api.js";

/** Polling interval for live usage refresh, in milliseconds.
 * 10s strikes a balance: fresh enough that the user can watch spend
 * accumulate during an agent turn, cheap enough to run while the page
 * is open without hammering the gateway. */
const USAGE_REFRESH_MS = 10_000;

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
  text: "#8b8fa3",
  border: "#262a35",
  card: "#181b23",
  foreground: "#e1e4ea",
};

export function UsageSection({ days = 30 }: { days?: number }) {
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [projects, setProjects] = useState<ProjectCost[]>([]);
  const [history, setHistory] = useState<UsageHistoryPoint[]>([]);

  // Refresh all three queries. Stable callback so the polling effect
  // doesn't reinstall every render.
  const refresh = useCallback(() => {
    fetchUsageSummary(days).then(setSummary).catch(() => {});
    fetchUsageByProject(days).then(setProjects).catch(() => {});
    fetchUsageHistory(days).then(setHistory).catch(() => {});
  }, [days]);

  useEffect(() => {
    // Initial load
    refresh();
    // Live refresh — lets the user watch spend climb while the agent works.
    const t = setInterval(refresh, USAGE_REFRESH_MS);
    return () => clearInterval(t);
  }, [refresh]);

  if (!summary) return null;

  const projectNames = projects.map((p) => {
    const parts = p.projectPath.split("/");
    return parts[parts.length - 1] ?? p.projectPath;
  });

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

      {/* Cost by project */}
      {projects.length > 0 && (
        <Card className="p-4">
          <h4 className="text-[13px] font-semibold text-foreground mb-2">Cost by Project</h4>
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
                data: projectNames,
                axisLabel: { color: COLORS.foreground, fontSize: 11 },
                axisLine: { lineStyle: { color: COLORS.border } },
              },
              series: [{
                type: "bar" as const,
                data: projects.map((p) => Math.round(p.costUsd * 10000) / 10000),
                itemStyle: { color: COLORS.green, borderRadius: [0, 4, 4, 0] },
                barMaxWidth: 24,
              }],
            }}
            style={{ height: Math.max(100, projects.length * 36) }}
          />
        </Card>
      )}
    </div>
  );
}
