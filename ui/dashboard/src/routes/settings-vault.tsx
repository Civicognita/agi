/**
 * Settings → Vault route — owner-facing UX for the Vault feature (s128 t495).
 *
 * Lists vault entry summaries from GET /api/vault. Owner can create new
 * entries via the "New entry" Modal (POST /api/vault) and delete existing
 * ones (DELETE /api/vault/:id).
 *
 * Per-project Vault picker on MCP tab + Stacks panel deferred to a follow-up
 * cycle — the Settings tab is the first user-visible surface.
 */

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  fetchVaultEntries,
  createVaultEntry,
  deleteVaultEntry,
  type VaultEntrySummary,
  type VaultEntryType,
} from "@/api.js";

const VAULT_TYPES: VaultEntryType[] = ["key", "password", "token"];

const TYPE_DESCRIPTION: Record<VaultEntryType, string> = {
  key: "API keys, OAuth secrets, signing keys",
  password: "Password-style credentials",
  token: "Bearer tokens, JWTs, session cookies",
};

const TYPE_BADGE_CLASS: Record<VaultEntryType, string> = {
  key: "bg-blue/15 text-blue",
  password: "bg-amber-500/15 text-amber-400",
  token: "bg-emerald-500/15 text-emerald-400",
};

function formatRelativeTime(iso: string | null): string {
  if (iso === null) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${String(Math.round(ms / 60_000))}m ago`;
  if (ms < 86_400_000) return `${String(Math.round(ms / 3_600_000))}h ago`;
  return `${String(Math.round(ms / 86_400_000))}d ago`;
}

export default function SettingsVaultPage() {
  const [entries, setEntries] = useState<VaultEntrySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await fetchVaultEntries();
      setEntries(list);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onDelete = useCallback(async (id: string) => {
    if (pendingDeleteId !== null) return;
    setPendingDeleteId(id);
    try {
      await deleteVaultEntry(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingDeleteId(null);
    }
  }, [pendingDeleteId, refresh]);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight">Vault</h1>
          <p className="text-muted-foreground mt-1 max-w-[60ch] text-[13.5px]">
            Private keys, passwords, and tokens encrypted via TPM2-sealed storage.
            Reference entries from project config via{" "}
            <code className="font-mono text-foreground">vault://&lt;id&gt;</code> — values never
            land in <code className="font-mono text-foreground">.env</code> files or{" "}
            <code className="font-mono text-foreground">project.json</code>.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} data-testid="vault-create-open">
          New entry
        </Button>
      </div>

      {/* Disclaimer banner — first slice of the Vault UX */}
      <div className="px-4 py-3 rounded-lg border-l-4 border-amber-400 border border-amber-400/30 bg-amber-400/5 text-[12.5px] leading-relaxed">
        <strong className="text-amber-400 uppercase tracking-wider text-[11px]">
          ⚠ First slice
        </strong>
        <p className="mt-1 text-foreground">
          The list below shows vault entries across the gateway. Per-project filtering, the MCP-tab
          picker, the Stacks integration, and the runtime resolver land in follow-up cycles
          (s128 t496-t498).
        </p>
      </div>

      {error !== null && (
        <div className="px-3.5 py-2.5 rounded-lg bg-red/10 text-red text-[13px]">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-muted-foreground">Loading vault entries...</div>
      ) : entries.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground" data-testid="vault-empty">
          <p className="text-[15px] mb-2">No vault entries yet.</p>
          <p className="text-[12px]">
            Click <span className="text-foreground font-medium">New entry</span> to add your first key,
            password, or token.
          </p>
        </Card>
      ) : (
        <div className="grid gap-3" data-testid="vault-list">
          {entries.map((entry) => (
            <Card
              key={entry.id}
              className="p-4 flex items-center justify-between gap-4"
              data-testid={`vault-entry-${entry.id}`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className={cn(
                    "text-[10px] px-1.5 py-0.5 rounded-md font-medium uppercase tracking-wider",
                    TYPE_BADGE_CLASS[entry.type],
                  )}>
                    {entry.type}
                  </span>
                  <span className="text-[15px] font-semibold truncate">{entry.name}</span>
                  {entry.ownedByProject && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-blue/15 text-blue font-medium">
                      project-scoped
                    </span>
                  )}
                </div>
                {entry.description !== undefined && (
                  <p className="text-[12px] text-muted-foreground mt-1 truncate">
                    {entry.description}
                  </p>
                )}
                <div className="text-[11px] text-muted-foreground mt-1 flex items-center gap-3">
                  <span className="font-mono">id: {entry.id}</span>
                  <span>created {formatRelativeTime(entry.created)}</span>
                  <span>last read {formatRelativeTime(entry.lastAccessed)}</span>
                </div>
              </div>
              <Button
                variant="outline"
                onClick={() => void onDelete(entry.id)}
                disabled={pendingDeleteId === entry.id}
                data-testid={`vault-delete-${entry.id}`}
              >
                {pendingDeleteId === entry.id ? "Deleting…" : "Delete"}
              </Button>
            </Card>
          ))}
        </div>
      )}

      <CreateEntryDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => { void refresh(); setCreateOpen(false); }}
      />
    </div>
  );
}

interface CreateDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (entry: VaultEntrySummary) => void;
}

function CreateEntryDialog({ open, onClose, onCreated }: CreateDialogProps) {
  const [name, setName] = useState("");
  const [type, setType] = useState<VaultEntryType>("key");
  const [value, setValue] = useState("");
  const [description, setDescription] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form when dialog reopens
  useEffect(() => {
    if (open) {
      setName("");
      setType("key");
      setValue("");
      setDescription("");
      setError(null);
    }
  }, [open]);

  const onSubmit = async (): Promise<void> => {
    if (pending) return;
    setError(null);

    if (name.trim().length === 0) { setError("Name is required"); return; }
    if (value.length === 0) { setError("Value is required"); return; }

    setPending(true);
    try {
      const entry = await createVaultEntry({
        name: name.trim(),
        type,
        value,
        ...(description.trim().length > 0 ? { description: description.trim() } : {}),
      });
      onCreated(entry);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New vault entry</DialogTitle>
          <DialogDescription>
            Stored encrypted via TPM2-sealed storage. The value is never echoed back after creation.
          </DialogDescription>
        </DialogHeader>

        <div className="px-4 py-2 space-y-3">
          <div>
            <label className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold">
              Name
            </label>
            <Input
              value={name}
              onChange={(e) => setName((e.target as HTMLInputElement).value)}
              placeholder="Tynn API key"
              className="mt-1"
              data-testid="vault-create-name"
            />
          </div>

          <div>
            <label className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold">
              Type
            </label>
            <Select
              className="mt-1"
              list={VAULT_TYPES.map((t) => ({ value: t, label: `${t} — ${TYPE_DESCRIPTION[t]}` }))}
              value={type}
              onValueChange={(v) => setType(v as VaultEntryType)}
            />
          </div>

          <div>
            <label className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold">
              Value
            </label>
            <Input
              type="password"
              value={value}
              onChange={(e) => setValue((e.target as HTMLInputElement).value)}
              placeholder="paste secret value here"
              className="mt-1 font-mono"
              data-testid="vault-create-value"
            />
            <p className="text-[10.5px] text-muted-foreground mt-1">
              Stored encrypted; never readable in plaintext after creation.
            </p>
          </div>

          <div>
            <label className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold">
              Description (optional)
            </label>
            <Input
              value={description}
              onChange={(e) => setDescription((e.target as HTMLInputElement).value)}
              placeholder="primary key for tynn.ai/mcp/tynn"
              className="mt-1"
            />
          </div>

          {error !== null && (
            <div className="px-3 py-2 rounded-md bg-red/10 text-red text-[12px]">
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={() => void onSubmit()} disabled={pending} data-testid="vault-create-submit">
            {pending ? "Creating…" : "Create entry"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
