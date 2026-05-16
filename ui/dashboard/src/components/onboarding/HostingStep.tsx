/**
 * HostingStep — Configure domain hosting during onboarding.
 *
 * 1. "Do you have a custom domain?" → toggle
 * 2. If yes: enter base domain (e.g. "mysetup.com")
 * 3. Saves to config: hosting.baseDomain
 *
 * Identity is now handled directly by the gateway (no separate ID service).
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
  const [saving, setSaving] = useState(false);

  const isCompleted = status === "completed";

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/onboarding/hosting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseDomain: hasCustomDomain ? baseDomain : "ai.on",
        }),
      });
      if (res.ok) onNext();
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

      <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 onboard-animate-in onboard-stagger-2">
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
