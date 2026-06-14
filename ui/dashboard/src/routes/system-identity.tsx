/**
 * System ▸ Identity — the single home for Identity Management (story #212).
 *
 * Owner directive 2026-06-12: identity lives in ONE place, not buried in or
 * duplicated across Settings. This page consolidates:
 *   - Your Identity (GEID / COA alias)         — was Settings ▸ Identity
 *   - Identity Providers (canonical 6)          — GitHub · Google · Meta · X · Tynn.ai · Civicognita
 *   - Federation / Civicognita (HIVE network)   — was Settings ▸ Gateway
 *
 * Dashboard login accounts stay in Machine Admin (cross-linked below) — this
 * page is about external provider identity + federation, not local access control.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { PageScroll } from "@/components/PageScroll.js";
import { Button } from "@/components/ui/button.js";
import { Badge } from "@/components/ui/badge.js";
import { Card } from "@/components/ui/card.js";
import { Input } from "@/components/ui/input.js";
import { DevNote } from "@/components/ui/dev-notes.js";
import { cn } from "@/lib/utils";
import { fetchIdentityProviders, configureProviderApp, clearProviderApp } from "@/api.js";
import { DEFAULT_IDENTITY_PROVIDERS, resolveIdentityProviders } from "@/lib/identity-providers.js";
import { useConfig } from "@/hooks.js";
import type { AionimaConfig, IdentityProviderView, IdentityProviderStatus } from "@/types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OwnerEntityData {
  registered: boolean;
  owner?: { displayName: string; coaAlias: string; geid: string };
  agent?: { coaAlias: string; geid: string };
}

interface DeviceFlowState {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  interval: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncateGeid(geid: string): string {
  if (geid.length <= 22) return geid;
  return `${geid.slice(0, 16)}…${geid.slice(-6)}`;
}

const STATUS_BADGE: Record<IdentityProviderStatus, { label: string; cls: string }> = {
  connected: { label: "Connected", cls: "bg-green/15 text-green border-green/30" },
  available: { label: "Available", cls: "bg-primary/10 text-primary border-primary/30" },
  "needs-config": { label: "Needs OAuth app", cls: "bg-surface1 text-muted-foreground border-border" },
  "federation-gated": { label: "Federation", cls: "bg-surface1 text-muted-foreground border-border" },
};

/** Single-letter brand glyph (icon set registered upstream later). */
function ProviderGlyph({ provider }: { provider: IdentityProviderView }) {
  return (
    <div className="w-9 h-9 rounded-lg bg-secondary flex items-center justify-center text-foreground font-bold shrink-0 text-sm">
      {provider.displayName.charAt(0).toUpperCase()}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Device flow (GitHub) — inline, no redirect
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
  // Consecutive poll failures — after a few, surface an error instead of
  // spinning on "waiting" forever (story #218).
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
    };
    const poll = async () => {
      try {
        const res = await fetch(`/api/auth/device-flow/poll?deviceCode=${encodeURIComponent(flow.deviceCode)}`);
        if (!res.ok) { fail(`Lost contact while waiting (HTTP ${res.status}). Please try again.`); return; }
        const data = await res.json() as { status?: string; interval?: number; error?: string };
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
            clearInterval(intervalRef.current!);
            currentInterval.current = data.interval * 1000;
            intervalRef.current = setInterval(() => { void poll(); }, currentInterval.current);
          }
        } else {
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
    <div className="mt-3 rounded-lg border border-primary/20 bg-primary/5 p-3" data-testid="identity-device-flow">
      {pollStatus === "pending" && (
        <div className="flex flex-col gap-2">
          <p className="text-[11px] text-muted-foreground">Open this link and enter the code:</p>
          <a href={flow.verificationUri} target="_blank" rel="noopener noreferrer" className="text-[11px] text-primary underline break-all">
            {flow.verificationUri}
          </a>
          <div className="flex items-center gap-3 bg-card rounded px-3 py-2 border border-border">
            <code className="text-xl font-mono font-bold tracking-widest text-foreground flex-1">{flow.userCode}</code>
            <span className="text-[10px] text-muted-foreground animate-pulse">Waiting…</span>
          </div>
          <button onClick={onCancel} className="text-[11px] text-muted-foreground hover:text-foreground self-start">Cancel</button>
        </div>
      )}
      {pollStatus === "completed" && <p className="text-sm text-green font-medium">Connected successfully.</p>}
      {(pollStatus === "expired" || pollStatus === "error") && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-destructive">{pollStatus === "expired" ? "Code expired." : `Error: ${pollError}`}</p>
          <button onClick={onCancel} className="text-[11px] text-muted-foreground hover:text-foreground self-start">Dismiss</button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Provider card
// ---------------------------------------------------------------------------

function OAuthAppForm({ providerId, onSaved, onCancel }: {
  providerId: string;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await configureProviderApp(providerId, clientId, clientSecret);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-2 rounded-lg border border-border bg-secondary/30 p-3 space-y-2" data-testid={`identity-app-form-${providerId}`}>
      <p className="text-[11px] text-muted-foreground">
        Paste the OAuth app credentials from your {providerId} developer console. The redirect URI is
        <code className="mx-1 text-[10px]">/api/auth/callback/{providerId}</code>.
      </p>
      <Input type="text" placeholder="Client ID" value={clientId} onChange={(e) => setClientId(e.target.value)}
        className="text-[12px]" data-testid={`identity-app-clientid-${providerId}`} />
      <Input type="password" placeholder="Client Secret" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)}
        className="text-[12px]" data-testid={`identity-app-secret-${providerId}`} />
      {error && <p className="text-[11px] text-destructive">{error}</p>}
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => void save()} disabled={saving || !clientId.trim() || !clientSecret.trim()}
          data-testid={`identity-app-save-${providerId}`}>
          {saving ? "Saving…" : "Save app"}
        </Button>
        <button onClick={onCancel} className="text-[11px] text-muted-foreground hover:text-foreground">Cancel</button>
      </div>
    </div>
  );
}

function ProviderCard({ provider, onConnectGitHub, onConnectRedirect, onRemove, onConfigured, onClearApp, activeFlow, onFlowComplete, onFlowCancel, flowError }: {
  provider: IdentityProviderView;
  onConnectGitHub: () => void;
  onConnectRedirect: (id: string) => void;
  onRemove: (id: string) => void;
  onConfigured: () => void;
  onClearApp: (id: string) => void;
  activeFlow: DeviceFlowState | null;
  onFlowComplete: () => void;
  onFlowCancel: () => void;
  flowError: string | null;
}) {
  const badge = STATUS_BADGE[provider.status];
  const isGitHubFlow = provider.id === "github" && activeFlow;
  const [showForm, setShowForm] = useState(false);

  return (
    <Card className="p-4 flex flex-col gap-3" data-testid={`identity-provider-${provider.id}`}>
      <div className="flex items-start gap-3">
        <ProviderGlyph provider={provider} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-foreground">{provider.displayName}</p>
            <Badge
              variant="outline"
              className={cn("text-[10px] border", badge.cls)}
              data-testid={`identity-provider-${provider.id}-status`}
            >
              {provider.status === "connected" && provider.connectedLabel
                ? provider.connectedLabel
                : badge.label}
            </Badge>
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{provider.blurb}</p>
        </div>
      </div>

      {/* Action row */}
      <div className="mt-auto">
        {provider.status === "connected" && (
          <Button variant="ghost" size="sm" className="text-xs text-muted-foreground hover:text-destructive"
            onClick={() => onRemove(provider.id)} data-testid={`identity-remove-${provider.id}`}>
            Remove
          </Button>
        )}

        {provider.status === "available" && provider.id === "github" && !isGitHubFlow && (
          <Button variant="outline" size="sm" onClick={onConnectGitHub} data-testid="identity-connect-github">
            Connect
          </Button>
        )}

        {provider.status === "available" && provider.id !== "github" && (
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={() => onConnectRedirect(provider.id)}
              data-testid={`identity-connect-${provider.id}`}>
              Connect
            </Button>
            <button onClick={() => onClearApp(provider.id)} className="text-[10px] text-muted-foreground hover:text-destructive"
              data-testid={`identity-clearapp-${provider.id}`}>
              Remove app
            </button>
          </div>
        )}

        {provider.status === "needs-config" && !showForm && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="text-xs" onClick={() => setShowForm(true)}
              data-testid={`identity-configure-${provider.id}`}>
              Add OAuth app
            </Button>
            <span className="text-[10px] text-muted-foreground">paste your client ID/secret to enable</span>
          </div>
        )}

        {provider.status === "federation-gated" && (
          <span className="text-[11px] text-muted-foreground" data-testid={`identity-gated-${provider.id}`}>
            Available when federation is online ↓
          </span>
        )}
      </div>

      {provider.status === "needs-config" && showForm && (
        <OAuthAppForm
          providerId={provider.id}
          onSaved={() => { setShowForm(false); onConfigured(); }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {isGitHubFlow && (
        <DeviceFlowPrompt flow={activeFlow!} onComplete={onFlowComplete} onCancel={onFlowCancel} />
      )}
      {provider.id === "github" && flowError && (
        <p className="text-[11px] text-destructive">{flowError}</p>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Federation / Civicognita card (relocated from Settings ▸ Gateway)
// ---------------------------------------------------------------------------

function FederationCard() {
  const configHook = useConfig();
  const config = configHook.data;
  const federation = (config as Record<string, unknown> | undefined)?.federation as {
    enabled?: boolean; publicUrl?: string; autoGeid?: boolean; allowVisitors?: boolean;
  } | undefined;
  const [saving, setSaving] = useState(false);

  const setNested = async (patch: (prev: AionimaConfig) => AionimaConfig) => {
    if (!config) return;
    setSaving(true);
    try {
      await configHook.save(patch(config));
    } finally {
      setSaving(false);
    }
  };

  const toggle = (key: "enabled" | "autoGeid" | "allowVisitors", next: boolean) =>
    void setNested((prev) => ({
      ...prev,
      federation: { ...((prev as Record<string, unknown>).federation as object), [key]: next },
    } as AionimaConfig));

  return (
    <Card className="p-4 space-y-3" data-testid="federation-card">
      <div>
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
          Civicognita Identity · HIVE Federation
        </p>
        <p className="text-[12px] text-muted-foreground mt-1">
          Civicognita is Aionima's federated identity network (formerly Hive-ID). Enabling federation
          brings cross-node entity resolution, Global Entity IDs (GEIDs), and makes the Civicognita
          provider connectable above.
        </p>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-[13px] text-foreground">Enable Federation</span>
        <button
          type="button"
          disabled={saving || !config}
          onClick={() => toggle("enabled", !federation?.enabled)}
          data-testid="federation-toggle"
          className={cn("relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-50",
            federation?.enabled ? "bg-green" : "bg-surface1")}
        >
          <span className={cn("inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform",
            federation?.enabled ? "translate-x-4" : "translate-x-0.5")} />
        </button>
      </div>

      {federation?.enabled && (
        <>
          <div>
            <label className="text-[11px] text-muted-foreground">Public URL</label>
            <Input
              type="text"
              defaultValue={federation.publicUrl ?? ""}
              placeholder="https://your-node.example.com"
              className="text-[13px] mt-1"
              onBlur={(e) => void setNested((prev) => ({
                ...prev,
                federation: { ...((prev as Record<string, unknown>).federation as object), publicUrl: e.target.value },
              } as AionimaConfig))}
            />
            <p className="text-[10px] text-muted-foreground mt-1">Your node's public URL for HIVE registration and peer discovery.</p>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-foreground">Auto-generate GEIDs</span>
            <button type="button" onClick={() => toggle("autoGeid", !(federation.autoGeid !== false))}
              className={cn("relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
                federation.autoGeid !== false ? "bg-green" : "bg-surface1")}>
              <span className={cn("inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform",
                federation.autoGeid !== false ? "translate-x-4" : "translate-x-0.5")} />
            </button>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-foreground">Allow Visitors</span>
            <button type="button" onClick={() => toggle("allowVisitors", !(federation.allowVisitors !== false))}
              className={cn("relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
                federation.allowVisitors !== false ? "bg-green" : "bg-surface1")}>
              <span className={cn("inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform",
                federation.allowVisitors !== false ? "translate-x-4" : "translate-x-0.5")} />
            </button>
          </div>
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function IdentityServicePage() {
  // Seed from the baked-in registry so GitHub + Civicognita (core, baked-in
  // services) always render even if /api/auth/providers fails — story #219.
  const [providers, setProviders] = useState<IdentityProviderView[]>(DEFAULT_IDENTITY_PROVIDERS);
  const [entity, setEntity] = useState<OwnerEntityData>({ registered: false });
  const [loading, setLoading] = useState(true);
  const [activeFlow, setActiveFlow] = useState<DeviceFlowState | null>(null);
  const [startingFlow, setStartingFlow] = useState(false);
  const [flowError, setFlowError] = useState<string | null>(null);
  const [copiedGeid, setCopiedGeid] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const loadData = useCallback(async () => {
    const [provRes, entityRes] = await Promise.allSettled([
      fetchIdentityProviders(),
      fetch("/api/onboarding/owner-entity").then((r) => r.json() as Promise<OwnerEntityData>),
    ]);
    // resolveIdentityProviders enriches the baked-in seed with live status; a
    // failed/empty endpoint keeps the seed so the grid is never blank (#219).
    if (provRes.status === "fulfilled") setProviders(resolveIdentityProviders(provRes.value));
    if (entityRes.status === "fulfilled") setEntity(entityRes.value);
  }, []);

  useEffect(() => {
    void loadData().finally(() => setLoading(false));
  }, [loadData]);

  const startGitHub = async () => {
    setStartingFlow(true);
    setFlowError(null);
    try {
      const res = await fetch("/api/auth/device-flow/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "github", role: "owner" }),
      });
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        setFlowError(d.error ?? "Failed to start");
        return;
      }
      setActiveFlow(await res.json() as DeviceFlowState);
    } catch {
      setFlowError("Request failed — check gateway connection");
    } finally {
      setStartingFlow(false);
    }
  };

  const connectRedirect = async (provider: string) => {
    try {
      const res = await fetch(`/api/auth/start/${encodeURIComponent(provider)}`, { method: "POST" });
      const data = await res.json() as { authUrl?: string; error?: string };
      if (data.authUrl) { window.location.href = data.authUrl; return; }
      setFlowError(data.error ?? `Could not start ${provider} sign-in`);
    } catch {
      setFlowError(`Request failed for ${provider}`);
    }
  };

  const removeConnection = async (provider: string) => {
    await fetch(`/api/auth/device-flow/connection?provider=${encodeURIComponent(provider)}&role=owner`, { method: "DELETE" });
    await loadData();
  };

  const clearApp = async (provider: string) => {
    try {
      await clearProviderApp(provider);
    } catch { /* surfaced on reload */ }
    await loadData();
  };

  const handleFlowComplete = async () => {
    setActiveFlow(null);
    await loadData();
  };

  // Banner from the OAuth redirect callback (?connected=… / ?error=…), then
  // strip the query so a refresh doesn't re-show it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected");
    const error = params.get("error");
    if (connected) setNotice({ kind: "ok", text: `Connected ${connected}.` });
    else if (error) setNotice({ kind: "error", text: `Connection failed: ${error.replace(/_/g, " ")}` });
    if (connected || error) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const copyGeid = (geid: string) => {
    void navigator.clipboard.writeText(geid).then(() => {
      setCopiedGeid(true);
      setTimeout(() => setCopiedGeid(false), 2000);
    });
  };

  return (
    <PageScroll>
      <div className="max-w-4xl space-y-6" data-testid="system-identity-page">
        <DevNote heading="Cycle — Baked-in providers always render (story #219)" kind="warning">
          GitHub and Civicognita are core, baked-in identity services — the grid now seeds from a
          client-side registry (DEFAULT_IDENTITY_PROVIDERS) so the canonical 6 always render even if
          GET /api/auth/providers is empty, 500s, or never responds (e.g. a stale dashboard bundle or
          a host that upgraded while an older gateway build is still serving). The endpoint only
          enriches live status now; it can no longer blank the grid or hide GitHub. Backend matches:
          the handler degrades enrichment on any throw but always returns the registry list. Mirrors
          how the onboarding step hardcodes "Add GitHub".
        </DevNote>
        <DevNote heading="Cycle — Identity unified + provider connect (story #212)" kind="info">
          Identity Management lives only here. The six canonical providers (GitHub, Google, Meta, X,
          Tynn.ai, Civicognita) render from a single backend registry. GitHub connects via device
          flow; Google/Meta/X/Tynn.ai are connectable after you add their OAuth app (clientId/secret →
          stored hot in gateway.json identity.oauth.*) and run the redirect flow; Civicognita unlocks
          when federation is enabled below. Settings ▸ Identity redirects here; federation config moved
          off Settings ▸ Gateway.
        </DevNote>

        {notice && (
          <div
            data-testid="identity-notice"
            className={cn(
              "rounded-lg border px-3 py-2 text-[12px] flex items-center justify-between gap-3",
              notice.kind === "ok" ? "border-green/30 bg-green/10 text-green" : "border-destructive/30 bg-destructive/10 text-destructive",
            )}
          >
            <span>{notice.text}</span>
            <button onClick={() => setNotice(null)} className="text-[11px] opacity-70 hover:opacity-100">Dismiss</button>
          </div>
        )}

        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Identity</h1>
            <p className="text-[13px] text-muted-foreground mt-0.5">
              The single home for your identity, connected providers, and federation.
            </p>
          </div>
          <Link
            to="/admin"
            className="text-[12px] text-primary hover:underline shrink-0 mt-1"
            data-testid="identity-machine-admin-link"
          >
            Dashboard login accounts → Machine Admin
          </Link>
        </div>

        {loading ? (
          <div className="text-sm text-muted-foreground p-6">Loading…</div>
        ) : (
          <>
            {/* Your Identity */}
            <Card className="p-4 space-y-3" data-testid="your-identity-card">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Your Identity</p>
              {!entity.registered || !entity.owner ? (
                <p className="text-sm text-muted-foreground">
                  No identity registered yet. Complete the{" "}
                  <a href="/onboarding" className="text-primary underline">Onboarding</a> Owner Profile step first.
                </p>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold shrink-0">
                      {entity.owner.displayName.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-medium">{entity.owner.displayName}</p>
                      <p className="text-[11px] text-muted-foreground font-mono">{entity.owner.coaAlias}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 bg-secondary/50 rounded px-3 py-2">
                    <code className="text-xs font-mono text-foreground flex-1 truncate">{truncateGeid(entity.owner.geid)}</code>
                    <button onClick={() => copyGeid(entity.owner!.geid)} className="text-[11px] text-muted-foreground hover:text-foreground shrink-0">
                      {copiedGeid ? "Copied" : "Copy GEID"}
                    </button>
                  </div>
                  {entity.agent?.geid && (
                    <div className="pt-1 border-t border-border">
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Agent</p>
                      <p className="text-[11px] text-muted-foreground font-mono">{entity.agent.coaAlias}</p>
                      <code className="text-[11px] font-mono text-muted-foreground">{truncateGeid(entity.agent.geid)}</code>
                    </div>
                  )}
                </div>
              )}
            </Card>

            {/* Identity Providers */}
            <div className="space-y-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Identity Providers</h2>
                <p className="text-[12px] text-muted-foreground">
                  Connect external accounts so Aion can act on your behalf. Identity services are core,
                  critical infrastructure — these are the common providers.
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" data-testid="identity-provider-grid">
                {providers.map((p) => (
                  <ProviderCard
                    key={p.id}
                    provider={p}
                    onConnectGitHub={() => void startGitHub()}
                    onConnectRedirect={(id) => void connectRedirect(id)}
                    onRemove={(id) => void removeConnection(id)}
                    onConfigured={() => void loadData()}
                    onClearApp={(id) => void clearApp(id)}
                    activeFlow={activeFlow}
                    onFlowComplete={() => void handleFlowComplete()}
                    onFlowCancel={() => setActiveFlow(null)}
                    flowError={p.id === "github" && !startingFlow ? flowError : null}
                  />
                ))}
              </div>
            </div>

            {/* Federation / Civicognita */}
            <FederationCard />
          </>
        )}
      </div>
    </PageScroll>
  );
}
