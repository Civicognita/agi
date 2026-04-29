/**
 * IterativeWorkToast — transient overlay shown when an iterative-work
 * iteration completes (s124 t471).
 *
 * Ships as a custom component (not a wrapper around `Toast` from
 * @particle-academy/react-fancy) because the bare Toast primitive only
 * supports title + description + variant — no thumbnail or click-through
 * action. Tracked upstream as a particle-academy enhancement; this component
 * uses the ADF `Card` primitive for chrome so it inherits design tokens
 * + dark/light theming + accessible focus rings.
 *
 * Rendering:
 *   - Card-based container; status drives a left border accent
 *     (green=done, red=error)
 *   - Thumbnail (when metadata.thumbnailPath set) on the left;
 *     populated incrementally as t469 lands the agent-observability hook
 *   - Title + 1-line summary stacked next to thumbnail
 *   - Dismiss button (×) top-right; click-through region elsewhere
 *   - Auto-dismisses via a parent timer (see IterativeWorkToastStack)
 */

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { Notification } from "@/types.js";

/** Mirrors gateway's IterativeWorkNotificationMetadata (gateway-core
 *  iterative-work/notification-mapper.ts). Kept in sync via the wire
 *  contract — neither side can drop fields without breaking the other. */
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

/** Project-name from the absolute path (last segment), so the toast's
 *  click-through hint can read "Open <project>" instead of leaking the
 *  full path. */
function projectName(meta: IterativeWorkNotificationMetadata): string {
  const segments = meta.projectPath.split("/").filter((s) => s.length > 0);
  return segments[segments.length - 1] ?? meta.projectPath;
}

interface IterativeWorkToastProps {
  notification: Notification;
  onDismiss: () => void;
  onClick: () => void;
}

export function IterativeWorkToast({
  notification,
  onDismiss,
  onClick,
}: IterativeWorkToastProps) {
  const meta = isIterativeWorkMetadata(notification.metadata) ? notification.metadata : null;
  const isError = meta?.status === "error";
  const accentClass = isError ? "border-l-red" : "border-l-green";
  const thumb = meta?.thumbnailPath;
  const subline = meta?.summary ?? notification.body;

  return (
    <Card
      data-testid="iterative-work-toast"
      data-status={meta?.status ?? "unknown"}
      className={cn(
        "p-3 pr-2 w-[360px] shadow-lg border-l-4 cursor-pointer hover:bg-secondary/30 transition-colors",
        accentClass,
      )}
      onClick={(e) => {
        // Don't fire click-through when the dismiss button was clicked
        if ((e.target as HTMLElement).closest("[data-toast-dismiss]") !== null) return;
        onClick();
      }}
    >
      <div className="flex items-start gap-3">
        {thumb !== undefined && thumb.length > 0 && (
          <img
            src={thumb}
            alt=""
            className="w-12 h-12 rounded object-cover shrink-0 bg-secondary"
            onError={(e) => {
              // Hide broken thumbnails rather than leaving alt text rendered
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-foreground truncate">
            {notification.title}
          </div>
          <div className="text-[12px] text-muted-foreground line-clamp-2 mt-0.5">
            {subline}
          </div>
          {meta !== null && (
            <div className="flex items-center gap-2 mt-1.5 text-[10px] text-muted-foreground">
              <span className="font-mono">{projectName(meta)}</span>
              {meta.shipVersion !== undefined && (
                <>
                  <span>·</span>
                  <span className="font-mono">v{meta.shipVersion}</span>
                </>
              )}
              {meta.taskNumber !== undefined && (
                <>
                  <span>·</span>
                  <span className="font-mono">t{meta.taskNumber}</span>
                </>
              )}
            </div>
          )}
        </div>
        <button
          type="button"
          data-toast-dismiss
          onClick={onDismiss}
          aria-label="Dismiss notification"
          className="shrink-0 -mt-0.5 -mr-0.5 p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          <span aria-hidden="true" className="text-[14px] leading-none">×</span>
        </button>
      </div>
    </Card>
  );
}
