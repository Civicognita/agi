/**
 * Moderation Center — /comms/moderation
 *
 * Displays AI-raised moderation flags from the in-memory ring buffer.
 * Moderators can dismiss, warn, timeout, ban, escalate, redact, monitor,
 * or mark a flag as constructive with one click.
 */

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { PageScroll } from "@/components/PageScroll.js";
import { useInspector } from "@/lib/inspector-context.js";
import { fetchModerationFlags, applyModerationAction } from "@/api.js";
import type { ModerationFlag, FlagSeverity, FlagActionKind } from "@/types.js";

// ---------------------------------------------------------------------------
// Severity styles
// ---------------------------------------------------------------------------

const SEV_STYLE: Record<FlagSeverity, { dot: string; badge: string; label: string }> = {
  critical: { dot: "bg-red-500",    badge: "bg-red-500/10 text-red-600 border-red-500/25 dark:text-red-300",    label: "Critical" },
  high:     { dot: "bg-orange-400", badge: "bg-orange-400/10 text-orange-500 border-orange-400/25 dark:text-orange-300", label: "High" },
  medium:   { dot: "bg-amber-400",  badge: "bg-amber-400/10 text-amber-600 border-amber-400/25 dark:text-amber-200",   label: "Medium" },
  low:      { dot: "bg-zinc-400",   badge: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20 dark:text-zinc-400",      label: "Low" },
};

const STATUS_BADGE: Record<string, string> = {
  open:      "bg-amber-500/10 text-amber-600 border-amber-500/25 dark:text-amber-300",
  actioned:  "bg-sky-500/10 text-sky-600 border-sky-500/25 dark:text-sky-300",
  dismissed: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20 dark:text-zinc-400",
};

// ---------------------------------------------------------------------------
// Quick-action definitions
// ---------------------------------------------------------------------------

const QUICK_ACTIONS: { kind: FlagActionKind; label: string; cls: string }[] = [
  { kind: "dismiss",          label: "Dismiss",      cls: "text-zinc-500 hover:text-zinc-300" },
  { kind: "mark_constructive", label: "Constructive", cls: "text-emerald-500 hover:text-emerald-400" },
  { kind: "warn",             label: "Warn",         cls: "text-amber-500 hover:text-amber-400" },
  { kind: "timeout",          label: "Timeout",      cls: "text-orange-500 hover:text-orange-400" },
  { kind: "ban",              label: "Ban",          cls: "text-red-500 hover:text-red-400" },
  { kind: "escalate",         label: "Escalate",     cls: "text-violet-500 hover:text-violet-400" },
  { kind: "redact",           label: "Redact",       cls: "text-rose-500 hover:text-rose-400" },
  { kind: "monitor",          label: "Monitor",      cls: "text-sky-500 hover:text-sky-400" },
];

// ---------------------------------------------------------------------------
// ScoreBar — renders a 0-1 fill strip
// ---------------------------------------------------------------------------

function ScoreBar({ label, value }: { label: string; value: number }) {
  const pct = Math.round(value * 100);
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <span className="text-[9px] text-muted-foreground uppercase tracking-wide shrink-0 w-14">{label}</span>
      <div className="flex-1 h-1 bg-border rounded-full overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full",
            pct >= 80 ? "bg-red-400" : pct >= 50 ? "bg-amber-400" : "bg-sky-400",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[9px] tabular-nums text-muted-foreground w-6 text-right shrink-0">{pct}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FlagRow
// ---------------------------------------------------------------------------

function FlagRow({
  flag,
  onAction,
  onSelect,
}: {
  flag: ModerationFlag;
  onAction: (id: string, kind: FlagActionKind) => void;
  onSelect?: (flag: ModerationFlag) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const sev = SEV_STYLE[flag.severity];
  const time = new Date(flag.flaggedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const isResolved = flag.status !== "open";

  return (
    <div
      data-testid="flag-row"
      className={cn(
        "group px-4 py-2.5 border-b border-border/50 hover:bg-muted/30 transition-colors cursor-pointer",
        isResolved && "opacity-50",
      )}
      onClick={() => { setExpanded((v) => !v); onSelect?.(flag); }}
    >
      {/* Main row */}
      <div className="grid grid-cols-[20px_1fr_auto] gap-3 items-start min-w-0">
        {/* Severity dot */}
        <div className="mt-1 flex-shrink-0">
          <span className={cn("inline-block w-2 h-2 rounded-full", sev.dot)} />
        </div>

        {/* Content */}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
            <span className={cn("text-[10px] px-1.5 py-px rounded border font-medium", sev.badge)}>
              {sev.label}
            </span>
            <span className={cn("text-[10px] px-1.5 py-px rounded border font-medium", STATUS_BADGE[flag.status] ?? "")}>
              {flag.status}
            </span>
            <span className="text-xs font-medium text-foreground truncate">
              {flag.displayName ?? flag.userId}
            </span>
            <span className="text-[10px] text-muted-foreground">via {flag.channel}</span>
            {flag.priorFlagCount > 0 && (
              <span className="text-[10px] text-amber-500/80">{flag.priorFlagCount}× flagged</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground truncate">{flag.messagePreview}</p>
          <p className="text-[10px] text-muted-foreground/70 mt-0.5">{flag.reason}</p>
        </div>

        {/* Timestamp */}
        <div className="text-[10px] text-muted-foreground tabular-nums shrink-0 mt-0.5">{time}</div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="mt-2 pl-8 space-y-2" onClick={(e) => e.stopPropagation()}>
          {/* Scores */}
          {flag.scores && (
            <div className="space-y-1 max-w-xs">
              {flag.scores.toxicity !== undefined && (
                <ScoreBar label="Toxicity" value={flag.scores.toxicity} />
              )}
              {flag.scores.escalation !== undefined && (
                <ScoreBar label="Escalation" value={flag.scores.escalation} />
              )}
              {flag.scores.sarcasm !== undefined && (
                <ScoreBar label="Sarcasm" value={flag.scores.sarcasm} />
              )}
            </div>
          )}

          {/* Recommended action */}
          {flag.recommendedAction && (
            <p className="text-[10px] text-muted-foreground">
              Recommended: <span className="text-foreground/80">{flag.recommendedAction}</span>
            </p>
          )}

          {/* Prior action */}
          {flag.action && (
            <p className="text-[10px] text-muted-foreground">
              Actioned: <span className="text-foreground/80">{flag.action.kind}</span>
              {flag.action.note && <span className="ml-1 text-muted-foreground/60">— {flag.action.note}</span>}
            </p>
          )}

          {/* Quick actions (only when open) */}
          {!isResolved && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {QUICK_ACTIONS.map((a) => (
                <button
                  key={a.kind}
                  className={cn("text-[10px] font-medium px-2 py-0.5 rounded border border-border/50 hover:border-border transition-colors", a.cls)}
                  onClick={(e) => { e.stopPropagation(); onAction(flag.id, a.kind); }}
                >
                  {a.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// KPI strip
// ---------------------------------------------------------------------------

function KpiStrip({ flags }: { flags: ModerationFlag[] }) {
  const open     = flags.filter((f) => f.status === "open").length;
  const critical = flags.filter((f) => f.severity === "critical").length;
  const high     = flags.filter((f) => f.severity === "high").length;

  const kpis = [
    { label: "Open",     value: open,     cls: open > 0     ? "text-amber-500" : "text-foreground" },
    { label: "Critical", value: critical, cls: critical > 0 ? "text-red-500"   : "text-foreground" },
    { label: "High",     value: high,     cls: high > 0     ? "text-orange-500": "text-foreground" },
    { label: "Total",    value: flags.length, cls: "text-foreground" },
  ];

  return (
    <div className="flex gap-6 px-4 py-3 border-b border-border text-sm">
      {kpis.map((k) => (
        <div key={k.label} className="flex flex-col items-center">
          <span className={cn("text-lg font-bold tabular-nums leading-none", k.cls)}>{k.value}</span>
          <span className="text-[10px] text-muted-foreground mt-0.5">{k.label}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Severity filter tabs
// ---------------------------------------------------------------------------

const SEV_FILTERS: { key: FlagSeverity | "all"; label: string }[] = [
  { key: "all",      label: "All" },
  { key: "critical", label: "Critical" },
  { key: "high",     label: "High" },
  { key: "medium",   label: "Medium" },
  { key: "low",      label: "Low" },
];

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

function ModerationView() {
  const [flags, setFlags] = useState<ModerationFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [sevFilter, setSevFilter] = useState<FlagSeverity | "all">("all");
  const { inspect } = useInspector();

  const load = useCallback(() => {
    setLoading(true);
    fetchModerationFlags({ limit: 200 })
      .then((res) => setFlags(res.flags))
      .catch(() => setFlags([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleAction = useCallback((id: string, kind: FlagActionKind) => {
    void applyModerationAction(id, { kind }).then((updated) => {
      setFlags((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
    });
  }, []);

  const handleSelect = useCallback((flag: ModerationFlag) => {
    inspect({ kind: "moderation-flag", flag });
  }, [inspect]);

  const visible = sevFilter === "all"
    ? flags
    : flags.filter((f) => f.severity === sevFilter);

  return (
    <div className="flex flex-col h-full min-h-0">
      <KpiStrip flags={flags} />

      {/* Severity filter strip */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-border overflow-x-auto">
        {SEV_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setSevFilter(f.key)}
            className={cn(
              "text-xs px-3 py-1 rounded-full border transition-colors whitespace-nowrap",
              sevFilter === f.key
                ? "bg-foreground text-background border-foreground"
                : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/40",
            )}
          >
            {f.label}
          </button>
        ))}
        <div className="ml-auto">
          <button
            onClick={load}
            className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Flag list */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
            Loading…
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-sm text-muted-foreground gap-1">
            <span className="text-2xl">🛡</span>
            <span>No moderation flags</span>
            <span className="text-xs opacity-60">Flags from the AI moderation pipeline appear here</span>
          </div>
        ) : (
          visible.map((flag) => (
            <FlagRow key={flag.id} flag={flag} onAction={handleAction} onSelect={handleSelect} />
          ))
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page export
// ---------------------------------------------------------------------------

export default function CommsModerationPage() {
  return (
    <PageScroll className="flex flex-col h-full min-h-0">
      <div className="px-4 py-4 border-b border-border flex items-center gap-2 shrink-0">
        <div className="w-2 h-2 rounded-full bg-amber-400/80" />
        <h1 className="text-sm font-semibold">Moderation</h1>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        <ModerationView />
      </div>
    </PageScroll>
  );
}
