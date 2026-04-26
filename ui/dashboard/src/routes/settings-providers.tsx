/**
 * Settings → Providers route — s111 t373 + slice follow-ups.
 *
 * Visual design canon: ~/_dropbox/providers-mockup.html (DESIGN APPROVED
 * 2026-04-25). The mockup is layout/IA reference, not functional spec —
 * specific values shown there (TrueCost numbers, decision-preview JSON,
 * latency estimates) are illustrative.
 *
 * Shipped (cumulative through v0.4.210):
 *   - Disclaimer banner (visual-only mockup discipline)
 *   - Page head with off-grid toggle wired to PUT /api/providers/router
 *     (t373 first slice / v0.4.208)
 *   - Provider shelf rendering /api/providers/catalog with tier badges,
 *     active highlight, dependsOn → "runs on X", modelCount, baseUrl,
 *     off-grid capability (t373 first slice / v0.4.208)
 *   - "Set active" mutation per Provider card with cloud-when-off-grid
 *     confirmation guard (t418 / v0.4.209)
 *   - Cost-mode dial wired to PUT /api/providers/router (body.costMode);
 *     placeholder cost ticker per mockup discipline (t420 / v0.4.210)
 *
 * What follow-up cycles add (separate slices):
 *   - Mission Control hero (t419 — decision-feed backend endpoint first)
 *   - Cost ledger backend → real ticker data (separate task)
 *   - Runtimes strip (t376 Runtime catalog work)
 *   - Decision feed + what-if simulator (request-classifier integration)
 *   - Per-Provider drill-down ("View models" action target)
 *   - Custom modal for confirmation guards (replaces window.confirm)
 */

import { useEffect, useState, useCallback } from "react";
import { Card } from "@/components/ui/card";
import {
  fetchProvidersCatalog,
  fetchActiveProvider,
  updateActiveProvider,
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
// Cost-mode dial (s111 t420 / A2 slice 4)
//
// Backend's KNOWN_COST_MODES (providers-api.ts:99) is local|economy|balanced|max.
// The mockup shows a horizontal slider with 3 visible stops (Local/Balanced/
// Max); we render 4 stops to expose `economy` as well — it's a real cost mode
// the backend supports and economy = "Anthropic Haiku always" is owner-useful
// distinct from local. Stop positions: local=0%, economy=33%, balanced=66%,
// max=100%. The fill bar tracks the selected stop's left edge.
// ---------------------------------------------------------------------------

const COST_MODES = ["local", "economy", "balanced", "max"] as const;
type CostMode = (typeof COST_MODES)[number];

const COST_MODE_DESCRIPTIONS: Record<CostMode, string> = {
  local: "Always local Providers. Cheapest, slowest. Off-grid-safe.",
  economy: "Cloud Haiku-tier when local missing. Cheap cloud fallback.",
  balanced: "Cloud Sonnet-tier for moderate+complex. Default for most users.",
  max: "Always cloud Opus-tier. Best quality, highest $$$ — ignores localFirst.",
};

function isCostMode(s: string): s is CostMode {
  return (COST_MODES as readonly string[]).includes(s);
}

function CostModeDial({
  current,
  pending,
  onChange,
}: {
  current: CostMode;
  pending: boolean;
  onChange: (next: CostMode) => void;
}) {
  const idx = COST_MODES.indexOf(current);
  const fillPct = COST_MODES.length > 1 ? (idx / (COST_MODES.length - 1)) * 100 : 0;
  const description = COST_MODE_DESCRIPTIONS[current];
  return (
    <Card className="p-6">
      <div className="grid md:grid-cols-2 gap-6 items-center">
        <div>
          <h3 className="text-base font-semibold">Cost preference</h3>
          <p className="text-muted-foreground text-[13px] mt-1">
            Aion respects this preference for every routing decision unless a hard rule
            overrides (off-grid mode, no internet, missing API key).
          </p>
          <p className="text-[12px] mt-3 px-3 py-2 rounded-md bg-secondary text-foreground">
            <span className="text-primary font-semibold">{current}:</span> {description}
          </p>
        </div>
        <div>
          {/* Track + fill + clickable stops. Continuous-slider feel, discrete
              backend semantics — clicking a stop snaps to that cost mode. */}
          <div
            className="relative h-3 bg-secondary rounded-full"
            role="presentation"
          >
            <div
              className="absolute left-0 top-0 bottom-0 rounded-full bg-gradient-to-r from-emerald-500 to-primary transition-all"
              style={{ width: `${String(fillPct)}%` }}
            />
            {COST_MODES.map((mode, i) => {
              const left = COST_MODES.length > 1 ? (i / (COST_MODES.length - 1)) * 100 : 0;
              const isCurrent = mode === current;
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => !pending && !isCurrent && onChange(mode)}
                  disabled={pending}
                  aria-label={`Set cost mode to ${mode}`}
                  className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full transition-all ${
                    isCurrent
                      ? "w-5 h-5 bg-white shadow-[0_2px_12px_rgba(91,141,239,0.6)] cursor-default"
                      : pending
                        ? "w-3 h-3 bg-muted-foreground cursor-wait"
                        : "w-3 h-3 bg-muted-foreground hover:bg-foreground cursor-pointer"
                  }`}
                  style={{ left: `${String(left)}%` }}
                />
              );
            })}
          </div>
          <div className="flex justify-between mt-2 text-[11px]">
            {COST_MODES.map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => !pending && mode !== current && onChange(mode)}
                disabled={pending}
                className={`capitalize font-medium ${
                  mode === current ? "text-primary" : "text-muted-foreground hover:text-foreground"
                } ${pending ? "cursor-wait" : "cursor-pointer"}`}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Cost ticker — placeholder strip (real data lands when cost ledger ships)
//
// Per the mockup's "values illustrative" framing, the four tiles (today /
// week / tokens / $IMP) show example numbers with a "v0.6.0+" badge indicating
// the cost ledger backend is a separate task. The dial above IS fully wired;
// the ticker is the placeholder. Splitting wire-status this way prevents the
// "looks like real data but isn't" UX bug.
// ---------------------------------------------------------------------------

function CostTicker() {
  const tiles: Array<{ label: string; value: string; unit: string; sub: string }> = [
    { label: "Today", value: "—", unit: "USD", sub: "cost ledger pending" },
    { label: "This week", value: "—", unit: "USD", sub: "cost ledger pending" },
    { label: "Tokens used", value: "—", unit: "in/out", sub: "cost ledger pending" },
    { label: "$IMP minted", value: "—", unit: "$IMP", sub: "via 0SCALE · v0.6.0+" },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
      {tiles.map((t) => (
        <div key={t.label} className="bg-secondary rounded-lg px-4 py-3">
          <div className="text-[11px] text-muted-foreground uppercase tracking-wider">{t.label}</div>
          <div className="text-[18px] font-semibold mt-1 tabular-nums">
            {t.value}{" "}
            <span className="text-muted-foreground text-[13px] font-normal">{t.unit}</span>
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">{t.sub}</div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Provider card — single Provider in the shelf
// ---------------------------------------------------------------------------

function ProviderCard({
  provider,
  isActive,
  pending,
  onActivate,
}: {
  provider: ProviderCatalogEntry;
  isActive: boolean;
  pending: boolean;
  onActivate: () => void;
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
      {/* Set-active action — t418. Clicking on the active Provider is a noop;
          the button label changes to "Currently active" to make state obvious.
          Cloud-when-off-grid is intercepted at the page level by a confirmation
          guard before the PUT fires. */}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onActivate}
          disabled={isActive || pending}
          className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
            isActive
              ? "bg-primary text-primary-foreground cursor-default"
              : pending
                ? "bg-secondary text-muted-foreground cursor-wait"
                : "bg-secondary text-foreground hover:bg-primary hover:text-primary-foreground"
          }`}
          aria-label={isActive ? "Currently active" : `Set ${provider.name} active`}
        >
          {isActive ? "Currently active" : pending ? "Activating…" : "Set active"}
        </button>
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
  const [activatingId, setActivatingId] = useState<string | null>(null);
  const [costModePending, setCostModePending] = useState(false);

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

  const onChangeCostMode = useCallback(
    async (next: CostMode) => {
      if (!active || costModePending) return;
      if (active.router.costMode === next) return;
      setCostModePending(true);
      try {
        const updated = await updateRouterConfig({ costMode: next });
        setActive(updated);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setCostModePending(false);
      }
    },
    [active, costModePending],
  );

  const onActivateProvider = useCallback(
    async (provider: ProviderCatalogEntry) => {
      if (!active || activatingId !== null) return;
      if (provider.id === active.activeProviderId) return;

      // Confirmation guard: activating a cloud Provider while off-grid mode
      // is on would set a Provider that the router will then refuse to use
      // (per t415 — cloud Providers filtered when offGrid=true). Better to
      // catch this at click-time than let the user set active and then watch
      // chat fail silently. The browser confirm() is a deliberately small
      // UX choice for this slice; a custom modal can land in slice 4 (t420)
      // alongside the cost-mode dial which has similar guard semantics.
      if (active.offGridMode && !provider.offGridCapable) {
        const ok = window.confirm(
          `Off-grid mode is on. ${provider.name} is a cloud Provider and won't be reachable while off-grid is enabled.\n\nActivate anyway? (Disable off-grid mode first if you want this Provider to actually serve chat.)`,
        );
        if (!ok) return;
      }

      setActivatingId(provider.id);
      try {
        // Send defaultModel when the catalog declares one (t416 field) so the
        // backend persists agent.model alongside agent.provider. Without this,
        // switching to a different Provider with a different default model
        // would leave the previous Provider's model name in config.
        const next = await updateActiveProvider({
          providerId: provider.id,
          ...(provider.defaultModel !== undefined ? { model: provider.defaultModel } : {}),
        });
        setActive(next);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setActivatingId(null);
      }
    },
    [active, activatingId],
  );

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

      {/* Cost-mode dial + placeholder ticker (s111 t420) */}
      {active && (
        <div>
          <CostModeDial
            current={isCostMode(active.router.costMode) ? active.router.costMode : "balanced"}
            pending={costModePending}
            onChange={(next) => void onChangeCostMode(next)}
          />
          <CostTicker />
        </div>
      )}

      {/* Provider shelf */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[18px] font-semibold">Available Providers</h2>
          <span className="text-muted-foreground text-[12px]">
            Click "Set active" on a card to switch the Agent Router's default Provider
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {catalog.map((p) => (
            <ProviderCard
              key={p.id}
              provider={p}
              isActive={active?.activeProviderId === p.id}
              pending={activatingId === p.id}
              onActivate={() => void onActivateProvider(p)}
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
