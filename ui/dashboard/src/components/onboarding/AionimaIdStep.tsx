/**
 * AionimaIdStep — Identity confirmation, OAuth providers, and agent identity.
 *
 * Three cards:
 *   1. Your Identity — #E0 owner GEID + COA alias (from onboarding/owner-entity)
 *   2. Connected Providers — OAuth connections; inline GitHub device flow
 *   3. Agent — $A0 GEID (read-only)
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button.js";
import { Badge } from "@/components/ui/badge.js";
import type { OnboardingStepStatus, OnboardingState } from "@/types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OwnerEntityData {
  registered: boolean;
  owner?: { displayName: string; coaAlias: string; geid: string };
  agent?: { coaAlias: string; geid: string };
}

interface Connection {
  provider: string;
  role: string;
  accountLabel: string | null;
}

interface DeviceFlowState {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  interval: number;
}

interface Props {
  onNext: () => void;
  onSkip: () => void;
  status?: OnboardingStepStatus;
  idMode?: OnboardingState["idMode"];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncateGeid(geid: string): string {
  if (geid.length <= 20) return geid;
  return `${geid.slice(0, 14)}…${geid.slice(-6)}`;
}

// ---------------------------------------------------------------------------
// Card 1 — Your Identity
// ---------------------------------------------------------------------------

function IdentityCard({ entity, onCopy, copied }: {
  entity: OwnerEntityData;
  onCopy: (text: string) => void;
  copied: boolean;
}) {
  if (!entity.registered || !entity.owner) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 flex flex-col gap-2">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Your Identity</span>
        </div>
        <p className="text-sm text-muted-foreground">
          Complete <strong>Owner Profile</strong> first to register your identity.
        </p>
      </div>
    );
  }

  const { owner } = entity;
  return (
    <div className="rounded-lg border border-border bg-card p-4 flex flex-col gap-3">
      <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Your Identity</span>
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm shrink-0">
          {owner.displayName.charAt(0).toUpperCase()}
        </div>
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-medium truncate">{owner.displayName}</span>
          <span className="text-[11px] text-muted-foreground font-mono">{owner.coaAlias}</span>
        </div>
      </div>
      <div className="flex items-center gap-2 bg-secondary/50 rounded px-3 py-2">
        <code className="text-xs font-mono text-foreground flex-1 truncate">{truncateGeid(owner.geid)}</code>
        <button
          onClick={() => onCopy(owner.geid)}
          className="text-[11px] text-muted-foreground hover:text-foreground transition-colors shrink-0"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card 2 — Connected Providers
// ---------------------------------------------------------------------------

function ProvidersCard({ connections, onRemove, onFlowStarted }: {
  connections: Connection[];
  onRemove: (provider: string, role: string) => void;
  onFlowStarted: (flow: DeviceFlowState) => void;
}) {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startGitHub = async () => {
    setStarting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/device-flow/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "github", role: "owner" }),
      });
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        setError(d.error ?? "Failed to start GitHub login");
        return;
      }
      const data = await res.json() as DeviceFlowState;
      onFlowStarted(data);
    } catch {
      setError("Request failed — check gateway connection");
    } finally {
      setStarting(false);
    }
  };

  const githubConnected = connections.some((c) => c.provider === "github");

  return (
    <div className="rounded-lg border border-border bg-card p-4 flex flex-col gap-3">
      <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Connected Providers</span>

      {connections.length === 0 && (
        <p className="text-xs text-muted-foreground">No OAuth providers connected yet.</p>
      )}

      {connections.map((conn) => (
        <div key={`${conn.provider}-${conn.role}`} className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-[10px] capitalize">{conn.provider}</Badge>
            {conn.accountLabel && (
              <span className="text-xs text-muted-foreground">{conn.accountLabel}</span>
            )}
          </div>
          <button
            onClick={() => onRemove(conn.provider, conn.role)}
            className="text-[11px] text-muted-foreground hover:text-destructive transition-colors"
          >
            Remove
          </button>
        </div>
      ))}

      {error && <p className="text-xs text-destructive">{error}</p>}

      {!githubConnected && (
        <Button variant="outline" size="sm" onClick={() => void startGitHub()} disabled={starting}>
          {starting ? "Starting…" : "Add GitHub"}
        </Button>
      )}
      {githubConnected && (
        <p className="text-xs text-muted-foreground">
          GitHub connected. Google and Discord require Hive-ID (not yet active).
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Device Flow inline prompt
// ---------------------------------------------------------------------------

function DeviceFlowPrompt({ flow, onComplete, onCancel }: {
  flow: DeviceFlowState;
  onComplete: () => void;
  onCancel: () => void;
}) {
  const [pollStatus, setPollStatus] = useState<"pending" | "completed" | "error" | "expired">("pending");
  const [pollError, setPollError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const currentInterval = useRef(flow.interval * 1000);
  // Consecutive poll failures (non-OK / missing-status / network). After a few,
  // surface an error instead of spinning on "waiting" forever (story #218).
  const failuresRef = useRef(0);
  const MAX_POLL_FAILURES = 5;

  useEffect(() => {
    const fail = (msg: string) => {
      failuresRef.current += 1;
      if (failuresRef.current >= MAX_POLL_FAILURES) {
        clearInterval(intervalRef.current!);
        setPollStatus("error");
        setPollError(msg);
      }
      // else: tolerate a transient blip and keep polling
    };
    const poll = async () => {
      try {
        const res = await fetch(`/api/auth/device-flow/poll?deviceCode=${encodeURIComponent(flow.deviceCode)}`);
        if (!res.ok) { fail(`Lost contact while waiting (HTTP ${res.status}). Please try again.`); return; }
        const data = await res.json() as { status?: string; interval?: number; error?: string; accountLabel?: string };
        if (data.status === "completed") {
          clearInterval(intervalRef.current!);
          setPollStatus("completed");
          setTimeout(onComplete, 1200);
        } else if (data.status === "expired") {
          clearInterval(intervalRef.current!);
          setPollStatus("expired");
        } else if (data.status === "error") {
          clearInterval(intervalRef.current!);
          setPollStatus("error");
          setPollError(data.error ?? "Unknown error");
        } else if (data.status === "pending") {
          failuresRef.current = 0; // healthy response — reset the failure streak
          if (data.interval && data.interval * 1000 !== currentInterval.current) {
            // RFC 8628: slow_down — adjust interval
            clearInterval(intervalRef.current!);
            currentInterval.current = data.interval * 1000;
            intervalRef.current = setInterval(() => { void poll(); }, currentInterval.current);
          }
        } else {
          // Unknown / missing status (e.g. an error body without `status`) —
          // don't silently spin forever; count it as a failure.
          fail("Unexpected response while waiting for authorization. Please try again.");
        }
      } catch {
        fail("Lost contact while waiting for authorization. Please try again.");
      }
    };

    intervalRef.current = setInterval(() => { void poll(); }, currentInterval.current);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [flow.deviceCode, onComplete]);

  return (
    <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 flex flex-col gap-3">
      <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">GitHub Authorization</span>

      {pollStatus === "pending" && (
        <>
          <p className="text-xs text-muted-foreground">
            Open the link below and enter the code to authorize:
          </p>
          <a
            href={flow.verificationUri}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary underline break-all"
          >
            {flow.verificationUri}
          </a>
          <div className="flex items-center gap-3 bg-card rounded px-3 py-2 border border-border">
            <code className="text-lg font-mono font-bold tracking-widest text-foreground">
              {flow.userCode}
            </code>
            <span className="text-[10px] text-muted-foreground ml-auto">Waiting for approval…</span>
          </div>
          <button onClick={onCancel} className="text-[11px] text-muted-foreground hover:text-foreground transition-colors self-start">
            Cancel
          </button>
        </>
      )}

      {pollStatus === "completed" && (
        <p className="text-xs text-green font-medium">GitHub connected successfully.</p>
      )}

      {(pollStatus === "expired" || pollStatus === "error") && (
        <>
          <p className="text-xs text-destructive">
            {pollStatus === "expired" ? "Code expired." : `Error: ${pollError}`}
          </p>
          <button onClick={onCancel} className="text-[11px] text-muted-foreground hover:text-foreground transition-colors self-start">
            Dismiss
          </button>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card 3 — Agent
// ---------------------------------------------------------------------------

function AgentCard({ agent }: { agent?: { coaAlias: string; geid: string } }) {
  if (!agent?.geid) return null;
  return (
    <div className="rounded-lg border border-border bg-card p-4 flex flex-col gap-2">
      <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Agent</span>
      <div className="flex flex-col gap-0.5">
        <span className="text-xs text-muted-foreground font-mono">{agent.coaAlias}</span>
        <code className="text-xs font-mono text-muted-foreground truncate">{truncateGeid(agent.geid)}</code>
      </div>
      <p className="text-[11px] text-muted-foreground mt-1">
        Gateway-managed — GEID is read-only.{" "}
        <a href="/settings/identity" className="text-primary underline">
          Manage all identities →
        </a>
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main step
// ---------------------------------------------------------------------------

export function AionimaIdStep({ onNext, onSkip, status }: Props) {
  const [entity, setEntity] = useState<OwnerEntityData>({ registered: false });
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFlow, setActiveFlow] = useState<DeviceFlowState | null>(null);
  const [copied, setCopied] = useState(false);

  const isCompleted = status === "completed";

  const loadData = useCallback(async () => {
    const [entityRes, connectionsRes] = await Promise.allSettled([
      fetch("/api/onboarding/owner-entity").then((r) => r.json() as Promise<OwnerEntityData>),
      fetch("/api/auth/device-flow/status").then((r) => r.json() as Promise<Connection[]>),
    ]);
    if (entityRes.status === "fulfilled") setEntity(entityRes.value);
    if (connectionsRes.status === "fulfilled") setConnections(connectionsRes.value);
  }, []);

  useEffect(() => {
    void loadData().finally(() => setLoading(false));
  }, [loadData]);

  const handleCopy = (text: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleRemove = async (provider: string, role: string) => {
    await fetch(`/api/auth/device-flow/connection?provider=${encodeURIComponent(provider)}&role=${encodeURIComponent(role)}`, {
      method: "DELETE",
    });
    await loadData();
  };

  const handleFlowComplete = async () => {
    setActiveFlow(null);
    await loadData();
  };

  if (loading) return null;

  const canContinue = isCompleted || entity.registered;

  return (
    <div className="flex flex-col gap-5 sm:gap-6">
      <div className="onboard-animate-in">
        <h2 className="text-xl sm:text-2xl font-semibold mb-1">
          Your Identity
        </h2>
        <p className="text-[13px] sm:text-sm text-muted-foreground leading-relaxed">
          Confirm your registered identity and connect OAuth providers for agent access to external services.
        </p>
      </div>

      <div className="flex flex-col gap-3 onboard-animate-in onboard-stagger-1">
        <IdentityCard entity={entity} onCopy={handleCopy} copied={copied} />

        {activeFlow ? (
          <DeviceFlowPrompt
            flow={activeFlow}
            onComplete={() => void handleFlowComplete()}
            onCancel={() => setActiveFlow(null)}
          />
        ) : (
          <ProvidersCard
            connections={connections}
            onRemove={(p, r) => void handleRemove(p, r)}
            onFlowStarted={setActiveFlow}
          />
        )}

        <AgentCard agent={entity.agent} />
      </div>

      <div className="flex gap-3 onboard-animate-in onboard-stagger-2">
        <Button onClick={onNext} disabled={!canContinue}>
          Continue
        </Button>
        <Button variant="ghost" onClick={onSkip}>
          Skip for now
        </Button>
      </div>
    </div>
  );
}
