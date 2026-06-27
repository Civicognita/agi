/**
 * DevSettings — Contributing mode toggle + repo status + PRIME source controls.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { Callout } from "@particle-academy/react-fancy";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SectionHeading } from "./SettingsShared.js";
import { fetchDevStatus, switchDevMode, fetchTestVmStatus, runTestVmCommand, fetchTestResults } from "../../api.js";
import type { TestVmStatus, TestResults } from "../../api.js";
import type { DevStatus, AionimaConfig } from "../../types.js";

// Compact one-line repo row (Wave 2d — owner: "repo status doesn't need to be so
// bulky"). Dot = your-fork vs upstream; remote right-aligned + truncated; branch /
// entries inline. Replaces the previous tall per-repo card.
function RepoCard({ name, remote, branch, entries, isOwnerFork }: {
  name: string;
  remote: string;
  branch?: string;
  entries?: number;
  isOwnerFork: boolean;
}) {
  return (
    <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-surface0/50 text-[12px]" data-testid={`repo-row-${name.toLowerCase().replace(/\s+/g, "-")}`}>
      <span
        className={`h-2 w-2 rounded-full shrink-0 ${isOwnerFork ? "bg-green" : "bg-overlay1"}`}
        title={isOwnerFork ? "your fork" : "upstream"}
      />
      <span className="font-medium text-card-foreground shrink-0">{name}</span>
      {branch !== undefined && branch !== "" && (
        <span className="text-muted-foreground shrink-0 font-mono">{branch}</span>
      )}
      {entries !== undefined && (
        <span className="text-muted-foreground shrink-0">{entries} entries</span>
      )}
      <span className="font-mono text-muted-foreground/70 truncate flex-1 text-right" title={remote}>{remote}</span>
    </div>
  );
}

export function DevSettings(_props: {
  config: AionimaConfig;
  update: (fn: (prev: AionimaConfig) => AionimaConfig) => void;
}) {
  // config + update were used by an earlier inline form. Today the page is
  // status + repo cards only; the props remain in the signature for
  // call-site contract stability.
  const [devStatus, setDevStatus] = useState<DevStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // GitHub connection is AGI-native: the gateway runs the GitHub device flow
  // itself (device-flow-api.ts, absorbed from the retired Local-ID service).
  // This tab starts that flow, shows the user code to enter at github.com, and
  // polls until the token lands in the connections table — no external ID
  // service, no popup, no id.ai.on.
  const [connect, setConnect] = useState<
    { userCode: string; verificationUri: string; deviceCode: string; interval: number } | null
  >(null);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const statusPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // PRIME switcher state removed — PRIME is part of the Aionima core
  // collection managed by Dev Mode's unified provisioning. See
  // `dev-mode-forks.ts` + `_aionima/` clone target.

  useEffect(() => {
    setLoading(true);
    fetchDevStatus()
      .then(setDevStatus)
      .catch(() => { /* API unavailable */ })
      .finally(() => setLoading(false));
  }, []);

  // Cleanup devStatus poll on unmount
  useEffect(() => {
    return () => {
      if (statusPollRef.current) clearInterval(statusPollRef.current);
    };
  }, []);

  /**
   * Start AGI's own GitHub device flow (POST /api/auth/device-flow/start).
   * Shows the user code to enter at github.com/login/device, then polls
   * /api/auth/device-flow/poll until GitHub authorizes — at which point the
   * token is stored in the connections table and `/api/dev/status` reports
   * githubAuthenticated. No external service; the gateway owns the handshake.
   */
  const handleGithubConnect = useCallback(() => {
    if (statusPollRef.current) clearInterval(statusPollRef.current);
    setConnecting(true);
    setConnectError(null);
    void (async () => {
      try {
        const res = await fetch("/api/auth/device-flow/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider: "github", role: "owner" }),
        });
        if (!res.ok) {
          const b = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(b.error ?? `HTTP ${String(res.status)}`);
        }
        const data = (await res.json()) as {
          deviceCode: string; userCode: string; verificationUri: string; interval: number;
        };
        setConnect({
          userCode: data.userCode,
          verificationUri: data.verificationUri || "https://github.com/login/device",
          deviceCode: data.deviceCode,
          interval: data.interval,
        });

        // Poll for authorization at GitHub's requested interval.
        statusPollRef.current = setInterval(() => {
          void (async () => {
            try {
              const pr = await fetch(`/api/auth/device-flow/poll?deviceCode=${encodeURIComponent(data.deviceCode)}`);
              const pb = (await pr.json()) as { status: string; error?: string };
              if (pb.status === "completed") {
                if (statusPollRef.current) clearInterval(statusPollRef.current);
                statusPollRef.current = null;
                setConnect(null);
                setConnecting(false);
                setDevStatus(await fetchDevStatus());
              } else if (pb.status === "expired" || pb.status === "error") {
                if (statusPollRef.current) clearInterval(statusPollRef.current);
                statusPollRef.current = null;
                setConnect(null);
                setConnecting(false);
                setConnectError(pb.error ?? (pb.status === "expired" ? "Code expired — try again." : "Authorization failed."));
              }
              // "pending" → keep polling
            } catch {
              // Network blip — keep polling
            }
          })();
        }, Math.max(2, data.interval) * 1000);
      } catch (err) {
        setConnecting(false);
        setConnectError(err instanceof Error ? err.message : "Failed to start GitHub connect");
      }
    })();
  }, []);

  const handleToggle = useCallback(async () => {
    if (devStatus === null) return;
    const targetEnabled = !devStatus.enabled;
    setSwitching(true);
    setError(null);
    try {
      await switchDevMode(targetEnabled);
      const status = await fetchDevStatus();
      setDevStatus(status);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Switch failed");
    } finally {
      setSwitching(false);
    }
  }, [devStatus]);

  const isOwnerFork = (remote: string): boolean => {
    return remote.includes("wishborn/") || (
      devStatus !== null &&
      devStatus.enabled &&
      !remote.includes("Civicognita/")
    );
  };

  return (
    <>
      {/* Contributing Mode Toggle */}
      <Card className="p-6 gap-0 mb-4">
        <SectionHeading>Contributing</SectionHeading>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-card-foreground">Fork Switching</p>
            <p className="text-[13px] text-muted-foreground">
              Clone your forks of the core repos (AGI, PRIME, the Marketplaces, PAx) into your workspace
            </p>
          </div>
          <div className="flex items-center gap-3">
            {switching && (
              <span className="text-[13px] text-muted-foreground">Switching...</span>
            )}
            {error !== null && (
              <span className="text-[13px] text-red">{error}</span>
            )}
            <button
              onClick={() => void handleToggle()}
              disabled={loading || switching || devStatus === null || (!devStatus?.enabled && !devStatus?.githubAuthenticated)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer disabled:opacity-50 ${
                devStatus?.enabled ? "bg-green" : "bg-overlay1"
              }`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                devStatus?.enabled ? "translate-x-6" : "translate-x-1"
              }`} />
            </button>
          </div>
        </div>
        {/* GitHub auth gate — AGI-native device flow (device-flow-api.ts).
            The gateway runs the handshake itself; this block starts it, shows
            the user code to enter at github.com/login/device, and polls until
            the token lands in the connections table. No external ID service. */}
        {devStatus !== null && !devStatus.enabled && !devStatus.githubAuthenticated && (
          <Callout color="zinc" className="mt-3">
            <p className="text-sm text-card-foreground">GitHub authentication required</p>
            <p className="text-[13px] text-muted-foreground mt-1">
              Contributing mode clones your forks of the core repos. AGI connects your GitHub
              account directly — no external service.
            </p>

            {!connect ? (
              <div className="mt-2 flex items-center gap-3">
                <Button variant="outline" size="sm" disabled={connecting} onClick={handleGithubConnect} data-testid="dev-github-connect">
                  {connecting ? "Starting…" : "Connect GitHub"}
                </Button>
                {connectError !== null && <span className="text-[12px] text-red">{connectError}</span>}
              </div>
            ) : (
              <div className="mt-3 space-y-2" data-testid="dev-github-devicecode">
                <p className="text-[13px] text-card-foreground">
                  1. Open{" "}
                  <a href={connect.verificationUri} target="_blank" rel="noopener noreferrer" className="text-primary underline">
                    {connect.verificationUri}
                  </a>
                </p>
                <p className="text-[13px] text-card-foreground">2. Enter this code:</p>
                <code className="block text-lg font-mono tracking-[0.3em] bg-surface0 rounded px-3 py-2 text-center select-all text-card-foreground">
                  {connect.userCode}
                </code>
                <span className="text-[12px] text-muted-foreground flex items-center gap-1">
                  <span className="animate-pulse">●</span> Waiting for you to authorize on GitHub…
                </span>
              </div>
            )}
          </Callout>
        )}

        {/* Connected state — show the account; identity is owned by AGI now */}
        {devStatus !== null && devStatus.githubAuthenticated && (
          <Callout color="green" className="mt-3 flex items-center gap-3">
            <Badge variant="outline" className="text-green border-green/50">
              ✓ GitHub connected{devStatus.githubAccount ? ` as ${devStatus.githubAccount}` : ""}
            </Badge>
            <span className="text-[12px] text-muted-foreground">
              Managed by AGI · <Link to="/settings/identity" className="text-primary underline">Settings → Identity</Link>
            </span>
          </Callout>
        )}

        {/* Phase H.2 — origin alignment callout. Dev Mode is on but one or
            more /opt/* origins are still pointing at Civicognita. The fix
            is a single `agi upgrade` — upgrade.sh's `ensure_origin_remote`
            rewrites the origin on each cycle. Shows only after the
            githubAuthenticated block so it doesn't drown out that gate. */}
        {devStatus !== null && devStatus.enabled && devStatus.originsAligned === false && (
          <Callout color="amber" className="mt-3">
            <p className="text-sm text-card-foreground flex items-center gap-2">
              <span className="text-yellow">⚠</span>
              Origin rewrite pending — re-run <code className="px-1 py-0.5 rounded bg-surface0 text-xs">agi upgrade</code>
            </p>
            <p className="text-[13px] text-muted-foreground mt-1">
              Dev Mode is enabled but one or more service directories still point at the canonical Civicognita origin. The next upgrade cycle rewrites them to your fork. After that, every subsequent upgrade pulls directly from your fork — no PR round-trip needed.
            </p>
            {devStatus.originMisaligned && devStatus.originMisaligned.length > 0 && (
              <ul className="mt-2 text-[12px] text-muted-foreground font-mono list-none space-y-0.5">
                {devStatus.originMisaligned.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
          </Callout>
        )}

        {!loading && devStatus === null && (
          <Callout color="zinc" className="mt-3">
            <p className="text-sm text-card-foreground">Contributing mode status unavailable</p>
            <p className="text-[13px] text-muted-foreground mt-1">
              Complete onboarding or sign in with dashboard auth to enable contributing mode controls.
            </p>
            <div className="mt-2">
              <Link to="/gateway/onboarding" className="text-xs text-blue underline">Open onboarding</Link>
            </div>
          </Callout>
        )}
      </Card>

      {/* Repo Status Cards — only shown when contributing mode is on.
          Grouped by upstream org per s136 t512:
            - Civicognita (the AGI core five — agi, prime, id, marketplace,
              mapp-marketplace)
            - Particle-Academy (PAx ADF UI primitives — react-fancy,
              fancy-code, fancy-sheets, fancy-echarts) */}
      {devStatus?.enabled && (
        <Card className="p-6 gap-0 mb-4">
          <SectionHeading>Repository Status</SectionHeading>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading repo status...</p>
          ) : devStatus !== null ? (
            <div className="space-y-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  Civicognita · core platform
                </div>
                <div className="grid gap-0.5">
                  <RepoCard
                    name="AGI"
                    remote={devStatus.agi.remote}
                    isOwnerFork={isOwnerFork(devStatus.agi.remote)}
                  />
                  <RepoCard
                    name="PRIME"
                    remote={devStatus.prime.remote}
                    branch={devStatus.prime.branch}
                    entries={devStatus.prime.entries}
                    isOwnerFork={isOwnerFork(devStatus.prime.remote)}
                  />
                  {devStatus.marketplace && (
                    <RepoCard
                      name="Marketplace"
                      remote={devStatus.marketplace.remote}
                      branch={devStatus.marketplace.branch}
                      isOwnerFork={isOwnerFork(devStatus.marketplace.remote)}
                    />
                  )}
                  {devStatus.mappMarketplace && (
                    <RepoCard
                      name="MApp Marketplace"
                      remote={devStatus.mappMarketplace.remote}
                      branch={devStatus.mappMarketplace.branch}
                      isOwnerFork={isOwnerFork(devStatus.mappMarketplace.remote)}
                    />
                  )}
                </div>
              </div>

              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  Particle-Academy · ADF UI primitives (PAx)
                </div>
                <div className="grid gap-0.5">
                  {devStatus.reactFancy && (
                    <RepoCard
                      name="react-fancy"
                      remote={devStatus.reactFancy.remote}
                      branch={devStatus.reactFancy.branch}
                      isOwnerFork={isOwnerFork(devStatus.reactFancy.remote)}
                    />
                  )}
                  {devStatus.fancyCode && (
                    <RepoCard
                      name="fancy-code"
                      remote={devStatus.fancyCode.remote}
                      branch={devStatus.fancyCode.branch}
                      isOwnerFork={isOwnerFork(devStatus.fancyCode.remote)}
                    />
                  )}
                  {devStatus.fancySheets && (
                    <RepoCard
                      name="fancy-sheets"
                      remote={devStatus.fancySheets.remote}
                      branch={devStatus.fancySheets.branch}
                      isOwnerFork={isOwnerFork(devStatus.fancySheets.remote)}
                    />
                  )}
                  {devStatus.fancyEcharts && (
                    <RepoCard
                      name="fancy-echarts"
                      remote={devStatus.fancyEcharts.remote}
                      branch={devStatus.fancyEcharts.branch}
                      isOwnerFork={isOwnerFork(devStatus.fancyEcharts.remote)}
                    />
                  )}
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Unable to load repo status</p>
          )}
        </Card>
      )}

      {/* Test Infrastructure — always available in Contributing tab */}
      <TestVmPanel />
    </>
  );
}

// ---------------------------------------------------------------------------
// TestVmPanel — test VM lifecycle + test runner
// ---------------------------------------------------------------------------

function TestVmPanel() {
  const [status, setStatus] = useState<TestVmStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [output, setOutput] = useState<Array<{ phase: string; status: string; message: string; timestamp: string }>>([]);
  const [testResults, setTestResults] = useState<TestResults | null>(null);
  const [showOutput, setShowOutput] = useState(false);
  const outputRef = useRef<HTMLDivElement>(null);

  const refreshStatus = useCallback(() => {
    fetchTestVmStatus().then(setStatus).catch(() => {});
  }, []);

  useEffect(() => {
    refreshStatus();
    const interval = setInterval(refreshStatus, 10_000);
    return () => clearInterval(interval);
  }, [refreshStatus]);

  useEffect(() => {
    fetchTestResults().then(setTestResults).catch(() => {});
  }, []);

  // WebSocket listener for test-vm events
  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    ws.onopen = () => ws.send(JSON.stringify({ type: "dashboard:subscribe" }));
    ws.onmessage = (ev) => {
      try {
        // Server broadcasts via `wsServer.broadcast("dashboard_event", { type, data })`
        // which wraps the second arg as `payload` (see ws-server.ts:143). Read
        // `msg.payload` — not `msg.data` — or events silently never match and
        // the "Running..." spinner hangs forever (tynn #257).
        const msg = JSON.parse(ev.data as string) as {
          type?: string;
          payload?: { type?: string; data?: { phase: string; status: string; message: string; timestamp: string } };
        };
        if (msg.type !== "dashboard_event") return;
        const event = msg.payload;
        if (event?.type === "system:test-vm" && event.data) {
          setOutput((prev) => [...prev, event.data!]);
          setShowOutput(true);
          if (event.data.status === "done" || event.data.status === "error") {
            setBusy(null);
            refreshStatus();
            fetchTestResults().then(setTestResults).catch(() => {});
          }
          setTimeout(() => outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight }), 50);
        }
      } catch { /* ignore */ }
    };
    return () => ws.close();
  }, [refreshStatus]);

  const runCommand = useCallback((command: string) => {
    setBusy(command);
    setOutput([]);
    setShowOutput(true);
    runTestVmCommand(command).catch(() => setBusy(null));
  }, []);

  const vmRunning = status?.running ?? false;
  const servicesUp = status?.services.agi === "running";

  return (
    <Card className="p-6 gap-0">
      <SectionHeading>Test Infrastructure</SectionHeading>

      {/* VM Status */}
      <div className="flex items-center gap-3 mb-4">
        <span className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${
          vmRunning ? "bg-green-500" : status?.exists === false ? "bg-muted-foreground" : "bg-yellow-500"
        }`} />
        <span className="text-[13px] text-foreground font-medium">
          {!status ? "Checking..." : !status.exists ? "VM not created" : vmRunning ? `VM running (${status.ip})` : "VM stopped"}
        </span>
        <span className="flex-1" />
        {vmRunning && (
          <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => {
            if (window.confirm("Destroy the test VM? This cannot be undone.")) runCommand("destroy");
          }}>
            Destroy
          </Button>
        )}
      </div>

      {/* Service health rows */}
      {vmRunning && status && (
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 mb-4 max-w-sm">
          {(["postgres", "caddy", "agi"] as const).map((svc) => {
            const val = status.services[svc];
            const isUp = val === "active" || val === "running";
            return (
              <div key={svc} className="flex items-center gap-2">
                <span className={`w-1.5 h-1.5 rounded-full ${isUp ? "bg-green-500" : "bg-red-500"}`} />
                <span className="text-[12px] text-muted-foreground">{svc === "postgres" ? "PostgreSQL" : svc === "caddy" ? "Caddy" : "AGI"}</span>
                <span className="text-[11px] text-muted-foreground font-mono">{val}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2 mb-4">
        {!vmRunning && (
          <Button size="sm" disabled={busy !== null} onClick={() => runCommand("provision")}>
            {busy === "provision" ? "Provisioning..." : "Provision VM"}
          </Button>
        )}
        {vmRunning && !servicesUp && (
          <Button size="sm" disabled={busy !== null} onClick={() => runCommand("services-start")}>
            {busy === "services-start" ? "Starting..." : "Start Services"}
          </Button>
        )}
        {vmRunning && servicesUp && (
          <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => runCommand("services-stop")}>
            {busy === "services-stop" ? "Stopping..." : "Stop Services"}
          </Button>
        )}
      </div>

      {/* Test Runner */}
      {vmRunning && (
        <>
          <div className="border-t border-border pt-4 mt-2 mb-3">
            <div className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Test Runner</div>
            <div className="flex flex-wrap gap-2 mb-3">
              <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => runCommand("test")}>
                {busy === "test" ? "Running..." : "Unit Tests"}
              </Button>
              <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => runCommand("test-ui")}>
                {busy === "test-ui" ? "Running..." : "UI Tests (Playwright)"}
              </Button>
            </div>
            {testResults && testResults.total > 0 && (
              <div className="text-[12px] text-muted-foreground">
                Last run:{" "}
                <span className="text-green-500">{testResults.passed} passed</span>
                {testResults.failed > 0 && <>, <span className="text-red-500">{testResults.failed} failed</span></>}
                {testResults.skipped > 0 && <>, <span className="text-muted-foreground">{testResults.skipped} skipped</span></>}
              </div>
            )}
          </div>
        </>
      )}

      {/* Command Output */}
      {showOutput && (
        <div className="border-t border-border pt-3 mt-2">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">Command Output</span>
            <button className="text-[11px] text-muted-foreground cursor-pointer hover:text-foreground" onClick={() => { setShowOutput(false); setOutput([]); }}>
              Clear
            </button>
          </div>
          <div
            ref={outputRef}
            className="bg-black/30 rounded-md p-3 max-h-[300px] overflow-y-auto font-mono text-[11px] text-muted-foreground"
          >
            {output.map((line, i) => (
              <div key={i} className={line.status === "error" ? "text-red-400" : line.status === "done" ? "text-green-400" : ""}>
                {line.message}
              </div>
            ))}
            {output.length === 0 && busy && (
              <div className="animate-pulse">Waiting for output...</div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
