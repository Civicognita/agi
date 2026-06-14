/**
 * ChannelsPanel — read-only listing of channel-room bindings for a project.
 *
 * CHN-D (s165) slice 3a — first visible-payoff slice on the channels track.
 * Renders the project's bound channel rooms in a table-ish layout with
 * channel-emoji prefix + label + roomId + boundAt timestamp. Surfaces a
 * "Remove" button per row that calls DELETE /api/projects/rooms/:c/:r.
 *
 * Room-picker dialog (slice 3b) lands next — for now, owner adds bindings
 * via the HTTP API directly OR via the future picker. The listing IS the
 * minimum-viable surface; the picker is the ergonomic add path.
 *
 * Renders inside ProjectDetail's "channels" tab (coordinate mode).
 */

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  fetchProjectRooms,
  removeProjectRoom,
  type ProjectRoomBinding,
} from "../api";
import { RoomPickerDialog } from "./RoomPickerDialog.js";

interface ChannelsPanelProps {
  projectPath: string;
}

function channelEmoji(channelId: string): string {
  switch (channelId) {
    case "discord": return "💬";
    case "telegram": return "✈️";
    case "slack": return "💼";
    case "email":
    case "gmail": return "📧";
    case "whatsapp": return "🟢";
    case "signal": return "🔐";
    default: return "📡";
  }
}

function kindEmoji(kind: string | undefined): string {
  if (kind === undefined) return "";
  if (kind === "forum") return "📁 ";
  if (kind === "voice") return "🔊 ";
  if (kind === "dm" || kind === "group" || kind === "group-dm") return "👥 ";
  if (kind === "thread") return "🧵 ";
  if (kind === "mailbox" || kind === "label") return "🏷️ ";
  return "# ";
}

export function ChannelsPanel({ projectPath }: ChannelsPanelProps) {
  const [bindings, setBindings] = useState<ProjectRoomBinding[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setBindings(await fetchProjectRooms(projectPath));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRemove = useCallback(
    async (channelId: string, roomId: string) => {
      const key = `${channelId}::${roomId}`;
      setBusyKey(key);
      setError(null);
      try {
        await removeProjectRoom(projectPath, channelId, roomId);
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusyKey(null);
      }
    },
    [projectPath, load],
  );

  return (
    <Card className="p-4 gap-0" data-testid="channels-panel">
      <div className="flex items-center justify-between mb-4 pb-2 border-b border-border">
        <div>
          <h3 className="text-base font-semibold text-card-foreground">Channel Rooms</h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Rooms bound to this project. Inbound events from these rooms route here.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="xs" onClick={() => void load()} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </Button>
          <Button
            size="xs"
            onClick={() => setPickerOpen(true)}
            data-testid="channels-panel-add-binding"
          >
            + Add Binding
          </Button>
        </div>
      </div>

      <RoomPickerDialog
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        projectPath={projectPath}
        boundRooms={bindings}
        onBound={() => { void load(); }}
      />

      {error !== null && (
        <div className="text-[12px] text-red mb-3" data-testid="channels-panel-error">
          {error}
        </div>
      )}

      {!loading && bindings.length === 0 && error === null && (
        <div className="text-[12px] text-muted-foreground italic py-4 text-center" data-testid="channels-panel-empty">
          No rooms bound yet. Bind one from the channel's status section in
          Settings → Channels, or use the room picker (coming soon).
        </div>
      )}

      {bindings.length > 0 && (
        <div className="space-y-2" data-testid="channels-panel-list">
          {bindings.map((b) => {
            const key = `${b.channelId}::${b.roomId}`;
            return (
              <div
                key={key}
                className="flex items-center gap-3 p-3 rounded border border-border/60 hover:border-border transition-colors"
                data-testid={`channel-binding-${b.channelId}-${b.roomId.replace(/[^a-zA-Z0-9]/g, "_")}`}
              >
                <span className="text-[18px] shrink-0" aria-hidden>{channelEmoji(b.channelId)}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium text-foreground flex items-center gap-1.5">
                    <span className="text-muted-foreground shrink-0">{kindEmoji(b.kind)}</span>
                    <span className="truncate">{b.label ?? b.roomId}</span>
                    {b.privacy !== undefined && b.privacy !== "public" && (
                      <span className="text-[9px] uppercase px-1.5 py-0 rounded bg-muted text-muted-foreground shrink-0">
                        {b.privacy}
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-muted-foreground font-mono mt-0.5 truncate">
                    {b.channelId} · {b.roomId}
                  </div>
                </div>
                <div className="text-[10px] text-muted-foreground shrink-0">
                  bound {new Date(b.boundAt).toLocaleDateString()}
                </div>
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => void handleRemove(b.channelId, b.roomId)}
                  disabled={busyKey === key}
                  data-testid={`channel-binding-remove-${b.channelId}-${b.roomId.replace(/[^a-zA-Z0-9]/g, "_")}`}
                >
                  {busyKey === key ? "Removing…" : "Remove"}
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
