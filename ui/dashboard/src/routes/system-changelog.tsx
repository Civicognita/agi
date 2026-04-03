/**
 * Changelog page — git commit history of deployed upgrades.
 * Each commit is an expandable card showing files changed and diff summary.
 */

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fetchChangelog } from "../api.js";
import type { ChangelogCommit } from "../api.js";

const PAGE_SIZE = 30;

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function relativeDate(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diff = now - then;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(iso);
}

/** Group commits by date for visual separation. */
function groupByDate(commits: ChangelogCommit[]): { date: string; commits: ChangelogCommit[] }[] {
  const groups: { date: string; commits: ChangelogCommit[] }[] = [];
  let current: { date: string; commits: ChangelogCommit[] } | null = null;

  for (const commit of commits) {
    const dateKey = new Date(commit.date).toLocaleDateString(undefined, {
      weekday: "long", year: "numeric", month: "long", day: "numeric",
    });
    if (!current || current.date !== dateKey) {
      current = { date: dateKey, commits: [] };
      groups.push(current);
    }
    current.commits.push(commit);
  }

  return groups;
}

function CommitCard({ commit }: { commit: ChangelogCommit }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={cn(
        "px-4 py-3 cursor-pointer transition-colors rounded-md",
        expanded ? "bg-surface0/50" : "hover:bg-surface0/30",
      )}
      onClick={() => setExpanded(!expanded)}
    >
      {/* Commit summary row */}
      <div className="flex items-start gap-3">
        <span className="text-[11px] font-mono text-blue shrink-0 mt-0.5">{commit.hash}</span>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] text-foreground leading-snug">{commit.subject}</p>
          <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground">
            <span>{commit.author}</span>
            <span>{relativeDate(commit.date)}</span>
            {commit.summary && (
              <span className="ml-auto">{commit.summary}</span>
            )}
          </div>
        </div>
        <span className="text-muted-foreground text-[11px] shrink-0 mt-0.5">
          {expanded ? "▾" : "▸"}
        </span>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="mt-2 ml-[52px] space-y-2">
          {/* Commit body (multi-line message) */}
          {commit.body && (
            <p className="text-[12px] text-muted-foreground whitespace-pre-wrap leading-relaxed">
              {commit.body}
            </p>
          )}

          {/* Files changed */}
          {commit.files.length > 0 && (
            <div className="space-y-0.5">
              <span className="text-[11px] text-muted-foreground font-medium block mb-1">
                Files changed
              </span>
              {commit.files.map((file, i) => {
                // --stat format: " path/to/file | 10 ++++---"
                const pipeIdx = file.lastIndexOf("|");
                const filePath = pipeIdx > 0 ? file.slice(0, pipeIdx).trim() : file;
                const stats = pipeIdx > 0 ? file.slice(pipeIdx + 1).trim() : "";

                return (
                  <div key={i} className="flex items-center gap-2 text-[11px] font-mono">
                    <span className="text-foreground truncate flex-1">{filePath}</span>
                    {stats && (
                      <span className="shrink-0 text-muted-foreground">
                        {stats.split("").map((ch, j) =>
                          ch === "+" ? <span key={j} className="text-green">+</span>
                          : ch === "-" ? <span key={j} className="text-red">-</span>
                          : ch,
                        )}
                      </span>
                    )}
                  </div>
                );
              })}
              {commit.summary && (
                <p className="text-[10px] text-muted-foreground mt-1">{commit.summary}</p>
              )}
            </div>
          )}

          {/* Timestamps */}
          <p className="text-[10px] text-muted-foreground">
            {formatDate(commit.date)} at {formatTime(commit.date)}
          </p>
        </div>
      )}
    </div>
  );
}

export default function ChangelogPage() {
  const [commits, setCommits] = useState<ChangelogCommit[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchChangelog(PAGE_SIZE, 0);
      setCommits(result.commits);
      setTotal(result.total);
    } catch {
      setCommits([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    setLoadingMore(true);
    try {
      const result = await fetchChangelog(PAGE_SIZE, commits.length);
      setCommits((prev) => [...prev, ...result.commits]);
    } catch { /* ignore */ }
    finally { setLoadingMore(false); }
  }, [commits.length]);

  useEffect(() => { void load(); }, [load]);

  const groups = groupByDate(commits);
  const hasMore = commits.length < total;

  return (
    <div className="space-y-4">
      <p className="text-[13px] text-muted-foreground">
        Commit history — each entry is a change that was pulled and deployed.
      </p>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : commits.length === 0 ? (
        <Card className="p-6">
          <p className="text-sm text-muted-foreground">
            No commit history available.
          </p>
        </Card>
      ) : (
        <>
          {groups.map((group) => (
            <div key={group.date}>
              <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm py-1.5 mb-1">
                <span className="text-[12px] font-medium text-muted-foreground">{group.date}</span>
              </div>
              <Card className="divide-y divide-border/50 overflow-hidden">
                {group.commits.map((commit) => (
                  <CommitCard key={commit.fullHash} commit={commit} />
                ))}
              </Card>
            </div>
          ))}

          {hasMore && (
            <div className="flex justify-center pt-2">
              <Button
                variant="outline"
                size="sm"
                disabled={loadingMore}
                onClick={() => void loadMore()}
              >
                {loadingMore ? "Loading..." : `Load more (${total - commits.length} remaining)`}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
