/**
 * NotificationItem — single notification row in the bell popover.
 */

import { cn } from "@/lib/utils";
import type { Notification } from "@/types.js";

interface NotificationItemProps {
  notification: Notification;
  onMarkRead: (id: string) => void;
}

function getTypeLabel(type: string): string {
  if (type.startsWith("bots:")) return "Worker";
  if (type.startsWith("comms:")) return "Comms";
  if (type.startsWith("system:")) return "System";
  return "Info";
}

function getTypeColor(type: string): string {
  if (type.startsWith("bots:")) return "bg-blue";
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

export function NotificationItem({ notification, onMarkRead }: NotificationItemProps) {
  return (
    <button
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

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className={cn("text-[10px] px-1.5 py-0.5 rounded-md text-background font-medium", getTypeColor(notification.type))}>
              {getTypeLabel(notification.type)}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {relativeTime(notification.createdAt)}
            </span>
          </div>
          <div className="text-[12px] font-medium text-foreground truncate">
            {notification.title}
          </div>
          <div className="text-[11px] text-muted-foreground truncate">
            {notification.body}
          </div>
        </div>
      </div>
    </button>
  );
}
