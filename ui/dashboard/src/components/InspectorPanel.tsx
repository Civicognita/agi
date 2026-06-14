/**
 * InspectorPanel — right contextual pane for the 3-panel comms workspace.
 *
 * Renders a 360px sliding panel with type-specific content for threads,
 * moderation flags, and agent events. Matches the aio-inspector design
 * from the Aionima Channel design pack.
 */

import { Avatar } from "@particle-academy/react-fancy";
import { cn } from "@/lib/utils";
import type { InspectorPayload } from "@/lib/inspector-context.js";
import type { ThreadEntry } from "@/components/InboxView.js";
import type { ModerationFlag, AgentEventEntry, FlagActionKind, FlagSeverity } from "@/types.js";

// ---------------------------------------------------------------------------
// Channel accent helpers
// ---------------------------------------------------------------------------

const CHANNEL_COLOR: Record<string, string> = {
  discord:  "bg-indigo-500/10 text-indigo-400 border-indigo-500/25",
  gmail:    "bg-red-500/10 text-red-400 border-red-500/30",
  email:    "bg-red-500/10 text-red-400 border-red-500/30",
  telegram: "bg-sky-500/10 text-sky-400 border-sky-500/25",
  signal:   "bg-emerald-500/10 text-emerald-400 border-emerald-500/25",
  whatsapp: "bg-green-500/10 text-green-400 border-green-500/25",
};

const SEV_STYLE: Record<FlagSeverity, { badge: string; dot: string; label: string }> = {
  critical: { badge: "bg-red-500/10 text-red-500 border-red-500/25",       dot: "bg-red-500",    label: "Critical" },
  high:     { badge: "bg-orange-400/10 text-orange-400 border-orange-400/25", dot: "bg-orange-400", label: "High" },
  medium:   { badge: "bg-amber-400/10 text-amber-400 border-amber-400/25",  dot: "bg-amber-400",  label: "Medium" },
  low:      { badge: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",     dot: "bg-zinc-400",   label: "Low" },
};

const FLAG_ACTIONS: { kind: FlagActionKind; label: string; cls: string }[] = [
  { kind: "dismiss",           label: "Dismiss",      cls: "hover:bg-zinc-500/10 text-zinc-400 hover:text-zinc-300" },
  { kind: "mark_constructive", label: "Constructive", cls: "hover:bg-emerald-500/10 text-emerald-500 hover:text-emerald-400" },
  { kind: "warn",              label: "Warn",         cls: "hover:bg-amber-500/10 text-amber-500 hover:text-amber-400" },
  { kind: "timeout",           label: "Timeout",      cls: "hover:bg-orange-500/10 text-orange-500 hover:text-orange-400" },
  { kind: "ban",               label: "Ban",          cls: "hover:bg-red-500/10 text-red-500 hover:text-red-400" },
  { kind: "escalate",          label: "Escalate",     cls: "hover:bg-violet-500/10 text-violet-500 hover:text-violet-400" },
];

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ---------------------------------------------------------------------------
// Thread inspector
// ---------------------------------------------------------------------------

function ThreadInspector({ thread }: { thread: ThreadEntry }) {
  const displayName = thread.senderName ?? thread.senderId;
  const initials = displayName.slice(0, 2).toUpperCase();
  const channelStyle = CHANNEL_COLOR[thread.channel] ?? "bg-zinc-500/10 text-zinc-400 border-zinc-500/20";

  return (
    <div className="space-y-4">
      {/* Sender header */}
      <div className="flex items-center gap-3">
        <Avatar fallback={initials} size="md" />
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-foreground truncate">{displayName}</div>
          <div className="text-[11px] text-muted-foreground font-mono truncate">{thread.senderId}</div>
        </div>
      </div>

      {/* Meta chips */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium border", channelStyle)}>
          {thread.channel}
        </span>
        <span className={cn(
          "inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium border",
          thread.direction === "inbound"
            ? "bg-sky-500/10 text-sky-400 border-sky-500/25"
            : "bg-violet-500/10 text-violet-400 border-violet-500/25",
        )}>
          {thread.direction}
        </span>
        <span className="text-[10px] text-muted-foreground font-mono">{relTime(thread.latestAt)}</span>
        {thread.count > 1 && (
          <span className="text-[10px] text-muted-foreground">{thread.count} messages</span>
        )}
      </div>

      {/* Subject */}
      {thread.subject && (
        <div className="space-y-1">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Subject</div>
          <div className="text-[12px] text-foreground">{thread.subject}</div>
        </div>
      )}

      {/* Message preview */}
      <div className="space-y-1">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Preview</div>
        <div className="text-[12px] text-foreground leading-relaxed bg-secondary/30 rounded-lg px-3 py-2 border border-border/50">
          {thread.preview || <span className="text-muted-foreground italic">No preview</span>}
        </div>
      </div>

      {/* Outbound indicator */}
      {thread.hasOutbound && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-violet-500/5 border border-violet-500/15">
          <span className="w-1.5 h-1.5 rounded-full bg-violet-400 shrink-0" />
          <span className="text-[11px] text-violet-400">Aion has replied to this thread</span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Score bar — AI scoring visualization
// ---------------------------------------------------------------------------

function ScoreBar({ label, value }: { label: string; value: number }) {
  const pct = Math.round(value * 100);
  return (
    <div className="flex items-center gap-2">
      <span className="text-[9px] text-muted-foreground uppercase tracking-wide w-14 shrink-0">{label}</span>
      <div className="flex-1 h-1 bg-border rounded-full overflow-hidden">
        <div
          className={cn("h-full rounded-full", pct >= 80 ? "bg-red-400" : pct >= 50 ? "bg-amber-400" : "bg-sky-400")}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[10px] font-mono text-muted-foreground w-8 text-right shrink-0">{pct}%</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Moderation flag inspector
// ---------------------------------------------------------------------------

function ModerationFlagInspector({
  flag,
  onAction,
}: {
  flag: ModerationFlag;
  onAction?: (id: string, kind: FlagActionKind) => void;
}) {
  const sev = SEV_STYLE[flag.severity];
  const displayName = flag.displayName ?? flag.userId;
  const initials = displayName.slice(0, 2).toUpperCase();

  return (
    <div className="space-y-4">
      {/* User header */}
      <div className="flex items-center gap-3">
        <Avatar fallback={initials} size="md" />
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-foreground truncate">{displayName}</div>
          <div className="text-[11px] text-muted-foreground font-mono truncate">{flag.userId}</div>
        </div>
        <span className={cn("inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-semibold border", sev.badge)}>
          <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", sev.dot)} />
          {sev.label}
        </span>
      </div>

      {/* Flagged message */}
      <div className="space-y-1">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Flagged Message</div>
        <div className="text-[12px] text-foreground leading-relaxed bg-red-500/5 border border-red-500/15 rounded-lg px-3 py-2">
          {flag.messagePreview || <span className="text-muted-foreground italic">No preview</span>}
        </div>
      </div>

      {/* AI Reason */}
      {flag.reason && (
        <div className="space-y-1">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">AI Reasoning</div>
          <div className="flex items-start gap-2 text-[11.5px] text-muted-foreground leading-relaxed">
            <span className="text-muted-foreground/50 shrink-0 mt-0.5">✦</span>
            <span>{flag.reason}</span>
          </div>
        </div>
      )}

      {/* AI Scores */}
      {flag.scores && Object.keys(flag.scores).length > 0 && (
        <div className="space-y-2">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">AI Scores</div>
          <div className="space-y-1.5">
            {Object.entries(flag.scores).map(([k, v]) =>
              v !== undefined ? <ScoreBar key={k} label={k} value={v} /> : null,
            )}
          </div>
        </div>
      )}

      {/* Recommended action */}
      {flag.recommendedAction && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-violet-500/5 border border-violet-500/15">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide shrink-0">Recommended</span>
          <span className="text-[11px] text-violet-400 font-medium">{flag.recommendedAction}</span>
        </div>
      )}

      {/* Prior flags */}
      {flag.priorFlagCount !== undefined && flag.priorFlagCount > 0 && (
        <div className="text-[11px] text-muted-foreground">
          {flag.priorFlagCount} prior flag{flag.priorFlagCount !== 1 ? "s" : ""} from this user
        </div>
      )}

      {/* Quick actions */}
      {onAction && flag.status === "open" && (
        <div className="space-y-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Actions</div>
          <div className="grid grid-cols-2 gap-1">
            {FLAG_ACTIONS.map((a) => (
              <button
                key={a.kind}
                onClick={() => onAction(flag.id, a.kind)}
                className={cn(
                  "text-[11px] font-medium px-2.5 py-1.5 rounded-lg transition-colors border border-border/50 text-left",
                  a.cls,
                )}
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Status / actioned */}
      {flag.status !== "open" && (
        <div className="text-[11px] text-muted-foreground capitalize">
          Status: <span className="text-foreground font-medium">{flag.status}</span>
          {flag.action && (
            <> · Action: <span className="text-foreground font-medium">{flag.action.kind}</span></>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agent event inspector
// ---------------------------------------------------------------------------

function AgentEventInspector({ event }: { event: AgentEventEntry }) {
  const channelStyle = event.channel ? (CHANNEL_COLOR[event.channel] ?? "bg-zinc-500/10 text-zinc-400 border-zinc-500/20") : "";

  return (
    <div className="space-y-4">
      {/* Agent header */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-violet-500/10 border border-violet-500/20 flex items-center justify-center text-[11px] font-bold text-violet-400">
          {(event.agentLabel ?? "A").slice(0, 2)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-foreground">{event.agentLabel ?? "Aion"}</div>
          <div className="text-[11px] text-muted-foreground">{relTime(event.ts)}</div>
        </div>
        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border bg-sky-500/10 text-sky-400 border-sky-500/25">
          {event.kind}
        </span>
      </div>

      {/* Channel */}
      {event.channel && (
        <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border", channelStyle)}>
          {event.channel}
        </span>
      )}

      {/* Target */}
      {event.target && (
        <div className="space-y-1">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Target</div>
          <div className="text-[12px] text-foreground font-mono">{event.target}</div>
        </div>
      )}

      {/* Summary */}
      {event.summary && (
        <div className="space-y-1">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Summary</div>
          <div className="text-[12px] text-foreground leading-relaxed bg-secondary/30 rounded-lg px-3 py-2 border border-border/50">
            {event.summary}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// InspectorPanel — exported root
// ---------------------------------------------------------------------------

interface InspectorPanelProps {
  payload: InspectorPayload;
  onDismiss: () => void;
  onFlagAction?: (id: string, kind: FlagActionKind) => void;
}

export function InspectorPanel({ payload, onDismiss, onFlagAction }: InspectorPanelProps) {
  const title =
    payload.kind === "thread" ? "Message Detail" :
    payload.kind === "moderation-flag" ? "Flag Detail" :
    "Event Detail";

  return (
    <aside data-testid="inspector-panel" className="w-[360px] shrink-0 border-l border-border bg-card flex flex-col min-h-0">
      {/* Panel header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <span className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </span>
        <button
          onClick={onDismiss}
          aria-label="Close inspector"
          className="p-1 rounded hover:bg-secondary/50 text-muted-foreground hover:text-foreground transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto p-4">
        {payload.kind === "thread" && <ThreadInspector thread={payload.thread} />}
        {payload.kind === "moderation-flag" && (
          <ModerationFlagInspector flag={payload.flag} onAction={onFlagAction} />
        )}
        {payload.kind === "agent-event" && <AgentEventInspector event={payload.event} />}
      </div>
    </aside>
  );
}
