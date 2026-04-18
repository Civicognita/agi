/**
 * AionimaIdStep — Connect services via OAuth Device Flow.
 *
 * Shows three provider cards (GitHub, Google, Discord). Each can be
 * independently connected via the device code flow — no popup required.
 * The user visits the verification URL on any device and enters the code.
 *
 * Works in both central and local ID service modes — the backend resolves
 * the correct ID service URL before proxying the device flow.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card.js";
import { Badge } from "@/components/ui/badge.js";
import { Button } from "@/components/ui/button.js";
import { startDeviceFlow, pollDeviceFlow, fetchDeviceFlowStatus } from "@/api.js";
import type { OnboardingStepStatus, OnboardingState } from "@/types.js";

interface Props {
  onNext: () => void;
  onSkip: () => void;
  status?: OnboardingStepStatus;
  idMode?: OnboardingState["idMode"];
}

interface ProviderState {
  status: "idle" | "connecting" | "connected" | "error";
  userCode?: string;
  verificationUri?: string;
  accountLabel?: string;
  error?: string;
}

interface ProviderDef {
  id: string;
  label: string;
  description: string;
}

const PROVIDERS: ProviderDef[] = [
  { id: "github", label: "GitHub", description: "Repository access, dev mode, PR tools" },
  { id: "google", label: "Google", description: "Gmail channel, email identity" },
  { id: "discord", label: "Discord", description: "Discord bot, guild management" },
];

function initialStates(): Record<string, ProviderState> {
  const map: Record<string, ProviderState> = {};
  for (const p of PROVIDERS) map[p.id] = { status: "idle" };
  return map;
}

export function AionimaIdStep({ onNext, onSkip, status }: Props) {
  const [providerStates, setProviderStates] = useState<Record<string, ProviderState>>(initialStates);
  const pollRefs = useRef<Record<string, ReturnType<typeof setInterval>>>({});

  const isCompleted = status === "completed";

  // Cleanup all polling intervals on unmount
  useEffect(() => {
    const refs = pollRefs.current;
    return () => {
      for (const interval of Object.values(refs)) clearInterval(interval);
    };
  }, []);

  // Hydrate connected state from stored secrets on mount
  useEffect(() => {
    let cancelled = false;
    fetchDeviceFlowStatus()
      .then((data) => {
        if (cancelled) return;
        if (data.services.length === 0) return;
        setProviderStates((prev) => {
          const next = { ...prev };
          for (const svc of data.services) {
            if (next[svc.provider]) {
              next[svc.provider] = { status: "connected" };
            }
          }
          return next;
        });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const setProviderState = useCallback((provider: string, update: ProviderState) => {
    setProviderStates((prev) => ({ ...prev, [provider]: update }));
  }, []);

  const stopPolling = useCallback((provider: string) => {
    if (pollRefs.current[provider]) {
      clearInterval(pollRefs.current[provider]);
      delete pollRefs.current[provider];
    }
  }, []);

  const startPolling = useCallback((provider: string) => {
    stopPolling(provider);
    const interval = setInterval(() => {
      void (async () => {
        try {
          const result = await pollDeviceFlow();
          if (result.status === "completed") {
            stopPolling(provider);
            setProviderState(provider, {
              status: "connected",
              accountLabel: result.accountLabel,
            });
          } else if (result.status === "expired" || result.status === "error") {
            stopPolling(provider);
            setProviderState(provider, {
              status: "error",
              error: result.error ?? "Authorization expired. Please try again.",
            });
          }
          // pending / no_session: keep polling
        } catch {
          // Network error — keep polling
        }
      })();
    }, 3000);
    pollRefs.current[provider] = interval;
  }, [stopPolling, setProviderState]);

  const handleConnect = useCallback(async (provider: string) => {
    stopPolling(provider);
    setProviderState(provider, { status: "connecting" });
    try {
      const data = await startDeviceFlow(provider);
      setProviderState(provider, {
        status: "connecting",
        userCode: data.userCode,
        verificationUri: data.verificationUri,
      });
      startPolling(provider);
    } catch (err) {
      setProviderState(provider, {
        status: "error",
        error: err instanceof Error ? err.message : "Connection failed",
      });
    }
  }, [stopPolling, setProviderState, startPolling]);

  const anyConnected = PROVIDERS.some((p) => providerStates[p.id]?.status === "connected");

  return (
    <div className="flex flex-col gap-5 sm:gap-6">
      <div className="onboard-animate-in">
        <h2 className="text-xl sm:text-2xl font-semibold mb-1">
          Connect Your Services
        </h2>
        <p className="text-[13px] sm:text-sm text-muted-foreground leading-relaxed">
          Link your accounts through secure device authorization. No data leaves your network.
        </p>
      </div>

      {isCompleted && (
        <div className="p-3 rounded-lg bg-green/5 border border-green/20 text-sm text-muted-foreground onboard-animate-in">
          Services are already connected. Continue to keep the current connections.
        </div>
      )}

      <div className="flex flex-col gap-3 onboard-animate-in onboard-stagger-1">
        {PROVIDERS.map((p) => {
          const state = providerStates[p.id] ?? { status: "idle" };
          return (
            <Card key={p.id} className="p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold">{p.label}</div>
                  <div className="text-[11px] text-muted-foreground">{p.description}</div>
                </div>

                {state.status === "idle" && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={() => void handleConnect(p.id)}
                  >
                    Connect
                  </Button>
                )}

                {state.status === "connecting" && !state.userCode && (
                  <span className="text-[12px] text-muted-foreground shrink-0">Starting...</span>
                )}

                {state.status === "connected" && (
                  <Badge variant="outline" className="shrink-0 text-green border-green/50">
                    ✓ {state.accountLabel ?? "Connected"}
                  </Badge>
                )}
              </div>

              {state.status === "connecting" && state.userCode && (
                <div className="mt-3 p-3 rounded-lg bg-muted/30 border border-border">
                  <div className="text-[11px] text-muted-foreground mb-1">
                    Visit this URL and enter the code:
                  </div>
                  <div className="mb-2">
                    <a
                      href={state.verificationUri}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[12px] text-primary underline font-mono break-all"
                    >
                      {state.verificationUri}
                    </a>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[16px] font-mono font-bold tracking-widest text-foreground">
                      {state.userCode}
                    </span>
                    <button
                      type="button"
                      onClick={() => void navigator.clipboard.writeText(state.userCode!)}
                      className="text-[10px] px-2 py-0.5 rounded border border-border hover:bg-accent transition-colors"
                    >
                      Copy
                    </button>
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-2 flex items-center gap-1">
                    <span className="animate-pulse">●</span>
                    <span>Waiting for authorization...</span>
                  </div>
                </div>
              )}

              {state.status === "error" && (
                <div className="mt-2 text-[11px] text-destructive flex items-center gap-1 flex-wrap">
                  <span>{state.error}</span>
                  <button
                    type="button"
                    onClick={() => void handleConnect(p.id)}
                    className="underline"
                  >
                    Try again
                  </button>
                </div>
              )}
            </Card>
          );
        })}
      </div>

      <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 onboard-animate-in onboard-stagger-2">
        <Button onClick={onNext} disabled={!anyConnected && !isCompleted} className="w-full sm:w-auto">
          Continue
        </Button>
        <Button variant="ghost" onClick={onSkip} className="w-full sm:w-auto">
          Skip for now
        </Button>
      </div>
    </div>
  );
}
