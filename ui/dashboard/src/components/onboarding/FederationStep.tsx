/**
 * FederationStep — Opt into HIVE network participation during onboarding.
 *
 * Optional (firstboot only):
 * 1. "Participate in HIVE network?" → toggle
 * 2. If yes: configure public URL, register with HIVE-ID
 * 3. Optional seed peers for private networks
 */

import { useState } from "react";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { cn } from "@/lib/utils.js";
import type { OnboardingStepStatus } from "@/types.js";

interface Props {
  onNext: () => void;
  onSkip: () => void;
  status?: OnboardingStepStatus;
}

export function FederationStep({ onNext, onSkip, status }: Props) {
  const [enabled, setEnabled] = useState(false);
  const [publicUrl, setPublicUrl] = useState("");
  const [saving, setSaving] = useState(false);

  const isCompleted = status === "completed";

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/onboarding/federation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled,
          publicUrl: enabled ? publicUrl : undefined,
        }),
      });
      if (res.ok) onNext();
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  const handleSkipFederation = async () => {
    // Save federation as disabled
    try {
      await fetch("/api/onboarding/federation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: false }),
      });
    } catch {
      // ignore
    }
    onSkip();
  };

  return (
    <div className="flex flex-col gap-5 sm:gap-6">
      <div className="onboard-animate-in">
        <h2 className="text-xl sm:text-2xl font-semibold mb-1">
          Network Federation
        </h2>
        <p className="text-[13px] sm:text-sm text-muted-foreground leading-relaxed">
          Join the HIVE network to connect with other Aionima nodes. Your agent
          gets a Global Entity ID (GEID) and can discover peers, verify trust,
          and relay accountability chains.
        </p>
      </div>

      {isCompleted && (
        <div className="p-3 rounded-lg bg-green/5 border border-green/20 text-sm text-muted-foreground onboard-animate-in">
          Federation is already configured.
        </div>
      )}

      {/* Enable/disable toggle */}
      <div className="flex flex-col gap-3 onboard-animate-in onboard-stagger-1">
        <p className="text-sm font-medium">Participate in the HIVE network?</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setEnabled(true)}
            className={cn(
              "px-4 py-2 rounded-lg text-sm border transition-colors",
              enabled
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border text-muted-foreground hover:border-primary/50",
            )}
          >
            Yes, join HIVE
          </button>
          <button
            type="button"
            onClick={() => setEnabled(false)}
            className={cn(
              "px-4 py-2 rounded-lg text-sm border transition-colors",
              !enabled
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border text-muted-foreground hover:border-primary/50",
            )}
          >
            No, standalone
          </button>
        </div>
      </div>

      {/* Federation config */}
      {enabled && (
        <div className="flex flex-col gap-3 onboard-animate-in onboard-stagger-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">
              Public URL for this node
            </label>
            <Input
              type="text"
              placeholder="https://mynode.example.com"
              value={publicUrl}
              onChange={(e) => setPublicUrl(e.target.value)}
              className="font-mono text-sm"
            />
            <p className="text-[11px] text-muted-foreground">
              Other nodes use this URL to discover and communicate with your node.
              Leave empty if you're only connecting outward.
            </p>
          </div>

          <div className="p-3 rounded-lg bg-card border border-border">
            <p className="text-xs text-muted-foreground">
              Your node will register with the HIVE-ID service at id.aionima.ai
              and receive a Global Entity ID (GEID). This ID is portable and
              cryptographically verifiable.
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 onboard-animate-in onboard-stagger-3">
        <Button onClick={handleSave} disabled={saving} className="w-full sm:w-auto">
          {saving ? "Saving..." : enabled ? "Join & Continue" : "Continue"}
        </Button>
        <Button variant="ghost" onClick={handleSkipFederation} className="w-full sm:w-auto">
          Skip for now
        </Button>
      </div>
    </div>
  );
}
