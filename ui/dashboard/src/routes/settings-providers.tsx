/**
 * Settings → Providers route — s111 t373 + slice follow-ups.
 *
 * Visual design canon: ~/_dropbox/providers-mockup.html (DESIGN APPROVED
 * 2026-04-25). The mockup is layout/IA reference, not functional spec —
 * specific values shown there (TrueCost numbers, decision-preview JSON,
 * latency estimates) are illustrative.
 *
 * Shipped (cumulative through v0.4.211):
 *   - Disclaimer banner (visual-only mockup discipline)
 *   - Mission Control hero with most recent routing decision flow +
 *     synthesized narrative (t419 / v0.4.211)
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
 *   - Cost ledger backend → real ticker data + watt readout in narrative
 *     (t421)
 *   - Runtimes strip (t376 Runtime catalog work)
 *   - Decision feed + what-if simulator (request-classifier integration)
 *   - Per-Provider drill-down ("View models" action target)
 *   - Custom modal for confirmation guards (replaces window.confirm)
 *   - "Last turn" prompt-text node in the hero (needs request payload
 *     storage which RoutingDecision intentionally doesn't carry)
 */

import { useEffect, useState, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ModelsTab } from "@/components/ModelsTab";
import {
  fetchProvidersCatalog,
  fetchActiveProvider,
  fetchRecentDecisions,
  updateActiveProvider,
  updateRouterConfig,
  type ProviderCatalogEntry,
  type ActiveProviderState,
  type RoutingDecisionRecord,
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
// Mission Control hero (s111 t419 UI slice)
//
// Shows the most recent routing decision as a flow: Provider → Runtime, with
// a narrative paragraph synthesized from the decision metadata. The full
// mockup shows 3 nodes (Last turn → Provider → Runtime) with the user
// prompt in the first node — we omit that node because the user-prompt
// text isn't in RoutingDecision (and synthesizing one would violate the
// "values illustrative" / no-fabrication discipline). When no decisions
// yet exist (fresh boot, no chat turns), the hero hides entirely; the
// cost dial + Provider shelf still render.
// ---------------------------------------------------------------------------

function formatTimeAgo(ts: string): string {
  const elapsed = Date.now() - new Date(ts).getTime();
  if (elapsed < 60_000) return `${String(Math.max(1, Math.round(elapsed / 1000)))}s ago`;
  if (elapsed < 3_600_000) return `${String(Math.round(elapsed / 60_000))}m ago`;
  if (elapsed < 86_400_000) return `${String(Math.round(elapsed / 3_600_000))}h ago`;
  return new Date(ts).toLocaleString();
}

function synthesizeNarrative(
  decision: RoutingDecisionRecord,
  catalog: ProviderCatalogEntry[],
): string {
  const provider = catalog.find((p) => p.id === decision.provider);
  const tier = provider?.tier ?? "unknown";
  const tierClause =
    tier === "cloud"
      ? "a cloud Provider"
      : tier === "floor"
        ? "the off-grid floor"
        : tier === "local"
          ? "a local Provider"
          : "the configured Provider";
  const escalationClause = decision.escalated ? " (escalated mid-turn for higher quality)" : "";
  return (
    `Picked ${decision.model} via ${decision.provider} (${tierClause}) ` +
    `for a ${decision.complexity} request in ${decision.costMode} cost mode${escalationClause}. ` +
    `Reason: ${decision.reason}.`
  );
}

function MissionControlHero({
  decision,
  catalog,
}: {
  decision: RoutingDecisionRecord;
  catalog: ProviderCatalogEntry[];
}) {
  const provider = catalog.find((p) => p.id === decision.provider);
  const runtimeLabel =
    provider?.dependsOn && provider.dependsOn.length > 0
      ? provider.dependsOn.join(", ")
      : provider?.baseUrl ?? "Cloud API";
  const runtimeSub = provider?.baseUrl ?? (provider?.tier === "cloud" ? "remote" : "—");
  const narrative = synthesizeNarrative(decision, catalog);
  const tag = decision.ts !== undefined ? `Right now · ${formatTimeAgo(decision.ts)}` : "Right now";
  return (
    <Card
      className="p-7 relative overflow-hidden bg-gradient-to-br from-primary/10 to-purple-400/[0.04] border-primary/25"
    >
      <div className="text-[10px] text-primary uppercase tracking-[0.12em] font-bold">{tag}</div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 mt-3">
        {/* Provider node — primary highlight, matches mockup's "active" node */}
        <Card className="p-3.5 border-primary/50 bg-primary/[0.06]">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
            Provider
          </div>
          <div className="text-base font-semibold mt-0.5 flex items-center gap-1.5">
            {provider?.name ?? decision.provider}
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5 font-mono truncate">
            {decision.model}
          </div>
        </Card>
        <div className="text-primary text-2xl animate-pulse">→</div>
        {/* Runtime node — dashed border matches mockup, lower visual prominence */}
        <Card className="p-3.5 border-dashed border-border">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
            Runtime
          </div>
          <div className="text-base font-semibold mt-0.5">{runtimeLabel}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5 font-mono truncate">
            {runtimeSub}
          </div>
        </Card>
      </div>
      <div className="mt-5 px-4 py-3 bg-primary/[0.06] border-l-[3px] border-primary rounded-md text-[13.5px] leading-relaxed">
        <div className="text-[11px] text-primary font-semibold uppercase tracking-wider mb-1">
          Aion · routing decision
        </div>
        {narrative}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Cost-mode range dial (s111 t420 + s129 t510)
//
// Backend's KNOWN_COST_MODES (providers-api.ts:158) is local|economy|balanced|max.
// The dial renders all four stops on a single track. Two handles select a
// floor (where every turn starts) and a ceiling (max escalation tier);
// floor === ceiling means "lock to this tier; never escalate". When the
// handles are equal the gradient between them collapses to a single dot, so
// the visual reads as a locked tier; when they're separate the gradient runs
// from emerald (low cost) → primary (high cost), matching the original
// single-mode visual language. Clicking a stop or label snaps the NEAREST
// handle. The legacy `costMode` continues to be patched alongside `floor`
// so older Provider plugins reading `costMode` still see a coherent value.
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

function CostModeRangeDial({
  floor,
  ceiling,
  pending,
  onChange,
}: {
  floor: CostMode;
  ceiling: CostMode;
  pending: boolean;
  onChange: (next: { floor: CostMode; ceiling: CostMode }) => void;
}) {
  const floorIdx = COST_MODES.indexOf(floor);
  const ceilingIdx = COST_MODES.indexOf(ceiling);
  const max = COST_MODES.length - 1;
  const floorPct = max > 0 ? (floorIdx / max) * 100 : 0;
  const ceilingPct = max > 0 ? (ceilingIdx / max) * 100 : 0;
  const locked = floor === ceiling;
  const description = locked
    ? `${COST_MODE_DESCRIPTIONS[floor]} (locked — no escalation)`
    : `Starts at ${floor}; escalates up to ${ceiling} when warranted.`;

  // Snap the nearest handle on click — distance ties go to ceiling so it's
  // possible to widen a locked range without un-pinning floor first.
  const snapNearest = (i: number): void => {
    if (pending) return;
    const distFloor = Math.abs(i - floorIdx);
    const distCeil = Math.abs(i - ceilingIdx);
    if (distFloor < distCeil) {
      const nextFloor = COST_MODES[i]!;
      const nextCeiling = i > ceilingIdx ? nextFloor : ceiling;
      if (nextFloor === floor && nextCeiling === ceiling) return;
      onChange({ floor: nextFloor, ceiling: nextCeiling });
    } else {
      const nextCeiling = COST_MODES[i]!;
      const nextFloor = i < floorIdx ? nextCeiling : floor;
      if (nextFloor === floor && nextCeiling === ceiling) return;
      onChange({ floor: nextFloor, ceiling: nextCeiling });
    }
  };

  return (
    <Card className="p-6">
      <div className="grid md:grid-cols-2 gap-6 items-center">
        <div>
          <h3 className="text-base font-semibold">Cost preference</h3>
          <p className="text-muted-foreground text-[13px] mt-1">
            Set a tier range. Aion starts every turn at the floor, and may escalate up
            to the ceiling when a request looks too complex or low-confidence. Drag the
            handles together to lock a single tier (no escalation).
          </p>
          <p className="text-[12px] mt-3 px-3 py-2 rounded-md bg-secondary text-foreground">
            <span className="text-primary font-semibold">
              {locked ? `${floor} only` : `${floor} → ${ceiling}`}:
            </span>{" "}
            {description}
          </p>
        </div>
        <div>
          {/* Track + range fill + two handles. Visual language matches the original
              single-mode dial (gradient emerald→primary, white handle with glow,
              clickable stops + label row); range mode just adds the second handle
              and constrains the gradient to the [floor, ceiling] window. */}
          <div
            className="relative h-3 bg-secondary rounded-full"
            role="presentation"
            data-testid="cost-mode-range-dial"
          >
            <div
              className="absolute top-0 bottom-0 rounded-full bg-gradient-to-r from-emerald-500 to-primary transition-all"
              style={{
                left: `${String(floorPct)}%`,
                width: `${String(ceilingPct - floorPct)}%`,
              }}
            />
            {COST_MODES.map((mode, i) => {
              const left = max > 0 ? (i / max) * 100 : 0;
              const isFloor = i === floorIdx;
              const isCeiling = i === ceilingIdx;
              const isHandle = isFloor || isCeiling;
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => snapNearest(i)}
                  disabled={pending || (isFloor && isCeiling)}
                  aria-label={
                    isFloor && isCeiling
                      ? `Locked at ${mode}`
                      : isFloor
                        ? `Floor: ${mode}`
                        : isCeiling
                          ? `Ceiling: ${mode}`
                          : `Snap nearest handle to ${mode}`
                  }
                  className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full transition-all ${
                    isHandle
                      ? "w-5 h-5 bg-white shadow-[0_2px_12px_rgba(91,141,239,0.6)] cursor-pointer"
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
            {COST_MODES.map((mode, i) => {
              const isInRange = i >= floorIdx && i <= ceilingIdx;
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => snapNearest(i)}
                  disabled={pending}
                  className={`capitalize font-medium ${
                    isInRange ? "text-primary" : "text-muted-foreground hover:text-foreground"
                  } ${pending ? "cursor-wait" : "cursor-pointer"}`}
                >
                  {mode}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Escalation triggers — only meaningful when floor < ceiling.
//
// Three knobs: low-confidence detection, mid-turn timeout, and parallel race.
// Visual language matches the dial above: same Card wrapper, same typography,
// row gridded for label/control alignment.
// ---------------------------------------------------------------------------

function EscalationTriggers({
  enabled,
  state,
  pending,
  onChange,
}: {
  enabled: boolean;
  state: {
    escalateOnLowConfidence: boolean;
    escalateOnTimeoutSec: number | null;
    parallelRace: boolean;
  };
  pending: boolean;
  onChange: (patch: Partial<{
    escalateOnLowConfidence: boolean;
    escalateOnTimeoutSec: number | null;
    parallelRace: boolean;
  }>) => void;
}) {
  if (!enabled) return null;
  const timeoutOn = state.escalateOnTimeoutSec !== null && state.escalateOnTimeoutSec > 0;
  return (
    <Card className="p-6">
      <h3 className="text-base font-semibold">Escalation triggers</h3>
      <p className="text-muted-foreground text-[13px] mt-1 mb-4">
        When the floor tier comes back uncertain, Aion can move up to the ceiling. Pick
        the gates that should fire that move.
      </p>
      <div className="space-y-3">
        <label className="flex items-start gap-3 cursor-pointer p-3 rounded-md hover:bg-secondary/50 transition-colors">
          <input
            type="checkbox"
            checked={state.escalateOnLowConfidence}
            onChange={(e) => onChange({ escalateOnLowConfidence: e.target.checked })}
            disabled={pending}
            className="mt-0.5 rounded border-input"
          />
          <div className="flex-1">
            <div className="text-[13px] font-medium text-foreground">On low confidence</div>
            <div className="text-[11.5px] text-muted-foreground mt-0.5">
              Short answer to a complex question, hedging phrases, or self-flagged uncertainty
              kicks the next call up one tier.
            </div>
          </div>
        </label>

        <label className="flex items-start gap-3 cursor-pointer p-3 rounded-md hover:bg-secondary/50 transition-colors">
          <input
            type="checkbox"
            checked={timeoutOn}
            onChange={(e) => onChange({ escalateOnTimeoutSec: e.target.checked ? 30 : null })}
            disabled={pending}
            className="mt-0.5 rounded border-input"
          />
          <div className="flex-1">
            <div className="text-[13px] font-medium text-foreground flex items-center gap-2">
              On timeout
              {timeoutOn && (
                <span className="flex items-center gap-1.5">
                  <input
                    type="number"
                    value={state.escalateOnTimeoutSec ?? 30}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      onChange({ escalateOnTimeoutSec: Number.isFinite(n) && n > 0 ? Math.floor(n) : null });
                    }}
                    disabled={pending}
                    className="w-16 px-2 py-0.5 text-[12px] font-mono bg-secondary border border-input rounded"
                    min={1}
                    step={1}
                  />
                  <span className="text-[11px] text-muted-foreground">seconds</span>
                </span>
              )}
            </div>
            <div className="text-[11.5px] text-muted-foreground mt-0.5">
              If the floor tier hasn't streamed a complete answer in N seconds, Aion fires
              the next call to a higher tier.
            </div>
          </div>
        </label>

        <label className="flex items-start gap-3 cursor-pointer p-3 rounded-md hover:bg-secondary/50 transition-colors">
          <input
            type="checkbox"
            checked={state.parallelRace}
            onChange={(e) => onChange({ parallelRace: e.target.checked })}
            disabled={pending}
            className="mt-0.5 rounded border-input"
          />
          <div className="flex-1">
            <div className="text-[13px] font-medium text-foreground">
              Race floor + ceiling in parallel{" "}
              <span className="text-[10px] text-amber-400 font-mono uppercase tracking-wider ml-1">
                2× cost
              </span>
            </div>
            <div className="text-[11.5px] text-muted-foreground mt-0.5">
              Fire the call to both tiers simultaneously and take the first complete answer.
              Cuts perceived latency at the price of doubled inference spend.
            </div>
          </div>
        </label>
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

interface CostRollup {
  turns: number;
  dollarCost: number;
  totalTokens: number;
  watts: number;
  byProvider: Array<{ providerId: string; turns: number; dollarCost: number }>;
}

function CostTicker() {
  const [today, setToday] = useState<CostRollup | null>(null);
  const [week, setWeek] = useState<CostRollup | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = async (): Promise<void> => {
      try {
        const [t, w] = await Promise.all([
          fetch("/api/providers/cost/today").then((r) => r.ok ? r.json() as Promise<CostRollup> : null).catch(() => null),
          fetch("/api/providers/cost/week").then((r) => r.ok ? r.json() as Promise<CostRollup> : null).catch(() => null),
        ]);
        if (!cancelled) {
          setToday(t);
          setWeek(w);
        }
      } catch { /* ignore */ }
    };
    void refresh();
    const id = window.setInterval(() => { void refresh(); }, 30_000);
    return (): void => { cancelled = true; window.clearInterval(id); };
  }, []);

  const fmtUsd = (v: number | undefined): string => v === undefined ? "—" : `$${v.toFixed(2)}`;
  const fmtTokens = (v: number | undefined): string => v === undefined ? "—" : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v);

  const tiles: Array<{ label: string; value: string; unit: string; sub: string }> = [
    { label: "Today", value: fmtUsd(today?.dollarCost), unit: "USD", sub: today ? `${String(today.turns)} turns` : "cost ledger online" },
    { label: "This week", value: fmtUsd(week?.dollarCost), unit: "USD", sub: week ? `${String(week.turns)} turns` : "cost ledger online" },
    { label: "Tokens used", value: fmtTokens(today?.totalTokens), unit: "today", sub: today && today.watts > 0 ? `${today.watts.toFixed(1)} Wh` : "—" },
    { label: "$IMP minted", value: "—", unit: "$IMP", sub: "via 0SCALE · v0.6.0+" },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4" data-testid="cost-ticker">
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
  const [recentDecisions, setRecentDecisions] = useState<RoutingDecisionRecord[]>([]);

  const reload = useCallback(async () => {
    try {
      // Recent-decisions fetched in parallel with catalog + active state.
      // It's never a blocker for the page (empty array is a valid state —
      // hero hides) so the result is consumed even if its fetch fails.
      const [catalogRes, activeRes, decisionsRes] = await Promise.all([
        fetchProvidersCatalog(),
        fetchActiveProvider(),
        fetchRecentDecisions(20).catch(() => []),
      ]);
      setCatalog(catalogRes.providers);
      setActive(activeRes);
      setRecentDecisions(decisionsRes);
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

  const onChangeRange = useCallback(
    async (next: { floor: CostMode; ceiling: CostMode }) => {
      if (!active || costModePending) return;
      if (active.router.floor === next.floor && active.router.ceiling === next.ceiling) return;
      setCostModePending(true);
      try {
        // Patch floor + ceiling alongside legacy costMode (= floor) so old
        // Provider plugins reading agent.router.costMode still see a value
        // that maps to the new range. Server-side schema validation enforces
        // floor <= ceiling on the local|economy|balanced|max scale.
        const updated = await updateRouterConfig({
          floor: next.floor,
          ceiling: next.ceiling,
          costMode: next.floor,
        });
        setActive(updated);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setCostModePending(false);
      }
    },
    [active, costModePending],
  );

  const onChangeTriggers = useCallback(
    async (patch: Partial<{
      escalateOnLowConfidence: boolean;
      escalateOnTimeoutSec: number | null;
      parallelRace: boolean;
    }>) => {
      if (!active || costModePending) return;
      setCostModePending(true);
      try {
        const updated = await updateRouterConfig(patch);
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

      {/* Owner directive cycle 129: split the page into two tabs.
          - "Providers" keeps today's catalog + router + cards
          - "Models" is the new consolidated entry point for installed
            local models. HF Marketplace remains the discovery/download
            flow; lifecycle (start/stop/uninstall) lives here. */}
      <Tabs defaultValue="providers">
        <TabsList variant="line">
          <TabsTrigger value="providers" data-testid="providers-tab-providers">Providers</TabsTrigger>
          <TabsTrigger value="models" data-testid="providers-tab-models">Models</TabsTrigger>
        </TabsList>

        <TabsContent value="providers" className="mt-4 space-y-6">

      {/* Mission Control hero — most recent routing decision (s111 t419).
          Hides when no decisions exist yet (fresh boot, no turns). */}
      {recentDecisions.length > 0 && (
        <MissionControlHero
          decision={recentDecisions[recentDecisions.length - 1]!}
          catalog={catalog}
        />
      )}

      {/* Cost-mode range dial + escalation triggers + placeholder ticker
          (s111 t420 + s129 t510). Floor/ceiling come from server-projected
          state (derived from legacy costMode/escalation when unset). */}
      {active && (
        <div className="space-y-4">
          <CostModeRangeDial
            floor={isCostMode(active.router.floor) ? active.router.floor : "balanced"}
            ceiling={isCostMode(active.router.ceiling) ? active.router.ceiling : "max"}
            pending={costModePending}
            onChange={(next) => void onChangeRange(next)}
          />
          <EscalationTriggers
            enabled={active.router.floor !== active.router.ceiling}
            state={{
              escalateOnLowConfidence: active.router.escalateOnLowConfidence,
              escalateOnTimeoutSec: active.router.escalateOnTimeoutSec,
              parallelRace: active.router.parallelRace,
            }}
            pending={costModePending}
            onChange={(patch) => void onChangeTriggers(patch)}
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
        </TabsContent>

        <TabsContent value="models" className="mt-4">
          <ModelsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
