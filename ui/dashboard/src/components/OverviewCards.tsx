/**
 * Overview Cards — Summary metrics for the dashboard header.
 */

import { Card, CardContent } from "@/components/ui/card";
import type { DashboardOverview } from "../types.js";

export interface OverviewCardsProps {
  data: DashboardOverview;
  theme?: "light" | "dark";
}

function formatImp(value: number): string {
  if (Math.abs(value) >= 1000) {
    return `${(value / 1000).toFixed(1)}k`;
  }
  return value.toFixed(2);
}

export function OverviewCards({ data }: OverviewCardsProps) {
  const cards = [
    {
      label: "Total $imp",
      value: formatImp(data.totalImp),
      sub: `${formatImp(data.windowImp)} in 90d window`,
      accent: "border-l-blue",
    },
    {
      label: "Entities",
      value: String(data.entityCount),
      sub: `${data.interactionCount} total interactions`,
      accent: "border-l-green",
    },
    {
      label: "Avg $imp / Event",
      value: formatImp(data.avgImpPerInteraction),
      sub: data.topChannel !== null ? `Top channel: ${data.topChannel}` : "No channel data",
      accent: "border-l-yellow",
    },
    {
      label: "Activity",
      value: String(data.recentActivity.length),
      sub: "Recent events tracked",
      accent: "border-l-red",
    },
  ];

  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-4">
      {cards.map((card) => (
        <Card key={card.label} className={`border-l-4 ${card.accent} gap-0 py-0`}>
          <CardContent className="p-5">
            <div className="text-[13px] text-muted-foreground mb-2">{card.label}</div>
            <div className="text-[28px] font-bold text-card-foreground">{card.value}</div>
            <div className="text-xs text-muted-foreground mt-1">{card.sub}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
