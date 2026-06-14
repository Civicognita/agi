/**
 * /identity/pending — pending-from-channel approval queue.
 *
 * CHN-E (s166) slice 4 — owner-facing surface for the pending approval
 * records captured by InboundRouter when unknown users post in
 * project-bound channel rooms. Approve promotes the entity (slice 5
 * adds the verificationTier update); reject drops + flags the source.
 *
 * s195 — shows collected registration data (name/email/birthdate/Discord)
 * and lets the owner assign projects before approving.
 *
 * Consumes /api/identity/pending (GET/POST shipped in slice 3).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DevNote } from "@/components/ui/dev-notes";
import { PageScroll } from "@/components/PageScroll";
import {
  fetchPendingApprovals,
  approvePendingApproval,
  rejectPendingApproval,
  fetchProjects,
  type PendingApproval,
} from "../api";
import type { ProjectInfo } from "../types";

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

/** A person's pending approval, collapsing all the rooms they appeared in. */
interface PersonGroup {
  /** `${channelId}::${channelUserId}` — stable per-person key. */
  key: string;
  channelId: string;
  channelUserId: string;
  displayName: string;
  /** Earliest first-seen timestamp across the person's rooms. */
  createdAt: string;
  registrationData?: PendingApproval["registrationData"];
  /** Every room this person posted in (each is a backend pending record). */
  rooms: { id: string; roomId: string; projectPath: string; firstMessagePreview: string }[];
  /** Representative record id for approve/reject (the store cascades the rest). */
  recordId: string;
}

interface ProjectSelectorProps {
  projects: ProjectInfo[];
  selected: string[];
  onChange: (paths: string[]) => void;
}

function ProjectSelector({ projects, selected, onChange }: ProjectSelectorProps): JSX.Element {
  if (projects.length === 0) {
    return <div className="text-[10px] text-muted-foreground mt-2">No projects available to assign.</div>;
  }
  return (
    <div className="mt-2">
      <div className="text-[10px] font-medium text-muted-foreground mb-1">Assign projects (optional)</div>
      <div className="flex flex-wrap gap-1.5">
        {projects.map((p) => {
          const isChecked = selected.includes(p.path);
          return (
            <button
              key={p.path}
              type="button"
              onClick={() => {
                onChange(isChecked ? selected.filter((x) => x !== p.path) : [...selected, p.path]);
              }}
              className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                isChecked
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:border-foreground/40"
              }`}
            >
              {p.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function IdentityPendingPage(): JSX.Element {
  const [pending, setPending] = useState<PendingApproval[]>([]);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selectedProjects, setSelectedProjects] = useState<Record<string, string[]>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [pendingData, projectData] = await Promise.all([
        fetchPendingApprovals(),
        fetchProjects().catch(() => [] as ProjectInfo[]),
      ]);
      setPending(pendingData);
      setProjects(projectData);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const interval = setInterval(() => { void load(); }, 30_000);
    return () => clearInterval(interval);
  }, [load]);

  // Approve/reject act on the PERSON: the backend cascades across all the
  // rooms that (channelId, channelUserId) appeared in, so we only need a single
  // representative record id. busyId + selectedProjects are keyed by personKey.
  const handleApprove = useCallback(async (personKey: string, recordId: string) => {
    setBusyId(personKey);
    setError(null);
    try {
      await approvePendingApproval(recordId, { projectPaths: selectedProjects[personKey] ?? [] });
      setSelectedProjects((prev) => { const n = { ...prev }; delete n[personKey]; return n; });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }, [load, selectedProjects]);

  const handleReject = useCallback(async (personKey: string, recordId: string) => {
    setBusyId(personKey);
    setError(null);
    try {
      await rejectPendingApproval(recordId);
      setSelectedProjects((prev) => { const n = { ...prev }; delete n[personKey]; return n; });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }, [load]);

  // One card per PERSON (channelId, channelUserId). A single human who posted in
  // several rooms previously rendered as several "duplicate" approval cards;
  // now their rooms are collapsed into one card and one approve/reject resolves
  // them all (the store cascades). Sorted oldest-first by first-seen time.
  const people = useMemo(() => {
    const map = new Map<string, PersonGroup>();
    for (const p of pending) {
      const key = `${p.channelId}::${p.channelUserId}`;
      const room = { id: p.id, roomId: p.roomId, projectPath: p.projectPath, firstMessagePreview: p.firstMessagePreview };
      const existing = map.get(key);
      if (existing) {
        existing.rooms.push(room);
        if (p.createdAt < existing.createdAt) existing.createdAt = p.createdAt;
        if (p.registrationData !== undefined && existing.registrationData === undefined) {
          existing.registrationData = p.registrationData;
        }
      } else {
        map.set(key, {
          key,
          channelId: p.channelId,
          channelUserId: p.channelUserId,
          displayName: p.displayName,
          createdAt: p.createdAt,
          registrationData: p.registrationData,
          rooms: [room],
          recordId: p.id,
        });
      }
    }
    return [...map.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }, [pending]);

  return (
    <PageScroll>
      <div className="max-w-4xl mx-auto p-6">
        <DevNote heading="2026-06-08 — One card per person + live again" kind="info" scope="identity/pending">
          This page now shows ONE card per person (channel + user), collapsing all the rooms they
          messaged from into a single card — previously the same human appeared as multiple
          "duplicate" cards (one per room). Approve/Reject act on the person: the backend cascades
          across all their rooms in one click. The list also stopped updating because the legacy
          Discord pairing-code gate intercepted messages BEFORE the pending-approval capture ran;
          that gate was retired (channel identity is dashboard-only now), so new contacts appear here
          again.
        </DevNote>
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Pending Identity Approvals</h1>
            <p className="text-[12px] text-muted-foreground mt-1">
              Unknown users who messaged a configured channel. Approve to grant verified access; reject to drop future messages.
              Bind a room to a project (via Projects → Channels tab) to enable message gating.
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
              No pending approvals. When unknown users message a configured channel, they'll appear here.
            </span>
          </Card>
        )}

        <div className="space-y-3">
          {people.map((person) => {
            const sanitizedKey = person.key.replace(/[^a-zA-Z0-9]/g, "_");
            const previewRoom = person.rooms.find((r) => r.firstMessagePreview.length > 0) ?? person.rooms[0];
            const isBusy = busyId === person.key;
            return (
              <Card
                key={person.key}
                className="p-4"
                data-testid={`identity-pending-entry-${sanitizedKey}`}
              >
                <div className="flex items-start gap-3">
                  <span className="text-[18px] shrink-0 mt-0.5" aria-hidden>
                    {channelEmoji(person.channelId)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium text-foreground truncate">
                        {person.displayName}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        · {person.channelId} · {relativeTime(person.createdAt)}
                      </span>
                    </div>
                    <div className="text-[10px] text-muted-foreground font-mono mt-0.5 truncate">
                      user: {person.channelUserId}
                    </div>

                    {/* Rooms this person appeared in — collapsed from N per-room
                        records into one card so the same human isn't a duplicate. */}
                    <div className="mt-1.5 space-y-0.5" data-testid={`identity-pending-rooms-${sanitizedKey}`}>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                        Seen in {person.rooms.length} room{person.rooms.length === 1 ? "" : "s"}
                      </div>
                      {person.rooms.map((room) => (
                        <div key={room.id} className="text-[10px] text-muted-foreground font-mono truncate">
                          {room.roomId}{room.projectPath ? ` · ${room.projectPath}` : " · unbound"}
                        </div>
                      ))}
                    </div>

                    {previewRoom !== undefined && previewRoom.firstMessagePreview.length > 0 && (
                      <div className="text-[11px] text-foreground/80 mt-1.5 italic line-clamp-2">
                        "{previewRoom.firstMessagePreview}"
                      </div>
                    )}

                    {/* s195 — registration data collected during DM flow */}
                    {person.registrationData !== undefined && (
                      <div className="mt-2 p-2 rounded bg-muted/40 border border-border/40 space-y-0.5">
                        <div className="text-[10px] font-medium text-muted-foreground mb-1">Registration data</div>
                        {person.registrationData.name !== undefined && (
                          <div className="text-[11px] text-foreground font-mono">Name: {person.registrationData.name}</div>
                        )}
                        {person.registrationData.email !== undefined && (
                          <div className="text-[11px] text-foreground font-mono">Email: {person.registrationData.email}</div>
                        )}
                        {person.registrationData.birthdate !== undefined && (
                          <div className="text-[11px] text-foreground font-mono">Birthdate: {person.registrationData.birthdate}</div>
                        )}
                        {person.registrationData.pronouns !== undefined && (
                          <div className="text-[11px] text-foreground font-mono">Pronouns: {person.registrationData.pronouns}</div>
                        )}
                        {person.registrationData.discordHandle !== undefined && (
                          <div className="text-[11px] text-foreground font-mono">Discord: @{person.registrationData.discordHandle}</div>
                        )}
                      </div>
                    )}

                    {/* s195 — project assignment before approving */}
                    <ProjectSelector
                      projects={projects}
                      selected={selectedProjects[person.key] ?? []}
                      onChange={(paths) => setSelectedProjects((prev) => ({ ...prev, [person.key]: paths }))}
                    />
                  </div>

                  <div className="flex flex-col gap-1.5 shrink-0">
                    <Button
                      size="xs"
                      onClick={() => void handleApprove(person.key, person.recordId)}
                      disabled={isBusy}
                      data-testid={`identity-pending-approve-${sanitizedKey}`}
                    >
                      {isBusy ? "…" : "Approve"}
                    </Button>
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() => void handleReject(person.key, person.recordId)}
                      disabled={isBusy}
                      data-testid={`identity-pending-reject-${sanitizedKey}`}
                    >
                      Reject
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </div>
    </PageScroll>
  );
}
