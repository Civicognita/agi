/**
 * CompletionStep — Final onboarding screen summarizing completed steps.
 */

import { cn } from "@/lib/utils.js";
import { Button } from "@/components/ui/button.js";
import type { OnboardingState, OnboardingStepStatus } from "@/types.js";

interface Props {
  onComplete: () => void;
  state: OnboardingState;
}

const STEP_ENTRIES: Array<{ key: keyof OnboardingState["steps"]; label: string }> = [
  { key: "hosting", label: "Hosting" },
  { key: "aionimaId", label: "Identity" },
  { key: "aiKeys", label: "AI Provider Keys" },
  { key: "ownerProfile", label: "Owner Profile" },
  { key: "channels", label: "Channels" },
  { key: "federation", label: "Network" },
  { key: "zeroMeMind", label: "0ME: Mind" },
  { key: "zeroMeSoul", label: "0ME: Soul" },
  { key: "zeroMeSkill", label: "0ME: Skill" },
];

function StatusIcon({ status }: { status: OnboardingStepStatus }) {
  if (status === "completed") {
    return (
      <span className="flex items-center justify-center w-5 h-5 rounded-full bg-green/10 text-green border border-green/30 text-xs font-bold shrink-0">
        ✓
      </span>
    );
  }
  if (status === "skipped") {
    return (
      <span className="flex items-center justify-center w-5 h-5 rounded-full bg-surface1 text-muted-foreground text-xs font-bold shrink-0">
        —
      </span>
    );
  }
  return (
    <span className="flex items-center justify-center w-5 h-5 rounded-full bg-yellow-500/10 border border-yellow-500/30 text-yellow-500 text-[8px] shrink-0">
      ●
    </span>
  );
}

export function CompletionStep({ onComplete, state }: Props) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] py-6 sm:py-8">
      {/* Logo */}
      <div className="mb-6 sm:mb-8 onboard-animate-scale onboard-logo-glow">
        <img
          src="/spore-seed-clear.svg"
          alt="Aionima"
          className="w-20 h-auto sm:w-28"
        />
      </div>

      <div className="text-center mb-6 sm:mb-8 onboard-animate-in onboard-stagger-1">
        <h2 className="text-2xl sm:text-3xl font-bold mb-2">The mycelium is awake</h2>
        <p className="text-[13px] sm:text-sm text-muted-foreground leading-relaxed max-w-md mx-auto">
          Aionima is configured and listening. From here, every action you take
          ripples through the network — visible, accountable, and meaningful. You can
          revisit any step from Gateway &gt; Onboarding.
        </p>
      </div>

      <div className="flex flex-col gap-2 w-full max-w-sm mb-8 onboard-animate-in onboard-stagger-2">
        {STEP_ENTRIES.map(({ key, label }) => {
          const status = state.steps[key];
          return (
            <div key={key} className="flex items-center gap-3 py-1">
              <StatusIcon status={status} />
              <span
                className={cn(
                  "text-sm",
                  status === "skipped" || status === "pending"
                    ? "text-muted-foreground"
                    : "text-foreground",
                )}
              >
                {label}
                {status === "skipped" && (
                  <span className="ml-1 text-xs">(skipped)</span>
                )}
                {status === "pending" && (
                  <span className="ml-1 text-xs">(not completed)</span>
                )}
              </span>
            </div>
          );
        })}
      </div>

      <div className="onboard-animate-in onboard-stagger-3">
        <Button size="lg" onClick={onComplete} className="w-full sm:w-auto min-w-[200px]">
          Enter Aionima
        </Button>
      </div>
    </div>
  );
}
