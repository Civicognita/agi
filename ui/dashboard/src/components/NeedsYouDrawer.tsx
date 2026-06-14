/**
 * NeedsYouDrawer — HearthHome right panel.
 *
 * Two sections:
 *  • "Needs you · N" — items requiring human decision (open security
 *    findings, pending identity approvals)
 *  • "Today" — recent project activity cards
 *
 * s197 — Hearth Home right drawer.
 */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Shield, Fingerprint, Activity, Layers } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { fetchSecurityFindings, fetchPendingApprovals } from "@/api.js";
import type { ProjectActivity } from "@/types.js";

interface NeedsItem {
  id: string;
  icon: LucideIcon;
  title: string;
  body: string;
  href: string;
  color: string;
}

interface TodayItem {
  projectPath: string;
  summary: string;
  timestamp: string;
  icon: LucideIcon;
  color: string;
}

interface NeedsYouDrawerProps {
  projectActivity: Record<string, ProjectActivity | null>;
}

function NeedsCard({ item }: { item: NeedsItem }) {
  const navigate = useNavigate();
  const Icon = item.icon;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => void navigate(item.href)}
      onKeyDown={(e) => e.key === "Enter" && void navigate(item.href)}
      className="rounded-xl border p-3 bg-card cursor-pointer hover:bg-secondary transition-colors"
      style={{ borderColor: "var(--agent-line)" }}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <Icon size={14} style={{ color: item.color }} className="shrink-0" />
        <span className="text-[12px] font-semibold">{item.title}</span>
      </div>
      <p className="text-[11px] text-muted-foreground leading-relaxed">{item.body}</p>
    </div>
  );
}

function TodayCard({ item }: { item: TodayItem }) {
  const Icon = item.icon;
  return (
    <div className="rounded-xl border border-border bg-card p-2.5 flex items-center gap-2.5">
      <span
        className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
        style={{ background: item.color + "1f", color: item.color }}
      >
        <Icon size={13} />
      </span>
      <div className="min-w-0">
        <div className="text-[12px] font-semibold truncate">{item.projectPath.split("/").pop()}</div>
        <div className="text-[10.5px] text-muted-foreground truncate">{item.summary}</div>
      </div>
    </div>
  );
}

const ACTIVITY_COLORS: Record<string, string> = {
  invocation_start: "#8b5cf6",
  invocation_complete: "#22c55e",
  tool_used: "#38bdf8",
  plan_updated: "#f59e0b",
  tynn_synced: "#6366f1",
};

export function NeedsYouDrawer({ projectActivity }: NeedsYouDrawerProps) {
  const [needsItems, setNeedsItems] = useState<NeedsItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    Promise.all([
      fetchSecurityFindings({ severity: "critical", status: "open" }).catch(() => []),
      fetchPendingApprovals().catch(() => []),
    ]).then(([findings, approvals]) => {
      if (cancelled) return;
      const items: NeedsItem[] = [];

      if (findings.length > 0) {
        items.push({
          id: "security",
          icon: Shield,
          title: `Security — ${findings.length} critical finding${findings.length !== 1 ? "s" : ""}`,
          body: "Open security findings need review before the next deploy.",
          href: "/system/security",
          color: "#f59e0b",
        });
      }

      if (approvals.length > 0) {
        items.push({
          id: "identity",
          icon: Fingerprint,
          title: `${approvals.length} pending identity approval${approvals.length !== 1 ? "s" : ""}`,
          body: "New users are waiting for access confirmation.",
          href: "/identity/pending",
          color: "#38bdf8",
        });
      }

      setNeedsItems(items);
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, []);

  const todayItems: TodayItem[] = Object.entries(projectActivity)
    .filter(([, a]) => a !== null)
    .map(([path, a]) => ({
      projectPath: path,
      summary: a!.summary,
      timestamp: a!.timestamp,
      icon: a!.type === "invocation_complete" ? Activity : Layers,
      color: ACTIVITY_COLORS[a!.type] ?? "#8b5cf6",
    }))
    .slice(0, 6);

  return (
    <div className="w-72 shrink-0 flex flex-col gap-3 overflow-y-auto border-l border-border px-4 py-4">
      {/* Needs you */}
      <div className={cn(
        "text-[10px] font-semibold uppercase tracking-wider",
        needsItems.length > 0 ? "text-yellow-500" : "text-muted-foreground",
      )}>
        Needs you{!loading && needsItems.length > 0 ? ` · ${needsItems.length}` : ""}
      </div>

      {loading && (
        <div className="text-[11px] text-muted-foreground">Checking…</div>
      )}
      {!loading && needsItems.length === 0 && (
        <div className="text-[11px] text-muted-foreground leading-relaxed rounded-xl border border-border bg-card p-3">
          All clear — nothing needs your attention right now.
        </div>
      )}
      {needsItems.map((item) => <NeedsCard key={item.id} item={item} />)}

      {/* Today */}
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mt-1">
        Today
      </div>
      {todayItems.length === 0 ? (
        <div className="text-[11px] text-muted-foreground">No activity yet today.</div>
      ) : (
        todayItems.map((item) => <TodayCard key={item.projectPath} item={item} />)
      )}
    </div>
  );
}
