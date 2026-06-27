/**
 * Settings → Channels route
 *
 * One tab per installed channel plugin (derived from discoveredPlugins, fully
 * plugin-driven — no hardcoded channel list). Each tab shows:
 *   - Connection status + start / stop / restart controls
 *   - Config form (fields derived from the plugin's getDefaults() template,
 *     populated with values from gateway.json)
 *   - Enabled toggle
 *   - Workflow bindings (MApp → channel dispatch rules)
 *
 * Config is persisted via PATCH /api/channels/:id/config → gateway.json.
 * Hot-reload applies without a gateway restart; a channel restart is offered
 * when the channel is currently running so new credentials take effect.
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { DiscordOwnerCard } from "@/components/DiscordOwnerCard.js";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DevNote } from "@/components/ui/dev-notes";
import { cn } from "@/lib/utils";
import {
  fetchChannels,
  fetchChannelDetail,
  fetchChannelConfig,
  updateChannelConfig,
  startChannel,
  stopChannel,
  restartChannel,
  fetchCommsLog,
  fetchChannelOpsLog,
  listWorkflowBindings,
  addWorkflowBinding,
  deleteWorkflowBinding,
  type ChannelListEntry,
  type ChannelConfigResponse,
  type ChannelWorkflowBinding,
  type ChannelOpsLogEntry,
} from "@/api.js";
import type { ChannelDetail, CommsLogEntry } from "@/types.js";

// ---------------------------------------------------------------------------
// Discord state types (mirrors channels/discord/src/state.ts — no direct import)
// ---------------------------------------------------------------------------

interface DiscordRoleDescriptor {
  id: string;
  name: string;
  color: number;
  position: number;
  managed: boolean;
}
interface DiscordChannelDescriptor {
  id: string;
  name: string;
  kind: string;
  parent?: string;
}
interface DiscordGuildDescriptor {
  id: string;
  name: string;
  iconUrl?: string;
  memberCount?: number;
  channels: DiscordChannelDescriptor[];
  roles: DiscordRoleDescriptor[];
}
interface DiscordStateDescriptor {
  connected: boolean;
  user?: { id: string; tag: string; avatarUrl?: string };
  guilds: DiscordGuildDescriptor[];
  snapshotAt: string;
}

import { ChannelModeBadge, CHANNEL_MODES, CHANNEL_MODE_META } from "@/components/ChannelModeBadge.js";
import type { DiscordChannelMode } from "@/components/ChannelModeBadge.js";

interface ChannelExtConfig {
  memoryScope?: {
    channel?: boolean;
    server?: boolean;
    user?: boolean;
    thread?: boolean;
  };
  promptAddendum?: string;
}

function parseIds(v: unknown): string[] {
  if (typeof v === "string") return v.split(",").map((s) => s.trim()).filter(Boolean);
  if (Array.isArray(v)) return (v as unknown[]).filter((s) => typeof s === "string") as string[];
  return [];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Derive a human label from a camelCase / snake_case config field name. */
function fieldLabel(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}

/** Mask sensitive fields — show as password inputs. */
function isSensitive(key: string): boolean {
  const k = key.toLowerCase();
  return k.includes("token") || k.includes("secret") || k.includes("password") || k.includes("key");
}

/** Strip trailing " Channel" suffix from plugin display name. */
function shortName(name: string): string {
  return name.replace(/\s+Channel$/i, "");
}

// ---------------------------------------------------------------------------
// WorkflowBindingsBlock — MApp workflow bindings for a channel
// ---------------------------------------------------------------------------

const EMPTY_FORM = { mappId: "", label: "", roomId: "", roleId: "", messagePattern: "" };

function WorkflowBindingsBlock({ channelId }: { channelId: string }) {
  const [bindings, setBindings] = useState<ChannelWorkflowBinding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const bs = await listWorkflowBindings(channelId);
      setBindings(bs);
      setError(null);
    } catch {
      setError("Failed to load bindings");
    } finally {
      setLoading(false);
    }
  }, [channelId]);

  useEffect(() => { void load(); }, [load]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!form.mappId.trim()) { setAddError("MApp ID is required"); return; }
    setAdding(true);
    setAddError(null);
    try {
      await addWorkflowBinding({
        channelId,
        mappId: form.mappId.trim(),
        label: form.label.trim() || undefined,
        roomId: form.roomId.trim() || undefined,
        roleId: form.roleId.trim() || undefined,
        messagePattern: form.messagePattern.trim() || undefined,
      });
      setForm(EMPTY_FORM);
      setShowAdd(false);
      await load();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Failed to add binding");
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteWorkflowBinding(id);
      setBindings((prev) => prev.filter((b) => b.id !== id));
    } catch {
      setError("Failed to delete binding");
    }
  }

  return (
    <Card className="p-5" data-testid="workflow-bindings-block">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[13px] font-semibold text-foreground">Workflow Bindings</span>
        <Button variant="outline" size="xs" onClick={() => { setShowAdd((v) => !v); setAddError(null); }}>
          {showAdd ? "Cancel" : "Add"}
        </Button>
      </div>

      {showAdd && (
        <form onSubmit={(e) => { void handleAdd(e); }} className="mb-4 p-3 rounded border border-border bg-muted/30 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[12px] font-medium text-muted-foreground">MApp ID *</label>
              <Input value={form.mappId} onChange={(e) => setForm((f) => ({ ...f, mappId: e.target.value }))} placeholder="e.g. my-mapp" className="font-mono text-xs" data-testid="binding-mapp-id" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[12px] font-medium text-muted-foreground">Label</label>
              <Input value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} placeholder="Optional display name" className="text-xs" data-testid="binding-label" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[12px] font-medium text-muted-foreground">Room ID</label>
              <Input value={form.roomId} onChange={(e) => setForm((f) => ({ ...f, roomId: e.target.value }))} placeholder="Channel ID (optional)" className="font-mono text-xs" data-testid="binding-room-id" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[12px] font-medium text-muted-foreground">Role ID</label>
              <Input value={form.roleId} onChange={(e) => setForm((f) => ({ ...f, roleId: e.target.value }))} placeholder="Role ID (optional)" className="font-mono text-xs" data-testid="binding-role-id" />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[12px] font-medium text-muted-foreground">Message Pattern (regex)</label>
            <Input value={form.messagePattern} onChange={(e) => setForm((f) => ({ ...f, messagePattern: e.target.value }))} placeholder="e.g. ^!command or leave empty to match all" className="font-mono text-xs" data-testid="binding-pattern" />
          </div>
          {addError !== null && <p className="text-xs text-red">{addError}</p>}
          <Button type="submit" size="xs" disabled={adding} data-testid="binding-add-submit">
            {adding ? "Adding…" : "Add Binding"}
          </Button>
        </form>
      )}

      {loading && <p className="text-[13px] text-muted-foreground">Loading…</p>}
      {error !== null && <p className="text-[13px] text-red">{error}</p>}

      {!loading && bindings.length === 0 && (
        <p className="text-[13px] text-muted-foreground" data-testid="binding-empty">
          No bindings. Add one to dispatch incoming messages to a MApp workflow.
        </p>
      )}

      {bindings.length > 0 && (
        <div className="space-y-2" data-testid="binding-list">
          {bindings.map((b) => (
            <div key={b.id} className="flex items-start justify-between gap-2 p-2 rounded border border-border text-[12px]" data-testid="binding-row">
              <div className="flex-1 min-w-0 space-y-0.5">
                <div className="font-mono font-semibold truncate">{b.label ?? b.mappId}</div>
                <div className="text-muted-foreground space-x-2">
                  <span>MApp: <span className="font-mono">{b.mappId}</span></span>
                  {b.roomId !== undefined && <span>Room: <span className="font-mono">{b.roomId}</span></span>}
                  {b.roleId !== undefined && <span>Role: <span className="font-mono">{b.roleId}</span></span>}
                  {b.messagePattern !== undefined && <span>Pattern: <span className="font-mono">{b.messagePattern}</span></span>}
                </div>
              </div>
              <Button variant="ghost" size="xs" className="shrink-0 text-red hover:bg-red/10" onClick={() => { void handleDelete(b.id); }} data-testid="binding-delete">
                Delete
              </Button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// ChannelLogTab — live operational log for a channel
// ---------------------------------------------------------------------------

function levelColor(level: string): string {
  if (level === "error") return "text-red";
  if (level === "warn") return "text-yellow";
  if (level === "debug") return "text-muted-foreground";
  return "text-foreground";
}

function ChannelLogTab({ channelId }: { channelId: string }) {
  const [entries, setEntries] = useState<ChannelOpsLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetchChannelOpsLog(channelId, 200);
      setEntries(res.entries);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [channelId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!autoRefresh) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
      return;
    }
    intervalRef.current = setInterval(() => { void load(); }, 5_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [autoRefresh, load]);

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[13px] font-semibold text-foreground">Operations Log</span>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <button
              type="button"
              onClick={() => setAutoRefresh((v) => !v)}
              className={cn(
                "relative w-8 h-4 rounded-full transition-colors",
                autoRefresh ? "bg-emerald-500" : "bg-secondary",
              )}
              aria-label="Toggle auto-refresh"
            >
              <span
                className={cn(
                  "absolute top-0.5 w-3 h-3 rounded-full transition-all",
                  autoRefresh ? "left-[18px] bg-white" : "left-0.5 bg-muted-foreground",
                )}
              />
            </button>
            <span className="text-[11px] text-muted-foreground">Live</span>
          </label>
          <Button variant="outline" size="xs" onClick={() => void load()}>Refresh</Button>
        </div>
      </div>

      {error !== null && (
        <div className="text-[12px] text-red mb-2">{error}</div>
      )}

      {loading && entries.length === 0 ? (
        <div className="text-[13px] text-muted-foreground py-8 text-center">Loading…</div>
      ) : entries.length === 0 ? (
        <div className="text-[13px] text-muted-foreground py-8 text-center">
          No log entries yet. Entries appear when the channel starts, receives messages, or errors.
        </div>
      ) : (
        <div className="font-mono text-[11px] space-y-0.5 min-h-[200px] max-h-[60vh] overflow-y-auto">
          {entries.map((e, i) => (
            <div
              key={`${e.ts}-${String(i)}`}
              className="flex gap-2 items-start hover:bg-secondary/30 px-1 py-0.5 rounded"
            >
              <span className="text-muted-foreground shrink-0 whitespace-nowrap">
                {new Date(e.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
              <span className={cn("shrink-0 uppercase w-10", levelColor(e.level))}>{e.level}</span>
              <span className="text-muted-foreground shrink-0 truncate max-w-[140px]" title={e.component}>[{e.component}]</span>
              <span className={cn("flex-1 break-all", levelColor(e.level))}>{e.msg}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// ChannelChatsTab — conversation history for a channel
// ---------------------------------------------------------------------------

function formatChatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" }) + " " +
    d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const CHATS_PAGE = 50;

function ChannelChatsTab({ channelId }: { channelId: string }) {
  const [entries, setEntries] = useState<CommsLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (off: number) => {
    setLoading(true);
    try {
      const res = await fetchCommsLog({ channel: channelId, limit: CHATS_PAGE, offset: off });
      setEntries(res.entries);
      setTotal(res.total);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [channelId]);

  useEffect(() => { void load(offset); }, [load, offset]);

  const hasMore = offset + CHATS_PAGE < total;

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[13px] font-semibold text-foreground">Chat History</span>
        <span className="text-[12px] text-muted-foreground">{total} message{total !== 1 ? "s" : ""}</span>
      </div>

      {error !== null && <div className="text-[12px] text-red mb-2">{error}</div>}

      {loading && entries.length === 0 ? (
        <div className="text-[13px] text-muted-foreground py-8 text-center">Loading…</div>
      ) : entries.length === 0 ? (
        <div className="text-[13px] text-muted-foreground py-8 text-center">
          No messages yet. Start the channel to begin receiving messages.
        </div>
      ) : (
        <div className="space-y-2 max-h-[520px] overflow-y-auto">
          {entries.map((entry) => {
            const isInbound = entry.direction === "inbound";
            return (
              <div
                key={entry.id}
                className={cn(
                  "flex flex-col max-w-[80%] gap-0.5",
                  isInbound ? "items-start self-start" : "items-end self-end ml-auto",
                )}
              >
                <div className="flex items-center gap-1.5 px-1">
                  <span className="text-[10px] text-muted-foreground">
                    {isInbound ? (entry.senderName ?? entry.senderId) : "Aion"}
                  </span>
                  <span className="text-[10px] text-muted-foreground">·</span>
                  <span className="text-[10px] text-muted-foreground">{formatChatTime(entry.createdAt)}</span>
                </div>
                <div
                  className={cn(
                    "px-3 py-2 rounded-xl text-[12px] leading-snug",
                    isInbound
                      ? "bg-secondary text-foreground rounded-tl-sm"
                      : "bg-primary text-primary-foreground rounded-tr-sm",
                  )}
                >
                  {entry.subject !== null && (
                    <div className="font-medium text-[11px] mb-0.5 opacity-80">{entry.subject}</div>
                  )}
                  {entry.preview}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {(offset > 0 || hasMore) && (
        <div className="flex gap-2 justify-center mt-3">
          <Button variant="outline" size="xs" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - CHATS_PAGE))}>
            Previous
          </Button>
          <span className="text-[11px] text-muted-foreground self-center">
            {offset + 1}–{Math.min(offset + CHATS_PAGE, total)} of {total}
          </span>
          <Button variant="outline" size="xs" disabled={!hasMore} onClick={() => setOffset(offset + CHATS_PAGE)}>
            Next
          </Button>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// ChannelDetailPanel — per-channel config (mode + memory scope + prompt override)
// ---------------------------------------------------------------------------

interface ChannelDetailPanelProps {
  channel: DiscordChannelDescriptor;
  mode: DiscordChannelMode;
  extConfig: ChannelExtConfig;
  onModeChange: (mode: DiscordChannelMode) => void;
  onExtConfigChange: (cfg: ChannelExtConfig) => void;
  onClose: () => void;
}

function ChannelDetailPanel({ channel, mode, extConfig, onModeChange, onExtConfigChange, onClose }: ChannelDetailPanelProps) {
  const memScope = extConfig.memoryScope ?? {};
  const memoryDefaults: Record<string, boolean> = { channel: true, server: true, user: true, thread: false };

  function toggleMemory(key: keyof NonNullable<ChannelExtConfig["memoryScope"]>) {
    const current = memScope[key] ?? memoryDefaults[key] ?? true;
    onExtConfigChange({ ...extConfig, memoryScope: { ...memScope, [key]: !current } });
  }

  const memoryTiles = [
    { key: "channel" as const, label: "Channel memory", sub: "Last 1,000 msgs" },
    { key: "server"  as const, label: "Server memory",  sub: "Cross-channel, shared" },
    { key: "user"    as const, label: "User memory",    sub: "Per-user profile + history" },
    { key: "thread"  as const, label: "Thread memory",  sub: "Isolated per-thread" },
  ];

  return (
    <Card className="p-4 flex flex-col gap-4 overflow-y-auto max-h-[520px]">
      {/* Header */}
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-semibold text-foreground flex-1 min-w-0 truncate">
          <span className="text-muted-foreground mr-1 select-none">{channel.kind === "forum" ? "§" : "#"}</span>
          {channel.name}
        </span>
        <ChannelModeBadge mode={mode} size="sm" />
        <button
          type="button"
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground transition-colors shrink-0 w-5 h-5 flex items-center justify-center rounded text-[13px]"
          title="Close"
        >
          ✕
        </button>
      </div>

      {/* Mode picker — full descriptive cards */}
      <div>
        <div className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Mode</div>
        <div className="grid grid-cols-2 gap-1.5">
          {CHANNEL_MODES.map((m) => {
            const meta = CHANNEL_MODE_META[m];
            const active = mode === m;
            return (
              <button
                key={m}
                type="button"
                onClick={() => onModeChange(m)}
                className={cn(
                  "text-left p-2.5 rounded-lg border transition-all",
                  active ? meta.badge : "border-border hover:bg-secondary/40 hover:border-border/80",
                )}
              >
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", meta.dot)} />
                  <span className="text-[11px] font-semibold">{meta.label}</span>
                </div>
                <p className="text-[10.5px] leading-snug text-muted-foreground">{meta.description}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Memory scope */}
      <div>
        <div className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Memory scope</div>
        <div className="grid grid-cols-2 gap-1.5">
          {memoryTiles.map(({ key, label, sub }) => {
            const on = memScope[key] ?? memoryDefaults[key] ?? true;
            return (
              <button
                key={key}
                type="button"
                onClick={() => toggleMemory(key)}
                className={cn(
                  "text-left p-2.5 rounded-lg border transition-colors",
                  on ? "bg-violet-500/10 border-violet-500/25" : "border-border hover:bg-secondary/40",
                )}
              >
                <div className="flex items-center gap-1.5">
                  <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", on ? "bg-violet-400" : "bg-zinc-500 opacity-50")} />
                  <span className="text-[11px] font-semibold text-foreground">{label}</span>
                </div>
                <p className="text-[10.5px] text-muted-foreground mt-0.5">{sub}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Prompt addendum */}
      <div>
        <div className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Prompt addendum</div>
        <textarea
          value={extConfig.promptAddendum ?? ""}
          onChange={(e) => onExtConfigChange({ ...extConfig, promptAddendum: e.target.value })}
          placeholder={"Channel-specific context appended to Aion's base identity (optional)…\nAion's core is unchanged — this text is added at the end of the system prompt."}
          rows={4}
          className="w-full rounded-lg border border-border bg-input text-[12px] text-foreground placeholder:text-muted-foreground/50 px-3 py-2 font-mono resize-y focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// DiscordServerPanel — visual guild/channel/role manager
// ---------------------------------------------------------------------------

interface DiscordServerPanelProps {
  channelId: string;
  cfgResponse: ChannelConfigResponse | null;
  enabled: boolean;
  channelStatus?: string;
  onSaved: () => void;
}

function DiscordServerPanel({ channelId, cfgResponse, enabled, channelStatus, onSaved }: DiscordServerPanelProps) {
  const [discordState, setDiscordState] = useState<DiscordStateDescriptor | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [selectedGuildId, setSelectedGuildId] = useState<string | null>(null);
  const [channelModes, setChannelModes] = useState<Record<string, DiscordChannelMode>>({});
  const [allowedRoleSet, setAllowedRoleSet] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [channelConfigs, setChannelConfigs] = useState<Record<string, ChannelExtConfig>>({});
  const guildInitialized = useRef(false);

  // Initialise modes + roles from current config whenever cfgResponse arrives.
  // Prefer the unified `channelModes` JSON map (supports all 6 modes);
  // fall back to legacy allowedChannelIds / presenceChannelIds for older configs.
  useEffect(() => {
    if (!cfgResponse) return;
    const c = cfgResponse.config;
    const modeJson = c["channelModes"];
    if (modeJson && typeof modeJson === "string") {
      try {
        setChannelModes(JSON.parse(modeJson) as Record<string, DiscordChannelMode>);
      } catch {
        // fall through to legacy
      }
    } else {
      const respondIds = parseIds(c["allowedChannelIds"]);
      const monitorIds = parseIds(c["presenceChannelIds"]);
      const modes: Record<string, DiscordChannelMode> = {};
      for (const id of respondIds) modes[id] = "respond";
      for (const id of monitorIds) modes[id] = "monitor";
      setChannelModes(modes);
    }
    setAllowedRoleSet(new Set(parseIds(c["allowedRoleIds"])));
    const cfgJson = c["channelConfig"];
    if (cfgJson && typeof cfgJson === "string") {
      try { setChannelConfigs(JSON.parse(cfgJson) as Record<string, ChannelExtConfig>); } catch { /* ignore */ }
    }
  }, [cfgResponse]);

  const loadState = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch("/api/channels/discord/state");
      if (!res.ok) throw new Error(`HTTP ${String(res.status)}`);
      const data = (await res.json()) as DiscordStateDescriptor;
      setDiscordState(data);
      if (!guildInitialized.current && data.guilds.length > 0) {
        setSelectedGuildId(data.guilds[0].id);
        guildInitialized.current = true;
      }
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadState(); }, [loadState]);

  const selectedGuild =
    discordState?.guilds.find((g) => g.id === selectedGuildId) ?? discordState?.guilds[0];

  function setMode(chId: string, mode: DiscordChannelMode) {
    setChannelModes((prev) => {
      const next = { ...prev };
      if (mode === "off") {
        delete next[chId];
      } else {
        next[chId] = mode;
      }
      return next;
    });
  }

  function toggleRole(roleId: string) {
    setAllowedRoleSet((prev) => {
      const next = new Set(prev);
      if (next.has(roleId)) next.delete(roleId);
      else next.add(roleId);
      return next;
    });
  }

  const handleSave = async () => {
    if (!cfgResponse) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      // Write unified mode map (all 6 modes) + keep legacy keys for bot compat.
      const respondIds = Object.entries(channelModes).filter(([, m]) => m === "respond").map(([id]) => id);
      const monitorIds = Object.entries(channelModes).filter(([, m]) => m === "monitor").map(([id]) => id);
      const config: Record<string, unknown> = {
        ...cfgResponse.config,
        channelModes: JSON.stringify(channelModes),
        channelConfig: JSON.stringify(channelConfigs),
        allowedChannelIds: respondIds.join(","),
        presenceChannelIds: monitorIds.join(","),
        allowedRoleIds: [...allowedRoleSet].join(","),
      };
      await updateChannelConfig(channelId, { enabled, config });
      if (channelStatus === "running") {
        await restartChannel(channelId);
        setSaveMsg("Saved and restarted.");
      } else {
        setSaveMsg("Saved.");
      }
      onSaved();
    } catch (e) {
      setSaveMsg(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  function roleColor(color: number): string | undefined {
    if (color === 0) return undefined;
    return `#${color.toString(16).padStart(6, "0")}`;
  }

  // Group channels by parent category for nested display
  function groupChannels(channels: DiscordChannelDescriptor[]) {
    const groups: Array<{ parent?: string; channels: DiscordChannelDescriptor[] }> = [];
    const seen = new Map<string | undefined, DiscordChannelDescriptor[]>();
    for (const ch of channels.filter((c) => c.kind !== "voice")) {
      const key = ch.parent;
      if (!seen.has(key)) {
        const arr: DiscordChannelDescriptor[] = [];
        seen.set(key, arr);
        groups.push({ parent: key, channels: arr });
      }
      seen.get(key)!.push(ch);
    }
    return groups;
  }

  if (loading) {
    return <div className="text-[13px] text-muted-foreground py-8 text-center">Loading Discord server data…</div>;
  }

  if (fetchError !== null) {
    return (
      <div className="space-y-3">
        <div className="text-[13px] text-destructive">Failed to load Discord state: {fetchError}</div>
        <Button variant="outline" size="xs" onClick={() => void loadState()}>Retry</Button>
      </div>
    );
  }

  if (discordState === null || !discordState.connected || discordState.guilds.length === 0) {
    return (
      <Card className="p-6 text-center text-[13px] text-muted-foreground">
        {discordState?.connected === false
          ? "Bot is not connected. Start the Discord channel to manage server settings."
          : "No servers found. Make sure the bot has been invited to your server."}
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Guild header + selector */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {discordState.guilds.length > 1 ? (
            <select
              value={selectedGuildId ?? ""}
              onChange={(e) => setSelectedGuildId(e.target.value)}
              className="h-8 px-2 rounded-lg border border-input bg-background text-[13px] text-foreground"
            >
              {discordState.guilds.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          ) : (
            <span className="text-[13px] font-semibold text-foreground">{selectedGuild?.name}</span>
          )}
          {selectedGuild?.memberCount !== undefined && (
            <span className="text-[12px] text-muted-foreground">
              {selectedGuild.memberCount.toLocaleString()} members
            </span>
          )}
          {discordState.user && (
            <span className="text-[11px] text-muted-foreground ml-2">
              Bot: <span className="font-mono">{discordState.user.tag}</span>
            </span>
          )}
        </div>
        <Button variant="outline" size="xs" onClick={() => void loadState()}>Refresh</Button>
      </div>

      {/* Owner designation — which Discord user is #E0 (Wave 1d). */}
      <DiscordOwnerCard />

      {selectedGuild && (
        <div className="grid grid-cols-[1fr_260px] gap-4">

          {/* Channels panel */}
          <Card className="p-4 space-y-3">
            <div>
              <span className="text-[13px] font-semibold text-foreground">Channels</span>
              <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5">
                {CHANNEL_MODES.map((m) => (
                  <span key={m} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <ChannelModeBadge mode={m} size="xs" />
                    <span className="hidden sm:inline">{CHANNEL_MODE_META[m].description}</span>
                  </span>
                ))}
              </div>
            </div>
            <div className="space-y-4 max-h-[480px] overflow-y-auto pr-1">
              {groupChannels(selectedGuild.channels).map(({ parent, channels: chs }) => (
                <div key={parent ?? "__root__"}>
                  {parent !== undefined && (
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 px-2">
                      {parent}
                    </div>
                  )}
                  <div className="space-y-0.5">
                    {chs.map((ch) => {
                      const mode: DiscordChannelMode = channelModes[ch.id] ?? "off";
                      const isSelected = selectedChannelId === ch.id;
                      return (
                        <div
                          key={ch.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => setSelectedChannelId(isSelected ? null : ch.id)}
                          onKeyDown={(e) => e.key === "Enter" && setSelectedChannelId(isSelected ? null : ch.id)}
                          className={cn(
                            "flex items-center justify-between gap-2 py-1.5 px-2 rounded cursor-pointer transition-colors",
                            isSelected
                              ? "bg-primary/10 ring-1 ring-primary/20"
                              : "hover:bg-secondary/40",
                          )}
                        >
                          <span className={cn("text-[13px] truncate flex-1 min-w-0", isSelected ? "text-primary font-medium" : "text-foreground")}>
                            <span className="text-muted-foreground mr-1 select-none">
                              {ch.kind === "forum" ? "§" : "#"}
                            </span>
                            {ch.name}
                          </span>
                          <ChannelModeBadge mode={mode} size="xs" showDot={mode !== "off"} />
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Right panel — channel detail when selected, roles otherwise */}
          {selectedChannelId !== null && selectedGuild.channels.some((c) => c.id === selectedChannelId) ? (
            <ChannelDetailPanel
              channel={selectedGuild.channels.find((c) => c.id === selectedChannelId)!}
              mode={channelModes[selectedChannelId] ?? "off"}
              extConfig={channelConfigs[selectedChannelId] ?? {}}
              onModeChange={(m) => setMode(selectedChannelId, m)}
              onExtConfigChange={(cfg) => setChannelConfigs((prev) => ({ ...prev, [selectedChannelId]: cfg }))}
              onClose={() => setSelectedChannelId(null)}
            />
          ) : (
            <Card className="p-4 space-y-3">
              <div>
                <span className="text-[13px] font-semibold text-foreground">Roles</span>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Checked roles can interact with Aion. Empty = all roles allowed.
                </p>
              </div>
              <div className="space-y-0.5 max-h-[480px] overflow-y-auto">
                {selectedGuild.roles
                  .filter((r) => !r.managed)
                  .map((role) => {
                    const color = roleColor(role.color);
                    const checked = allowedRoleSet.has(role.id);
                    return (
                      <label
                        key={role.id}
                        className="flex items-center gap-2 py-1 px-2 rounded hover:bg-secondary/40 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleRole(role.id)}
                          className="accent-emerald-500 shrink-0"
                        />
                        <span
                          className="text-[13px] truncate"
                          style={color !== undefined ? { color } : undefined}
                        >
                          {role.name}
                        </span>
                      </label>
                    );
                  })}
                {selectedGuild.roles.filter((r) => !r.managed).length === 0 && (
                  <p className="text-[12px] text-muted-foreground py-2 px-2">
                    No assignable roles found in this server.
                  </p>
                )}
              </div>
              <p className="text-[10.5px] text-muted-foreground border-t border-border pt-2">
                Click a channel to configure its mode, memory scope, and prompt.
              </p>
            </Card>
          )}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={() => { void handleSave(); }}
          disabled={saving || cfgResponse === null}
          className="px-4 py-1.5 rounded-lg text-[13px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {saveMsg !== null && (
          <span className={`text-[12px] ${saveMsg.startsWith("Error") ? "text-destructive" : "text-emerald-400"}`}>
            {saveMsg}
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DiscordSettingsPanel — guided setup form for the Discord channel
// ---------------------------------------------------------------------------

interface DiscordSettingsPanelProps {
  form: Record<string, string>;
  onChange: (form: Record<string, string>) => void;
}

function DiscordSettingsPanel({ form, onChange }: DiscordSettingsPanelProps) {
  const hasToken = Boolean(form.botToken?.trim());
  const mentionOnly = form.mentionOnly === "true";
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <div className="space-y-4">
      {!hasToken && (
        <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-4">
          <p className="text-[13px] font-semibold text-foreground mb-3">Connect Aion to Discord</p>
          <ol className="space-y-2 text-[12px] text-muted-foreground list-decimal list-inside">
            <li>Go to <strong>discord.com/developers/applications</strong> and create a new application</li>
            <li>Open the <strong>Bot</strong> tab → click <strong>Reset Token</strong> → copy the token</li>
            <li>Paste the token into <strong>Bot Token</strong> below, then click <strong>Save</strong></li>
            <li>
              Under <strong>OAuth2 → URL Generator</strong>, select the <code>bot</code> scope +{" "}
              <code>Send Messages</code> and <code>Read Message History</code> permissions → copy the
              URL → open it to invite Aion to your server
            </li>
            <li>Come back here and click <strong>Start</strong></li>
          </ol>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <label data-testid="discord-bot-token-label" className="text-[12px] font-medium text-muted-foreground">Bot Token</label>
        <input
          type="password"
          value={form.botToken ?? ""}
          onChange={(e) => onChange({ ...form, botToken: e.target.value })}
          autoComplete="off"
          placeholder="••••••••"
          className="h-8 px-3 rounded-lg border border-input bg-background text-[13px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <p className="text-[11px] text-muted-foreground">
          From Discord Developer Portal → Your App → Bot → Reset Token
        </p>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-[12px] font-medium text-muted-foreground">Application ID</label>
        <input
          type="text"
          value={form.applicationId ?? ""}
          onChange={(e) => onChange({ ...form, applicationId: e.target.value })}
          autoComplete="off"
          className="h-8 px-3 rounded-lg border border-input bg-background text-[13px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <p className="text-[11px] text-muted-foreground">
          Optional. From Developer Portal → Your App → General Information. Required only for slash commands.
        </p>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-[12px] font-medium text-muted-foreground">Respond only when @mentioned</span>
          <span className="text-[11px] text-muted-foreground">
            When on, Aion replies only when @mentioned. Turn off to respond to all messages in channels
            where Aion has Respond mode.
          </span>
        </div>
        <button
          type="button"
          onClick={() => onChange({ ...form, mentionOnly: mentionOnly ? "false" : "true" })}
          className={`relative shrink-0 w-9 h-5 rounded-full transition-colors ${mentionOnly ? "bg-emerald-500" : "bg-secondary"}`}
          aria-label="Toggle respond only when mentioned"
        >
          <span
            className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${mentionOnly ? "left-[18px] bg-white" : "left-0.5 bg-muted-foreground"}`}
          />
        </button>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-[12px] font-medium text-muted-foreground">Rate limit (messages/min)</label>
        <input
          type="number"
          min="1"
          max="1000"
          value={form.rateLimitPerMinute ?? ""}
          onChange={(e) => onChange({ ...form, rateLimitPerMinute: e.target.value })}
          className="h-8 px-3 rounded-lg border border-input bg-background text-[13px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring w-32"
        />
        <p className="text-[11px] text-muted-foreground">
          Max messages per user per minute before Aion pauses responses. Default: 20.
        </p>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Channel presence, role permissions, and per-channel modes are managed in the <strong>Server</strong> tab.
      </p>

      {/* Advanced — collapsed by default, rarely needed */}
      <div className="border-t border-border/40 pt-3">
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <span className={`transition-transform ${showAdvanced ? "rotate-90" : ""}`}>▶</span>
          Advanced
        </button>
        {showAdvanced && (
          <div className="mt-3 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-[12px] font-medium text-muted-foreground">Server Members Intent</span>
                <p className="text-[11px] text-muted-foreground max-w-[320px]">
                  Required for member sync and role-based access. You must first enable{" "}
                  <strong>Server Members Intent</strong> in the Discord Developer Portal → Bot →
                  Privileged Gateway Intents — without that, enabling this will prevent the bot
                  from connecting (error 4014).
                </p>
              </div>
              <button
                type="button"
                onClick={() => onChange({ ...form, enableServerMembersIntent: String(form.enableServerMembersIntent !== "true") })}
                className={`relative shrink-0 w-9 h-5 rounded-full transition-colors ${form.enableServerMembersIntent === "true" ? "bg-primary" : "bg-muted"}`}
                role="switch"
                aria-checked={form.enableServerMembersIntent === "true"}
              >
                <span className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${form.enableServerMembersIntent === "true" ? "left-[18px] bg-white" : "left-0.5 bg-muted-foreground"}`} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChannelTab — config + controls for one channel
// ---------------------------------------------------------------------------

interface ChannelTabProps {
  id: string;
  initialEnabled: boolean;
}

function ChannelTab({ id, initialEnabled: _initialEnabled }: ChannelTabProps) {
  const [detail, setDetail] = useState<ChannelDetail | null>(null);
  const [cfgResponse, setCfgResponse] = useState<ChannelConfigResponse | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [controlling, setControlling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Discord-specific: live WS connection state from /api/channels/discord/state
  const [discordState, setDiscordState] = useState<DiscordStateDescriptor | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const discordPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [det, cfg] = await Promise.all([
        fetchChannelDetail(id),
        fetchChannelConfig(id),
      ]);
      setDetail(det);
      setCfgResponse(cfg);
      // Only include scalar (non-object) values in the form — object/array fields
      // (memory, tools, autoMod, etc.) are owned by specialised UIs and must not
      // be coerced to "[object Object]" strings here.
      const merged: Record<string, string> = {};
      for (const key of Object.keys(cfg.defaults)) {
        const val = cfg.config[key];
        if (val === undefined || val === null) {
          merged[key] = "";
        } else if (typeof val !== "object") {
          merged[key] = String(val);
        }
      }
      for (const key of Object.keys(cfg.config)) {
        if (key in merged) continue;
        const val = cfg.config[key];
        if (val !== undefined && val !== null && typeof val === "object") continue;
        merged[key] = val !== undefined && val !== null ? String(val) : "";
      }
      setForm(merged);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [id]);

  useEffect(() => {
    loadData();
    pollRef.current = setInterval(() => {
      fetchChannelDetail(id).then(setDetail).catch(() => {});
    }, 5_000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [id, loadData]);

  // Discord WS connection state — independent poll at 3s so the indicator
  // is always current without waiting for the 5s registry poll to tick.
  useEffect(() => {
    if (id !== "discord") return;
    const poll = () => {
      fetch("/api/channels/discord/state")
        .then((r) => r.json() as Promise<DiscordStateDescriptor>)
        .then(setDiscordState)
        .catch(() => {});
    };
    poll();
    discordPollRef.current = setInterval(poll, 3_000);
    return () => {
      if (discordPollRef.current) clearInterval(discordPollRef.current);
    };
  }, [id]);

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      // Preserve non-scalar fields (owned by other UIs), overlay scalar form values on top.
      const config: Record<string, unknown> = { ...cfgResponse?.config };
      for (const [k, v] of Object.entries(form)) {
        config[k] = v;
      }
      // Preserve the existing enabled state — Start/Stop buttons own that flag.
      await updateChannelConfig(id, { enabled: cfgResponse?.enabled ?? true, config });

      if (detail?.status === "running") {
        await restartChannel(id);
      } else {
        await startChannel(id);
      }

      if (id === "discord") {
        setSaveMsg("Connecting...");
        const deadline = Date.now() + 20_000;
        let finalMsg = "Saved — check status indicator";
        while (Date.now() < deadline) {
          await new Promise<void>((r) => setTimeout(r, 1_500));
          try {
            const r = await fetch("/api/channels/discord/state");
            const state = await (r.json() as Promise<DiscordStateDescriptor>);
            if (state.connected) { finalMsg = "Saved — bot connected ✓"; break; }
            const det = await fetchChannelDetail(id);
            setDetail(det);
            if (det.status === "error") { finalMsg = `Error: ${det.error ?? "connection failed"}`; break; }
          } catch { break; }
        }
        setSaveMsg(finalMsg);
      } else {
        setSaveMsg("Saved and restarted.");
      }
      void loadData();
    } catch (err) {
      setSaveMsg(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleControl = async (action: "start" | "stop" | "restart") => {
    setControlling(true);
    try {
      if (action === "start") await startChannel(id);
      else if (action === "stop") await stopChannel(id);
      else await restartChannel(id);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setControlling(false);
    }
  };

  const registryStatus = detail?.status ?? "stopped";

  // For Discord, derive the displayed status from the live WS state poll, not
  // the registry. "running" in the registry only means login was initiated;
  // "connected" means the bot received READY and is online in Discord.
  const isDiscord = id === "discord";
  const discordConnected = discordState?.connected ?? false;
  const displayStatus = isDiscord
    ? registryStatus === "running"
      ? (discordConnected ? "running" : "starting")
      : registryStatus
    : registryStatus;

  const fieldKeys = cfgResponse
    ? [...new Set([...Object.keys(cfgResponse.defaults), ...Object.keys(cfgResponse.config)])]
    : [];

  const statusDot =
    displayStatus === "running" ? "bg-emerald-500" :
    displayStatus === "starting" || displayStatus === "stopping" ? "bg-amber-400 animate-pulse" :
    displayStatus === "error" ? "bg-red-500" : "bg-secondary";

  const statusText =
    displayStatus === "running" ? (isDiscord ? "Connected" : "Running") :
    displayStatus === "starting" ? (isDiscord ? "Connecting..." : "Starting...") :
    displayStatus === "stopping" ? "Stopping..." :
    displayStatus === "error" ? "Error" : "Stopped";

  return (
    <div className="space-y-4">
      {/* Status + controls — always visible above the inner tabs */}
      <Card className="p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${statusDot}`} />
            <span className="text-[13px] font-medium">{statusText}</span>
          </div>
          {detail?.error && (
            <span className="text-[12px] text-destructive truncate max-w-xs">{detail.error}</span>
          )}
          {error && (
            <span className="text-[12px] text-destructive truncate max-w-xs">{error}</span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => handleControl("start")}
              disabled={controlling || registryStatus === "running"}
              className="px-3 py-1.5 rounded-lg text-[12px] font-medium bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Start
            </button>
            <button
              onClick={() => handleControl("stop")}
              disabled={controlling || registryStatus !== "running"}
              className="px-3 py-1.5 rounded-lg text-[12px] font-medium bg-secondary text-foreground hover:bg-secondary/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Stop
            </button>
            <button
              onClick={() => handleControl("restart")}
              disabled={controlling || registryStatus !== "running"}
              className="px-3 py-1.5 rounded-lg text-[12px] font-medium bg-secondary text-foreground hover:bg-secondary/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Restart
            </button>
          </div>
        </div>
      </Card>

      {/* Inner tabs: Settings / Server (Discord only) / Chats / Log */}
      <Tabs defaultValue="settings">
        <TabsList className="mb-3">
          <TabsTrigger value="settings">Settings</TabsTrigger>
          {id === "discord" && <TabsTrigger value="server">Server</TabsTrigger>}
          <TabsTrigger value="chats">Chats</TabsTrigger>
          <TabsTrigger value="log">Log</TabsTrigger>
        </TabsList>

        {id === "discord" && (
          <TabsContent value="server">
            <DiscordServerPanel
              channelId={id}
              cfgResponse={cfgResponse}
              enabled={cfgResponse?.enabled ?? true}
              channelStatus={registryStatus}
              onSaved={loadData}
            />
          </TabsContent>
        )}

        <TabsContent value="settings">
          <div className="space-y-5">
            {/* Config form */}
            <Card className="p-5 space-y-4">
              <h3 className="text-[13px] font-semibold text-foreground">Configuration</h3>

              {cfgResponse === null ? (
                <p className="text-[13px] text-muted-foreground">Loading configuration…</p>
              ) : id === "discord" ? (
                <DiscordSettingsPanel form={form} onChange={setForm} />
              ) : fieldKeys.length === 0 ? (
                <p className="text-[13px] text-muted-foreground">No configuration fields for this channel.</p>
              ) : (
                <div className="grid grid-cols-1 gap-3">
                  {fieldKeys.map((key) => (
                    <div key={key} className="flex flex-col gap-1">
                      <label className="text-[12px] font-medium text-muted-foreground">{fieldLabel(key)}</label>
                      <input
                        type={isSensitive(key) ? "password" : "text"}
                        value={form[key] ?? ""}
                        onChange={(e) => setForm((prev) => ({ ...prev, [key]: e.target.value }))}
                        autoComplete="off"
                        className="h-8 px-3 rounded-lg border border-input bg-background text-[13px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                        placeholder={isSensitive(key) ? "••••••••" : ""}
                      />
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-3 pt-1">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-4 py-1.5 rounded-lg text-[13px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
                {saveMsg && (
                  <span className={`text-[12px] ${saveMsg.startsWith("Error") ? "text-destructive" : "text-emerald-400"}`}>
                    {saveMsg}
                  </span>
                )}
                {registryStatus === "running" && !saveMsg && (
                  <span className="text-[11px] text-muted-foreground">
                    Saving will restart the channel to apply new credentials.
                  </span>
                )}
              </div>
            </Card>

            <WorkflowBindingsBlock channelId={id} />
          </div>
        </TabsContent>

        <TabsContent value="chats">
          <ChannelChatsTab channelId={id} />
        </TabsContent>

        <TabsContent value="log">
          <ChannelLogTab channelId={id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SettingsChannelsPage() {
  const [channels, setChannels] = useState<ChannelListEntry[] | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    fetchChannels()
      .then(setChannels)
      .catch((err) => setFetchError(err instanceof Error ? err.message : String(err)));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">Channel Settings</h1>
        <p className="text-[13px] text-muted-foreground mt-1">
          Configure authentication and options for each communication channel plugin.
        </p>
      </div>

      <DevNote title="Channels">
        <DevNote.Item kind="info" heading="Cycle 223 — Settings page">
          Channels moved from the Comms hub to a dedicated settings page. Each installed
          channel plugin gets its own tab. Channel list is fully plugin-driven (no hardcoded
          IDs) — derived from discoveredPlugins. Config persists to gateway.json via PATCH
          /api/channels/:id/config; a running channel is automatically restarted on save
          so new credentials take effect immediately.
        </DevNote.Item>
        <DevNote.Item kind="info" heading="Cycle 262 — Workflow bindings moved here">
          WorkflowBindingsBlock migrated from the old Gateway → Channels tab (removed).
          Every channel tab now shows its own workflow bindings below the config form.
          The Gateway settings Channels tab has been removed — this page is the canonical home.
        </DevNote.Item>
        <DevNote.Item kind="info" heading="Cycle 270 — Log + Chats tabs per channel">
          Each channel now has Settings / Chats / Log inner tabs. Log shows live gateway
          operational entries filtered to the channel (auto-refreshes every 5s). Chats shows
          the conversation history as chat bubbles (inbound left, outbound right) with pagination.
          Backend: GET /api/channels/:id/ops-log backed by an in-process log ring buffer.
        </DevNote.Item>
        <DevNote.Item kind="info" heading="Discord server management panel">
          Discord channel tab gains a &quot;Server&quot; inner tab. Fetches live guild data from
          /api/channels/discord/state (guilds, channels with category grouping, roles). Each channel
          has Off / Monitor / Respond radio toggles: Monitor = Aion reads all messages for context
          but never responds; Respond = full AI routing. Each non-managed role has a &quot;Can
          interact&quot; checkbox (empty = all roles allowed). The four array config fields
          (allowedChannelIds, presenceChannelIds, allowedRoleIds, allowedGuildIds) are hidden from
          the generic Settings form and managed exclusively through the Server panel.
        </DevNote.Item>
        <DevNote.Item kind="fix" heading="Discord auto-start + settings take effect immediately">
          Two related fixes: (1) Discord now auto-connects after every upgrade without requiring
          manual Start — the v2 startup path starts the legacy channel after login so the registry
          status updates to &quot;running&quot; and the filtered inbound route (mentionOnly, allowedChannelIds,
          allowedRoleIds) is wired automatically. (2) Saving channel/role settings via the Server
          tab now triggers an immediate channel restart so config changes take effect without a
          manual restart.
        </DevNote.Item>
        <DevNote.Item kind="info" heading="Discord setup guide + UX overhaul">
          Discord Settings tab replaced with a guided DiscordSettingsPanel: numbered setup steps
          shown when botToken is empty, labeled fields with descriptions for botToken / applicationId
          / mentionOnly (now a toggle) / rateLimitPerMinute, and a status-bar warning when the
          process registry shows Running but the bot WebSocket is not actually connected to Discord.
          Log tab max-height changed from fixed 480px to 60 vh so it doesn&apos;t overflow the viewport.
        </DevNote.Item>
        <DevNote.Item kind="fix" heading="Discord GuildMembers intent — opt-in flag (v0.4.870)">
          GatewayIntentBits.GuildMembers is a privileged Discord intent requiring
          &quot;Server Members Intent&quot; to be enabled in the developer portal. It was
          previously hardcoded, causing 4014 Disallowed Intents on bots without the
          portal toggle → bot never connects. Now controlled by enableServerMembersIntent
          toggle in Settings (default off). Proactive member sync is also guarded by
          the same flag.
        </DevNote.Item>
        <DevNote.Item kind="info" heading="Discord reconnect + role access control + member registration">
          Three Discord improvements shipped together: (1) Discord now auto-reconnects after
          an AGI upgrade — the v2 channel protocol reuses the single shared discord.js Client
          (no more privileged-intent login failure) and gateway-core schedules exponential-backoff
          retries on start failure. (2) New &quot;Allowed Role Ids&quot; config field
          (comma-separated) — members without a matching role receive a DM and are blocked.
          (3) All guild members with an allowed role are auto-registered as pending AGI user
          accounts on every bot start; message senders are registered on first contact. Users
          appear in Settings → Users and can claim their dashboard access later.
        </DevNote.Item>
      </DevNote>

      {fetchError ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-[13px] text-destructive">
          {fetchError}
        </div>
      ) : channels === null ? (
        <div className="text-[13px] text-muted-foreground">Loading channels…</div>
      ) : channels.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-[14px] font-medium text-foreground">No channel plugins installed</p>
          <p className="text-[13px] text-muted-foreground mt-1">
            Install a channel plugin from the Plugin Marketplace to get started.
          </p>
        </Card>
      ) : (
        <Tabs defaultValue={channels[0].id}>
          <TabsList className="mb-4">
            {channels.map((ch) => (
              <TabsTrigger key={ch.id} value={ch.id}>
                <span className="flex items-center gap-1.5">
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${ch.status === "running" ? "bg-emerald-500" : ch.status === "error" ? "bg-red-500" : "bg-secondary"}`}
                  />
                  {ch.name ? shortName(ch.name) : ch.id}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
          {channels.map((ch) => (
            <TabsContent key={ch.id} value={ch.id}>
              <ChannelTab id={ch.id} initialEnabled={ch.enabled} />
            </TabsContent>
          ))}
        </Tabs>
      )}
    </div>
  );
}
