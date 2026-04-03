/**
 * Activity Feed — Real-time scrolling feed of impact events.
 */

import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import type { ActivityEntry } from "../types.js";

export interface ActivityFeedProps {
  entries: ActivityEntry[];
  theme?: "light" | "dark";
  maxItems?: number;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatImp(value: number): string {
  return value >= 0 ? `+${value.toFixed(2)}` : value.toFixed(2);
}

export function ActivityFeed({ entries, maxItems = 15 }: ActivityFeedProps) {
  const visible = entries.slice(0, maxItems);

  return (
    <Card className="p-5 gap-0">
      <h3 className="text-base font-semibold text-card-foreground mb-4">Recent Activity</h3>
      {visible.length === 0 ? (
        <div className="py-5 text-center text-muted-foreground">No recent activity</div>
      ) : (
        <div className="max-h-[400px] overflow-auto">
          {visible.map((entry) => (
            <div
              key={entry.id}
              className="flex items-center gap-3 py-2.5 border-b border-border"
            >
              <div
                className={cn(
                  "w-2 h-2 rounded-full shrink-0",
                  entry.impScore >= 0 ? "bg-green" : "bg-red",
                )}
              />

              <div className="flex-1 min-w-0">
                <div className="text-[13px] text-card-foreground">
                  <strong>{entry.entityName}</strong>
                  {" "}
                  <span className="text-muted-foreground">{entry.workType ?? "interaction"}</span>
                  {entry.channel !== null && (
                    <span className="text-muted-foreground"> via {entry.channel}</span>
                  )}
                </div>
              </div>

              <div className="text-right shrink-0">
                <div
                  className={cn(
                    "text-[13px] font-semibold",
                    entry.impScore >= 0 ? "text-green" : "text-red",
                  )}
                >
                  {formatImp(entry.impScore)} $imp
                </div>
                <div className="text-[11px] text-muted-foreground">{timeAgo(entry.createdAt)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
