/**
 * ReportCard — single report card for the reports grid.
 *
 * Shows project badge, file/token count, gist, COA fingerprint, worker badges, timestamp.
 */

import { Link } from "react-router";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import type { ReportSummary } from "@/types.js";

const DOMAIN_COLORS: Record<string, string> = {
  code: "var(--color-blue)",
  k: "var(--color-green)",
  ux: "var(--color-mauve)",
  strat: "var(--color-peach)",
  comm: "var(--color-yellow)",
  ops: "var(--color-teal)",
  gov: "var(--color-red)",
  data: "var(--color-lavender)",
};

function getDomain(worker: string): string {
  // "$W.code.hacker" → "code", "code.hacker" → "code"
  const cleaned = worker.replace("$W.", "");
  return cleaned.split(".")[0] ?? "k";
}

function getDomainColor(workers: string[]): string {
  if (workers.length === 0) return "var(--color-overlay0)";
  const domain = getDomain(workers[0]);
  return DOMAIN_COLORS[domain] ?? "var(--color-overlay0)";
}

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

function shortWorkerName(worker: string): string {
  return worker.replace("$W.", "");
}

interface ReportCardProps {
  report: ReportSummary;
}

export function ReportCard({ report }: ReportCardProps) {
  const accentColor = getDomainColor(report.workers);

  return (
    <Link
      to={`/reports/${encodeURIComponent(report.coaReqId)}`}
      className="block no-underline"
    >
      <div
        className="rounded-lg border border-border bg-card p-4 hover:bg-secondary/50 transition-colors"
        style={{ borderLeftWidth: "3px", borderLeftColor: accentColor }}
      >
        {/* Top row: project badge + counts */}
        <div className="flex items-center justify-between mb-2">
          <div>
            {report.project && (
              <Badge variant="outline" className="text-[10px]">
                {report.project.name}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground">{report.fileCount} files</span>
            <span className="text-[10px] text-muted-foreground">{formatTokens(report.totalTokens)}</span>
          </div>
        </div>

        {/* Gist */}
        {report.gist && (
          <p className="text-[12px] text-foreground leading-relaxed mb-3 line-clamp-3">
            {report.gist}
          </p>
        )}

        {/* COA fingerprint */}
        <div className="text-[10px] text-muted-foreground font-mono mb-2">
          {report.coaReqId}
        </div>

        {/* Bottom: worker badges + timestamp */}
        <div className="flex items-center justify-between">
          <div className="flex flex-wrap gap-1">
            {report.workers.slice(0, 4).map((w) => (
              <Badge
                key={w}
                variant="secondary"
                className="text-[9px] px-1.5 py-0"
              >
                {shortWorkerName(w)}
              </Badge>
            ))}
            {report.workers.length > 4 && (
              <span className="text-[9px] text-muted-foreground">+{report.workers.length - 4}</span>
            )}
          </div>
          <span className="text-[10px] text-muted-foreground">
            {formatRelativeTime(report.createdAt)}
          </span>
        </div>
      </div>
    </Link>
  );
}
