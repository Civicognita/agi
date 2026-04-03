import React from "react";
import {
  ResponsiveContainer,
  LineChart,
  BarChart,
  AreaChart,
  PieChart,
  Line,
  Bar,
  Area,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import type { ChartSection } from "./canvas-types.js";

const DEFAULT_COLORS = [
  "#89b4fa", "#a6e3a1", "#f9e2af", "#f38ba8",
  "#cba6f7", "#94e2d5", "#fab387", "#89dceb",
];

export function ChartRenderer({ section }: { section: ChartSection }): React.JSX.Element {
  return (
    <div>
      <h4 style={{ color: "var(--blue, #89b4fa)", fontSize: "0.9rem", marginBottom: "0.75rem" }}>
        {section.title}
      </h4>
      <ResponsiveContainer width="100%" height={250}>
        {renderChart(section)}
      </ResponsiveContainer>
    </div>
  );
}

function renderChart(section: ChartSection): React.JSX.Element {
  const { chartType, data, series, xKey } = section;

  if (chartType === "pie") {
    const firstSeries = series[0];
    if (!firstSeries) return <div>No series defined</div>;
    return (
      <PieChart>
        <Pie
          data={data}
          dataKey={firstSeries.key}
          nameKey={xKey}
          cx="50%"
          cy="50%"
          outerRadius={80}
          label
        >
          {data.map((_, i) => (
            <Cell key={i} fill={DEFAULT_COLORS[i % DEFAULT_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip />
      </PieChart>
    );
  }

  const ChartComponent = chartType === "bar" ? BarChart : chartType === "area" ? AreaChart : LineChart;
  const SeriesComponent = chartType === "bar" ? Bar : chartType === "area" ? Area : Line;

  return (
    <ChartComponent data={data}>
      <CartesianGrid strokeDasharray="3 3" stroke="var(--overlay, #45475a)" />
      <XAxis dataKey={xKey} stroke="var(--subtext, #a6adc8)" fontSize={12} />
      <YAxis stroke="var(--subtext, #a6adc8)" fontSize={12} />
      <Tooltip
        contentStyle={{ background: "var(--surface, #313244)", border: "1px solid var(--border, #585b70)" }}
      />
      {series.map((s, i) => (
        <SeriesComponent
          key={s.key}
          type="monotone"
          dataKey={s.key}
          name={s.label}
          stroke={s.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length]}
          fill={s.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length]}
          fillOpacity={chartType === "area" ? 0.3 : 1}
        />
      ))}
    </ChartComponent>
  );
}
