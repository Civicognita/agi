/**
 * OwnerProfileStep — Set display name and DM policy.
 */

import { useEffect, useState } from "react";
import { Callout } from "@particle-academy/react-fancy";
import { cn } from "@/lib/utils.js";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import type { OnboardingStepStatus } from "@/types.js";

interface Props {
  onNext: () => void;
  onSkip: () => void;
  status?: OnboardingStepStatus;
}

export function OwnerProfileStep({ onNext, onSkip, status }: Props) {
  const [displayName, setDisplayName] = useState("");
  const [dmPolicy, setDmPolicy] = useState<"pairing" | "open">("pairing");
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const isCompleted = status === "completed";
  const canContinue = isCompleted || displayName.trim().length > 0;

  // Load existing config
  useEffect(() => {
    fetch("/api/onboarding/owner-profile")
      .then((r) => r.json() as Promise<{ displayName?: string; dmPolicy?: string }>)
      .then((data) => {
        if (data.displayName) setDisplayName(data.displayName);
        if (data.dmPolicy === "open") setDmPolicy("open");
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/onboarding/owner-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: displayName.trim(), dmPolicy }),
      });
      if (res.ok) onNext();
    } catch {
      // Save failed, proceed anyway
      onNext();
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) return null;

  return (
    <div className="flex flex-col gap-5 sm:gap-6">
      <div className="onboard-animate-in">
        <h2 className="text-xl sm:text-2xl font-semibold mb-1">
          Who are you?
        </h2>
        <p className="text-[13px] sm:text-sm text-muted-foreground leading-relaxed">
          Tell Aionima who it's working for. Your display name appears in agent
          conversations, and the DM policy controls how unknown contacts reach you.
        </p>
      </div>

      {isCompleted && (
        <Callout color="green" className="text-sm text-muted-foreground onboard-animate-in">
          Owner profile already configured. Continue to keep current details, or edit below.
        </Callout>
      )}

      <div className="flex flex-col gap-4 onboard-animate-in onboard-stagger-1">
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="displayName">
            Display Name
          </label>
          <Input
            id="displayName"
            placeholder="Your name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            How the agent refers to you in conversations.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">DM Policy</span>
          <div className="flex flex-col gap-2">
            <label
              className={cn(
                "flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors",
                dmPolicy === "pairing"
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-border/80",
              )}
            >
              <input
                type="radio"
                name="dmPolicy"
                value="pairing"
                checked={dmPolicy === "pairing"}
                onChange={() => setDmPolicy("pairing")}
                className="mt-0.5"
              />
              <div>
                <p className="text-sm font-medium">Pairing</p>
                <p className="text-xs text-muted-foreground">
                  Unknown contacts must enter a pairing code before they can interact
                  with your agent. Recommended for personal use.
                </p>
              </div>
            </label>
            <label
              className={cn(
                "flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors",
                dmPolicy === "open"
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-border/80",
              )}
            >
              <input
                type="radio"
                name="dmPolicy"
                value="open"
                checked={dmPolicy === "open"}
                onChange={() => setDmPolicy("open")}
                className="mt-0.5"
              />
              <div>
                <p className="text-sm font-medium">Open</p>
                <p className="text-xs text-muted-foreground">
                  Anyone can message your agent. They start as unverified (limited
                  capabilities) until manually promoted.
                </p>
              </div>
            </label>
          </div>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 onboard-animate-in onboard-stagger-2">
        <Button
          onClick={handleSave}
          disabled={saving || !canContinue}
          className="w-full sm:w-auto"
        >
          {saving ? "Saving..." : "Continue"}
        </Button>
        <Button variant="ghost" onClick={onSkip} className="w-full sm:w-auto">
          Skip for now
        </Button>
      </div>
    </div>
  );
}
