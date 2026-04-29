/**
 * NotificationBell — bell icon with dropdown for notifications.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { NotificationItem } from "@/components/NotificationItem.js";
import type { Notification } from "@/types.js";

interface NotificationBellProps {
  notifications: Notification[];
  unreadCount: number;
  onMarkRead: (ids: string[]) => void;
  onMarkAllRead: () => void;
}

export function NotificationBell({ notifications, unreadCount, onMarkRead, onMarkAllRead }: NotificationBellProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const toggle = useCallback(() => setOpen((prev) => !prev), []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={toggle}
        className="relative p-1.5 rounded-lg bg-transparent border-none cursor-pointer text-foreground hover:bg-secondary transition-colors"
        aria-label="Notifications"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>

        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-red text-background text-[10px] font-bold flex items-center justify-center leading-none">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className={cn(
          "absolute right-0 top-full mt-2 w-80 max-h-[420px] flex flex-col",
          "rounded-xl border border-border bg-popover text-popover-foreground shadow-lg z-[300]",
        )}>
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-border">
            <div className="flex items-center gap-1.5">
              <span className="text-[13px] font-semibold text-foreground">Notifications</span>
              {unreadCount > 0 && (
                <span className="text-[11px] text-muted-foreground">({unreadCount} unread)</span>
              )}
            </div>
            {unreadCount > 0 && (
              <button
                onClick={onMarkAllRead}
                className="text-[11px] text-blue hover:underline bg-transparent border-none cursor-pointer"
              >
                Mark all read
              </button>
            )}
          </div>

          {/* Notification list */}
          <div className="overflow-y-auto max-h-[360px]">
            {notifications.length === 0 ? (
              <div className="text-center text-[12px] text-muted-foreground py-8">
                No notifications yet
              </div>
            ) : (
              notifications.map((n) => (
                <NotificationItem
                  key={n.id}
                  notification={n}
                  onMarkRead={(id) => onMarkRead([id])}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
