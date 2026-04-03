/**
 * ChatHistory — overlay panel for browsing and resuming saved chat sessions.
 *
 * Appears inside ChatFlyout. Lists past sessions with context label, preview,
 * timestamp, and message count. Click to resume, delete button to remove.
 */

import { useCallback, useEffect, useState, type FC } from "react";
import { fetchChatSessions, deleteChatSession } from "../api.js";
import type { ChatSessionSummary } from "../api.js";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${String(mins)}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${String(hours)}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${String(days)}d ago`;
  return new Date(iso).toLocaleDateString();
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ChatHistoryProps {
  open: boolean;
  onClose: () => void;
  onResume: (sessionId: string, context: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const ChatHistory: FC<ChatHistoryProps> = ({ open, onClose, onResume }) => {
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchChatSessions();
      setSessions(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load history");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const handleDelete = useCallback(async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      await deleteChatSession(id);
      setSessions((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    }
  }, []);

  if (!open) return null;

  return (
    <div className="absolute inset-0 z-10 flex flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0">
        <span className="font-bold text-sm text-foreground">Chat History</span>
        <Button variant="outline" size="xs" onClick={onClose}>
          Back
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {loading && sessions.length === 0 && (
          <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
            Loading...
          </div>
        )}

        {error && (
          <div className="px-3 py-2 rounded-md bg-secondary text-red text-xs mb-2">
            {error}
          </div>
        )}

        {!loading && sessions.length === 0 && !error && (
          <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
            No saved conversations
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          {sessions.map((s) => (
            <button
              key={s.id}
              onClick={() => { onResume(s.id, s.context); onClose(); }}
              className={cn(
                "w-full text-left px-3 py-2.5 rounded-lg border border-border",
                "bg-card hover:bg-secondary transition-colors cursor-pointer",
                "flex flex-col gap-1",
              )}
            >
              <div className="flex items-center justify-between">
                <span className={cn(
                  "text-[12px] font-semibold",
                  s.context === "general" ? "text-muted-foreground" : "text-blue",
                )}>
                  {s.contextLabel}
                </span>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-muted-foreground">
                    {relativeTime(s.updatedAt)}
                  </span>
                  <span
                    onClick={(e) => void handleDelete(e, s.id)}
                    className="text-[10px] text-red cursor-pointer px-1 hover:bg-red/10 rounded"
                    title="Delete"
                  >
                    &#10007;
                  </span>
                </div>
              </div>
              <div className="text-[11px] text-foreground/70 truncate">
                {s.lastPreview || "Empty conversation"}
              </div>
              <div className="text-[10px] text-muted-foreground">
                {String(s.messageCount)} message{s.messageCount !== 1 ? "s" : ""}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
