/**
 * AionimaIncomingPrsPanel — inbound PR review queue (Dev Mode).
 *
 * Incoming tab content for the _aionima meta-project. The First Custodian
 * reviews open PRs that contributors' personal forks (incl. forks-of-forks)
 * have opened INTO upstream/dev — across every core repo. Each PR shows its
 * author + head fork (cross-fork flagged), draft state, and a link to GitHub
 * (where the merge happens — an irreversible write we never automate).
 *
 * The "Test in VM" action (fetch the PR head → run the suite → serve at
 * test.ai.on) lands with its backend in the next slice; this panel is the
 * read-only review queue.
 */

import { useState, useEffect, useCallback } from "react";
import { Textarea } from "@particle-academy/react-fancy";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useIncomingStatus } from "../hooks.js";
import { fetchPrComments, postPrComment, type PrComment } from "../api.js";
import type { IncomingPrInfo, IncomingRepoStatus } from "../types.js";

/** Expandable PR comment thread + composer (Wave 2c). */
function PrCommentThread({ slug, prNumber }: { slug: string; prNumber: number }) {
  const [comments, setComments] = useState<PrComment[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setComments(await fetchPrComments(slug, prNumber));
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load comments");
    } finally {
      setLoading(false);
    }
  }, [slug, prNumber]);

  useEffect(() => { void load(); }, [load]);

  const post = async () => {
    if (body.trim() === "") return;
    setPosting(true);
    setError(null);
    try {
      const c = await postPrComment(slug, prNumber, body.trim());
      setComments((prev) => [...(prev ?? []), c]);
      setBody("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to post comment");
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="mt-2 border-t border-border/40 pt-2 space-y-2" data-testid={`pr-comments-${slug}-${String(prNumber)}`}>
      {loading && comments === null && <p className="text-[11px] text-muted-foreground">Loading comments…</p>}
      {comments !== null && comments.length === 0 && (
        <p className="text-[11px] text-muted-foreground italic">No comments yet.</p>
      )}
      {comments?.map((c) => (
        <div key={c.id} className="text-[11px]" data-testid="pr-comment">
          <span className="font-mono font-semibold text-foreground">{c.authorLogin}</span>
          <span className="text-muted-foreground/60"> · {new Date(c.createdAt).toLocaleString()}</span>
          <p className="text-muted-foreground whitespace-pre-wrap mt-0.5">{c.body}</p>
        </div>
      ))}
      <div className="flex flex-col gap-1.5">
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Comment on this PR…"
          rows={2}
          className="text-[12px]"
          data-testid={`pr-comment-input-${slug}-${String(prNumber)}`}
        />
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            className="text-[11px] h-7"
            disabled={posting || body.trim() === ""}
            onClick={() => void post()}
            data-testid={`pr-comment-post-${slug}-${String(prNumber)}`}
          >
            {posting ? "Posting…" : "Comment"}
          </Button>
          {error !== null && <span className="text-[11px] text-red">{error}</span>}
        </div>
      </div>
    </div>
  );
}

interface PrTestPrep {
  supported: boolean;
  command: string | null;
  note: string;
  error?: string;
}

export function AionimaIncomingPrsPanel() {
  const { data, isLoading, refetch } = useIncomingStatus();

  // Only surface repos that actually have open PRs — most won't.
  const reposWithPrs = (data?.repos ?? []).filter((r) => r.prs.length > 0);
  const totalPrs = reposWithPrs.reduce((n, r) => n + r.prs.length, 0);

  return (
    <div className="space-y-5" data-testid="aionima-incoming-panel">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div>
          <span className="text-sm font-semibold text-foreground">Incoming PRs</span>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Open PRs from personal forks into <span className="font-mono">upstream/dev</span> — review &amp; test before merging.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="text-[11px] h-7"
          onClick={() => void refetch()}
          data-testid="aionima-incoming-refresh"
        >
          Refresh
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading incoming PRs…</p>
      ) : data?.error ? (
        <Card className="p-4" data-testid="aionima-incoming-error">
          <p className="text-sm text-muted-foreground italic">{data.error}</p>
        </Card>
      ) : totalPrs === 0 ? (
        <Card className="p-4" data-testid="aionima-incoming-empty">
          <p className="text-sm text-muted-foreground italic">
            No open PRs targeting any upstream <span className="font-mono">dev</span> branch.
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {reposWithPrs.map((repo) => (
            <IncomingRepoGroup key={repo.slug} repo={repo} />
          ))}
        </div>
      )}
    </div>
  );
}

function IncomingRepoGroup({ repo }: { repo: IncomingRepoStatus }) {
  return (
    <section data-testid={`aionima-incoming-group-${repo.slug}`}>
      <div className="mb-2">
        <span className="text-[11px] font-semibold text-foreground uppercase tracking-wider">
          {repo.displayName}
        </span>
        <span className="text-[10px] font-mono text-muted-foreground ml-2">
          {repo.upstreamOrg}/{repo.upstream} · {repo.prs.length} open
        </span>
      </div>
      <div className="space-y-2">
        {repo.prs.map((pr) => (
          <IncomingPrRow key={`${repo.slug}#${pr.number}`} pr={pr} />
        ))}
      </div>
    </section>
  );
}

function IncomingPrRow({ pr }: { pr: IncomingPrInfo }) {
  const [prep, setPrep] = useState<PrTestPrep | null>(null);
  const [busy, setBusy] = useState(false);
  const [showComments, setShowComments] = useState(false);

  async function handleTest() {
    setBusy(true);
    try {
      const res = await fetch(`/api/dev/incoming/${pr.slug}/pr/${String(pr.number)}/test`, { method: "POST" });
      const body = (await res.json()) as PrTestPrep;
      setPrep(res.ok ? body : { supported: false, command: null, note: "", error: body.error ?? `HTTP ${String(res.status)}` });
    } catch (err) {
      setPrep({ supported: false, command: null, note: "", error: err instanceof Error ? err.message : "request failed" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-3" data-testid={`aionima-incoming-pr-${pr.slug}-${pr.number}`}>
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-mono text-muted-foreground">#{pr.number}</span>
            <span className="text-sm font-medium text-foreground leading-tight truncate">{pr.title}</span>
            {pr.isDraft && (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-surface1 text-muted-foreground font-semibold uppercase tracking-wide">
                Draft
              </span>
            )}
            {pr.isCrossRepo && (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue/10 text-blue/80 font-semibold" title="From a different fork than upstream">
                fork
              </span>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            <span className="font-mono">{pr.authorLogin}</span>
            {" · "}
            <span className="font-mono">{pr.headRepoFullName}:{pr.headRef}</span>
            {pr.headSha && <span className="font-mono text-muted-foreground/70"> @{pr.headSha.slice(0, 7)}</span>}
          </p>
        </div>

        <div className="shrink-0 flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="text-[11px] h-7"
            disabled={busy}
            onClick={() => void handleTest()}
            data-testid={`aionima-incoming-test-${pr.slug}-${pr.number}`}
          >
            {busy ? "Preparing…" : "Test in VM"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-[11px] h-7"
            onClick={() => setShowComments((s) => !s)}
            data-testid={`aionima-incoming-comments-toggle-${pr.slug}-${pr.number}`}
          >
            {showComments ? "Hide comments" : "Comments"}
          </Button>
          <a
            href={pr.htmlUrl}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] text-blue hover:underline"
            data-testid={`aionima-incoming-view-${pr.slug}-${pr.number}`}
          >
            View on GitHub →
          </a>
        </div>
      </div>

      {prep && (
        <div className="mt-2 border-t border-border/40 pt-2" data-testid={`aionima-incoming-testprep-${pr.slug}-${pr.number}`}>
          {prep.error ? (
            <p className="text-[11px] text-red">{prep.error}</p>
          ) : prep.command ? (
            <>
              <p className="text-[11px] text-muted-foreground mb-1">{prep.note}</p>
              <code className="block text-[11px] font-mono bg-surface0 rounded px-2 py-1 select-all">
                {prep.command}
              </code>
            </>
          ) : (
            <p className="text-[11px] text-muted-foreground italic">{prep.note}</p>
          )}
        </div>
      )}

      {showComments && <PrCommentThread slug={pr.slug} prNumber={pr.number} />}
    </Card>
  );
}
