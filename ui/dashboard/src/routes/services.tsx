/**
 * Services route — manage infrastructure services (databases, caches, etc.).
 */

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PageScroll } from "@/components/PageScroll.js";
import {
  fetchServices, startService, stopService, restartService,
  fetchCircuitBreakers, resetCircuitBreaker, resetAllCircuitBreakers,
  type CircuitBreakersResponse,
} from "@/api.js";
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
    <CircuitBreakerSection />
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

/**
 * CircuitBreakerSection — surfaces the gateway's persistent circuit-breaker
 * state at the top of the Services page (s143 t570). Closes the loop opened
 * in cycles 153-157: the breaker auto-trips broken hosting services to keep
 * boot bounded, but until now the only way to see + reset breakers was
 * editing gateway.json by hand. Owner directive cycle 156: "we need a
 * circuit breaker in the Services page for failing services we're
 * responsible for."
 *
 * Hidden when nothing is tracked. Otherwise lists every breaker with status
 * pill, failure count, last error (truncated), per-service Reset button,
 * and a "Reset all" affordance when multiple are tracked.
 */
function CircuitBreakerSection(): React.ReactElement | null {
  const [data, setData] = useState<CircuitBreakersResponse | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(() => {
    fetchCircuitBreakers().then(setData).catch(() => setData(null));
  }, []);

  useEffect(() => {
    refresh();
    // Refresh every 10s so a freshly-tripped breaker surfaces without
    // requiring a manual reload. Cheap — single GET against gateway.json.
    const t = setInterval(refresh, 10_000);
    return () => clearInterval(t);
  }, [refresh]);

  if (data === null || data.totalCount === 0) {
    return null;
  }

  const entries = Object.entries(data.states);

  async function handleReset(serviceId: string): Promise<void> {
    setBusy(serviceId);
    try {
      await resetCircuitBreaker(serviceId);
      refresh();
    } finally {
      setBusy(null);
    }
  }

  async function handleResetAll(): Promise<void> {
    setBusy("__all__");
    try {
      await resetAllCircuitBreakers();
      refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-xl bg-card border border-border p-4 mb-6" data-testid="circuit-breakers-section">
      <div className="flex items-center gap-2 mb-3">
        <span className="inline-block w-2 h-2 rounded-full bg-yellow shrink-0" />
        <span className="text-[14px] font-semibold text-foreground">
          Circuit-broken services
        </span>
        <span className="text-[11px] text-muted-foreground ml-2">
          {data.openCount} open · {data.halfOpenCount} half-open · {data.totalCount} tracked
        </span>
        {data.totalCount > 1 && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy !== null}
            onClick={() => void handleResetAll()}
            className="text-[11px] h-7 ml-auto"
          >
            {busy === "__all__" ? "Resetting..." : "Reset all"}
          </Button>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground mb-3">
        Services that failed to start N consecutive times. Open breakers are skipped on the next boot
        until reset or until the cool-down elapses (default 24h).
      </p>
      <div className="flex flex-col gap-2">
        {entries.map(([id, state]) => {
          const statusPillClass = state.status === "open"
            ? "bg-red/15 text-red"
            : state.status === "half-open"
              ? "bg-yellow/15 text-yellow"
              : "bg-green/15 text-green";
          return (
            <div key={id} className="rounded-lg border border-border bg-background p-3 flex items-start gap-3" data-testid={`circuit-breaker-${id}`}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={cn("text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded", statusPillClass)}>
                    {state.status}
                  </span>
                  <code className="text-[11px] font-mono text-foreground truncate">{id}</code>
                  <span className="text-[10px] text-muted-foreground ml-auto shrink-0">
                    {state.failures} {state.failures === 1 ? "failure" : "failures"}
                  </span>
                </div>
                {state.lastError && (
                  <p className="text-[10px] text-muted-foreground font-mono truncate" title={state.lastError}>
                    {state.lastError}
                  </p>
                )}
                {state.lastFailureAt && (
                  <p className="text-[10px] text-muted-foreground/70">
                    Last failure: {new Date(state.lastFailureAt).toLocaleString()}
                  </p>
                )}
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={busy !== null}
                onClick={() => void handleReset(id)}
                className="text-[11px] h-7 shrink-0"
                data-testid={`circuit-breaker-reset-${id}`}
              >
                {busy === id ? "Resetting..." : "Reset"}
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
