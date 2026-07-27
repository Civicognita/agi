/**
 * /identity/pending — pending-from-channel approval queue.
 *
 * CHN-E (s166) — owner-facing surface for the pending-approval records captured
 * by InboundRouter when unknown users post in configured channel rooms.
 *
 * s234 P2 — Approve is now a guided identity resolution: the Owner chooses to
 * REGISTER a new local person for this channel account, or ASSOCIATE the account
 * onto an EXISTING local identity (the same human who already reached us on
 * another channel/account). Then set access (projects). Reject drops the source.
 *
 * Consumes /api/identity/pending (GET/POST) + /api/identity/people (associate
 * picker source).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DevNote } from "@/components/ui/dev-notes";
import { PageScroll } from "@/components/PageScroll";
import {
  fetchPendingApprovals,
  approvePendingApproval,
  rejectPendingApproval,
  fetchIdentityPeople,
  fetchProjects,
  fetchOwnerStatus,
  claimOwner,
  type PendingApproval,
  type DecidedPerson,
  type ApproveDecision,
  type OwnerStatus,
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
  key: string;
  channelId: string;
  channelUserId: string;
  displayName: string;
  createdAt: string;
  registrationData?: PendingApproval["registrationData"];
  rooms: { id: string; roomId: string; projectPath: string; firstMessagePreview: string }[];
  recordId: string;
}

function ProjectSelector({ projects, selected, onChange }: {
  projects: ProjectInfo[];
  selected: string[];
  onChange: (paths: string[]) => void;
}): JSX.Element {
  if (projects.length === 0) {
    return <div className="text-[10px] text-muted-foreground mt-2">No projects available to assign.</div>;
  }
  return (
    <div className="mt-2">
      <div className="text-[10px] font-medium text-muted-foreground mb-1">Project access (optional)</div>
      <div className="flex flex-wrap gap-1.5">
        {projects.map((p) => {
          const isChecked = selected.includes(p.path);
          return (
            <button
              key={p.path}
              type="button"
              onClick={() => onChange(isChecked ? selected.filter((x) => x !== p.path) : [...selected, p.path])}
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

/**
 * The approve panel — expands under a person's card when the Owner clicks
 * Approve. Owner picks register-new vs associate-to-existing, then confirms.
 */
function ApprovePanel({ person, people, projects, busy, onConfirm, onCancel }: {
  person: PersonGroup;
  people: DecidedPerson[];
  projects: ProjectInfo[];
  busy: boolean;
  onConfirm: (decision: ApproveDecision) => void;
  onCancel: () => void;
}): JSX.Element {
  const [mode, setMode] = useState<"register" | "associate">("register");
  const [projectPaths, setProjectPaths] = useState<string[]>([]);
  const [targetEntityId, setTargetEntityId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [name, setName] = useState(person.registrationData?.name ?? person.displayName);
  const [email, setEmail] = useState(person.registrationData?.email ?? "");

  // Existing identities available to associate onto (approved people with an
  // entity id), minus this same channel account. Searchable.
  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return people
      .filter((p) => p.entityId !== undefined && p.status === "approved")
      .filter((p) => !(p.channelId === person.channelId && p.channelUserId === person.channelUserId))
      .filter((p) => q === "" || (p.displayName ?? "").toLowerCase().includes(q) || (p.channelUserId ?? "").toLowerCase().includes(q))
      .slice(0, 12);
  }, [people, query, person]);

  const canConfirm = mode === "register" || (mode === "associate" && targetEntityId !== null);

  return (
    <div className="mt-3 border-t border-border/50 pt-3 space-y-3" data-testid="identity-approve-panel">
      {/* Mode toggle */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setMode("register")}
          className={`text-[11px] px-3 py-1 rounded border transition-colors ${mode === "register" ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-foreground/40"}`}
          data-testid="identity-approve-mode-register"
        >
          ＋ Register new person
        </button>
        <button
          type="button"
          onClick={() => setMode("associate")}
          className={`text-[11px] px-3 py-1 rounded border transition-colors ${mode === "associate" ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-foreground/40"}`}
          data-testid="identity-approve-mode-associate"
        >
          🔗 Associate to existing
        </button>
      </div>

      {mode === "register" ? (
        <div className="space-y-2" data-testid="identity-register-form">
          <div className="text-[10px] text-muted-foreground">Create a new local identity for this channel account.</div>
          <div className="flex gap-2">
            <Input className="h-7 text-[11px]" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} data-testid="identity-register-name" />
            <Input className="h-7 text-[11px]" placeholder="Email (optional)" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="identity-register-email" />
          </div>
        </div>
      ) : (
        <div className="space-y-2" data-testid="identity-associate-picker">
          <div className="text-[10px] text-muted-foreground">Link this channel account onto an existing person (same human, another account).</div>
          <Input className="h-7 text-[11px]" placeholder="Search people…" value={query} onChange={(e) => setQuery(e.target.value)} data-testid="identity-associate-search" />
          <div className="max-h-40 overflow-y-auto space-y-1">
            {candidates.length === 0 ? (
              <div className="text-[10px] text-muted-foreground italic px-1 py-2">No existing people match. Register a new person instead.</div>
            ) : candidates.map((c) => (
              <button
                key={c.entityId}
                type="button"
                onClick={() => setTargetEntityId(c.entityId ?? null)}
                className={`w-full text-left px-2 py-1 rounded border text-[11px] transition-colors ${targetEntityId === c.entityId ? "bg-primary/15 border-primary" : "border-border/60 hover:border-foreground/40"}`}
                data-testid={`identity-associate-candidate-${(c.entityId ?? "").replace(/[^a-zA-Z0-9]/g, "_")}`}
              >
                <span className="font-medium text-foreground">{c.displayName ?? c.channelUserId}</span>
                <span className="text-[9px] text-muted-foreground ml-2">
                  {channelEmoji(c.channelId ?? "")} {c.channelId}
                  {c.channelAccounts && c.channelAccounts.length > 1 ? ` · ${c.channelAccounts.length} accounts` : ""}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <ProjectSelector projects={projects} selected={projectPaths} onChange={setProjectPaths} />

      <div className="flex gap-2 pt-1">
        <Button
          size="xs"
          disabled={busy || !canConfirm}
          onClick={() => onConfirm(
            mode === "associate"
              ? { mode, targetEntityId: targetEntityId ?? undefined, projectPaths }
              : { mode, profile: { name: name.trim() || undefined, email: email.trim() || undefined }, projectPaths },
          )}
          data-testid="identity-approve-confirm"
        >
          {busy ? "…" : mode === "associate" ? "Associate & approve" : "Register & approve"}
        </Button>
        <Button variant="ghost" size="xs" disabled={busy} onClick={onCancel} data-testid="identity-approve-cancel">
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** s234 P3 — fresh-install owner claim. Shown when no owner is designated. */
function ClaimOwnerCard({ people, onClaimed }: { people: PersonGroup[]; onClaimed: () => void }): JSX.Element {
  const [token, setToken] = useState("");
  const [targetKey, setTargetKey] = useState<string>(people[0]?.key ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const target = people.find((p) => p.key === targetKey) ?? people[0];

  const doClaim = async (): Promise<void> => {
    setBusy(true); setErr(null);
    try {
      await claimOwner({
        token: token.trim(),
        ...(target !== undefined ? { channelId: target.channelId, channelUserId: target.channelUserId, displayName: target.displayName } : {}),
      });
      onClaimed();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  return (
    <Card className="p-4 mb-4 border-amber-500/40 bg-amber-500/5" data-testid="owner-claim-card">
      <div className="text-[14px] font-semibold text-foreground">👑 Claim ownership</div>
      <p className="text-[12px] text-muted-foreground mt-1">
        No owner is set for this install. Enter the one-time claim token printed to the server console at boot,
        then pick which person is the owner.
      </p>
      <div className="mt-3 space-y-2 max-w-md">
        <Input className="h-8 text-[12px]" placeholder="One-time claim token" value={token} onChange={(e) => setToken(e.target.value)} data-testid="owner-claim-token" />
        {people.length > 0 ? (
          <select className="h-8 w-full rounded-md border border-input bg-background px-2 text-[12px] text-foreground" value={targetKey} onChange={(e) => setTargetKey(e.target.value)} data-testid="owner-claim-target">
            {people.map((p) => <option key={p.key} value={p.key}>{p.displayName} · {p.channelId}:{p.channelUserId}</option>)}
          </select>
        ) : (
          <p className="text-[11px] text-muted-foreground italic">No pending people to designate — message the bot from your own account first, then claim.</p>
        )}
        {err !== null && <p className="text-[11px] text-red">{err}</p>}
        <Button size="xs" disabled={busy || token.trim() === "" || people.length === 0} onClick={() => void doClaim()} data-testid="owner-claim-submit">
          {busy ? "Claiming…" : "Claim ownership"}
        </Button>
      </div>
    </Card>
  );
}

export default function IdentityPendingPage(): JSX.Element {
  const [pending, setPending] = useState<PendingApproval[]>([]);
  const [people, setPeople] = useState<DecidedPerson[]>([]);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [approvingKey, setApprovingKey] = useState<string | null>(null);
  const [ownerStatus, setOwnerStatus] = useState<OwnerStatus | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [pendingData, peopleData, projectData, owner] = await Promise.all([
        fetchPendingApprovals(),
        fetchIdentityPeople("approved").catch(() => [] as DecidedPerson[]),
        fetchProjects().catch(() => [] as ProjectInfo[]),
        fetchOwnerStatus().catch(() => null),
      ]);
      setPending(pendingData);
      setPeople(peopleData);
      setProjects(projectData);
      setOwnerStatus(owner);
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

  const handleApprove = useCallback(async (personKey: string, recordId: string, decision: ApproveDecision) => {
    setBusyId(personKey);
    setError(null);
    try {
      await approvePendingApproval(recordId, decision);
      setApprovingKey(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }, [load]);

  const handleReject = useCallback(async (personKey: string, recordId: string) => {
    setBusyId(personKey);
    setError(null);
    try {
      await rejectPendingApproval(recordId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }, [load]);

  const peopleGroups = useMemo(() => {
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
          key, channelId: p.channelId, channelUserId: p.channelUserId,
          displayName: p.displayName, createdAt: p.createdAt,
          registrationData: p.registrationData, rooms: [room], recordId: p.id,
        });
      }
    }
    return [...map.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }, [pending]);

  return (
    <PageScroll>
      <div className="max-w-4xl mx-auto p-6">
        <DevNote heading="s234 P2 — approve = register new OR associate to existing" kind="info" scope="identity/pending">
          Approving a pending channel person is now a guided identity choice: <b>Register new person</b>
          {" "}(mint a fresh local identity for this channel account) or <b>Associate to existing</b> (link this
          account onto a person who already reached you on another channel — one human, many accounts). Then set
          project access. Owner identity + permissions derive from these local associations (the hand-edited
          <code>owner.channels</code> config is being retired). One card per person; the backend cascades across
          all the rooms they messaged from.
        </DevNote>
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Pending Identity Approvals</h1>
            <p className="text-[12px] text-muted-foreground mt-1">
              Unknown users who messaged a configured channel. Approve to grant verified access (register or
              associate); reject to drop future messages.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading} data-testid="identity-pending-refresh">
            {loading ? "Loading…" : "Refresh"}
          </Button>
        </div>

        {ownerStatus?.claimable === true && (
          <ClaimOwnerCard people={peopleGroups} onClaimed={() => void load()} />
        )}

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
          {peopleGroups.map((person) => {
            const sanitizedKey = person.key.replace(/[^a-zA-Z0-9]/g, "_");
            const previewRoom = person.rooms.find((r) => r.firstMessagePreview.length > 0) ?? person.rooms[0];
            const isBusy = busyId === person.key;
            const isApproving = approvingKey === person.key;
            return (
              <Card key={person.key} className="p-4" data-testid={`identity-pending-entry-${sanitizedKey}`}>
                <div className="flex items-start gap-3">
                  <span className="text-[18px] shrink-0 mt-0.5" aria-hidden>{channelEmoji(person.channelId)}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium text-foreground truncate">{person.displayName}</span>
                      <span className="text-[10px] text-muted-foreground">· {person.channelId} · {relativeTime(person.createdAt)}</span>
                    </div>
                    <div className="text-[10px] text-muted-foreground font-mono mt-0.5 truncate">user: {person.channelUserId}</div>

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
                      <div className="text-[11px] text-foreground/80 mt-1.5 italic line-clamp-2">"{previewRoom.firstMessagePreview}"</div>
                    )}

                    {person.registrationData !== undefined && (
                      <div className="mt-2 p-2 rounded bg-muted/40 border border-border/40 space-y-0.5">
                        <div className="text-[10px] font-medium text-muted-foreground mb-1">Registration data</div>
                        {person.registrationData.name !== undefined && <div className="text-[11px] text-foreground font-mono">Name: {person.registrationData.name}</div>}
                        {person.registrationData.email !== undefined && <div className="text-[11px] text-foreground font-mono">Email: {person.registrationData.email}</div>}
                        {person.registrationData.birthdate !== undefined && <div className="text-[11px] text-foreground font-mono">Birthdate: {person.registrationData.birthdate}</div>}
                        {person.registrationData.pronouns !== undefined && <div className="text-[11px] text-foreground font-mono">Pronouns: {person.registrationData.pronouns}</div>}
                        {person.registrationData.discordHandle !== undefined && <div className="text-[11px] text-foreground font-mono">Discord: @{person.registrationData.discordHandle}</div>}
                      </div>
                    )}

                    {isApproving && (
                      <ApprovePanel
                        person={person}
                        people={people}
                        projects={projects}
                        busy={isBusy}
                        onConfirm={(decision) => void handleApprove(person.key, person.recordId, decision)}
                        onCancel={() => setApprovingKey(null)}
                      />
                    )}
                  </div>

                  {!isApproving && (
                    <div className="flex flex-col gap-1.5 shrink-0">
                      <Button size="xs" onClick={() => setApprovingKey(person.key)} disabled={isBusy} data-testid={`identity-pending-approve-${sanitizedKey}`}>
                        Approve
                      </Button>
                      <Button variant="outline" size="xs" onClick={() => void handleReject(person.key, person.recordId)} disabled={isBusy} data-testid={`identity-pending-reject-${sanitizedKey}`}>
                        Reject
                      </Button>
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      </div>
    </PageScroll>
  );
}
