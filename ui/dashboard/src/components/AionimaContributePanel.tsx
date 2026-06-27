/**
 * AionimaContributePanel — Phase 2 (Dev Mode outbound).
 *
 * Contribute tab content for the _aionima meta-project. Surfaces, per core
 * fork, how many commits the owner's fork is ahead of upstream/dev, grouped
 * into:
 *   - Learnings → PRIME (the knowledge corpus)
 *   - Mechanics → agi, the marketplaces, the PAx UI packages, …
 *
 * Each repo with commits ahead gets a "Create PR" button that opens a
 * cross-repo PR to upstream/dev with an AI-drafted body. Repos with an
 * already-open PR link to it instead.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DevNote } from "@/components/ui/dev-notes.js";
import { cn } from "@/lib/utils";
import { useContributeStatus, useCreateContributePr } from "../hooks.js";
import type { RepoContributeInfo } from "../types.js";

export function AionimaContributePanel() {
  const { data, isLoading, refetch } = useContributeStatus();
  const createPr = useCreateContributePr();
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, { url?: string; error?: string; alreadyOpen?: boolean }>>({});

  async function handleCreate(repo: RepoContributeInfo) {
    setActiveSlug(repo.slug);
    try {
      const res = await createPr.mutateAsync({ slug: repo.slug });
      setResults((r) => ({ ...r, [repo.slug]: { url: res.prUrl, alreadyOpen: res.alreadyOpen } }));
    } catch (err) {
      setResults((r) => ({ ...r, [repo.slug]: { error: err instanceof Error ? err.message : "PR failed" } }));
    } finally {
      setActiveSlug(null);
    }
  }

  return (
    <div className="space-y-5">
      <DevNote heading="Cycle — Refresh now reflects merged PRs (s222)" kind="info">
        Refresh clears the optimistic per-create PR links and refetches, so once a PR is merged
        upstream (server reports no open PR) the row drops "View open PR" and restores "Create PR".
        Previously the locally-cached created-PR URL was preferred over server truth and Refresh
        appeared to do nothing.
      </DevNote>

      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div>
          <span className="text-sm font-semibold text-foreground">Contribute upstream</span>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Open cross-repo PRs to <span className="font-mono">upstream/dev</span>
            {data?.ownerLogin && <> from <span className="font-mono">{data.ownerLogin}</span></>}.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="text-[11px] h-7"
          data-testid="contribute-refresh"
          onClick={() => {
            // Clear optimistic per-create results (the just-created PR URLs) so
            // the refetched server state is authoritative. Without this, a merged
            // PR's link would persist forever because `result?.url` is preferred
            // over the server's `existingPrUrl` (s222).
            setResults({});
            void refetch();
          }}
        >
          Refresh
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading contribution status…</p>
      ) : data?.error ? (
        <Card className="p-4">
          <p className="text-sm text-muted-foreground italic">{data.error}</p>
        </Card>
      ) : (
        <>
          <ContributeGroup
            testid="contribute-group-learnings"
            title="Learnings"
            subtitle="Knowledge & corpus → PRIME"
            repos={data?.learnings ?? []}
            activeSlug={activeSlug}
            results={results}
            onCreate={handleCreate}
          />
          <ContributeGroup
            testid="contribute-group-mechanics"
            title="Mechanics"
            subtitle="Code & framework → agi, marketplaces, PAx"
            repos={data?.mechanics ?? []}
            activeSlug={activeSlug}
            results={results}
            onCreate={handleCreate}
          />
        </>
      )}
    </div>
  );
}

function ContributeGroup({
  testid,
  title,
  subtitle,
  repos,
  activeSlug,
  results,
  onCreate,
}: {
  testid: string;
  title: string;
  subtitle: string;
  repos: RepoContributeInfo[];
  activeSlug: string | null;
  results: Record<string, { url?: string; error?: string; alreadyOpen?: boolean }>;
  onCreate: (repo: RepoContributeInfo) => void;
}) {
  return (
    <section data-testid={testid}>
      <div className="mb-2">
        <span className="text-[11px] font-semibold text-foreground uppercase tracking-wider">{title}</span>
        <span className="text-[10px] text-muted-foreground ml-2">{subtitle}</span>
      </div>
      {repos.length === 0 ? (
        <p className="text-[12px] text-muted-foreground italic">No repos in this group.</p>
      ) : (
        <div className="space-y-2">
          {repos.map((repo) => (
            <ContributeRow
              key={repo.slug}
              repo={repo}
              busy={activeSlug === repo.slug}
              result={results[repo.slug]}
              onCreate={() => onCreate(repo)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ContributeRow({
  repo,
  busy,
  result,
  onCreate,
}: {
  repo: RepoContributeInfo;
  busy: boolean;
  result?: { url?: string; error?: string; alreadyOpen?: boolean };
  onCreate: () => void;
}) {
  const hasUpstreamErr = Boolean(repo.error);
  const canCreate = repo.commitsAhead > 0 && !hasUpstreamErr;
  const prUrl = result?.url ?? repo.existingPrUrl;
  const prAlreadyOpen = Boolean(repo.existingPrUrl) || result?.alreadyOpen;

  return (
    <Card className="p-3" data-testid={`contribute-row-${repo.slug}`}>
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground leading-tight">{repo.displayName}</span>
            <span className="text-[10px] font-mono text-muted-foreground">
              {repo.upstreamOrg}/{repo.upstream}
            </span>
          </div>
          {hasUpstreamErr ? (
            <p className="text-[11px] text-amber mt-0.5">{repo.error}</p>
          ) : (
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {repo.commitsAhead > 0 ? (
                <>
                  <span className="text-green font-semibold">↑{repo.commitsAhead}</span> ahead of upstream/dev
                  {repo.branch && <span className="font-mono"> · {repo.branch}</span>}
                </>
              ) : (
                <>in sync with upstream/dev</>
              )}
            </p>
          )}
          {result?.error && <p className="text-[11px] text-red mt-1">{result.error}</p>}
        </div>

        <div className="shrink-0 flex items-center gap-2">
          {prUrl ? (
            <a
              href={prUrl}
              target="_blank"
              rel="noreferrer"
              className="text-[11px] text-blue hover:underline"
              data-testid={`contribute-pr-link-${repo.slug}`}
            >
              {prAlreadyOpen ? "View open PR →" : "PR opened →"}
            </a>
          ) : (
            <Button
              size="sm"
              className={cn("text-[11px] h-7", !canCreate && "opacity-50")}
              disabled={!canCreate || busy}
              onClick={onCreate}
              data-testid="contribute-create-pr"
            >
              {busy ? "Drafting…" : "Create PR"}
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
