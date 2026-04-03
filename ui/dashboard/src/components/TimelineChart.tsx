/**
 * Timeline Chart — Impact over time as area/line chart.
 */

import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Card } from "@/components/ui/card";
import { fetchTimeline } from "../api.js";
import type { TimeBucket, TimelineBucket } from "../types.js";

export interface TimelineChartProps {
  entityId?: string;
  bucket?: TimeBucket;
  since?: string;
  until?: string;
  theme?: "light" | "dark";
}

function formatDate(dateStr: string, bucket: TimeBucket): string {
  if (bucket === "week") return dateStr;
  const d = new Date(dateStr);
  if (bucket === "month") return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
  if (bucket === "hour") return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function TimelineChart({ entityId, bucket = "day", since, until }: TimelineChartProps) {
  const [data, setData] = useState<TimelineBucket[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    void fetchTimeline(bucket, entityId, since, until).then((res) => {
      setData(res.buckets);
      setLoading(false);
    });
  }, [bucket, entityId, since, until]);

  if (loading) {
    return <div className="py-10 text-center text-muted-foreground">Loading timeline...</div>;
  }

  if (data.length === 0) {
    return <div className="py-10 text-center text-muted-foreground">No timeline data available</div>;
  }

  const chartData = data.map((b) => ({
    ...b,
    label: formatDate(b.bucketStart, bucket),
  }));

  return (
    <Card className="p-5 gap-0">
      <h3 className="text-base font-semibold text-card-foreground mb-4">
        Impact Timeline
      </h3>
      <ResponsiveContainer width="100%" height={300}>
        <AreaChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-overlay)" />
          <XAxis dataKey="label" tick={{ fill: "var(--color-subtext0)", fontSize: 11 }} />
          <YAxis tick={{ fill: "var(--color-subtext0)", fontSize: 11 }} />
          <Tooltip
            contentStyle={{
              background: "var(--color-card)",
              border: "1px solid var(--color-border)",
              borderRadius: "8px",
            }}
            labelStyle={{ color: "var(--color-muted-foreground)" }}
          />
          <Area
            type="monotone"
            dataKey="positiveImp"
            stackId="1"
            stroke="var(--color-green)"
            fill="var(--color-green)"
            fillOpacity={0.3}
            name="Positive $imp"
          />
          <Area
            type="monotone"
            dataKey="negativeImp"
            stackId="2"
            stroke="var(--color-red)"
            fill="var(--color-red)"
            fillOpacity={0.3}
            name="Negative $imp"
          />
        </AreaChart>
      </ResponsiveContainer>
    </Card>
  );
}
