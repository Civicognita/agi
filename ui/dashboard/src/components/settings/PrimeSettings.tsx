/**
 * PrimeSettings — PRIME source configuration.
 */

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SectionHeading, FieldGroup } from "./SettingsShared.js";
import { fetchPrimeStatus, switchPrimeSource } from "../../api.js";
import type { PrimeStatus } from "../../types.js";

const MAIN_PRIME_URL = "git@github.com:Civicognita/aionima.git";

export function PrimeSettings() {
  const [primeStatus, setPrimeStatus] = useState<PrimeStatus | null>(null);
  const [primeLoading, setPrimeLoading] = useState(false);
  const [primeSwitching, setPrimeSwitching] = useState(false);
  const [primeError, setPrimeError] = useState<string | null>(null);
  const [primeSourceMode, setPrimeSourceMode] = useState<"main" | "custom">("main");
  const [primeCustomUrl, setPrimeCustomUrl] = useState("");
  const [primeBranch, setPrimeBranch] = useState("main");

  useEffect(() => {
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

  return (
    <Card className="p-6 gap-0 mb-4">
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
    </Card>
  );
}
