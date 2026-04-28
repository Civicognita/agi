/**
 * IterativeWorkArtifactCard — full-content rendering of an iteration
 * completion artifact, embedded inside a project's chat or canvas surface
 * (s124 rework per cycle 86 owner clarification: "the iterative work
 * notifications should display everything in the toast or canvas for
 * the project the response belongs to").
 *
 * Replaces the prior layout-root IterativeWorkToast which was a global
 * bottom-right popup with truncated content. This card is INLINE in the
 * project's chat/canvas, shows the full artifact, and is naturally
 * scoped because the chat surface itself is already per-project.
 *
 * Renders:
 *   - Status header (project name + done/error pill + relative time)
 *   - Thumbnail image (when t469 populates it)
 *   - Summary line (full, not line-clamped)
 *   - Metadata chips: version, commit hash (short), task number, duration
 *   - COA fingerprint footer (monospace, for audit traceability)
 *   - Error block (when status === "error")
 */

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { Notification } from "@/types.js";

interface IterativeWorkNotificationMetadata {
  projectPath: string;
  cron?: string;
  firedAt?: string;
  completedAt?: string;
  durationMs?: number;
  status?: "done" | "error";
  error?: string;
  thumbnailPath?: string;
  summary?: string;
  chatSessionId?: string;
  taskNumber?: number;
  commitHash?: string;
  shipVersion?: string;
}

function isIterativeWorkMetadata(meta: unknown): meta is IterativeWorkNotificationMetadata {
  return typeof meta === "object" && meta !== null && "projectPath" in meta;
}

function projectNameFromPath(path: string): string {
  const segments = path.split("/").filter((s) => s.length > 0);
  return segments[segments.length - 1] ?? path;
}

function formatDuration(ms: number): string {
  const totalSec = Math.max(1, Math.round(ms / 1000));
  if (totalSec < 60) return `${String(totalSec)}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min < 60) return sec === 0 ? `${String(min)}m` : `${String(min)}m ${String(sec)}s`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  return remMin === 0 ? `${String(hr)}h` : `${String(hr)}h ${String(remMin)}m`;
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${String(Math.round(ms / 60_000))}m ago`;
  if (ms < 86_400_000) return `${String(Math.round(ms / 3_600_000))}h ago`;
  return new Date(iso).toLocaleString();
}

interface IterativeWorkArtifactCardProps {
  notification: Notification;
  /** Compact mode trims the COA footer + condenses metadata chips. Used in
   *  flyout layouts where vertical real estate is tight. */
  compact?: boolean;
  className?: string;
}

export function IterativeWorkArtifactCard({
  notification,
  compact = false,
  className,
}: IterativeWorkArtifactCardProps) {
  const meta = isIterativeWorkMetadata(notification.metadata) ? notification.metadata : null;
  const isError = meta?.status === "error";
  const accentClass = isError ? "border-l-red" : "border-l-green";

  const projectName = meta !== null ? projectNameFromPath(meta.projectPath) : "iteration";
  const summary = meta?.summary ?? notification.body;
  const thumb = meta?.thumbnailPath;
  const duration = meta?.durationMs !== undefined ? formatDuration(meta.durationMs) : null;

  return (
    <Card
      data-testid="iterative-work-artifact-card"
      data-status={meta?.status ?? "unknown"}
      className={cn("p-4 border-l-4 space-y-3", accentClass, className)}
    >
      {/* Header: project · status · relative time */}
      <div className="flex items-center gap-2 text-[12px]">
        <span className="font-mono font-semibold text-foreground">{projectName}</span>
        <span
          className={cn(
            "px-1.5 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wider",
            isError ? "bg-red/15 text-red" : "bg-green/15 text-green",
          )}
        >
          {meta?.status === "error" ? "failed" : "complete"}
        </span>
        <span className="text-muted-foreground">·</span>
        <span className="text-muted-foreground">
          {relativeTime(notification.createdAt)}
        </span>
      </div>

      {/* Body: thumbnail + summary side-by-side, or summary-only when no thumb */}
      <div className={cn("flex gap-3", compact ? "items-center" : "items-start")}>
        {thumb !== undefined && thumb.length > 0 && (
          <img
            src={thumb}
            alt=""
            className={cn(
              "rounded object-cover bg-secondary shrink-0",
              compact ? "w-16 h-16" : "w-32 h-32",
            )}
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        )}
        <div className="flex-1 min-w-0">
          <p className="text-[13px] text-foreground leading-relaxed">{summary}</p>
          {isError && meta?.error !== undefined && (
            <pre className="mt-2 px-2 py-1.5 rounded bg-red/10 text-red text-[11px] font-mono whitespace-pre-wrap">
              {meta.error}
            </pre>
          )}
        </div>
      </div>

      {/* Metadata chips */}
      {meta !== null && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          {meta.shipVersion !== undefined && (
            <span>
              <span className="text-muted-foreground/60 mr-1">version</span>
              <span className="font-mono text-foreground">v{meta.shipVersion}</span>
            </span>
          )}
          {meta.commitHash !== undefined && (
            <span>
              <span className="text-muted-foreground/60 mr-1">commit</span>
              <span className="font-mono text-foreground">{meta.commitHash.slice(0, 7)}</span>
            </span>
          )}
          {meta.taskNumber !== undefined && (
            <span>
              <span className="text-muted-foreground/60 mr-1">task</span>
              <span className="font-mono text-foreground">t{meta.taskNumber}</span>
            </span>
          )}
          {duration !== null && (
            <span>
              <span className="text-muted-foreground/60 mr-1">ran for</span>
              <span className="font-mono text-foreground">{duration}</span>
            </span>
          )}
        </div>
      )}

      {/* COA footer — hidden in compact mode; shown in full as audit trail */}
      {!compact && meta !== null && (
        <div className="pt-2 border-t border-border/50 flex items-center gap-2 text-[10px] text-muted-foreground/70">
          <span className="uppercase tracking-wider">audit</span>
          <span className="font-mono truncate" title={notification.id}>
            {notification.id}
          </span>
        </div>
      )}
    </Card>
  );
}
