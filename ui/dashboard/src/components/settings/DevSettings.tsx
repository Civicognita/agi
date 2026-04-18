/**
 * DevSettings — Contributing mode toggle + repo status + PRIME source controls.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SectionHeading, FieldGroup } from "./SettingsShared.js";
import { fetchDevStatus, switchDevMode, fetchPrimeStatus, switchPrimeSource, startDeviceFlow, pollDeviceFlow } from "../../api.js";
import type { DevStatus, PrimeStatus, AionimaConfig } from "../../types.js";

const MAIN_PRIME_URL = "git@github.com:Civicognita/aionima.git";

function RepoCard({ name, remote, branch, entries, isOwnerFork }: {
  name: string;
  remote: string;
  branch?: string;
  entries?: number;
  isOwnerFork: boolean;
}) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-md bg-surface0">
      <span className={`mt-1 h-2.5 w-2.5 rounded-full shrink-0 ${isOwnerFork ? "bg-green" : "bg-overlay1"}`} />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-card-foreground">{name}</div>
        <div className="text-[12px] text-muted-foreground font-mono truncate" title={remote}>{remote}</div>
        {branch !== undefined && (
          <div className="text-[12px] text-muted-foreground mt-0.5">Branch: <span className="text-card-foreground">{branch}</span></div>
        )}
        {entries !== undefined && (
          <div className="text-[12px] text-muted-foreground mt-0.5">Entries: <span className="text-card-foreground">{entries}</span></div>
        )}
      </div>
    </div>
  );
}

interface GithubFlowState {
  status: "idle" | "connecting" | "connected" | "error";
  userCode?: string;
  verificationUri?: string;
  accountLabel?: string;
  error?: string;
}

export function DevSettings({ config, update }: {
  config: AionimaConfig;
  update: (fn: (prev: AionimaConfig) => AionimaConfig) => void;
}) {
  const [devStatus, setDevStatus] = useState<DevStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Inline GitHub device flow for the auth gate
  const [githubFlow, setGithubFlow] = useState<GithubFlowState>({ status: "idle" });
  const githubPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // PRIME source controls
  const [primeStatus, setPrimeStatus] = useState<PrimeStatus | null>(null);
  const [primeLoading, setPrimeLoading] = useState(false);
  const [primeSwitching, setPrimeSwitching] = useState(false);
  const [primeError, setPrimeError] = useState<string | null>(null);
  const [primeSourceMode, setPrimeSourceMode] = useState<"main" | "custom">("main");
  const [primeCustomUrl, setPrimeCustomUrl] = useState("");
  const [primeBranch, setPrimeBranch] = useState("main");

  useEffect(() => {
    setLoading(true);
    fetchDevStatus()
      .then(setDevStatus)
      .catch(() => { /* API unavailable */ })
      .finally(() => setLoading(false));

    setPrimeLoading(true);
    fetchPrimeStatus()
      .then((status) => {
        setPrimeStatus(status);
        if (status.source === MAIN_PRIME_URL) {
          setPrimeSourceMode("main");
        } else {
          setPrimeSourceMode("custom");
          setPrimeCustomUrl(status.source);
        }
        setPrimeBranch(status.branch);
      })
      .catch(() => { /* PRIME API unavailable */ })
      .finally(() => setPrimeLoading(false));
  }, []);

  // Cleanup GitHub poll on unmount
  useEffect(() => {
    return () => {
      if (githubPollRef.current) clearInterval(githubPollRef.current);
    };
  }, []);

  const handleGithubConnect = useCallback(async () => {
    if (githubPollRef.current) clearInterval(githubPollRef.current);
    setGithubFlow({ status: "connecting" });
    try {
      const data = await startDeviceFlow("github");
      setGithubFlow({
        status: "connecting",
        userCode: data.userCode,
        verificationUri: data.verificationUri,
      });
      const dc = data.deviceCode;
      githubPollRef.current = setInterval(() => {
        void (async () => {
          try {
            const result = await pollDeviceFlow(dc);
            if (result.status === "completed") {
              if (githubPollRef.current) clearInterval(githubPollRef.current);
              setGithubFlow({ status: "connected", accountLabel: result.accountLabel });
              // Re-fetch dev status so the toggle becomes enabled
              const updated = await fetchDevStatus();
              setDevStatus(updated);
            } else if (result.status === "expired" || result.status === "error") {
              if (githubPollRef.current) clearInterval(githubPollRef.current);
              setGithubFlow({
                status: "error",
                error: result.error ?? "Authorization expired. Please try again.",
              });
            }
          } catch {
            // Keep polling on network errors
          }
        })();
      }, 3000);
    } catch (err) {
      setGithubFlow({
        status: "error",
        error: err instanceof Error ? err.message : "Connection failed",
      });
    }
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

  const handlePrimeSwitch = useCallback(async () => {
    setPrimeSwitching(true);
    setPrimeError(null);
    const source = primeSourceMode === "main" ? MAIN_PRIME_URL : primeCustomUrl;
    if (!source) {
      setPrimeError("Source URL is required");
      setPrimeSwitching(false);
      return;
    }
    try {
      await switchPrimeSource(source, primeBranch || "main");
      const status = await fetchPrimeStatus();
      setPrimeStatus(status);
    } catch (err) {
      setPrimeError(err instanceof Error ? err.message : "Switch failed");
    } finally {
      setPrimeSwitching(false);
    }
  }, [primeSourceMode, primeCustomUrl, primeBranch]);

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
              Clone owner forks of core repos (AGI, PRIME, ID, Marketplace) into your workspace
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
        {/* GitHub auth gate — shown when not authenticated and contributing mode is off */}
        {devStatus !== null && !devStatus.enabled && !devStatus.githubAuthenticated && (
          <div className="mt-3 p-3 rounded-md bg-surface0 border border-overlay0">
            <p className="text-sm text-card-foreground">GitHub authentication required</p>
            <p className="text-[13px] text-muted-foreground mt-1">
              Contributing mode clones owner forks of the AGI, PRIME, ID, and Marketplace repositories.
              Connect your GitHub account to continue.
            </p>

            {githubFlow.status === "idle" && (
              <div className="mt-2">
                <Button variant="outline" size="sm" onClick={() => void handleGithubConnect()}>
                  Connect GitHub
                </Button>
              </div>
            )}

            {githubFlow.status === "connecting" && !githubFlow.userCode && (
              <p className="mt-2 text-[12px] text-muted-foreground">Starting device flow...</p>
            )}

            {githubFlow.status === "connecting" && githubFlow.userCode && (
              <div className="mt-3 p-3 rounded-lg bg-muted/30 border border-border">
                <div className="text-[11px] text-muted-foreground mb-1">
                  Visit this URL and enter the code:
                </div>
                <div className="mb-2">
                  <a
                    href={githubFlow.verificationUri}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[12px] text-primary underline font-mono break-all"
                  >
                    {githubFlow.verificationUri}
                  </a>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[16px] font-mono font-bold tracking-widest text-foreground">
                    {githubFlow.userCode}
                  </span>
                  <button
                    type="button"
                    onClick={() => void navigator.clipboard.writeText(githubFlow.userCode!)}
                    className="text-[10px] px-2 py-0.5 rounded border border-border hover:bg-accent transition-colors"
                  >
                    Copy
                  </button>
                </div>
                <div className="text-[10px] text-muted-foreground mt-2 flex items-center gap-1">
                  <span className="animate-pulse">●</span>
                  <span>Waiting for authorization...</span>
                </div>
              </div>
            )}

            {githubFlow.status === "connected" && (
              <div className="mt-2 flex items-center gap-2">
                <Badge variant="outline" className="text-green border-green/50">
                  ✓ {githubFlow.accountLabel ?? "GitHub connected"}
                </Badge>
                <span className="text-[12px] text-muted-foreground">Toggle contributing mode above.</span>
              </div>
            )}

            {githubFlow.status === "error" && (
              <div className="mt-2 text-[11px] text-destructive flex items-center gap-1 flex-wrap">
                <span>{githubFlow.error}</span>
                <button
                  type="button"
                  onClick={() => void handleGithubConnect()}
                  className="underline"
                >
                  Try again
                </button>
              </div>
            )}
          </div>
        )}

        {!loading && devStatus === null && (
          <div className="mt-3 p-3 rounded-md bg-surface0 border border-overlay0">
            <p className="text-sm text-card-foreground">Contributing mode status unavailable</p>
            <p className="text-[13px] text-muted-foreground mt-1">
              Complete onboarding or sign in with dashboard auth to enable contributing mode controls.
            </p>
            <div className="mt-2">
              <Link to="/gateway/onboarding" className="text-xs text-blue underline">Open onboarding</Link>
            </div>
          </div>
        )}
      </Card>

      {/* Repo Status Cards — only shown when contributing mode is on */}
      {devStatus?.enabled && (
        <Card className="p-6 gap-0 mb-4">
          <SectionHeading>Repository Status</SectionHeading>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading repo status...</p>
          ) : devStatus !== null ? (
            <div className="grid gap-3">
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
              {devStatus.id && (
                <RepoCard
                  name="ID"
                  remote={devStatus.id.remote}
                  branch={devStatus.id.branch}
                  isOwnerFork={isOwnerFork(devStatus.id.remote)}
                />
              )}
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
          ) : (
            <p className="text-sm text-muted-foreground">Unable to load repo status</p>
          )}
        </Card>
      )}

      {/* PRIME Source Controls — only shown when contributing mode is on */}
      {devStatus?.enabled && <Card className="p-6 gap-0 mb-4">
        <SectionHeading>PRIME Source</SectionHeading>
        {primeLoading ? (
          <p className="text-sm text-muted-foreground">Loading PRIME status...</p>
        ) : (
          <>
            {primeStatus !== null && (
              <div className="flex items-center gap-4 mb-4 text-[13px] text-muted-foreground font-mono bg-surface0 rounded-md px-3 py-2">
                <span>Source: <span className="text-card-foreground">{primeStatus.source}</span></span>
                <span>Branch: <span className="text-card-foreground">{primeStatus.branch}</span></span>
                <span>Entries: <span className="text-card-foreground">{primeStatus.entries}</span></span>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <FieldGroup label="Source">
                <select
                  className="w-full h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm font-mono cursor-pointer"
                  value={primeSourceMode}
                  onChange={(e) => {
                    const mode = e.target.value as "main" | "custom";
                    setPrimeSourceMode(mode);
                    if (mode === "main") setPrimeCustomUrl("");
                  }}
                >
                  <option value="main">Main (Civicognita/aionima)</option>
                  <option value="custom">Custom fork</option>
                </select>
              </FieldGroup>
              <FieldGroup label="Branch">
                <Input
                  className="font-mono"
                  value={primeBranch}
                  onChange={(e) => setPrimeBranch(e.target.value)}
                  placeholder="main"
                />
              </FieldGroup>
            </div>
            {primeSourceMode === "custom" && (
              <FieldGroup label="Repository URL">
                <Input
                  className="font-mono"
                  value={primeCustomUrl}
                  onChange={(e) => setPrimeCustomUrl(e.target.value)}
                  placeholder="git@github.com:your-user/aionima.git"
                />
              </FieldGroup>
            )}
            <div className="flex items-center gap-3 mt-2">
              <Button
                onClick={() => void handlePrimeSwitch()}
                disabled={primeSwitching}
              >
                {primeSwitching ? "Switching..." : "Switch Source"}
              </Button>
              {primeError !== null && (
                <span className="text-[13px] text-red">{primeError}</span>
              )}
            </div>
          </>
        )}
      </Card>}
    </>
  );
}
