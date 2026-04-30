/**
 * PAx — Particle-Academy ADF UI primitives consolidated view (s136 t522
 * follow-up, cycle 128). Mirrors /aionima's pattern: one page per
 * sacred-portal collection, listing fork-alignment status and entry
 * points to maintenance actions.
 *
 * The four PAx packages (react-fancy, fancy-code, fancy-sheets,
 * fancy-echarts) live in this view rather than as per-package tiles
 * in /projects. Same data source as /aionima (`/api/dev/core-forks/status`)
 * — this page filters the response to PAx slugs only.
 */

import { useEffect, useState } from "react";
import { Card } from "../components/ui/card";
import { useIsTestVm } from "../hooks/useRuntimeMode";
import { PAX_SACRED_PROJECTS } from "../lib/sacred-projects.js";

interface CoreForkStatus {
  slug: string;
  label?: string;
  ahead?: number;
  behind?: number;
  branch?: string;
  hasUncommitted?: boolean;
  hasUnpushed?: boolean;
  remote?: string;
  error?: string;
}

interface ForksResponse {
  forks: CoreForkStatus[];
  branch?: string;
  error?: string;
}

const PAX_SLUGS = new Set(PAX_SACRED_PROJECTS.map((p) => p.id));

export default function PaxPage(): JSX.Element {
  const isTestVm = useIsTestVm();
  const [forksData, setForksData] = useState<ForksResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isTestVm) { setLoading(false); return; }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/dev/core-forks/status");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json() as ForksResponse;
        if (!cancelled) {
          // Filter to PAx slugs only — the endpoint returns all CORE_REPOS
          // (Civicognita + Particle-Academy) but this page is PAx-specific.
          setForksData({ ...data, forks: data.forks.filter((f) => PAX_SLUGS.has(f.slug)) });
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return (): void => { cancelled = true; };
  }, [isTestVm]);

  if (isTestVm) {
    return (
      <div className="h-full overflow-y-auto p-4 max-w-4xl" data-testid="pax-page">
        <h1 className="text-[16px] font-semibold mb-2">PAx · ADF UI Primitives</h1>
        <Card className="p-4 text-[13px] text-muted-foreground">
          PAx is hidden in test-VM mode — switch to a production or dev gateway with contributing-mode enabled.
        </Card>
      </div>
    );
  }

  const totalAhead = forksData?.forks.reduce((s, f) => s + (f.ahead ?? 0), 0) ?? 0;
  const totalBehind = forksData?.forks.reduce((s, f) => s + (f.behind ?? 0), 0) ?? 0;
  const totalUncommitted = forksData?.forks.filter((f) => f.hasUncommitted).length ?? 0;
  const totalUnpushed = forksData?.forks.filter((f) => f.hasUnpushed).length ?? 0;
  const aligned = forksData && forksData.forks.length > 0 && totalAhead === 0 && totalBehind === 0 && totalUncommitted === 0;

  return (
    <div className="h-full overflow-y-auto p-4 max-w-4xl space-y-6" data-testid="pax-page">
      <div>
        <h1 className="text-[16px] font-semibold mb-1">PAx · ADF UI Primitives</h1>
        <p className="text-[12px] text-muted-foreground">
          The four Particle-Academy packages consumed by the dashboard, plugins, MApps, and locally-hosted apps:
          react-fancy, fancy-code, fancy-sheets, fancy-echarts. Same maintenance loop as Aionima — file issues
          + open PRs upstream via the cross-repo flow.
        </p>
      </div>

      {/* Rolled-up alignment summary */}
      <section data-testid="pax-alignment-summary">
        <h2 className="text-[14px] font-semibold mb-2">Upstream Alignment</h2>
        {loading && <div className="text-[12px] text-muted-foreground">Loading fork status…</div>}
        {error && <div className="text-[12px] text-destructive">{error}</div>}
        {!loading && !error && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card className="p-3">
              <div className="text-[11px] text-muted-foreground uppercase tracking-wider">Status</div>
              <div className="text-[15px] font-semibold mt-1" data-testid="pax-aligned-badge">
                {aligned ? "✓ Aligned" : forksData?.forks.length === 0 ? "Not provisioned" : "Drift"}
              </div>
            </Card>
            <Card className="p-3">
              <div className="text-[11px] text-muted-foreground uppercase tracking-wider">Ahead</div>
              <div className="text-[15px] font-semibold mt-1">{totalAhead}</div>
            </Card>
            <Card className="p-3">
              <div className="text-[11px] text-muted-foreground uppercase tracking-wider">Behind</div>
              <div className="text-[15px] font-semibold mt-1">{totalBehind}</div>
            </Card>
            <Card className="p-3">
              <div className="text-[11px] text-muted-foreground uppercase tracking-wider">Uncommitted / Unpushed</div>
              <div className="text-[15px] font-semibold mt-1">{totalUncommitted} / {totalUnpushed}</div>
            </Card>
          </div>
        )}
      </section>

      {/* Per-fork detail */}
      <section data-testid="pax-forks-detail">
        <h2 className="text-[14px] font-semibold mb-2">Per-package status</h2>
        {forksData && forksData.forks.length === 0 && (
          <div className="text-[12px] text-muted-foreground">
            {forksData.error ?? "PAx packages not provisioned — toggle Contributing Mode in Settings → Gateway."}
          </div>
        )}
        {forksData && forksData.forks.length > 0 && (
          <table className="w-full text-[12px]" data-testid="pax-forks-table">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left pb-1">Package</th>
                <th className="text-left pb-1">Ahead</th>
                <th className="text-left pb-1">Behind</th>
                <th className="text-left pb-1">Local state</th>
              </tr>
            </thead>
            <tbody>
              {forksData.forks.map((fork) => (
                <tr key={fork.slug} className="border-b border-border/50">
                  <td className="py-1 font-mono">{fork.slug}</td>
                  <td className="py-1 font-mono">{fork.ahead ?? "—"}</td>
                  <td className="py-1 font-mono">{fork.behind ?? "—"}</td>
                  <td className="py-1 text-[11px]">
                    {fork.hasUncommitted && <span className="text-yellow">uncommitted </span>}
                    {fork.hasUnpushed && <span className="text-yellow">unpushed </span>}
                    {!fork.hasUncommitted && !fork.hasUnpushed && <span className="text-muted-foreground">clean</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Maintenance flow card */}
      <section data-testid="pax-maintenance-flow">
        <h2 className="text-[14px] font-semibold mb-2">Maintenance loop</h2>
        <Card className="p-3 text-[12px] space-y-2">
          <div>
            File issues + open PRs against the four upstream repos via cross-repo PR (wishborn/&lt;pkg&gt;:dev → Particle-Academy/&lt;pkg&gt;:main).
          </div>
          <div>
            Full discipline at <code className="text-[11px]">agi/docs/agents/contributing-to-adf-packages.md</code>.
          </div>
          <div>
            Provision/repair forks via <a href="/settings/gateway" className="text-blue underline">Settings → Gateway → Contributing</a>.
          </div>
        </Card>
      </section>
    </div>
  );
}
