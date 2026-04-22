/**
 * Overview route — two-tab layout:
 *   - Usage & Cost (default): live token / cost tracking, refreshed via
 *     the dashboard WS `usage:recorded` event so the user can watch spend
 *     in real time while the agent works.
 *   - Impactinomics: existing overview content (OverviewCards + Timeline +
 *     Breakdown + ActivityFeed). Wrapped in <ComingSoonOverlay /> while
 *     0PRIME / MINT is not operational — data is stubbed; the watermark
 *     tells the user so. Remove the overlay when MINT comes online.
 */

import { cn } from "@/lib/utils";
import { ActivityFeed } from "@/components/ActivityFeed.js";
import { BreakdownChart } from "@/components/BreakdownChart.js";
import { OverviewCards } from "@/components/OverviewCards.js";
import { TimelineChart } from "@/components/TimelineChart.js";
import { UsageSection } from "@/components/UsageSection.js";
import { PageScroll } from "@/components/PageScroll.js";
import { ComingSoonOverlay } from "@/components/ComingSoonOverlay.js";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs.js";
import type { TimeBucket } from "@/types.js";
import { useRootContext } from "./root.js";

export default function OverviewPage() {
  const { overview, liveActivity, timelineBucket, setTimelineBucket } = useRootContext();

  // Defensive coalesce: if an older/broken backend ever returns `overview`
  // without `recentActivity` (e.g. an un-awaited async handler), render with
  // just the live buffer instead of throwing "not iterable" at runtime.
  const recentActivity = Array.isArray(overview.data?.recentActivity)
    ? overview.data.recentActivity
    : [];
  const allActivity = overview.data !== null
    ? [...liveActivity, ...recentActivity]
      .filter((e, i, arr) => arr.findIndex((a) => a.id === e.id) === i)
      .slice(0, 30)
    : liveActivity;

  if (overview.data === null) return null;

  return (
    <PageScroll>
      <Tabs defaultValue="usage">
        <TabsList variant="line">
          <TabsTrigger value="usage">Usage &amp; Cost</TabsTrigger>
          <TabsTrigger value="impactinomics">Impactinomics</TabsTrigger>
        </TabsList>

        {/* Usage & Cost — live data; default tab. */}
        <TabsContent value="usage" className="mt-4">
          <UsageSection days={30} />
        </TabsContent>

        {/* Impactinomics — content exists but is stubbed until 0PRIME/MINT
            is operational. Overlay tells the user what they're looking at. */}
        <TabsContent value="impactinomics" className="mt-4">
          <ComingSoonOverlay caption="Impact scoring, COA<>COI registration, and MINT ledger updates need 0PRIME to be operational. This tab will light up when the Hive mind is online.">
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
            </div>
          </ComingSoonOverlay>
        </TabsContent>
      </Tabs>
    </PageScroll>
  );
}
