/**
 * Overview route — dashboard cards, timeline, breakdown charts, activity feed.
 */

import { cn } from "@/lib/utils";
import { ActivityFeed } from "@/components/ActivityFeed.js";
import { BreakdownChart } from "@/components/BreakdownChart.js";
import { OverviewCards } from "@/components/OverviewCards.js";
import { TimelineChart } from "@/components/TimelineChart.js";
import { UsageSection } from "@/components/UsageSection.js";
import type { TimeBucket } from "@/types.js";
import { useRootContext } from "./root.js";

export default function OverviewPage() {
  const { overview, liveActivity, timelineBucket, setTimelineBucket } = useRootContext();

  const allActivity = overview.data !== null
    ? [...liveActivity, ...overview.data.recentActivity]
      .filter((e, i, arr) => arr.findIndex((a) => a.id === e.id) === i)
      .slice(0, 30)
    : liveActivity;

  if (overview.data === null) return null;

  return (
    <div className="flex flex-col gap-6">
      <OverviewCards data={overview.data} />

      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-6">
        <div className="flex flex-col gap-6">
          {/* Timeline controls */}
          <div className="flex gap-1">
            {(["hour", "day", "week", "month"] as TimeBucket[]).map((b) => (
              <button
                key={b}
                onClick={() => setTimelineBucket(b)}
                className={cn(
                  "px-2.5 py-2 md:py-1 rounded-md border text-[11px] cursor-pointer transition-colors",
                  timelineBucket === b
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-transparent text-foreground border-border hover:bg-secondary",
                )}
              >
                {b}
              </button>
            ))}
          </div>
          <TimelineChart bucket={timelineBucket} />
          <BreakdownChart dimension="domain" />
        </div>
        <ActivityFeed entries={allActivity} />
      </div>

      <BreakdownChart dimension="channel" />

      {/* Usage & True Cost */}
      <UsageSection days={30} />
    </div>
  );
}
