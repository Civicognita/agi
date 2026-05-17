/**
 * /identity/pending — pending-from-channel approval queue.
 *
 * CHN-E (s166) slice 4 — owner-facing surface for the pending approval
 * records captured by InboundRouter when unknown users post in
 * project-bound channel rooms. Approve promotes the entity (slice 5
 * adds the verificationTier update); reject drops + flags the source.
 *
 * Consumes /api/identity/pending (GET/POST shipped in slice 3).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageScroll } from "@/components/PageScroll";
import {
  fetchPendingApprovals,
  approvePendingApproval,
  rejectPendingApproval,
  type PendingApproval,
} from "../api";

function channelEmoji(channelId: string): string {
  switch (channelId) {
    case "discord": return "💬";
    case "telegram": return "✈️";
    case "slack": return "💼";
    case "email":
    case "gmail": return "📧";
    case "whatsapp": return "🟢";
    case "signal": return "🔐";
    default: return "📡";
  }
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const ago = Date.now() - then;
  if (ago < 60_000) return "just now";
  if (ago < 3_600_000) return `${Math.floor(ago / 60_000)}m ago`;
  if (ago < 86_400_000) return `${Math.floor(ago / 3_600_000)}h ago`;
  return `${Math.floor(ago / 86_400_000)}d ago`;
}

export default function IdentityPendingPage(): JSX.Element {
  const [pending, setPending] = useState<PendingApproval[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setPending(await fetchPendingApprovals());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // Light polling so newly captured pending records show up without manual refresh.
    const interval = setInterval(() => { void load(); }, 30_000);
    return () => clearInterval(interval);
  }, [load]);

  const handleApprove = useCallback(async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      await approvePendingApproval(id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }, [load]);

  const handleReject = useCallback(async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      await rejectPendingApproval(id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }, [load]);

  // Group by project for clearer review surface
  const byProject = useMemo(() => {
    const out: Record<string, PendingApproval[]> = {};
    for (const p of pending) {
      const key = p.projectPath;
      if (!out[key]) out[key] = [];
      out[key]!.push(p);
    }
    return out;
  }, [pending]);

  return (
    <PageScroll>
      <div className="max-w-4xl mx-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Pending Identity Approvals</h1>
            <p className="text-[12px] text-muted-foreground mt-1">
              Unknown users who messaged a channel room bound to one of your projects.
              Approve to grant verified access; reject to drop + flag the source.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading} data-testid="identity-pending-refresh">
            {loading ? "Loading…" : "Refresh"}
          </Button>
        </div>

        {error !== null && (
          <Card className="p-4 mb-4 border-red/40 bg-red/5" data-testid="identity-pending-error">
            <span className="text-[13px] text-red">{error}</span>
          </Card>
        )}

        {!loading && pending.length === 0 && error === null && (
          <Card className="p-8 text-center" data-testid="identity-pending-empty">
            <span className="text-[14px] text-muted-foreground">
              No pending approvals. When unknown users message a bound channel room, they'll appear here.
            </span>
          </Card>
        )}

        {Object.entries(byProject).map(([projectPath, entries]) => (
          <Card key={projectPath} className="p-4 mb-4" data-testid={`identity-pending-project-${projectPath.replace(/[^a-zA-Z0-9]/g, "_")}`}>
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border">
              <span className="text-[13px] font-semibold text-card-foreground truncate">
                {projectPath}
              </span>
              <span className="text-[10px] text-muted-foreground">
                · {entries.length} pending
              </span>
            </div>
            <div className="space-y-2">
              {entries.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-start gap-3 p-3 rounded border border-border/60 hover:border-border transition-colors"
                  data-testid={`identity-pending-entry-${entry.id.replace(/[^a-zA-Z0-9]/g, "_")}`}
                >
                  <span className="text-[18px] shrink-0 mt-0.5" aria-hidden>
                    {channelEmoji(entry.channelId)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium text-foreground truncate">
                        {entry.displayName}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        · {entry.channelId} · {relativeTime(entry.createdAt)}
                      </span>
                    </div>
                    <div className="text-[10px] text-muted-foreground font-mono mt-0.5 truncate">
                      room: {entry.roomId} · user: {entry.channelUserId}
                    </div>
                    {entry.firstMessagePreview.length > 0 && (
                      <div className="text-[11px] text-foreground/80 mt-1.5 italic line-clamp-2">
                        “{entry.firstMessagePreview}”
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-1.5 shrink-0">
                    <Button
                      size="xs"
                      onClick={() => void handleApprove(entry.id)}
                      disabled={busyId === entry.id}
                      data-testid={`identity-pending-approve-${entry.id.replace(/[^a-zA-Z0-9]/g, "_")}`}
                    >
                      {busyId === entry.id ? "…" : "Approve"}
                    </Button>
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() => void handleReject(entry.id)}
                      disabled={busyId === entry.id}
                      data-testid={`identity-pending-reject-${entry.id.replace(/[^a-zA-Z0-9]/g, "_")}`}
                    >
                      Reject
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </PageScroll>
  );
}
