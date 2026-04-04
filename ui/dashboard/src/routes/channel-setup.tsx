/**
 * ChannelSetupPage — Gateway > Channels.
 *
 * Two views:
 * 1. ChannelGrid: a grid of all five channel cards showing their current
 *    status (Connected / Not configured). Click a card to enter the wizard.
 * 2. ChannelWizard: the per-channel step wizard, mounted when a channel
 *    is selected.
 *
 * Status is fetched from GET /api/onboarding/channels (same endpoint used
 * in the onboarding flow). Gracefully handles API failure with empty state.
 */

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils.js";
import { Card } from "@/components/ui/card.js";
import { CHANNEL_DEFS } from "@/components/channel-defs.js";
import { ChannelWizard } from "@/components/ChannelWizard.js";

interface ChannelStatus {
  id: string;
  enabled: boolean;
  configured: boolean;
}

function ChannelGrid({
  onSelect,
  statuses,
}: {
  onSelect: (id: string) => void;
  statuses: Record<string, ChannelStatus>;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold mb-1">Channels</h1>
        <p className="text-sm text-muted-foreground">
          Connect messaging channels so Aionima can receive and send messages on your behalf.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {CHANNEL_DEFS.map((def) => {
          const status = statuses[def.id];
          const isConnected = status?.enabled && status?.configured;

          return (
            <button
              key={def.id}
              type="button"
              onClick={() => onSelect(def.id)}
              className="text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-xl"
            >
              <Card
                className={cn(
                  "h-full transition-colors cursor-pointer hover:bg-secondary/50",
                  isConnected && "border-green-500/30",
                )}
              >
                <div className="p-4 flex flex-col gap-3">
                  {/* Icon + status badge row */}
                  <div className="flex items-center justify-between">
                    <div
                      className={cn(
                        "w-10 h-10 rounded-xl flex items-center justify-center text-white shrink-0",
                        def.color,
                      )}
                    >
                      {def.icon}
                    </div>
                    <span
                      className={cn(
                        "text-[10px] font-semibold px-2 py-0.5 rounded-full",
                        isConnected
                          ? "bg-green-500/10 text-green-500 border border-green-500/30"
                          : "bg-secondary text-muted-foreground",
                      )}
                    >
                      {isConnected ? "Connected" : "Not configured"}
                    </span>
                  </div>

                  {/* Name + description */}
                  <div>
                    <p className="text-sm font-semibold leading-tight">{def.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                      {def.description}
                    </p>
                  </div>

                  {/* Configure link */}
                  <p className="text-xs text-primary font-medium">
                    {isConnected ? "Reconfigure" : "Set up"} &rarr;
                  </p>
                </div>
              </Card>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function ChannelSetupPage() {
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<Record<string, ChannelStatus>>({});

  const loadStatuses = () => {
    fetch("/api/onboarding/channels")
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (
          data: {
            channels: Array<{ id: string; enabled: boolean; config: Record<string, string> }>;
          } | null,
        ) => {
          if (!data) return;
          const map: Record<string, ChannelStatus> = {};
          for (const ch of data.channels) {
            map[ch.id] = {
              id: ch.id,
              enabled: ch.enabled,
              configured: Object.keys(ch.config ?? {}).length > 0,
            };
          }
          setStatuses(map);
        },
      )
      .catch(() => {});
  };

  useEffect(() => {
    loadStatuses();
  }, []);

  if (selectedChannel) {
    return (
      <div className="max-w-lg">
        <ChannelWizard
          channelId={selectedChannel}
          onBack={() => setSelectedChannel(null)}
          onComplete={() => {
            setSelectedChannel(null);
            loadStatuses();
          }}
        />
      </div>
    );
  }

  return (
    <ChannelGrid
      onSelect={setSelectedChannel}
      statuses={statuses}
    />
  );
}
