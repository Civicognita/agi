/**
 * Settings → Providers route — s111 t373 first slice.
 *
 * Visual design canon: ~/_dropbox/providers-mockup.html (DESIGN APPROVED
 * 2026-04-25). The mockup is layout/IA reference, not functional spec —
 * specific values shown there (TrueCost numbers, decision-preview JSON,
 * latency estimates) are illustrative.
 *
 * What this slice ships:
 *   - Disclaimer banner (visual-only mockup discipline)
 *   - Page head with off-grid toggle wired to PUT /api/providers/router
 *   - Provider shelf rendering /api/providers/catalog with tier badges,
 *     active highlight from /api/providers/active, dependsOn → "runs on X",
 *     modelCount, baseUrl, off-grid capability
 *
 * What follow-up cycles add (separate slices):
 *   - Mission Control hero (decision-feed data source not yet exposed)
 *   - Cost-mode dial + true-cost ticker (cost-mode controls + ledger data)
 *   - Runtimes strip (t376 Runtime catalog work)
 *   - Decision feed + what-if simulator (request-classifier integration)
 *   - Per-Provider drill-down ("View models" action target)
 */

import { useEffect, useState, useCallback } from "react";
import { Card } from "@/components/ui/card";
import {
  fetchProvidersCatalog,
  fetchActiveProvider,
  updateRouterConfig,
  type ProviderCatalogEntry,
  type ActiveProviderState,
} from "@/api.js";

// ---------------------------------------------------------------------------
// Tier badge — matches the mockup's pcard-tier color treatment
// ---------------------------------------------------------------------------

function TierBadge({ tier }: { tier: ProviderCatalogEntry["tier"] }) {
  const colorClass = {
    floor: "bg-sky-500/15 text-sky-400",
    local: "bg-emerald-500/15 text-emerald-400",
    cloud: "bg-purple-400/15 text-purple-400",
    core: "bg-blue-500/15 text-blue-400",
  }[tier];
  const label = tier === "floor" ? "core · floor" : tier;
  return (
    <span
      className={`text-[9.5px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${colorClass}`}
    >
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Off-grid toggle — header chip; writes to /api/providers/router
// ---------------------------------------------------------------------------

function OffGridToggle({
  on,
  onToggle,
  pending,
}: {
  on: boolean;
  onToggle: () => void;
  pending: boolean;
}) {
  return (
    <div
      className="flex items-center gap-3 bg-card border border-border rounded-lg px-4 py-2.5"
      title="When ON: cloud Providers disabled. ALL local Providers + Runtimes remain available; aion-micro is the guaranteed floor."
    >
      <button
        type="button"
        onClick={onToggle}
        disabled={pending}
        className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${
          on ? "bg-emerald-500" : "bg-secondary"
        } ${pending ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
        aria-label="Toggle off-grid mode"
      >
        <span
          className={`absolute top-0.5 ${on ? "left-[22px] bg-white" : "left-0.5 bg-muted-foreground"} w-[18px] h-[18px] rounded-full transition-all`}
        />
      </button>
      <div>
        <div className="font-semibold text-[13px] text-foreground">Off-grid mode</div>
        <div className="text-muted-foreground text-[11px]">
          Disables cloud · uses any local Provider · aion-micro guaranteed
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Provider card — single Provider in the shelf
// ---------------------------------------------------------------------------

function ProviderCard({
  provider,
  isActive,
}: {
  provider: ProviderCatalogEntry;
  isActive: boolean;
}) {
  const offGridLabel = provider.offGridCapable ? "✓ yes" : "✗ no";
  const offGridColor = provider.offGridCapable ? "text-emerald-400" : "text-red-400";
  const dependsOnText =
    provider.dependsOn && provider.dependsOn.length > 0
      ? `runs on ${provider.dependsOn.join(", ")}`
      : provider.baseUrl
        ? provider.baseUrl
        : "Cloud API";
  const meta = provider.defaultModel ?? (provider.modelCount ? `${String(provider.modelCount)} models` : "—");
  const healthColor = {
    healthy: "text-emerald-400",
    degraded: "text-amber-400",
    unreachable: "text-red-400",
    "no-key": "text-amber-400",
  }[provider.health];

  return (
    <Card
      className={`p-5 transition-colors ${
        isActive
          ? "border-primary shadow-[0_0_0_1px_var(--primary),0_4px_24px_rgba(91,141,239,0.15)]"
          : "hover:border-primary/50"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[17px] font-semibold flex items-center gap-2">
            {provider.name}
            {isActive && (
              <span className="text-[10px] text-primary font-bold tracking-wider uppercase">
                Active
              </span>
            )}
          </div>
          <div className="text-muted-foreground text-[12px] mt-1 font-mono truncate">{meta}</div>
        </div>
        <TierBadge tier={provider.tier} />
      </div>
      <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-border">
        <div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Health</div>
          <div className={`text-[13px] font-semibold mt-0.5 font-mono ${healthColor}`}>
            {provider.health}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Off-grid</div>
          <div className={`text-[13px] font-semibold mt-0.5 font-mono ${offGridColor}`}>
            {offGridLabel}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Timeout</div>
          <div className="text-[13px] font-semibold mt-0.5 font-mono text-foreground">
            {provider.timeoutMultiplier === 1 ? "60s" : `${String(provider.timeoutMultiplier * 60)}s`}
          </div>
        </div>
      </div>
      <div className="mt-3 px-3 py-2 bg-background rounded-md text-[11px] text-muted-foreground">
        ▾ {dependsOnText}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SettingsProvidersPage() {
  const [catalog, setCatalog] = useState<ProviderCatalogEntry[]>([]);
  const [active, setActive] = useState<ActiveProviderState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [togglePending, setTogglePending] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [catalogRes, activeRes] = await Promise.all([
        fetchProvidersCatalog(),
        fetchActiveProvider(),
      ]);
      setCatalog(catalogRes.providers);
      setActive(activeRes);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const onToggleOffGrid = useCallback(async () => {
    if (!active || togglePending) return;
    setTogglePending(true);
    try {
      const next = await updateRouterConfig({ offGridMode: !active.offGridMode });
      setActive(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTogglePending(false);
    }
  }, [active, togglePending]);

  if (loading) {
    return <div className="text-center py-12 text-muted-foreground">Loading Providers...</div>;
  }

  if (error && catalog.length === 0) {
    return (
      <div className="px-3.5 py-2.5 rounded-lg bg-surface0 text-red-400 text-[13px]">
        Failed to load Providers: {error}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Disclaimer banner — visual design discipline (mockup is layout, not contract) */}
      <div className="px-4 py-3 rounded-lg border-l-4 border-amber-400 border border-amber-400/30 bg-amber-400/5 text-[12.5px] leading-relaxed">
        <strong className="text-amber-400 uppercase tracking-wider text-[11px]">
          ⚠ Implementation in progress
        </strong>
        <p className="mt-1 text-foreground">
          This is the first slice of the Providers route. Catalog rendering, off-grid toggle, and
          active-Provider highlight ship in v0.4.208. Mission Control hero, cost-mode dial,
          Runtimes strip, decision feed, and what-if simulator land in follow-up cycles. See
          <code className="bg-background px-1.5 py-0.5 rounded mx-1 text-[11px]">tynn s111</code>
          for the task chain.
        </p>
      </div>

      {/* Page head */}
      <div className="flex items-end justify-between gap-8 flex-wrap">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight">Providers</h1>
          <p className="text-muted-foreground mt-1 max-w-[56ch] text-[13.5px]">
            Aion's available brains. Each Provider is a catalog of models. The Agent Router picks
            the right Provider + model for each turn — you tell it how to prefer cost vs capability,
            it does the rest. <strong className="text-foreground">aion-micro</strong> is the floor:
            always available, even off-grid.
          </p>
        </div>
        {active && (
          <OffGridToggle
            on={active.offGridMode}
            onToggle={() => void onToggleOffGrid()}
            pending={togglePending}
          />
        )}
      </div>

      {/* Provider shelf */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[18px] font-semibold">Available Providers</h2>
          <span className="text-muted-foreground text-[12px]">
            Click a card to inspect or set active (coming in next slice)
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {catalog.map((p) => (
            <ProviderCard
              key={p.id}
              provider={p}
              isActive={active?.activeProviderId === p.id}
            />
          ))}
        </div>
      </div>

      {error && catalog.length > 0 && (
        <div className="px-3.5 py-2.5 rounded-lg bg-red-500/10 text-red-400 text-[12px]">
          Last action failed: {error}
        </div>
      )}
    </div>
  );
}
