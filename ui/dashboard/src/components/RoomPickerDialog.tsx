/**
 * RoomPickerDialog — modal for binding a channel room to a project.
 *
 * CHN-D (s165) slice 3b — second visible-payoff slice on the channels
 * track. Lists available rooms from the selected channel (via
 * GET /api/channels/:id/rooms), shows which are already bound, lets
 * owner click to bind via POST /api/projects/rooms.
 *
 * Today supports `discord` as the only available channel (the only
 * adapter with a `/rooms` endpoint live). When CHN-I/J/K/L migrate
 * the other adapters, the channel selector populates from them too.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Modal } from "@particle-academy/react-fancy";
import { Button } from "@/components/ui/button";
import {
  addProjectRoom,
  fetchAvailableChannelRooms,
  type AvailableChannelRoom,
  type ProjectRoomBinding,
} from "../api";

interface RoomPickerDialogProps {
  open: boolean;
  onClose: () => void;
  projectPath: string;
  /** Currently-bound rooms — used to mark "already bound" in the list. */
  boundRooms: ProjectRoomBinding[];
  /** Called after a successful bind so the parent refetches its list. */
  onBound: () => void;
}

// Channels that have a /rooms endpoint shipped today. Extend as
// CHN-I/J/K/L migrate other adapters to the new SDK.
const AVAILABLE_CHANNELS: Array<{ id: string; label: string }> = [
  { id: "discord", label: "💬 Discord" },
];

export function RoomPickerDialog({
  open,
  onClose,
  projectPath,
  boundRooms,
  onBound,
}: RoomPickerDialogProps) {
  const [selectedChannel, setSelectedChannel] = useState<string>("discord");
  const [available, setAvailable] = useState<AvailableChannelRoom[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bindingKey, setBindingKey] = useState<string | null>(null);

  const boundKeys = useMemo(() => {
    const set = new Set<string>();
    for (const b of boundRooms) set.add(`${b.channelId}::${b.roomId}`);
    return set;
  }, [boundRooms]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setAvailable(await fetchAvailableChannelRooms(selectedChannel));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [selectedChannel]);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  const handleBind = useCallback(
    async (room: AvailableChannelRoom) => {
      const key = `${room.channelId}::${room.roomId}`;
      setBindingKey(key);
      setError(null);
      try {
        await addProjectRoom(projectPath, {
          channelId: room.channelId,
          roomId: room.roomId,
          label: room.label,
          kind: room.kind,
          privacy: room.privacy,
        });
        onBound();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBindingKey(null);
      }
    },
    [projectPath, onBound],
  );

  // Group available rooms by group label for visual sections.
  const byGroup = useMemo(() => {
    const groups: Record<string, AvailableChannelRoom[]> = {};
    for (const r of available) {
      const key = r.group;
      if (!groups[key]) groups[key] = [];
      groups[key]!.push(r);
    }
    return groups;
  }, [available]);

  if (!open) return null;

  return (
    <Modal open={open} onClose={onClose} title="Bind a channel room" size="lg" data-testid="room-picker-dialog">
      <div className="flex flex-col gap-3 min-h-[400px] max-h-[70vh]">
        {/* Channel selector */}
        <div className="flex items-center gap-2 text-[12px]">
          <span className="text-muted-foreground">Channel:</span>
          {AVAILABLE_CHANNELS.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`px-3 py-1 rounded text-[12px] transition-colors ${
                selectedChannel === c.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-foreground hover:bg-muted/70"
              }`}
              onClick={() => setSelectedChannel(c.id)}
              data-testid={`room-picker-channel-${c.id}`}
            >
              {c.label}
            </button>
          ))}
          <Button variant="outline" size="xs" onClick={() => void load()} disabled={loading} className="ml-auto">
            {loading ? "Loading…" : "Refresh"}
          </Button>
        </div>

        {error !== null && (
          <div className="text-[12px] text-red px-3 py-2 rounded bg-red/5 border border-red/20" data-testid="room-picker-error">
            {error}
          </div>
        )}

        {/* Rooms list */}
        <div className="flex-1 min-h-0 overflow-y-auto pr-1">
          {loading && available.length === 0 && (
            <div className="text-[12px] text-muted-foreground italic text-center py-8">
              Loading rooms…
            </div>
          )}
          {!loading && available.length === 0 && error === null && (
            <div className="text-[12px] text-muted-foreground italic text-center py-8" data-testid="room-picker-empty">
              No rooms available. Make sure the bot is connected + invited to a server.
            </div>
          )}
          {Object.entries(byGroup).map(([groupName, rooms]) => (
            <div key={groupName} className="mb-3" data-testid={`room-picker-group-${groupName.replace(/[^a-zA-Z0-9]/g, "_")}`}>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1 px-2">
                {groupName}
              </div>
              <div className="space-y-1">
                {rooms.map((r) => {
                  const key = `${r.channelId}::${r.roomId}`;
                  const isBound = boundKeys.has(key);
                  return (
                    <div
                      key={key}
                      className="flex items-center gap-2 px-3 py-2 rounded border border-border/40 hover:border-border transition-colors"
                      data-testid={`room-picker-room-${r.channelId}-${r.roomId.replace(/[^a-zA-Z0-9]/g, "_")}`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-[12px] font-medium text-foreground truncate">
                          {r.kind === "forum" && "📁 "}
                          {r.kind === "thread" && "🧵 "}
                          {(r.kind === "dm" || r.kind === "group") && "👥 "}
                          {(r.kind === "channel" || r.kind === "text" || r.kind === undefined) && "# "}
                          {r.label}
                        </div>
                        <div className="text-[10px] text-muted-foreground font-mono mt-0.5 truncate">
                          {r.roomId}
                        </div>
                      </div>
                      {isBound ? (
                        <span className="text-[10px] text-muted-foreground px-2 py-0.5 rounded bg-muted">
                          Bound
                        </span>
                      ) : (
                        <Button
                          variant="outline"
                          size="xs"
                          onClick={() => void handleBind(r)}
                          disabled={bindingKey === key}
                          data-testid={`room-picker-bind-${r.channelId}-${r.roomId.replace(/[^a-zA-Z0-9]/g, "_")}`}
                        >
                          {bindingKey === key ? "Binding…" : "Bind"}
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex justify-end pt-2 border-t border-border">
          <Button variant="outline" size="sm" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </Modal>
  );
}
