/**
 * NotificationItem — single notification row in the bell popover.
 *
 * Rendering branches by notification type:
 *   - "iterative-work" (s124 t473): full preview (thumbnail + summary
 *     + project/version chips) for the first FULL_PREVIEW_TTL_MS;
 *     compact (title + project chip + age) afterward. The full artifact
 *     is always reachable by clicking through to the project's chat.
 *   - All other types: the original compact title + body row.
 */

import { cn } from "@/lib/utils";
import { isCompactByAge } from "@/lib/notification-lifecycle.js";
import type { Notification } from "@/types.js";

interface NotificationItemProps {
  notification: Notification;
  onMarkRead: (id: string) => void;
}

interface IterativeWorkNotificationMetadata {
  projectPath?: string;
  status?: "done" | "error";
  thumbnailPath?: string;
  summary?: string;
  taskNumber?: number;
  shipVersion?: string;
}

function isIterativeWorkMetadata(meta: unknown): meta is IterativeWorkNotificationMetadata {
  return typeof meta === "object" && meta !== null && "projectPath" in meta;
}

function getTypeLabel(type: string): string {
  if (type === "error") return "Error";
  if (type === "warning") return "Warning";
  if (type === "iterative-work") return "Iteration";
  if (type.startsWith("tm:")) return "Worker";
  if (type.startsWith("comms:")) return "Comms";
  if (type.startsWith("system:")) return "System";
  return "Info";
}

function getTypeColor(type: string, status?: "done" | "error"): string {
  if (type === "error") return "bg-red";
  if (type === "warning") return "bg-yellow";
  if (type === "iterative-work") return status === "error" ? "bg-red" : "bg-green";
  if (type.startsWith("tm:")) return "bg-blue";
  if (type.startsWith("comms:")) return "bg-green";
  if (type.startsWith("system:")) return "bg-peach";
  return "bg-lavender";
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function projectNameFromPath(path: string): string {
  const segments = path.split("/").filter((s) => s.length > 0);
  return segments[segments.length - 1] ?? path;
}

export function NotificationItem({ notification, onMarkRead }: NotificationItemProps) {
  const isIterativeWork = notification.type === "iterative-work";
  const meta = isIterativeWork && isIterativeWorkMetadata(notification.metadata)
    ? notification.metadata
    : null;
  const isCompact = isCompactByAge(notification);

  return (
    <button
      data-testid="notification-item"
      data-notification-type={notification.type}
      data-compact={String(isCompact)}
      className={cn(
        "w-full text-left px-3 py-2 border-b border-border transition-colors cursor-pointer bg-transparent border-x-0 border-t-0",
        !notification.read ? "bg-secondary/50" : "hover:bg-secondary/30",
      )}
      onClick={() => {
        if (!notification.read) onMarkRead(notification.id);
      }}
    >
      <div className="flex items-start gap-2">
        {/* Unread indicator */}
        <div className="pt-1.5 shrink-0">
          {!notification.read && (
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue" />
          )}
          {notification.read && <span className="inline-block w-1.5 h-1.5" />}
        </div>

        {/* Thumbnail (full-preview window only, when populated) */}
        {isIterativeWork && !isCompact && meta?.thumbnailPath !== undefined && meta.thumbnailPath.length > 0 && (
          <img
            src={meta.thumbnailPath}
            alt=""
            className="w-10 h-10 rounded object-cover shrink-0 bg-secondary"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className={cn("text-[10px] px-1.5 py-0.5 rounded-md text-background font-medium", getTypeColor(notification.type, meta?.status))}>
              {getTypeLabel(notification.type)}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {relativeTime(notification.createdAt)}
            </span>
            {/* Iterative-work footer chips (compact AND full-preview both
                show the project; full-preview adds version + task num) */}
            {meta !== null && (
              <>
                <span className="text-[10px] text-muted-foreground font-mono truncate">
                  · {projectNameFromPath(meta.projectPath ?? "")}
                </span>
                {!isCompact && meta.shipVersion !== undefined && (
                  <span className="text-[10px] text-muted-foreground font-mono">
                    v{meta.shipVersion}
                  </span>
                )}
                {!isCompact && meta.taskNumber !== undefined && (
                  <span className="text-[10px] text-muted-foreground font-mono">
                    t{meta.taskNumber}
                  </span>
                )}
              </>
            )}
          </div>
          <div className="text-[12px] font-medium text-foreground truncate">
            {notification.title}
          </div>
          {/* Body line — hidden in iterative-work compact mode (>24h) */}
          {!isCompact && (
            <div className="text-[11px] text-muted-foreground truncate">
              {meta?.summary ?? notification.body}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}
