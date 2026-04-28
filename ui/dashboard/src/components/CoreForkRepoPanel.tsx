/**
 * CoreForkRepoPanel — specialized Repository tab for Dev-Mode core forks.
 *
 * Replaces the generic RepoPanel for projects under the `_aionima/`
 * collection. Three purposes:
 *   1. Show ahead/behind vs `upstream/<channel>` (Civicognita).
 *   2. One-shot "Merge upstream → origin" action with ff → merge-commit
 *      → aion-micro agentic fallback.
 *   3. "Open PR to upstream" jump-link to the GitHub compare page.
 *
 * Everything happens through `/api/dev/core-forks/*` — the generic
 * `/api/projects/git` endpoint is not used here.
 */

import { useCallback, useEffect, useState } from "react";
import { Callout } from "@particle-academy/react-fancy";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useCoreForkStatus } from "../hooks.js";
import { fetchDevStatus } from "../api.js";
import type { CoreForkMergeResult, CoreForkStatus, DevStatus } from "../types.js";

export interface CoreForkRepoPanelProps {
  slug: string;
}

// Slug → upstream Civicognita repo name. Mirrors CORE_REPOS in
// `packages/gateway-core/src/dev-mode-forks.ts` — we keep a small
// client-side copy so the PR button can construct the compare URL
// without an extra round-trip.
const UPSTREAM_REPO_BY_SLUG: Record<string, string> = {
  "agi": "agi",
  "prime": "aionima",
  "id": "agi-local-id",
  "marketplace": "agi-marketplace",
  "mapp-marketplace": "agi-mapp-marketplace",
};

function shortSha(sha: string | null): string {
  return sha ? sha.slice(0, 7) : "—";
}

export function CoreForkRepoPanel({ slug }: CoreForkRepoPanelProps) {
  const { data, isLoading, refetch } = useCoreForkStatus();
  const [devStatus, setDevStatus] = useState<DevStatus | null>(null);
  const [merging, setMerging] = useState(false);
  const [mergeResult, setMergeResult] = useState<CoreForkMergeResult | null>(null);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [aionBusy, setAionBusy] = useState(false);

  useEffect(() => {
    fetchDevStatus().then(setDevStatus).catch(() => setDevStatus(null));
  }, []);

  const fork: CoreForkStatus | undefined = data?.forks.find((f) => f.slug === slug);
  const branch = fork?.branch ?? data?.branch ?? "main";
  const upstreamRepo = UPSTREAM_REPO_BY_SLUG[slug];
  const ownerLogin = devStatus?.githubAccount ?? null;

  const handleMerge = useCallback(async (strategy: "ff-only" | "agentic") => {
    if (merging) return;
    setMerging(true);
    setMergeError(null);
    if (strategy === "agentic") setAionBusy(true);
    try {
      const res = await fetch(`/api/dev/core-forks/${encodeURIComponent(slug)}/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ strategy }),
      });
      const body = (await res.json()) as CoreForkMergeResult;
      setMergeResult(body);
      if (body.ok) {
        // Refresh status — the WS event should also trigger this, but a
        // direct refetch keeps the UI responsive on local dev setups.
        await refetch();
      }
    } catch (err) {
      setMergeError(err instanceof Error ? err.message : String(err));
    } finally {
      setMerging(false);
      setAionBusy(false);
    }
  }, [merging, slug, refetch]);

  const handleOpenPR = useCallback(() => {
    if (!upstreamRepo || !ownerLogin || !branch) return;
    const url = `https://github.com/Civicognita/${upstreamRepo}/compare/${branch}...${ownerLogin}:${branch}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }, [upstreamRepo, ownerLogin, branch]);

  if (isLoading) {
    return (
      <div className="p-4 text-[13px] text-muted-foreground">
        Loading fork status…
      </div>
    );
  }

  if (!fork) {
    return (
      <div className="p-4 text-[13px] text-muted-foreground">
        This fork isn't in the Dev-Mode collection yet — toggle Dev Mode in Settings to provision it.
      </div>
    );
  }

  if (fork.error) {
    return (
      <Callout color="red" className="p-4 text-[13px]">
        <div className="font-semibold mb-1">{fork.displayName}</div>
        <div className="text-[12px] opacity-80">{fork.error}</div>
      </Callout>
    );
  }

  const behind = fork.behind;
  const ahead = fork.ahead;
  const canMerge = behind > 0 && !merging;
  const showConflictPanel = mergeResult !== null && mergeResult.ok === false && mergeResult.conflict;

  return (
    <div className="flex flex-col gap-4">
      {/* Header row: branch + SHAs + badges */}
      <Card className="flex flex-wrap items-center gap-3 p-3">
        <div className="flex flex-col gap-0.5">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Branch</div>
          <div className="font-mono text-[13px]">{fork.branch}</div>
        </div>
        <div className="flex flex-col gap-0.5">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Fork HEAD</div>
          <div className="font-mono text-[13px]">{shortSha(fork.currentSha)}</div>
        </div>
        <div className="flex flex-col gap-0.5">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Upstream HEAD</div>
          <div className="font-mono text-[13px]">{shortSha(fork.upstreamSha)}</div>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "text-[12px] font-semibold px-2 py-0.5 rounded-full",
              ahead > 0 ? "bg-green/20 text-green" : "text-muted-foreground",
            )}
          >
            ↑ {ahead} ahead
          </span>
          <span
            className={cn(
              "text-[12px] font-semibold px-2 py-0.5 rounded-full",
              behind > 0 ? "bg-peach/20 text-peach" : "text-muted-foreground",
            )}
          >
            ↓ {behind} behind
          </span>
        </div>
      </Card>

      {/* Action row */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          onClick={() => { void handleMerge("ff-only"); }}
          disabled={!canMerge}
          title={canMerge ? "Merge upstream commits into your fork" : "Fork is up to date with upstream"}
        >
          {merging ? "Merging…" : behind > 0 ? `Merge upstream → origin (${behind})` : "Up to date"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={handleOpenPR}
          disabled={!upstreamRepo || !ownerLogin}
          title={
            !ownerLogin
              ? "Connect GitHub in Settings → Contributing first"
              : `Open PR from ${ownerLogin}/${upstreamRepo} → Civicognita/${upstreamRepo}`
          }
        >
          Open PR to upstream
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => { void refetch(); }}
          disabled={merging}
        >
          Refresh
        </Button>
      </div>

      {/* Merge result feedback */}
      {mergeError && (
        <Callout color="red" className="text-[12px]">
          {mergeError}
        </Callout>
      )}

      {mergeResult?.ok && (
        <Callout color="green" className="text-[13px]">
          {mergeResult.agentic
            ? `Aion-Micro resolved conflicts and merged upstream at ${shortSha(mergeResult.newSha)}.`
            : mergeResult.ff
              ? `Fast-forwarded to upstream at ${shortSha(mergeResult.newSha)}.`
              : `Merged upstream with a merge commit at ${shortSha(mergeResult.newSha)}.`}
          {!mergeResult.pushed && (
            <div className="text-[11px] opacity-80 mt-1">
              Local merge succeeded but push to origin failed — run <code>git push</code> manually.
            </div>
          )}
        </Callout>
      )}

      {mergeResult?.ok === false && !mergeResult.conflict && (
        <Callout color="amber" className="text-[12px]">
          {mergeResult.reason}
        </Callout>
      )}

      {showConflictPanel && mergeResult?.ok === false && mergeResult.conflict && (
        <Callout color="amber" className="text-[12px]">
          <div className="font-semibold text-peach mb-1">
            {mergeResult.agentic && mergeResult.reviewNeeded
              ? "Aion-Micro couldn't confidently resolve this merge"
              : "Merge conflict"}
          </div>
          <div className="opacity-90 mb-2">
            {mergeResult.files.length > 0
              ? `Conflicting files: ${mergeResult.files.join(", ")}`
              : "No files reported."}
          </div>
          {mergeResult.aionSummary && (
            <div className="opacity-80 font-mono text-[11px] mb-2 whitespace-pre-wrap">
              {mergeResult.aionSummary}
            </div>
          )}
          {!mergeResult.agentic && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => { void handleMerge("agentic"); }}
              disabled={aionBusy}
            >
              {aionBusy ? "Aion-Micro thinking…" : "Let Aion-Micro try"}
            </Button>
          )}
          {mergeResult.agentic && mergeResult.reviewNeeded && (
            <div className="opacity-80 text-[11px]">
              Open the Editor tab to resolve the conflicts manually — the file contents are in the working tree with conflict markers preserved.
            </div>
          )}
        </Callout>
      )}

      <div className="text-[11px] text-muted-foreground mt-1">
        Last checked {fork.lastFetchedAt ? new Date(fork.lastFetchedAt).toLocaleTimeString() : "—"}
      </div>
    </div>
  );
}
