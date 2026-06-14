/**
 * ProfileManager — flyout panel for all entity types.
 *
 * Three sections:
 *   Owner (#E0)    — edit display name, GEID copy, OAuth connections
 *   Guests (#E1+)  — create, edit, remove, connections
 *   Agents ($A0+)  — read-only GEID + bound entity
 */

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge.js";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import {
  FlyoutPanel,
  FlyoutHeader,
  FlyoutBody,
} from "@/components/ui/flyout-panel.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EntityRow {
  id: string;
  type: string;
  displayName: string;
  coaAlias: string;
  scope: string;
  geid: string | null;
}

interface Connection {
  provider: string;
  role: string;
  accountLabel: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncateGeid(geid: string): string {
  if (geid.length <= 18) return geid;
  return `${geid.slice(0, 12)}…${geid.slice(-6)}`;
}

// ---------------------------------------------------------------------------
// Connections sub-list
// ---------------------------------------------------------------------------

function EntityConnections({ entityId }: { entityId: string }) {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/entities/${entityId}/connections`);
      if (res.ok) setConnections(await res.json() as Connection[]);
    } catch { /* non-fatal */ } finally { setLoading(false); }
  }, [entityId]);

  useEffect(() => { void load(); }, [load]);

  const removeConnection = async (provider: string) => {
    await fetch(`/api/entities/${entityId}/connections/${encodeURIComponent(provider)}`, { method: "DELETE" });
    await load();
  };

  if (loading) return <p className="text-[11px] text-muted-foreground">Loading…</p>;
  if (connections.length === 0) return <p className="text-[11px] text-muted-foreground">No OAuth connections.</p>;

  return (
    <div className="flex flex-col gap-1 mt-1">
      {connections.map((conn) => (
        <div key={`${conn.provider}-${conn.role}`} className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Badge variant="secondary" className="text-[10px] capitalize">{conn.provider}</Badge>
            {conn.accountLabel && <span className="text-[11px] text-muted-foreground">{conn.accountLabel}</span>}
          </div>
          <button
            onClick={() => void removeConnection(conn.provider)}
            className="text-[10px] text-muted-foreground hover:text-destructive transition-colors"
          >
            Remove
          </button>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Owner section
// ---------------------------------------------------------------------------

function OwnerSection({ entity }: { entity: EntityRow }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(entity.displayName);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showConnections, setShowConnections] = useState(false);

  const saveDisplayName = async () => {
    setSaving(true);
    await fetch(`/api/entities/${entity.id}/profile`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: name.trim() }),
    });
    setSaving(false);
    setEditing(false);
  };

  const copyGeid = () => {
    if (!entity.geid) return;
    void navigator.clipboard.writeText(entity.geid).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm shrink-0">
          {entity.displayName.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          {editing ? (
            <div className="flex items-center gap-2">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-7 text-sm"
                autoFocus
              />
              <Button size="sm" className="h-7 text-xs px-2" onClick={() => void saveDisplayName()} disabled={saving || !name.trim()}>
                Save
              </Button>
              <button onClick={() => { setEditing(false); setName(entity.displayName); }} className="text-[11px] text-muted-foreground hover:text-foreground">
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{entity.displayName}</span>
              <button onClick={() => setEditing(true)} className="text-[10px] text-muted-foreground hover:text-foreground transition-colors">Edit</button>
            </div>
          )}
          <span className="text-[11px] text-muted-foreground font-mono">{entity.coaAlias}</span>
        </div>
      </div>

      {entity.geid && (
        <div className="flex items-center gap-2 bg-secondary/50 rounded px-2 py-1.5">
          <code className="text-[11px] font-mono text-foreground flex-1 truncate">{truncateGeid(entity.geid)}</code>
          <button onClick={copyGeid} className="text-[10px] text-muted-foreground hover:text-foreground shrink-0">
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}

      <button
        onClick={() => setShowConnections((v) => !v)}
        className="text-[11px] text-muted-foreground hover:text-foreground transition-colors self-start"
      >
        {showConnections ? "Hide connections" : "OAuth connections ▾"}
      </button>
      {showConnections && <EntityConnections entityId={entity.id} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Guest row
// ---------------------------------------------------------------------------

function GuestRow({ entity, onRemoved }: { entity: EntityRow; onRemoved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(entity.displayName);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showConnections, setShowConnections] = useState(false);

  const saveDisplayName = async () => {
    setSaving(true);
    await fetch(`/api/entities/${entity.id}/profile`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: name.trim() }),
    });
    setSaving(false);
    setEditing(false);
  };

  const remove = async () => {
    await fetch(`/api/entities/${entity.id}`, { method: "DELETE" });
    onRemoved();
  };

  const copyGeid = () => {
    if (!entity.geid) return;
    void navigator.clipboard.writeText(entity.geid).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="flex flex-col gap-1.5 p-3 rounded-lg border border-border">
      <div className="flex items-center justify-between gap-2">
        {editing ? (
          <div className="flex items-center gap-2 flex-1">
            <Input value={name} onChange={(e) => setName(e.target.value)} className="h-7 text-sm flex-1" autoFocus />
            <Button size="sm" className="h-7 text-xs px-2" onClick={() => void saveDisplayName()} disabled={saving || !name.trim()}>Save</Button>
            <button onClick={() => { setEditing(false); setName(entity.displayName); }} className="text-[10px] text-muted-foreground hover:text-foreground">✕</button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{entity.displayName}</span>
            <span className="text-[10px] text-muted-foreground font-mono">{entity.coaAlias}</span>
          </div>
        )}
        {!editing && (
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={() => setEditing(true)} className="text-[10px] text-muted-foreground hover:text-foreground">Edit</button>
            <button onClick={() => void remove()} className="text-[10px] text-muted-foreground hover:text-destructive">Remove</button>
          </div>
        )}
      </div>

      {entity.geid && (
        <div className="flex items-center gap-2 bg-secondary/50 rounded px-2 py-1">
          <code className="text-[11px] font-mono text-foreground flex-1 truncate">{truncateGeid(entity.geid)}</code>
          <button onClick={copyGeid} className="text-[10px] text-muted-foreground hover:text-foreground shrink-0">
            {copied ? "Copied" : "Copy GEID"}
          </button>
        </div>
      )}

      <button
        onClick={() => setShowConnections((v) => !v)}
        className="text-[10px] text-muted-foreground hover:text-foreground transition-colors self-start"
      >
        {showConnections ? "Hide connections" : "Connections ▾"}
      </button>
      {showConnections && <EntityConnections entityId={entity.id} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create guest form
// ---------------------------------------------------------------------------

function CreateGuestForm({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  const create = async () => {
    if (!name.trim()) return;
    setSaving(true);
    await fetch("/api/entities/guests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: name.trim() }),
    });
    setName("");
    setSaving(false);
    setOpen(false);
    onCreated();
  };

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="text-xs">
        + Add Guest
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2 p-3 rounded-lg border border-border bg-secondary/20">
      <span className="text-xs font-medium">New Guest</span>
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Display name"
        className="h-8 text-sm"
        autoFocus
        onKeyDown={(e) => { if (e.key === "Enter") void create(); if (e.key === "Escape") setOpen(false); }}
      />
      <div className="flex gap-2">
        <Button size="sm" className="text-xs" onClick={() => void create()} disabled={saving || !name.trim()}>
          {saving ? "Creating…" : "Create"}
        </Button>
        <button onClick={() => { setOpen(false); setName(""); }} className="text-[11px] text-muted-foreground hover:text-foreground">
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ProfileManager({ open, onClose }: Props) {
  const [entities, setEntities] = useState<EntityRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/entities");
      if (res.ok) setEntities(await res.json() as EntityRow[]);
    } catch { /* non-fatal */ } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const owner = entities.find((e) => e.coaAlias === "#E0");
  const guests = entities.filter((e) => e.type === "E" && e.coaAlias !== "#E0");
  const agents = entities.filter((e) => e.type === "A");

  return (
    <FlyoutPanel open={open} onClose={onClose} position="right" width="min(400px, 92vw)">
      <FlyoutHeader>
        <span className="text-sm font-semibold">People & Identities</span>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-lg leading-none">✕</button>
      </FlyoutHeader>

      <FlyoutBody className="flex flex-col gap-6">
        {loading && <p className="text-sm text-muted-foreground">Loading…</p>}

        {!loading && (
          <>
            {/* Owner */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Owner</span>
                <Badge variant="secondary" className="text-[9px]">#E0</Badge>
              </div>
              {owner ? <OwnerSection entity={owner} /> : (
                <p className="text-sm text-muted-foreground">No owner registered yet. Complete the Owner Profile step in Onboarding.</p>
              )}
            </section>

            {/* Guests */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Guests</span>
                <Badge variant="secondary" className="text-[9px]">#E1+</Badge>
              </div>
              <div className="flex flex-col gap-2">
                {guests.length === 0 && (
                  <p className="text-xs text-muted-foreground mb-1">No guests yet.</p>
                )}
                {guests.map((g) => (
                  <GuestRow key={g.id} entity={g} onRemoved={() => void load()} />
                ))}
                <CreateGuestForm onCreated={() => void load()} />
              </div>
            </section>

            {/* Agents */}
            {agents.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Agents</span>
                  <Badge variant="secondary" className="text-[9px]">$A</Badge>
                </div>
                <div className="flex flex-col gap-2">
                  {agents.map((a) => (
                    <div key={a.id} className="flex flex-col gap-1 p-3 rounded-lg border border-border bg-secondary/20">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{a.displayName}</span>
                        <span className="text-[10px] text-muted-foreground font-mono">{a.coaAlias}</span>
                      </div>
                      {a.geid && (
                        <code className="text-[11px] font-mono text-muted-foreground truncate">{truncateGeid(a.geid)}</code>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </FlyoutBody>
    </FlyoutPanel>
  );
}
