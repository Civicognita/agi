/**
 * Services route — manage infrastructure services (databases, caches, etc.).
 */

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { fetchServices, startService, stopService, restartService } from "@/api.js";
import type { ServiceInfo } from "@/types.js";

export default function ServicesPage() {
  const [services, setServices] = useState<ServiceInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(() => {
    fetchServices()
      .then(setServices)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function handleAction(id: string, action: "start" | "stop" | "restart") {
    setBusy(id);
    try {
      if (action === "start") await startService(id);
      else if (action === "stop") await stopService(id);
      else await restartService(id);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return <div className="text-[12px] text-muted-foreground py-8">Loading services...</div>;
  }

  if (error) {
    return <div className="text-[12px] text-red py-8">Failed to load services: {error}</div>;
  }

  if (services.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="text-[13px] text-muted-foreground mb-2">No services registered</div>
        <div className="text-[11px] text-muted-foreground">
          Services are registered by plugins. Install a service plugin (e.g. MySQL, Redis)
          to see them here.
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {services.map((svc) => {
        const statusColor = {
          running: "bg-green",
          stopped: "bg-muted-foreground",
          error: "bg-red",
        }[svc.status];

        const statusText = {
          running: "text-green",
          stopped: "text-muted-foreground",
          error: "text-red",
        }[svc.status];

        return (
          <div key={svc.id} className="rounded-xl bg-card border border-border p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className={cn("inline-block w-2 h-2 rounded-full", statusColor)} />
                <span className="text-[13px] font-semibold text-foreground">{svc.name}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue/15 text-blue font-medium">
                  service
                </span>
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {svc.status === "stopped" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === svc.id}
                    onClick={() => void handleAction(svc.id, "start")}
                    className="text-[11px] h-7"
                  >
                    Start
                  </Button>
                ) : (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy === svc.id}
                      onClick={() => void handleAction(svc.id, "restart")}
                      className="text-[11px] h-7"
                    >
                      Restart
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy === svc.id}
                      onClick={() => void handleAction(svc.id, "stop")}
                      className="text-[11px] h-7"
                    >
                      Stop
                    </Button>
                  </>
                )}
              </div>
            </div>
            <div className="text-[12px] text-muted-foreground mb-2">{svc.description}</div>
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
              <span className={cn("font-semibold capitalize", statusText)}>{svc.status}</span>
              <span>Image: <code className="text-foreground">{svc.image}</code></span>
              {svc.port !== null && (
                <span>Port: <code className="text-foreground">{svc.port}</code></span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
