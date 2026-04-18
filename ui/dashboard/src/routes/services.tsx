/**
 * Services route — manage infrastructure services (databases, caches, etc.).
 */

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PageScroll } from "@/components/PageScroll.js";
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
    return <PageScroll><div className="text-[12px] text-muted-foreground py-8">Loading services...</div></PageScroll>;
  }

  if (error) {
    return <PageScroll><div className="text-[12px] text-red py-8">Failed to load services: {error}</div></PageScroll>;
  }

  // Only show services whose image is locally available. If imageAvailable is
  // absent on the response (older backend), treat it as true for backward compat.
  const visibleServices = services.filter((svc) => svc.imageAvailable !== false);

  if (visibleServices.length === 0) {
    return (
      <PageScroll>
      <div className="text-center py-12">
        <div className="text-[13px] text-muted-foreground mb-2">No services registered</div>
        <div className="text-[11px] text-muted-foreground">
          Services are registered by plugins. Install a service plugin (e.g. MySQL, Redis)
          to see them here.
        </div>
      </div>
      </PageScroll>
    );
  }

  return (
    <PageScroll>
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {visibleServices.map((svc) => {
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
          <div key={svc.id} className="rounded-xl bg-card border border-border p-4 flex flex-col">
            <div className="flex items-center gap-2 mb-1.5">
              <span className={cn("inline-block w-2 h-2 rounded-full shrink-0", statusColor)} />
              <span className="text-[14px] font-semibold text-foreground">{svc.name}</span>
              <span className={cn("text-[10px] font-semibold capitalize ml-auto shrink-0", statusText)}>{svc.status}</span>
            </div>
            <p className="text-[11px] text-muted-foreground mb-2">{svc.description}</p>
            {svc.extensions && svc.extensions.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-2">
                {svc.extensions.map(ext => (
                  <span key={ext} className="text-[9px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-mono">
                    {ext}
                  </span>
                ))}
              </div>
            )}
            <div className="text-[10px] text-muted-foreground mb-3 flex flex-col gap-0.5 mt-auto">
              <span>Image: <code className="text-foreground">{svc.image.startsWith("ghcr.io/civicognita/") ? svc.image.slice("ghcr.io/civicognita/".length) : svc.image}</code></span>
              {svc.port !== null && (
                <span>Port: <code className="text-foreground">{svc.port}</code></span>
              )}
            </div>
            <div className="flex gap-1.5 border-t border-border pt-2">
              {svc.status === "stopped" ? (
                <Button
                  size="sm"
                  variant="default"
                  disabled={busy === svc.id}
                  onClick={() => void handleAction(svc.id, "start")}
                  className="text-[11px] h-7 flex-1"
                >
                  {busy === svc.id ? "Starting..." : "Start"}
                </Button>
              ) : (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === svc.id}
                    onClick={() => void handleAction(svc.id, "restart")}
                    className="text-[11px] h-7 flex-1"
                  >
                    Restart
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === svc.id}
                    onClick={() => void handleAction(svc.id, "stop")}
                    className="text-[11px] h-7 flex-1"
                  >
                    Stop
                  </Button>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
    </PageScroll>
  );
}
