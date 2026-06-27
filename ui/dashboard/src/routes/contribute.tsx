/**
 * Contribute — dedicated top-level page for the contributing workflow (Wave 2).
 *
 * Previously this lived buried in Settings → Gateway → "Contributing" tab. Owner
 * wanted it as its own page with less scroll. Composes the existing surfaces into
 * PAx Tabs:
 *   - Outbound   → AionimaContributePanel  (open PRs from your fork → upstream)
 *   - Incoming   → AionimaIncomingPrsPanel  (PRs awaiting your review)
 *   - Repos & Mode → DevSettings (contributing-mode toggle, GitHub connect, repo
 *                    status, test VM)
 *
 * Metrics (2b) and PR comments (2c) layer onto these tabs; the repo-status slim
 * (2d) trims the Repos surface.
 */
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PageScroll } from "@/components/PageScroll.js";
import { AionimaContributePanel } from "@/components/AionimaContributePanel.js";
import { AionimaIncomingPrsPanel } from "@/components/AionimaIncomingPrsPanel.js";
import { DevSettings } from "@/components/settings/DevSettings.js";
import { useConfig, useContributeMetrics } from "@/hooks.js";
import { cn } from "@/lib/utils";
import type { AionimaConfig } from "@/types.js";

/** Compact contribution-metrics strip — accepted (merged), open, repos, total. */
function MetricsStrip() {
  const { data } = useContributeMetrics();
  if (!data) return null;
  const reposWith = data.repos.filter((r) => r.total > 0).length;
  const stat = (label: string, value: number, cls?: string) => (
    <div className="flex-1 min-w-[120px] rounded-lg border border-border bg-card px-4 py-2.5">
      <div className={cn("text-xl font-semibold tabular-nums", cls)}>{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
  return (
    <div className="flex flex-wrap gap-3" data-testid="contribute-metrics">
      {stat("Accepted (merged)", data.totals.merged, "text-green-400")}
      {stat("Open PRs", data.totals.open, "text-amber-400")}
      {stat("Repos contributed", reposWith)}
      {stat("Total PRs", data.totals.total)}
    </div>
  );
}

export default function ContributePage() {
  const cfg = useConfig();
  const config = cfg.data ?? ({} as AionimaConfig);

  return (
    <PageScroll>
      <div className="max-w-[1100px] w-full mx-auto p-4 md:p-6 space-y-4" data-testid="contribute-page">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Contributing</h1>
          <p className="text-[13px] text-muted-foreground mt-0.5">
            Send your fork's work upstream, review incoming PRs, and manage contributing mode — in one place.
          </p>
        </div>

        <MetricsStrip />

        <Tabs defaultValue="outbound">
          <TabsList>
            <TabsTrigger value="outbound" data-testid="contribute-tab-outbound">Outbound</TabsTrigger>
            <TabsTrigger value="incoming" data-testid="contribute-tab-incoming">Incoming</TabsTrigger>
            <TabsTrigger value="repos" data-testid="contribute-tab-repos">Repos &amp; Mode</TabsTrigger>
          </TabsList>

          <TabsContent value="outbound">
            <AionimaContributePanel />
          </TabsContent>

          <TabsContent value="incoming">
            <AionimaIncomingPrsPanel />
          </TabsContent>

          <TabsContent value="repos">
            <DevSettings config={config} update={() => undefined} />
          </TabsContent>
        </Tabs>
      </div>
    </PageScroll>
  );
}
