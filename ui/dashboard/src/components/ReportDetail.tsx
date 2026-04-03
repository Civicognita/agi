/**
 * ReportDetail — full report view with burn summary and file rendering.
 */

import { Link, useParams } from "react-router";
import ReactMarkdown from "react-markdown";
import { markdownComponents } from "@/lib/markdown.js";
import { Badge } from "@/components/ui/badge";
import { useReport } from "@/hooks.js";

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

function formatDuration(ms: number): string {
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)}m`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function ReportDetail() {
  const { coaReqId } = useParams<{ coaReqId: string }>();
  const { data: report, loading, error } = useReport(coaReqId ?? "");

  if (loading) return <p className="text-[12px] text-muted-foreground">Loading report...</p>;
  if (error) return <p className="text-[12px] text-destructive">{error}</p>;
  if (!report) return <p className="text-[12px] text-muted-foreground">Report not found.</p>;

  const components = markdownComponents({ prose: true });

  return (
    <div className="max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <Link to="/reports" className="text-[12px] text-blue hover:underline no-underline" style={{ color: "var(--color-blue)" }}>
          Reports
        </Link>
        <span className="text-[12px] text-muted-foreground">/</span>
        <span className="text-[12px] font-mono text-foreground">{report.coaReqId}</span>
        {report.project && (
          <Badge variant="outline" className="text-[10px]">{report.project.name}</Badge>
        )}
        <span className="text-[12px] text-muted-foreground ml-auto">{formatDate(report.createdAt)}</span>
      </div>

      {/* Burn summary bar */}
      <div className="flex items-center gap-4 p-3 rounded-lg bg-secondary/50 border border-border mb-6">
        <div className="text-center">
          <div className="text-[18px] font-bold text-foreground">{formatTokens(report.burn.totalTokens)}</div>
          <div className="text-[10px] text-muted-foreground">Tokens</div>
        </div>
        <div className="w-px h-8 bg-border" />
        <div className="text-center">
          <div className="text-[18px] font-bold text-foreground">${report.burn.costEstimate.toFixed(2)}</div>
          <div className="text-[10px] text-muted-foreground">Cost</div>
        </div>
        <div className="w-px h-8 bg-border" />
        <div className="text-center">
          <div className="text-[18px] font-bold text-foreground">{formatDuration(report.burn.durationMs)}</div>
          <div className="text-[10px] text-muted-foreground">Duration</div>
        </div>
        <div className="w-px h-8 bg-border" />
        <div className="text-center">
          <div className="text-[18px] font-bold text-foreground">{report.files.length}</div>
          <div className="text-[10px] text-muted-foreground">Files</div>
        </div>
      </div>

      {/* Report files */}
      {report.files.map((file) => (
        <div key={file.filename} className="mb-6">
          <div className="flex items-center gap-2 border-b border-border pb-1 mb-3">
            <span className="text-[12px] font-mono font-semibold text-foreground">{file.filename}</span>
          </div>
          <div className="text-foreground">
            <ReactMarkdown components={components}>{file.content}</ReactMarkdown>
          </div>
        </div>
      ))}
    </div>
  );
}
