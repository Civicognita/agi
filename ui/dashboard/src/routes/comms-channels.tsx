/**
 * Channel Management — /comms/channels
 *
 * Per-channel behavioral config stored in gateway.json channels[].config.
 * All UI built on PAx/ADF primitives: Card, Switch, Progress, Slider,
 * Input, Textarea, Select, Avatar, Badge, Button from react-fancy.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Switch, Progress, Slider, Textarea, Badge,
  Avatar,
} from "@particle-academy/react-fancy";
import { Card, CardHeader, CardContent } from "@/components/ui/card.js";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { Select } from "@/components/ui/select.js";
import { cn } from "@/lib/utils";
import { PageScroll } from "@/components/PageScroll.js";
import {
  CHANNEL_MODES,
  CHANNEL_MODE_META,
  type DiscordChannelMode,
} from "@/components/ChannelModeBadge.js";
import {
  fetchChannels,
  fetchChannelConfig,
  updateChannelConfig,
  fetchCommsLog,
  fetchAgents,
  type ChannelListEntry,
} from "@/api.js";
import type { CommsLogEntry, AgentStatus } from "@/types.js";

// ---------------------------------------------------------------------------
// Behavior config — stored in gateway.json channels[].config blob
// ---------------------------------------------------------------------------

export interface MemoryScope {
  channel: boolean;
  server:  boolean;
  user:    boolean;
  thread:  boolean;
}

export interface AutoModConfig {
  toxicity:  number;
  spam:      number;
  pii:       number;
  jailbreak: number;
}

export interface EscalationRule {
  trigger: string;
  target:  string;
  live:    boolean;
}

export interface RateLimitConfig {
  repliesPerMin: boolean;
  tokensPerHour: boolean;
  userCooldown:  boolean;
  backoff:       boolean;
}

export interface RoleOverride {
  role:  string;
  allow: string;
}

export interface BehaviorConfig {
  mode:          DiscordChannelMode;
  memory:        MemoryScope;
  tools:         Record<string, boolean>;
  autoMod:       AutoModConfig;
  escalation:    EscalationRule[];
  promptSystem:  string;
  promptTone:    string;
  promptRefuse:  string[];
  promptTemp:    number;
  promptMaxTurn: number;
  roleOverrides: RoleOverride[];
  rateLimits:    RateLimitConfig;
  agentIds:      string[];
}

const TOOL_NAMES = [
  "memory.recall", "memory.write", "web.search",
  "discord.react", "discord.timeout", "discord.ban",
  "user.profile", "knowledge.query", "calendar.book",
  "code.run", "sentiment.score", "summarize.thread",
] as const;

const TOOL_LOCKED = new Set(["discord.ban", "code.run"]);

const DEFAULT_TOOLS: Record<string, boolean> = Object.fromEntries(
  TOOL_NAMES.map((n) => [
    n,
    ["memory.recall", "memory.write", "web.search", "discord.react",
     "user.profile", "knowledge.query", "sentiment.score", "summarize.thread"].includes(n),
  ]),
);

const DEFAULTS: BehaviorConfig = {
  mode: "respond",
  memory: { channel: true, server: true, user: true, thread: false },
  tools: DEFAULT_TOOLS,
  autoMod: { toxicity: 0.72, spam: 0.85, pii: 0.95, jailbreak: 0.78 },
  escalation: [],
  promptSystem: "You are Aion, the personal AI gateway. Help members of this channel.",
  promptTone: "warm, direct, no exclamation marks",
  promptRefuse: [],
  promptTemp: 0.4,
  promptMaxTurn: 6,
  roleOverrides: [],
  rateLimits: { repliesPerMin: true, tokensPerHour: true, userCooldown: true, backoff: false },
  agentIds: [],
};

function parseBehavior(raw: Record<string, unknown>): BehaviorConfig {
  const b = (v: unknown, fb: boolean) => typeof v === "boolean" ? v : fb;
  const n = (v: unknown, fb: number)  => typeof v === "number"  ? v : fb;
  const s = (v: unknown, fb: string)  => typeof v === "string"  ? v : fb;

  const mode = ((): DiscordChannelMode => {
    const m = raw["mode"] as string | undefined;
    return m && CHANNEL_MODES.includes(m as DiscordChannelMode) ? (m as DiscordChannelMode) : DEFAULTS.mode;
  })();

  const mem = (raw["memory"] ?? {}) as Partial<MemoryScope>;
  const am  = (raw["autoMod"] ?? {}) as Partial<AutoModConfig>;
  const rl  = (raw["rateLimits"] ?? {}) as Partial<RateLimitConfig>;

  const tools: Record<string, boolean> = { ...DEFAULT_TOOLS };
  const rawTools = (raw["tools"] ?? {}) as Record<string, unknown>;
  for (const k of TOOL_NAMES) { if (k in rawTools) tools[k] = b(rawTools[k], DEFAULT_TOOLS[k]); }

  const escalation: EscalationRule[] = Array.isArray(raw["escalation"])
    ? (raw["escalation"] as unknown[])
        .filter((e): e is EscalationRule =>
          e !== null && typeof e === "object" &&
          typeof (e as EscalationRule).trigger === "string" &&
          typeof (e as EscalationRule).target  === "string")
        .map((e) => ({ trigger: e.trigger, target: e.target, live: b(e.live, false) }))
    : DEFAULTS.escalation;

  const roleOverrides: RoleOverride[] = Array.isArray(raw["roleOverrides"])
    ? (raw["roleOverrides"] as unknown[])
        .filter((r): r is RoleOverride =>
          r !== null && typeof r === "object" &&
          typeof (r as RoleOverride).role  === "string" &&
          typeof (r as RoleOverride).allow === "string")
    : DEFAULTS.roleOverrides;

  const agentIds = Array.isArray(raw["agentIds"])
    ? (raw["agentIds"] as unknown[]).filter((id): id is string => typeof id === "string")
    : DEFAULTS.agentIds;

  const refuse = Array.isArray(raw["promptRefuse"])
    ? (raw["promptRefuse"] as unknown[]).filter((s): s is string => typeof s === "string")
    : DEFAULTS.promptRefuse;

  return {
    mode,
    tools,
    escalation,
    roleOverrides,
    agentIds,
    refuse,
    memory:   { channel: b(mem.channel, DEFAULTS.memory.channel), server: b(mem.server, DEFAULTS.memory.server), user: b(mem.user, DEFAULTS.memory.user), thread: b(mem.thread, DEFAULTS.memory.thread) },
    autoMod:  { toxicity: n(am.toxicity, DEFAULTS.autoMod.toxicity), spam: n(am.spam, DEFAULTS.autoMod.spam), pii: n(am.pii, DEFAULTS.autoMod.pii), jailbreak: n(am.jailbreak, DEFAULTS.autoMod.jailbreak) },
    rateLimits: { repliesPerMin: b(rl.repliesPerMin, DEFAULTS.rateLimits.repliesPerMin), tokensPerHour: b(rl.tokensPerHour, DEFAULTS.rateLimits.tokensPerHour), userCooldown: b(rl.userCooldown, DEFAULTS.rateLimits.userCooldown), backoff: b(rl.backoff, DEFAULTS.rateLimits.backoff) },
    promptSystem:  s(raw["promptSystem"],  DEFAULTS.promptSystem),
    promptTone:    s(raw["promptTone"],    DEFAULTS.promptTone),
    promptRefuse:  refuse,
    promptTemp:    n(raw["promptTemp"],    DEFAULTS.promptTemp),
    promptMaxTurn: n(raw["promptMaxTurn"], DEFAULTS.promptMaxTurn),
  } as BehaviorConfig;
}

function serializeBehavior(b: BehaviorConfig): Record<string, unknown> {
  return {
    mode: b.mode, memory: b.memory, tools: b.tools, autoMod: b.autoMod,
    escalation: b.escalation, rateLimits: b.rateLimits, roleOverrides: b.roleOverrides,
    agentIds: b.agentIds, promptSystem: b.promptSystem, promptTone: b.promptTone,
    promptRefuse: b.promptRefuse, promptTemp: b.promptTemp, promptMaxTurn: b.promptMaxTurn,
  };
}

// ---------------------------------------------------------------------------
// ConfigCard — Card + CardHeader + CardContent from PAx
// ---------------------------------------------------------------------------

function ConfigCard({ title, right, children, accent }: {
  title: string; right?: React.ReactNode; children: React.ReactNode; accent?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          {accent && <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", accent)} />}
          <span className="text-[11.5px] font-semibold flex-1 truncate">{title}</span>
          {right}
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// AgentAssignment — Avatar + Switch from PAx
// ---------------------------------------------------------------------------

function AgentAssignment({ agents, assignedIds, onChange }: {
  agents: AgentStatus[]; assignedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  if (agents.length === 0) {
    return <p className="text-[12px] text-muted-foreground py-2">No agents running.</p>;
  }
  return (
    <div className="divide-y divide-border">
      {agents.map((a) => {
        const assigned = assignedIds.includes(a.id);
        return (
          <div key={a.id} className="flex items-center gap-3 py-2">
            <Avatar
              fallback={a.name.slice(0, 2).toUpperCase()}
              size="sm"
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-[12.5px] font-semibold truncate">{a.name}</span>
                <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", a.status === "running" ? "bg-emerald-500" : "bg-zinc-500")} />
              </div>
              <div className="text-[11px] text-muted-foreground capitalize">{a.type} · {a.status}</div>
            </div>
            <Switch
              checked={assigned}
              onCheckedChange={(v) => onChange(v ? [...assignedIds, a.id] : assignedIds.filter((id) => id !== a.id))}
              color="violet"
              size="sm"
            />
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MemoryScope — custom toggle tiles (no PAx primitive for toggle-card-grid)
// ---------------------------------------------------------------------------

const MEMORY_OPTS: { key: keyof MemoryScope; label: string; sub: string }[] = [
  { key: "channel", label: "Channel memory", sub: "Last 1,000 msgs · 30d" },
  { key: "server",  label: "Server memory",  sub: "Cross-channel, shared" },
  { key: "user",    label: "User memory",    sub: "Per-user profile + history" },
  { key: "thread",  label: "Thread memory",  sub: "Per-thread isolated" },
];

function MemoryScopeCard({ value, onChange }: { value: MemoryScope; onChange: (v: MemoryScope) => void }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {MEMORY_OPTS.map(({ key, label, sub }) => {
          const on = value[key];
          return (
            <button
              key={key}
              type="button"
              onClick={() => onChange({ ...value, [key]: !on })}
              className={cn(
                "rounded-lg border px-3 py-2 text-left transition-colors",
                on ? "border-violet-500/25 bg-violet-500/5" : "border-border bg-secondary/20 hover:bg-secondary/40",
              )}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", on ? "bg-violet-400" : "bg-zinc-500")} />
                <span className="text-[12px] font-semibold">{label}</span>
              </div>
              <div className="text-[11px] text-muted-foreground">{sub}</div>
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[11px] text-muted-foreground">Expiration:</span>
        <Badge color="zinc" variant="soft" size="sm">rolling · 90d</Badge>
        <span className="text-[11px] text-muted-foreground">· PII:</span>
        <Badge color="green" variant="soft" size="sm">redacted</Badge>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ToolAccess — toggle-tag grid (no exact PAx primitive; Button ghost variant)
// ---------------------------------------------------------------------------

function ToolAccessCard({ tools, onChange }: { tools: Record<string, boolean>; onChange: (v: Record<string, boolean>) => void }) {
  const enabled = TOOL_NAMES.filter((n) => tools[n]).length;
  return (
    <div className="flex flex-wrap gap-1.5">
      {TOOL_NAMES.map((name) => {
        const on = tools[name] ?? false;
        const locked = TOOL_LOCKED.has(name);
        return (
          <button
            key={name}
            type="button"
            disabled={locked}
            onClick={() => !locked && onChange({ ...tools, [name]: !on })}
            className={cn(
              "inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] font-mono transition-colors",
              on ? "bg-sky-500/10 text-sky-500 border-sky-500/25 dark:text-sky-300"
                 : "bg-secondary/30 text-muted-foreground border-border/50 hover:border-border",
              locked && "opacity-40 cursor-not-allowed",
            )}
          >
            {name}
          </button>
        );
      })}
      <div className="w-full text-[10.5px] text-muted-foreground/60 mt-1">{enabled} of {TOOL_NAMES.length} enabled</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AutoMod — Slider from PAx (min=0, max=100, step=1; stored as 0-1)
// ---------------------------------------------------------------------------

const AUTO_MOD_ROWS: { key: keyof AutoModConfig; label: string; color: "amber" | "violet" | "green" | "rose" }[] = [
  { key: "toxicity",  label: "Toxicity threshold", color: "amber"  },
  { key: "spam",      label: "Spam detection",      color: "violet" },
  { key: "pii",       label: "PII redaction",       color: "green"  },
  { key: "jailbreak", label: "Jailbreak guard",     color: "rose"   },
];

function AutoModCard({ value, onChange }: { value: AutoModConfig; onChange: (v: AutoModConfig) => void }) {
  return (
    <div className="space-y-3">
      {AUTO_MOD_ROWS.map(({ key, label, color }) => (
        <div key={key} className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-foreground">{label}</span>
            <span className="text-[11px] font-mono text-muted-foreground">{value[key].toFixed(2)}</span>
          </div>
          <Slider
            min={0}
            max={100}
            step={1}
            value={Math.round(value[key] * 100)}
            onValueChange={(v) => onChange({ ...value, [key]: v / 100 })}
            size="sm"
          />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Escalation rules — Input from PAx
// ---------------------------------------------------------------------------

function EscalationCard({ rules, onChange }: { rules: EscalationRule[]; onChange: (v: EscalationRule[]) => void }) {
  return (
    <div className="space-y-2">
      {rules.length === 0 && (
        <p className="text-[12px] text-muted-foreground py-1">No rules yet. Add one to route flagged messages.</p>
      )}
      {rules.map((r, i) => (
        <div key={i} className={cn("rounded-lg border p-2.5 space-y-2", r.live ? "border-amber-500/25 bg-amber-500/5" : "border-border bg-secondary/10")}>
          <div className="flex items-center gap-2">
            <Input
              size="sm"
              placeholder="Trigger (e.g. sentiment < -0.6)"
              value={r.trigger}
              onChange={(e) => onChange(rules.map((x, j) => j === i ? { ...x, trigger: e.target.value } : x))}
              className="flex-1 font-mono text-[11.5px]"
            />
            <Button variant="ghost" size="icon-sm" onClick={() => onChange(rules.filter((_, j) => j !== i))} aria-label="Remove rule">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10.5px] text-muted-foreground shrink-0">→</span>
            <Input
              size="sm"
              placeholder="Target (e.g. @operator, #channel)"
              value={r.target}
              onChange={(e) => onChange(rules.map((x, j) => j === i ? { ...x, target: e.target.value } : x))}
              className="flex-1 text-[11px]"
            />
          </div>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        onClick={() => onChange([...rules, { trigger: "", target: "", live: false }])}
      >
        Add rule
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Prompt addendum — Textarea from PAx, Input for inline fields
// ---------------------------------------------------------------------------

function PromptCard({ system, tone, refuse, temp, maxTurn, onChange }: {
  system: string; tone: string; refuse: string[]; temp: number; maxTurn: number;
  onChange: (patch: Partial<Pick<BehaviorConfig, "promptSystem" | "promptTone" | "promptRefuse" | "promptTemp" | "promptMaxTurn">>) => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Channel addendum</div>
        <Textarea
          value={system}
          onChange={(e) => onChange({ promptSystem: e.target.value })}
          minRows={3}
          maxRows={6}
          className="font-mono text-[12px]"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Tone</div>
          <Input
            size="sm"
            value={tone}
            onChange={(e) => onChange({ promptTone: e.target.value })}
            placeholder="e.g. warm, direct"
          />
        </div>
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Refuse topics</div>
          <Input
            size="sm"
            value={refuse.join(", ")}
            onChange={(e) => onChange({ promptRefuse: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
            placeholder="comma-separated"
          />
        </div>
      </div>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground font-mono shrink-0">temp</span>
          <Input
            size="sm"
            type="number"
            min="0" max="2" step="0.1"
            value={temp}
            onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) onChange({ promptTemp: v }); }}
            className="w-16 font-mono"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground font-mono shrink-0">max_turn</span>
          <Input
            size="sm"
            type="number"
            min="1" max="20" step="1"
            value={maxTurn}
            onChange={(e) => { const v = parseInt(e.target.value, 10); if (!isNaN(v)) onChange({ promptMaxTurn: v }); }}
            className="w-16 font-mono"
          />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Role overrides — Input + Select from PAx
// ---------------------------------------------------------------------------

const ROLE_ALLOW_OPTIONS = ["all", "respond", "respond + memory", "monitor", "none"].map((v) => ({ value: v, label: v }));

function RoleOverridesCard({ roles, onChange }: { roles: RoleOverride[]; onChange: (v: RoleOverride[]) => void }) {
  return (
    <div className="space-y-2">
      {roles.length === 0 && (
        <p className="text-[12px] text-muted-foreground py-1">No overrides. Defaults apply to all users.</p>
      )}
      {roles.map((r, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            size="sm"
            placeholder="Role name or ID"
            value={r.role}
            onChange={(e) => onChange(roles.map((x, j) => j === i ? { ...x, role: e.target.value } : x))}
            className="flex-1"
          />
          <Select
            list={ROLE_ALLOW_OPTIONS}
            value={r.allow}
            onValueChange={(v) => onChange(roles.map((x, j) => j === i ? { ...x, allow: v } : x))}
            size="sm"
          />
          <Button variant="ghost" size="icon-sm" onClick={() => onChange(roles.filter((_, j) => j !== i))} aria-label="Remove">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={() => onChange([...roles, { role: "", allow: "respond" }])}>
        Add override
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rate limits — Switch from PAx
// ---------------------------------------------------------------------------

const RATE_LIMIT_ROWS: { key: keyof RateLimitConfig; label: string; sub: string }[] = [
  { key: "repliesPerMin", label: "Replies / minute",  sub: "Soft cap 6 · Hard cap 12"        },
  { key: "tokensPerHour", label: "Tokens / hour",     sub: "Cap 220k"                         },
  { key: "userCooldown",  label: "Per-user cooldown", sub: "30s between replies to same user" },
  { key: "backoff",       label: "Backoff on errors", sub: "Exponential · max 5m"             },
];

function RateLimitsCard({ value, onChange }: { value: RateLimitConfig; onChange: (v: RateLimitConfig) => void }) {
  return (
    <div className="divide-y divide-border">
      {RATE_LIMIT_ROWS.map(({ key, label, sub }) => (
        <div key={key} className="flex items-center gap-3 py-2">
          <div className="flex-1 min-w-0">
            <div className="text-[12.5px] font-medium">{label}</div>
            <div className="text-[11px] text-muted-foreground">{sub}</div>
          </div>
          <Switch
            checked={value[key]}
            onCheckedChange={(v) => onChange({ ...value, [key]: v })}
            color="violet"
            size="sm"
          />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mode picker — custom design-pack tiles (no PAx primitive for 6-tile mode grid)
// ---------------------------------------------------------------------------

function ModePicker({ current, onChange, disabled }: {
  current: DiscordChannelMode; onChange: (m: DiscordChannelMode) => void; disabled?: boolean;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 8 }}>
      {CHANNEL_MODES.map((m) => {
        const meta = CHANNEL_MODE_META[m];
        const selected = m === current;
        return (
          <button
            key={m}
            type="button"
            disabled={disabled}
            onClick={() => onChange(m)}
            className={cn(
              "rounded-lg p-2.5 text-left border transition-colors",
              selected ? "border-violet-500/40 bg-violet-500/10" : "border-border bg-card hover:border-border/80 hover:bg-secondary/30",
              disabled && "opacity-50 pointer-events-none",
            )}
          >
            <div className="flex items-center gap-1.5 mb-2">
              <span className={cn("inline-flex items-center gap-1 h-[18px] px-1.5 rounded-full border text-[9.5px] font-semibold uppercase tracking-wide", meta.badge)}>
                <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", meta.dot)} />
                {meta.label}
              </span>
              {selected && <span className="w-1.5 h-1.5 rounded-full bg-violet-400 shrink-0 ml-auto animate-pulse" />}
            </div>
            <div className="text-[11px] text-muted-foreground leading-relaxed line-clamp-2">{meta.description}</div>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live preview panel — Avatar from PAx
// ---------------------------------------------------------------------------

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}

function LivePreviewPanel({ channelId, channelName }: { channelId: string; channelName: string }) {
  const [entries, setEntries] = useState<CommsLogEntry[]>([]);
  const [paused, setPaused] = useState(false);
  const prevIdRef = useRef("");

  useEffect(() => {
    if (!channelId || paused) return;
    if (prevIdRef.current !== channelId) { setEntries([]); prevIdRef.current = channelId; }
    fetchCommsLog({ channel: channelId, limit: 10 })
      .then((res) => setEntries(res.entries.slice(0, 10)))
      .catch(() => {});
  }, [channelId, paused]);

  return (
    <aside className="w-[280px] shrink-0 border-l border-border bg-card flex flex-col min-h-0">
      <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-border shrink-0">
        <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0 animate-pulse" />
        <span className="text-[12.5px] font-semibold flex-1">Live preview</span>
        {channelName && <span className="text-[11px] text-muted-foreground truncate">· {channelName}</span>}
        <Button variant="ghost" size="icon-sm" onClick={() => setPaused((p) => !p)} aria-label={paused ? "Resume" : "Pause"}>
          {paused
            ? <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="5,3 19,12 5,21" /></svg>
            : <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><line x1="6" y1="4" x2="6" y2="20" /><line x1="18" y1="4" x2="18" y2="20" /></svg>
          }
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 gap-1.5">
            <span className="text-muted-foreground/30 text-2xl">✦</span>
            <p className="text-[12px] text-muted-foreground text-center">No recent messages</p>
          </div>
        ) : entries.map((e) => {
          const isOut = e.direction === "outbound";
          return (
            <div key={e.id} className="flex items-start gap-2">
              <Avatar
                fallback={(e.senderName ?? e.senderId).slice(0, 2).toUpperCase()}
                size="xs"
                className={isOut ? "bg-violet-500 text-white" : undefined}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-1.5 mb-0.5">
                  <span className={cn("text-[12px] font-semibold", isOut ? "text-violet-400" : "text-foreground")}>
                    {e.senderName ?? e.senderId}
                  </span>
                  <span className="text-[10px] text-muted-foreground/60 font-mono">{relTime(e.createdAt)}</span>
                </div>
                <p className="text-[12px] text-muted-foreground leading-relaxed line-clamp-3">{e.preview}</p>
              </div>
            </div>
          );
        })}
      </div>
      <div className="px-3.5 py-2 border-t border-border shrink-0">
        <span className="text-[10px] text-muted-foreground/60">{entries.length} recent message{entries.length !== 1 ? "s" : ""}</span>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function CommsChannelsPage() {
  const [channels, setChannels]    = useState<ChannelListEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [behavior, setBehavior]    = useState<BehaviorConfig>(DEFAULTS);
  const [agents, setAgents]        = useState<AgentStatus[]>([]);
  const [saving, setSaving]        = useState(false);
  const [dirty, setDirty]          = useState(false);
  const [error, setError]          = useState<string | null>(null);

  useEffect(() => {
    fetchChannels().then((list) => { setChannels(list); if (list.length > 0) setSelectedId((p) => p ?? list[0].id); }).catch(() => {});
    fetchAgents().then(setAgents).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    setDirty(false); setError(null);
    fetchChannelConfig(selectedId)
      .then((cfg) => setBehavior(parseBehavior(cfg.config)))
      .catch((e: unknown) => { setError(e instanceof Error ? e.message : String(e)); setBehavior(DEFAULTS); });
  }, [selectedId]);

  const patch = useCallback(<K extends keyof BehaviorConfig>(key: K, value: BehaviorConfig[K]) => {
    setBehavior((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  }, []);

  const handleSave = useCallback(async () => {
    if (!selectedId) return;
    setSaving(true); setError(null);
    try {
      await updateChannelConfig(selectedId, { config: serializeBehavior(behavior) });
      setDirty(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [selectedId, behavior]);

  const selected = channels.find((c) => c.id === selectedId);
  const channelOptions = channels.map((c) => ({ value: c.id, label: c.name }));

  return (
    <PageScroll className="flex flex-col h-full min-h-0 overflow-hidden">
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Config area */}
        <div className="flex-1 min-w-0 flex flex-col overflow-y-auto">
          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border shrink-0">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <span className="text-[12px] text-muted-foreground font-mono">Channels</span>
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-muted-foreground/50" aria-hidden="true"><polyline points="9 18 15 12 9 6" /></svg>
              {channelOptions.length > 0 && (
                <Select
                  list={channelOptions}
                  value={selectedId ?? ""}
                  onValueChange={(v) => setSelectedId(v)}
                  size="sm"
                  variant="native"
                />
              )}
              {selected && (
                <span className="text-[11px] text-muted-foreground">Behavior config</span>
              )}
            </div>
            {error && <span className="text-[11px] text-red-400 truncate max-w-[200px]">{error}</span>}
            <Button
              variant={dirty && !saving ? "default" : "secondary"}
              size="sm"
              disabled={!dirty || saving || !selectedId}
              onClick={() => void handleSave()}
            >
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </div>

          {/* Mode picker */}
          <div className="px-4 py-3 border-b border-border">
            <div className="mb-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Mode</div>
              <div className="text-[12px] text-muted-foreground mt-0.5">How Aion participates in this channel.</div>
            </div>
            <ModePicker current={behavior.mode} onChange={(m) => patch("mode", m)} disabled={!selectedId} />
          </div>

          {/* 2-col config cards */}
          <div className="p-4 grid gap-3" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <ConfigCard
              title="Agent assignment"
              right={<Badge color="zinc" variant="soft" size="sm">{behavior.agentIds.length} assigned</Badge>}
            >
              <AgentAssignment agents={agents} assignedIds={behavior.agentIds} onChange={(ids) => patch("agentIds", ids)} />
            </ConfigCard>

            <ConfigCard title="Memory scope">
              <MemoryScopeCard value={behavior.memory} onChange={(v) => patch("memory", v)} />
            </ConfigCard>

            <ConfigCard title="Tool access">
              <ToolAccessCard tools={behavior.tools} onChange={(v) => patch("tools", v)} />
            </ConfigCard>

            <ConfigCard title="Auto-moderation" accent="bg-amber-500">
              <AutoModCard value={behavior.autoMod} onChange={(v) => patch("autoMod", v)} />
            </ConfigCard>

            <ConfigCard
              title="Escalation rules"
              right={behavior.escalation.length > 0
                ? <Badge color="amber" variant="soft" size="sm">{behavior.escalation.length} rule{behavior.escalation.length !== 1 ? "s" : ""}</Badge>
                : undefined}
            >
              <EscalationCard rules={behavior.escalation} onChange={(v) => patch("escalation", v)} />
            </ConfigCard>

            <ConfigCard
              title="Prompt addendum"
              right={<Badge color="violet" variant="soft" size="sm">channel-scoped</Badge>}
            >
              <PromptCard
                system={behavior.promptSystem}
                tone={behavior.promptTone}
                refuse={behavior.promptRefuse}
                temp={behavior.promptTemp}
                maxTurn={behavior.promptMaxTurn}
                onChange={(p) => { setBehavior((prev) => ({ ...prev, ...p })); setDirty(true); }}
              />
            </ConfigCard>
          </div>

          {/* 3-col bottom strip */}
          <div className="px-4 pb-4 grid gap-3" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
            <ConfigCard title="Role overrides">
              <RoleOverridesCard roles={behavior.roleOverrides} onChange={(v) => patch("roleOverrides", v)} />
            </ConfigCard>
            <ConfigCard title="Rate limits">
              <RateLimitsCard value={behavior.rateLimits} onChange={(v) => patch("rateLimits", v)} />
            </ConfigCard>
            <ConfigCard
              title="Semantic topic detection"
              right={<Badge color="blue" variant="soft" size="sm">coming soon</Badge>}
            >
              <p className="text-[12px] text-muted-foreground leading-relaxed">
                Automatic thread tagging routes messages to relevant agents. Topic model training requires channel history.
              </p>
            </ConfigCard>
          </div>
        </div>

        {/* Live preview */}
        <LivePreviewPanel channelId={selectedId ?? ""} channelName={selected?.name ?? ""} />
      </div>
    </PageScroll>
  );
}
