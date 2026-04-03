/**
 * ServiceControlSection — manages plugin-registered system services.
 * Fetches status and provides install/start/stop/restart controls.
 */

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { fetchPluginSystemServices, controlSystemService } from "../../api.js";
import type { PluginSystemService } from "../../types.js";

interface Props {
  serviceIds?: string[];
}

export function ServiceControlSection({ serviceIds }: Props) {
  const [services, setServices] = useState<PluginSystemService[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  const loadServices = useCallback(async () => {
    try {
      const all = await fetchPluginSystemServices();
      const filtered = serviceIds
        ? all.filter((s) => serviceIds.includes(s.id))
        : all;
      setServices(filtered);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [serviceIds]);

  useEffect(() => {
    void loadServices();
    const interval = setInterval(() => void loadServices(), 10_000);
    return () => clearInterval(interval);
  }, [loadServices]);

  const handleAction = useCallback(async (serviceId: string, action: "start" | "stop" | "restart" | "install") => {
    setActionInProgress(`${serviceId}:${action}`);
    try {
      await controlSystemService(serviceId, action);
      // Refresh after action
      await loadServices();
    } catch {
      // ignore
    } finally {
      setActionInProgress(null);
    }
  }, [loadServices]);

  if (loading) {
    return <div className="text-sm text-muted-foreground">Loading services...</div>;
  }

  if (services.length === 0) {
    return <div className="text-sm text-muted-foreground">No services registered.</div>;
  }

  // Group: show a single install banner if any service in the group is not installed
  const anyNotInstalled = services.some((s) => s.installed === false);
  const anyInstallable = services.some((s) => s.installable);
  const allInstalled = services.every((s) => s.installed !== false);

  return (
    <div className="grid gap-3">
      {/* Install banner — shown when service is not installed */}
      {anyNotInstalled && anyInstallable && (
        <Card className="p-4 border-dashed border-yellow/30 bg-yellow/5">
          <div className="flex items-center gap-4">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-foreground">Not installed</div>
              <div className="text-[12px] text-muted-foreground">
                This service needs to be installed before it can be managed.
              </div>
            </div>
            <button
              type="button"
              disabled={actionInProgress !== null}
              onClick={() => {
                const installable = services.find((s) => s.installed === false && s.installable);
                if (installable) void handleAction(installable.id, "install");
              }}
              className="px-3 py-1.5 text-[12px] rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50 cursor-pointer border-none font-medium"
            >
              {actionInProgress?.endsWith(":install") ? "Installing..." : "Install"}
            </button>
          </div>
        </Card>
      )}

      {/* Service cards */}
      {services.map((svc) => {
        const isInstalled = svc.installed !== false;
        const isRunning = isInstalled && svc.status === "running";
        const isStopped = isInstalled && svc.status === "stopped";

        return (
          <Card key={svc.id} className={cn("p-4 flex items-center gap-4", !isInstalled && "opacity-50")}>
            {/* Status indicator */}
            <div
              className={cn(
                "w-2.5 h-2.5 rounded-full shrink-0",
                !isInstalled ? "bg-surface1" : isRunning ? "bg-green" : isStopped ? "bg-red" : "bg-yellow",
              )}
            />

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-foreground">{svc.name}</div>
              {svc.description && (
                <div className="text-[12px] text-muted-foreground truncate">{svc.description}</div>
              )}
              <div className="text-[11px] text-muted-foreground font-mono mt-0.5">
                {svc.unitName ?? svc.id} — {!isInstalled ? "not installed" : svc.status ?? "unknown"}
              </div>
            </div>

            {/* Action buttons — only when installed */}
            {isInstalled && (
              <div className="flex gap-1.5 shrink-0">
                {isStopped && (
                  <button
                    type="button"
                    disabled={actionInProgress !== null}
                    onClick={() => void handleAction(svc.id, "start")}
                    className="px-2.5 py-1 text-[12px] rounded-md bg-green/15 text-green hover:bg-green/25 transition-colors disabled:opacity-50 cursor-pointer border-none"
                  >
                    {actionInProgress === `${svc.id}:start` ? "Starting..." : "Start"}
                  </button>
                )}
                {isRunning && (
                  <button
                    type="button"
                    disabled={actionInProgress !== null}
                    onClick={() => void handleAction(svc.id, "stop")}
                    className="px-2.5 py-1 text-[12px] rounded-md bg-red/15 text-red hover:bg-red/25 transition-colors disabled:opacity-50 cursor-pointer border-none"
                  >
                    {actionInProgress === `${svc.id}:stop` ? "Stopping..." : "Stop"}
                  </button>
                )}
                <button
                  type="button"
                  disabled={actionInProgress !== null}
                  onClick={() => void handleAction(svc.id, "restart")}
                  className="px-2.5 py-1 text-[12px] rounded-md bg-blue/15 text-blue hover:bg-blue/25 transition-colors disabled:opacity-50 cursor-pointer border-none"
                >
                  {actionInProgress === `${svc.id}:restart` ? "Restarting..." : "Restart"}
                </button>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
