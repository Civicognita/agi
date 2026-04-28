/**
 * Aionima Development view (s119) — single consolidated surface for the
 * platform's core forks (agi/prime/id/marketplace/mapp-marketplace).
 *
 * Replaces the per-repo "sacred project" tile pattern in /projects with
 * one rolled-up view showing upstream-alignment status, PR-submission
 * flow, and MINT($WORK|$K|$RES) placeholder integration.
 *
 * The five core repos become INTERNAL DETAILS of this surface, not
 * user-facing tiles. This page is the canonical entry point for "how do
 * I contribute to Aionima itself?"
 */

import { useEffect, useState } from "react";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { useIsTestVm } from "../hooks/useRuntimeMode";

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

type MintCurrency = "WORK" | "K" | "RES";

const MINT_CURRENCIES: { id: MintCurrency; label: string; description: string }[] = [
  { id: "WORK", label: "$WORK", description: "Work-impact: deliverables, commits, shipped features." },
  { id: "K", label: "$K", description: "Knowledge-impact: docs, explanations, patterns." },
  { id: "RES", label: "$RES", description: "Resource-impact: compute, storage, capital provided." },
];

export default function AionimaPage(): JSX.Element {
  const isTestVm = useIsTestVm();
  const [forksData, setForksData] = useState<ForksResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedMint, setSelectedMint] = useState<MintCurrency>("WORK");

  useEffect(() => {
    if (isTestVm) { setLoading(false); return; }
    let cancelled = false;
    (async (): Promise<void> => {
      try {
        const res = await fetch("/api/dev/core-forks/status");
        if (!res.ok) {
          if (!cancelled) setError(`forks API returned ${String(res.status)}`);
          return;
        }
        const data = (await res.json()) as ForksResponse;
        if (!cancelled) setForksData(data);
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
      <div className="p-4 max-w-4xl" data-testid="aionima-page">
        <h1 className="text-[16px] font-semibold mb-2">Aionima Development</h1>
        <Card className="p-4 text-[13px] text-muted-foreground">
          Aionima Development is hidden in test-VM mode — this gateway IS the system being developed.
          Switch to a production or dev gateway to access the consolidated view.
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
    <div className="p-4 max-w-4xl space-y-6" data-testid="aionima-page">
      <div>
        <h1 className="text-[16px] font-semibold mb-1">Aionima Development</h1>
        <p className="text-[12px] text-muted-foreground">
          Single consolidated view for the Aionima platform's core forks. Tracking
          upstream-alignment, PR submission, and MINT impact across the five core
          repos as a whole.
        </p>
      </div>

      {/* Rolled-up alignment summary */}
      <section data-testid="aionima-alignment-summary">
        <h2 className="text-[14px] font-semibold mb-2">Upstream Alignment</h2>
        {loading && <div className="text-[12px] text-muted-foreground">Loading…</div>}
        {error && <div className="text-[12px] text-red">{error}</div>}
        {forksData && (
          <Card className="p-3 text-[13px]">
            <div className="flex items-center gap-3 mb-2">
              <span
                className={"px-2 py-0.5 rounded text-[11px] " + (aligned ? "bg-green/20 text-green" : "bg-yellow/20 text-yellow")}
                data-testid="aionima-aligned-badge"
              >
                {aligned ? "Aligned" : "Drift"}
              </span>
              <span className="text-muted-foreground text-[11px]">
                Branch: <span className="font-mono">{forksData.branch ?? "main"}</span>
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[12px]">
              <div><span className="text-muted-foreground">Total ahead:</span> <span className="font-mono">{totalAhead}</span></div>
              <div><span className="text-muted-foreground">Total behind:</span> <span className="font-mono">{totalBehind}</span></div>
              <div><span className="text-muted-foreground">Forks with uncommitted:</span> <span className="font-mono">{totalUncommitted}</span></div>
              <div><span className="text-muted-foreground">Forks with unpushed:</span> <span className="font-mono">{totalUnpushed}</span></div>
            </div>
          </Card>
        )}
      </section>

      {/* Per-fork detail (rolled into one section, not separate tiles) */}
      <section data-testid="aionima-forks-detail">
        <h2 className="text-[14px] font-semibold mb-2">Per-fork status</h2>
        {forksData && forksData.forks.length === 0 && (
          <div className="text-[12px] text-muted-foreground">
            {forksData.error ?? "Core-fork collection not provisioned — enable Dev Mode."}
          </div>
        )}
        {forksData && forksData.forks.length > 0 && (
          <table className="w-full text-[12px]" data-testid="aionima-forks-table">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left pb-1">Fork</th>
                <th className="text-left pb-1">Ahead</th>
                <th className="text-left pb-1">Behind</th>
                <th className="text-left pb-1">Local state</th>
                <th className="text-left pb-1">Action</th>
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
                  <td className="py-1">
                    {fork.behind && fork.behind > 0 ? (
                      <Button data-testid={`aionima-merge-${fork.slug}`}>Merge upstream</Button>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* PR submission entry point */}
      <section data-testid="aionima-pr-flow">
        <h2 className="text-[14px] font-semibold mb-2">Submit PR</h2>
        <Card className="p-3 text-[13px] text-muted-foreground">
          When a fork has unpushed commits, use <span className="font-mono">agi push &lt;slug&gt;</span> to push
          the branch + open a PR against upstream. Per-fork CI runs are linked from the per-fork detail above.
        </Card>
      </section>

      {/* MINT($WORK|$K|$RES) integration — placeholder */}
      <section data-testid="aionima-mint-flow">
        <h2 className="text-[14px] font-semibold mb-2">MINT impact for this contribution</h2>
        <Card className="p-3 space-y-2">
          <p className="text-[12px] text-muted-foreground">
            After your PR merges upstream, mint the contribution into one of the three Impactivism currencies:
          </p>
          <div className="grid grid-cols-3 gap-2" data-testid="aionima-mint-currencies">
            {MINT_CURRENCIES.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelectedMint(c.id)}
                data-testid={`aionima-mint-${c.id}`}
                className={"rounded border p-2 text-left text-[12px] " + (selectedMint === c.id ? "border-green bg-green/10" : "border-border")}
              >
                <div className="font-mono font-semibold">{c.label}</div>
                <div className="text-[11px] text-muted-foreground">{c.description}</div>
              </button>
            ))}
          </div>
          <Button disabled data-testid="aionima-mint-submit">
            MINT to ${selectedMint} (wiring lands once Impactium is operational)
          </Button>
        </Card>
      </section>
    </div>
  );
}
