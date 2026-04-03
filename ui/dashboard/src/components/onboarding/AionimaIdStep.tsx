/**
 * AionimaIdStep (IdentityStep) — Connect your Aionima ID to link accounts.
 *
 * Adapts based on hosting config:
 * - Central mode: Same popup handoff to id.aionima.ai
 * - Local mode: Handoff to local ID service at id.{baseDomain}
 *
 * Both modes use the same handoff flow — the only difference is the URL.
 */

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils.js";
import { Button } from "@/components/ui/button.js";
import type { OnboardingStepStatus, OnboardingState } from "@/types.js";

interface Props {
  onNext: () => void;
  onSkip: () => void;
  status?: OnboardingStepStatus;
  idMode?: OnboardingState["idMode"];
}

interface ConnectedService {
  provider: string;
  role: string;
  accountLabel?: string;
}

export function AionimaIdStep({ onNext, onSkip, status, idMode }: Props) {
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [services, setServices] = useState<ConnectedService[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [idHealthy, setIdHealthy] = useState<boolean | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const popupRef = useRef<Window | null>(null);

  const isCompleted = status === "completed";
  const isLocal = idMode === "local";

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // Check existing status
  useEffect(() => {
    let cancelled = false;
    fetch("/api/onboarding/aionima-id/status")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { step?: string; services?: ConnectedService[] } | null) => {
        if (cancelled || !data) return;
        if (data.services && data.services.length > 0) {
          setServices(data.services);
          setConnected(true);
        } else if (data.step === "completed") {
          setConnected(true);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Check local ID service health if in local mode
  useEffect(() => {
    if (!isLocal) return;
    fetch("/api/onboarding/hosting/local-id-status")
      .then((res) => res.json() as Promise<{ status: string }>)
      .then((data) => setIdHealthy(data.status === "healthy"))
      .catch(() => setIdHealthy(false));
  }, [isLocal]);

  useEffect(() => {
    if (isCompleted) setConnected(true);
  }, [isCompleted]);

  const handleConnect = async () => {
    setConnecting(true);
    setError(null);

    try {
      const res = await fetch("/api/onboarding/aionima-id/start", { method: "POST" });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }

      const { url } = (await res.json()) as { url: string };

      const popup = window.open(url, "aionima-id", "width=600,height=700");
      if (!popup) {
        throw new Error("Popup blocked. Please allow popups for this site.");
      }
      popupRef.current = popup;

      // Poll for completion every 2 seconds
      pollRef.current = setInterval(async () => {
        if (popup.closed && !connected) {
          try {
            const pollRes = await fetch("/api/onboarding/aionima-id/poll");
            if (pollRes.ok) {
              const data = (await pollRes.json()) as {
                status: string;
                services?: ConnectedService[];
              };
              if (data.status === "completed" && data.services) {
                setConnected(true);
                setServices(data.services);
                setConnecting(false);
                if (pollRef.current) clearInterval(pollRef.current);
                return;
              }
            }
          } catch {
            // ignore
          }
          setConnecting(false);
          if (pollRef.current) clearInterval(pollRef.current);
          return;
        }

        try {
          const pollRes = await fetch("/api/onboarding/aionima-id/poll");
          if (!pollRes.ok) return;

          const data = (await pollRes.json()) as {
            status: string;
            services?: ConnectedService[];
          };

          if (data.status === "completed" && data.services) {
            setConnected(true);
            setServices(data.services);
            setConnecting(false);
            if (pollRef.current) clearInterval(pollRef.current);
            popup.close();
          } else if (data.status === "expired" || data.status === "no_handoff") {
            setError("Session expired. Please try again.");
            setConnecting(false);
            if (pollRef.current) clearInterval(pollRef.current);
            popup.close();
          }
        } catch {
          // Network error, keep polling
        }
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection failed");
      setConnecting(false);
    }
  };

  const providerIcon = (provider: string) => {
    if (provider === "google") return "M";
    if (provider === "github") return "G";
    if (provider === "discord") return "D";
    return "?";
  };

  return (
    <div className="flex flex-col gap-5 sm:gap-6">
      <div className="onboard-animate-in">
        <h2 className="text-xl sm:text-2xl font-semibold mb-1">
          Connect your Identity
        </h2>
        <p className="text-[13px] sm:text-sm text-muted-foreground leading-relaxed">
          {isLocal
            ? "Link your accounts through your local Aionima ID service. Your tokens stay on your server."
            : "Link your Google and GitHub accounts through Aionima ID — a single, secure sign-in that connects all your services. Your tokens are encrypted end-to-end and never stored in a browser."}
        </p>
      </div>

      {isCompleted && (
        <div className="p-3 rounded-lg bg-green/5 border border-green/20 text-sm text-muted-foreground onboard-animate-in">
          Identity is already connected. Continue to keep the current connection.
        </div>
      )}

      {/* Local mode: health check */}
      {isLocal && idHealthy === false && (
        <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive onboard-animate-in">
          Local ID service is not reachable. Make sure it's running before connecting.
        </div>
      )}

      {isLocal && idHealthy === true && (
        <div className="p-3 rounded-lg bg-green/5 border border-green/20 text-sm text-muted-foreground onboard-animate-in">
          Local ID service is healthy and ready.
        </div>
      )}

      {/* Connection card */}
      {!connected && (
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 p-4 rounded-lg bg-card border border-border onboard-animate-in onboard-stagger-1">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold text-sm shrink-0">
              ID
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {isLocal ? "Local Identity Service" : "Aionima ID"}
              </p>
              <p className="text-xs text-muted-foreground">
                Google, GitHub, Discord, and more
              </p>
            </div>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={handleConnect}
            disabled={connecting || (isLocal && idHealthy === false)}
            className="w-full sm:w-auto"
          >
            {connecting ? "Connecting..." : "Connect"}
          </Button>
        </div>
      )}

      {/* Connected services list */}
      {connected && services.length > 0 && (
        <div className="flex flex-col gap-2 onboard-animate-in onboard-stagger-1">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Connected Services
          </p>
          {services.map((svc) => (
            <div
              key={`${svc.provider}-${svc.role}`}
              className="flex items-center gap-3 p-3 rounded-lg bg-card border border-border"
            >
              <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-foreground font-semibold text-xs shrink-0">
                {providerIcon(svc.provider)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">
                  {svc.provider === "google" ? "Google" : svc.provider === "github" ? "GitHub" : svc.provider === "discord" ? "Discord" : svc.provider}{" "}
                  <span className="text-muted-foreground font-normal">
                    ({svc.role})
                  </span>
                </p>
                {svc.accountLabel && (
                  <p className="text-xs text-muted-foreground truncate">
                    {svc.accountLabel}
                  </p>
                )}
              </div>
              <span
                className={cn(
                  "text-[10px] font-medium px-1.5 py-0.5 rounded",
                  "bg-green/10 text-green border border-green/30",
                )}
              >
                Connected
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Connected but no services */}
      {connected && services.length === 0 && (
        <div className="p-4 rounded-lg bg-card border border-border onboard-animate-in onboard-stagger-1">
          <p className="text-sm text-muted-foreground">
            Identity linked successfully. You can connect services later from
            your {isLocal ? "local" : "Aionima"} ID dashboard.
          </p>
        </div>
      )}

      {error !== null && (
        <p className="text-xs text-destructive">{error}</p>
      )}

      <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 onboard-animate-in onboard-stagger-2">
        <Button onClick={onNext} disabled={!connected} className="w-full sm:w-auto">
          Continue
        </Button>
        <Button variant="ghost" onClick={onSkip} className="w-full sm:w-auto">
          Skip for now
        </Button>
      </div>
    </div>
  );
}
