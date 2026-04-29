/**
 * HostingStep — Configure domain and identity service hosting during onboarding.
 *
 * 1. "Do you have a custom domain?" → toggle
 * 2. If yes: enter base domain (e.g. "mysetup.com")
 * 3. "Where should your identity service run?"
 *    - Central (recommended): Uses id.aionima.ai — no setup needed
 *    - Local: Deploys ID service at id.{baseDomain}
 * 4. If local: check setup status, offer Podman container setup
 * 5. Saves to config: hosting.baseDomain, idService.local.enabled
 */

import { useState } from "react";
import { Callout } from "@particle-academy/react-fancy";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { cn } from "@/lib/utils.js";
import type { OnboardingStepStatus } from "@/types.js";

interface Props {
  onNext: () => void;
  onSkip: () => void;
  status?: OnboardingStepStatus;
}

export function HostingStep({ onNext, onSkip, status }: Props) {
  const [hasCustomDomain, setHasCustomDomain] = useState(false);
  const [baseDomain, setBaseDomain] = useState("ai.on");
  const [idMode, setIdMode] = useState<"central" | "local">("central");
  const [saving, setSaving] = useState(false);
  const [localSetupStatus, setLocalSetupStatus] = useState<"idle" | "running" | "done" | "error">("idle");

  const isCompleted = status === "completed";

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/onboarding/hosting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseDomain: hasCustomDomain ? baseDomain : "ai.on",
          idMode,
        }),
      });
      if (res.ok) {
        // If local mode, trigger setup
        if (idMode === "local") {
          setLocalSetupStatus("running");
          try {
            const setupRes = await fetch("/api/onboarding/hosting/setup-local-id", {
              method: "POST",
            });
            setLocalSetupStatus(setupRes.ok ? "done" : "error");
          } catch {
            setLocalSetupStatus("error");
          }
        }
        onNext();
      }
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-5 sm:gap-6">
      <div className="onboard-animate-in">
        <h2 className="text-xl sm:text-2xl font-semibold mb-1">
          Hosting Setup
        </h2>
        <p className="text-[13px] sm:text-sm text-muted-foreground leading-relaxed">
          Configure how Aionima is hosted on your network. This determines your
          dashboard URL and where your identity service runs.
        </p>
      </div>

      {isCompleted && (
        <Callout color="green" className="text-sm text-muted-foreground onboard-animate-in">
          Hosting is already configured. Continue to keep existing settings, or update below.
        </Callout>
      )}

      {/* Custom domain toggle */}
      <div className="flex flex-col gap-3 onboard-animate-in onboard-stagger-1">
        <p className="text-sm font-medium">Do you have a custom domain?</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setHasCustomDomain(false)}
            className={cn(
              "px-4 py-2 rounded-lg text-sm border transition-colors",
              !hasCustomDomain
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border text-muted-foreground hover:border-primary/50",
            )}
          >
            No, use default (ai.on)
          </button>
          <button
            type="button"
            onClick={() => setHasCustomDomain(true)}
            className={cn(
              "px-4 py-2 rounded-lg text-sm border transition-colors",
              hasCustomDomain
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border text-muted-foreground hover:border-primary/50",
            )}
          >
            Yes, I have a domain
          </button>
        </div>

        {hasCustomDomain && (
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">
              Base Domain
            </label>
            <Input
              type="text"
              placeholder="mysetup.com"
              value={baseDomain}
              onChange={(e) => setBaseDomain(e.target.value)}
              className="font-mono text-sm"
            />
            <p className="text-[11px] text-muted-foreground">
              Your dashboard will be at https://{baseDomain}
            </p>
          </div>
        )}
      </div>

      {/* Identity service mode */}
      <div className="flex flex-col gap-3 onboard-animate-in onboard-stagger-2">
        <p className="text-sm font-medium">Where should your identity service run?</p>

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setIdMode("central")}
            className={cn(
              "flex items-start gap-3 p-4 rounded-lg border text-left transition-colors",
              idMode === "central"
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/50",
            )}
          >
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-bold shrink-0 mt-0.5">
              C
            </div>
            <div>
              <p className="text-sm font-medium">
                Central <span className="text-[10px] text-primary font-normal ml-1">Recommended</span>
              </p>
              <p className="text-xs text-muted-foreground">
                Uses id.aionima.ai — no setup needed. Your OAuth tokens are managed
                by the Aionima central identity service.
              </p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => setIdMode("local")}
            className={cn(
              "flex items-start gap-3 p-4 rounded-lg border text-left transition-colors",
              idMode === "local"
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/50",
            )}
          >
            <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-foreground text-xs font-bold shrink-0 mt-0.5">
              L
            </div>
            <div>
              <p className="text-sm font-medium">Local</p>
              <p className="text-xs text-muted-foreground">
                Deploys the ID service at id.{hasCustomDomain ? baseDomain : "ai.on"} on
                this server. Full control over your OAuth credentials and tokens.
                Requires PostgreSQL.
              </p>
            </div>
          </button>
        </div>

        {idMode === "local" && localSetupStatus === "running" && (
          <div className="p-3 rounded-lg bg-secondary text-sm text-muted-foreground">
            Setting up local ID service...
          </div>
        )}
        {idMode === "local" && localSetupStatus === "error" && (
          <Callout color="red" className="text-sm">
            Local ID setup failed. You can set it up manually later via
            <code className="mx-1 text-xs">scripts/setup-local.sh</code>
          </Callout>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 onboard-animate-in onboard-stagger-3">
        <Button onClick={handleSave} disabled={saving} className="w-full sm:w-auto">
          {saving ? "Saving..." : "Continue"}
        </Button>
        <Button variant="ghost" onClick={onSkip} className="w-full sm:w-auto">
          Skip for now
        </Button>
      </div>
    </div>
  );
}
