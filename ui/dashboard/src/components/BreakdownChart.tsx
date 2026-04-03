/**
 * Breakdown Chart — Domain/channel/workType breakdown as pie + bar.
 */

import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Card } from "@/components/ui/card";
import { fetchBreakdown } from "../api.js";
import type { BreakdownDimension, BreakdownSlice } from "../types.js";

export interface BreakdownChartProps {
  dimension?: BreakdownDimension;
  entityId?: string;
  since?: string;
  until?: string;
  theme?: "light" | "dark";
}

/** Catppuccin domain colors via CSS variables (adapt to light/dark). */
const DOMAIN_COLORS: Record<string, string> = {
  governance: "var(--color-mauve)",
  community: "var(--color-blue)",
  innovation: "var(--color-green)",
  operations: "var(--color-yellow)",
  knowledge: "var(--color-flamingo)",
  technology: "var(--color-teal)",
};

const FALLBACK_COLORS = [
  "var(--color-blue)", "var(--color-green)", "var(--color-yellow)", "var(--color-red)",
  "var(--color-mauve)", "var(--color-teal)", "var(--color-flamingo)", "var(--color-peach)",
];

function getColor(key: string, index: number): string {
  return DOMAIN_COLORS[key] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length] ?? "var(--color-blue)";
}

export function BreakdownChart({ dimension = "domain", entityId, since, until }: BreakdownChartProps) {
  const [slices, setSlices] = useState<BreakdownSlice[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    void fetchBreakdown(dimension, entityId, since, until).then((res) => {
      setSlices(res.slices);
      setTotal(res.total);
      setLoading(false);
    });
  }, [dimension, entityId, since, until]);

  if (loading) {
    return <div className="py-10 text-center text-muted-foreground">Loading breakdown...</div>;
  }

  if (slices.length === 0) {
    return <div className="py-10 text-center text-muted-foreground">No breakdown data available</div>;
  }

  const dimensionLabel = dimension === "domain" ? "Domain" : dimension === "channel" ? "Channel" : "Work Type";

  return (
    <Card className="p-5 gap-0">
      <h3 className="text-base font-semibold text-card-foreground mb-4">
        {dimensionLabel} Breakdown
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Pie chart */}
        <ResponsiveContainer width="100%" height={250}>
          <PieChart>
            <Pie
              data={slices}
              dataKey="totalImp"
              nameKey="key"
              cx="50%"
              cy="50%"
              outerRadius={90}
              label={({ key, percentage }: { key: string; percentage: number }) =>
                `${key} ${percentage.toFixed(0)}%`
              }
              labelLine={{ stroke: "var(--color-subtext0)" }}
            >
              {slices.map((slice, i) => (
                <Cell key={slice.key} fill={getColor(slice.key, i)} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                background: "var(--color-card)",
                border: "1px solid var(--color-border)",
                borderRadius: "8px",
              }}
            />
          </PieChart>
        </ResponsiveContainer>

        {/* Bar chart */}
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={slices} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-overlay)" />
            <XAxis type="number" tick={{ fill: "var(--color-subtext0)", fontSize: 11 }} />
            <YAxis type="category" dataKey="key" tick={{ fill: "var(--color-subtext0)", fontSize: 11 }} width={90} />
            <Tooltip
              contentStyle={{
                background: "var(--color-card)",
                border: "1px solid var(--color-border)",
                borderRadius: "8px",
              }}
            />
            <Bar dataKey="totalImp" name="$imp" radius={[0, 4, 4, 0]}>
              {slices.map((slice, i) => (
                <Cell key={slice.key} fill={getColor(slice.key, i)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Legend summary */}
      <div className="mt-3 text-xs text-muted-foreground">
        Total: {total.toFixed(2)} $imp across {slices.length} {dimensionLabel.toLowerCase()}s
      </div>
    </Card>
  );
}
