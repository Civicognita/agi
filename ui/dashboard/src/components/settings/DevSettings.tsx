/**
 * DevSettings — Contributing mode toggle + repo status + PRIME source controls.
 */

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SectionHeading, FieldGroup } from "./SettingsShared.js";
import { fetchDevStatus, switchDevMode, fetchPrimeStatus, switchPrimeSource } from "../../api.js";
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

export function DevSettings({ config, update }: {
  config: AionimaConfig;
  update: (fn: (prev: AionimaConfig) => AionimaConfig) => void;
}) {
  const [devStatus, setDevStatus] = useState<DevStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
              Connect your GitHub account via Aionima ID in the onboarding setup first.
            </p>
            <div className="mt-2">
              <Link to="/gateway/onboarding" className="text-xs text-blue underline">Open onboarding</Link>
            </div>
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
