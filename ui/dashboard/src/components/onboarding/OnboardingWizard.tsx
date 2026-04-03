/**
 * OnboardingWizard — Responsive wizard shell for FIRSTBOOT and re-run flows.
 *
 * New step order:
 * Welcome → Hosting → Identity → AI Providers → Owner Profile →
 * Channels → Network → 0ME (Mind/Soul/Skill) → Complete
 *
 * Mobile: bottom sheet step indicator + full-width content.
 * Tablet: collapsible sidebar.
 * Desktop: persistent sidebar + spacious content.
 */

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils.js";
import { WelcomeStep } from "./WelcomeStep.js";
import { HostingStep } from "./HostingStep.js";
import { AiKeysStep } from "./AiKeysStep.js";
import { AionimaIdStep } from "./AionimaIdStep.js";
import { OwnerProfileStep } from "./OwnerProfileStep.js";
import { ChannelsStep } from "./ChannelsStep.js";
import { FederationStep } from "./FederationStep.js";
import { ZeroMeStep } from "./ZeroMeStep.js";
import { CompletionStep } from "./CompletionStep.js";
import type { OnboardingState, OnboardingStepStatus } from "@/types.js";

// ---------------------------------------------------------------------------
// Step definitions
// ---------------------------------------------------------------------------

const ALL_STEPS = [
  { id: "welcome", label: "Welcome", firstbootOnly: true, stateKey: null },
  { id: "hosting", label: "Hosting", firstbootOnly: true, stateKey: "hosting" as const },
  { id: "aionimaId", label: "Identity", firstbootOnly: false, stateKey: "aionimaId" as const },
  { id: "aiKeys", label: "AI Providers", firstbootOnly: false, stateKey: "aiKeys" as const },
  { id: "ownerProfile", label: "Owner Profile", firstbootOnly: false, stateKey: "ownerProfile" as const },
  { id: "channels", label: "Channels", firstbootOnly: false, stateKey: "channels" as const },
  { id: "federation", label: "Network", firstbootOnly: true, stateKey: "federation" as const },
  { id: "zeroMeMind", label: "0ME: Mind", firstbootOnly: false, stateKey: "zeroMeMind" as const },
  { id: "zeroMeSoul", label: "0ME: Soul", firstbootOnly: false, stateKey: "zeroMeSoul" as const },
  { id: "zeroMeSkill", label: "0ME: Skill", firstbootOnly: false, stateKey: "zeroMeSkill" as const },
  { id: "complete", label: "Complete", firstbootOnly: true, stateKey: null },
] as const;

type StepId = (typeof ALL_STEPS)[number]["id"];
type OnboardingStateKey = NonNullable<(typeof ALL_STEPS)[number]["stateKey"]>;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  isFirstboot: boolean;
  onComplete?: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDefaultState(): OnboardingState {
  return {
    firstbootCompleted: false,
    steps: {
      hosting: "pending",
      aionimaId: "pending",
      aiKeys: "pending",
      ownerProfile: "pending",
      channels: "pending",
      federation: "pending",
      zeroMeMind: "pending",
      zeroMeSoul: "pending",
      zeroMeSkill: "pending",
    },
  };
}

async function fetchOnboardingState(): Promise<OnboardingState> {
  const res = await fetch("/api/onboarding/state");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<OnboardingState>;
}

async function updateOnboardingStepState(stepKey: OnboardingStateKey, status: OnboardingStepStatus): Promise<void> {
  await fetch("/api/onboarding/state", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ step: stepKey, status }),
  });
}

// ---------------------------------------------------------------------------
// Step status indicator
// ---------------------------------------------------------------------------

function StepIndicator({ status, isCurrent }: { status: OnboardingStepStatus | null; isCurrent: boolean }) {
  if (isCurrent) {
    return (
      <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary text-primary-foreground text-[9px] font-bold shrink-0">
        ●
      </span>
    );
  }
  if (status === "completed") {
    return (
      <span className="flex items-center justify-center w-5 h-5 rounded-full bg-green/10 text-green border border-green/30 text-[9px] font-bold shrink-0">
        ✓
      </span>
    );
  }
  if (status === "skipped") {
    return (
      <span className="flex items-center justify-center w-5 h-5 rounded-full border border-border text-muted-foreground text-[9px] font-bold shrink-0">
        —
      </span>
    );
  }
  return (
    <span className="flex items-center justify-center w-5 h-5 rounded-full border border-border shrink-0" />
  );
}

// ---------------------------------------------------------------------------
// Mobile progress dots
// ---------------------------------------------------------------------------

function MobileProgressDots({
  steps,
  currentIndex,
  state,
  onSelect,
}: {
  steps: typeof ALL_STEPS extends readonly (infer T)[] ? T[] : never;
  currentIndex: number;
  state: OnboardingState;
  onSelect: (index: number) => void;
}) {
  return (
    <div className="flex items-center justify-center gap-1.5 py-3 px-4 md:hidden">
      {steps.map((step, idx) => {
        const isCurrent = idx === currentIndex;
        const stepStatus = step.stateKey !== null ? state.steps[step.stateKey] : null;
        const isComplete = stepStatus === "completed";
        return (
          <button
            key={step.id}
            onClick={() => onSelect(idx)}
            className={cn(
              "rounded-full transition-all",
              isCurrent
                ? "w-6 h-2 bg-primary"
                : isComplete
                  ? "w-2 h-2 bg-green"
                  : "w-2 h-2 bg-border",
            )}
            aria-label={step.label}
          />
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step content router
// ---------------------------------------------------------------------------

function StepContent({
  stepId,
  state,
  onNext,
  onSkip,
  onComplete,
}: {
  stepId: StepId;
  state: OnboardingState;
  onNext: () => void;
  onSkip: () => void;
  onComplete: () => void;
}) {
  switch (stepId) {
    case "welcome":
      return <WelcomeStep onNext={onNext} />;
    case "hosting":
      return <HostingStep onNext={onNext} onSkip={onSkip} status={state.steps.hosting} />;
    case "aiKeys":
      return <AiKeysStep onNext={onNext} status={state.steps.aiKeys} />;
    case "aionimaId":
      return <AionimaIdStep onNext={onNext} onSkip={onSkip} status={state.steps.aionimaId} idMode={state.idMode} />;
    case "ownerProfile":
      return <OwnerProfileStep onNext={onNext} onSkip={onSkip} status={state.steps.ownerProfile} />;
    case "channels":
      return <ChannelsStep onNext={onNext} onSkip={onSkip} status={state.steps.channels} />;
    case "federation":
      return <FederationStep onNext={onNext} onSkip={onSkip} status={state.steps.federation} />;
    case "zeroMeMind":
      return <ZeroMeStep domain="MIND" onNext={onNext} onSkip={onSkip} />;
    case "zeroMeSoul":
      return <ZeroMeStep domain="SOUL" onNext={onNext} onSkip={onSkip} />;
    case "zeroMeSkill":
      return <ZeroMeStep domain="SKILL" onNext={onNext} onSkip={onSkip} />;
    case "complete":
      return <CompletionStep onComplete={onComplete} state={state} />;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Main wizard
// ---------------------------------------------------------------------------

export function OnboardingWizard({ isFirstboot, onComplete }: Props) {
  const [state, setState] = useState<OnboardingState>(makeDefaultState());
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const visibleSteps = ALL_STEPS.filter(
    (s) => isFirstboot || !s.firstbootOnly,
  );

  const currentStep = visibleSteps[currentStepIndex];

  useEffect(() => {
    fetchOnboardingState()
      .then((s) => setState(s))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (loading || isFirstboot) return;
    const idx = visibleSteps.findIndex((step) => {
      if (step.stateKey === null) return false;
      return state.steps[step.stateKey] !== "completed";
    });
    if (idx >= 0) setCurrentStepIndex(idx);
  }, [loading, isFirstboot, state, visibleSteps]);

  const markStep = async (stateKey: OnboardingStateKey | null, status: OnboardingStepStatus) => {
    if (stateKey === null) return;
    setState((prev) => ({
      ...prev,
      steps: { ...prev.steps, [stateKey]: status },
    }));
    try {
      await updateOnboardingStepState(stateKey, status);
    } catch {
      // Non-fatal
    }
  };

  const handleNext = async () => {
    if (currentStep !== undefined) {
      await markStep(currentStep.stateKey, "completed");
    }
    if (currentStepIndex < visibleSteps.length - 1) {
      setCurrentStepIndex((i) => i + 1);
    } else {
      onComplete?.();
    }
  };

  const handleSkip = async () => {
    if (currentStep !== undefined) {
      await markStep(currentStep.stateKey, "skipped");
    }
    if (currentStepIndex < visibleSteps.length - 1) {
      setCurrentStepIndex((i) => i + 1);
    } else {
      onComplete?.();
    }
  };

  const handleComplete = () => {
    onComplete?.();
  };

  const getStepStatus = (step: (typeof ALL_STEPS)[number]): OnboardingStepStatus | null => {
    if (step.stateKey === null) return null;
    return state.steps[step.stateKey];
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[50vh] text-sm text-muted-foreground">
        Loading...
      </div>
    );
  }

  return (
    <div className="flex flex-col md:flex-row h-full min-h-0">
      {/* Mobile: top bar with current step + hamburger */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card md:hidden">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Step {currentStepIndex + 1}/{visibleSteps.length}
          </span>
          <span className="text-sm font-medium text-foreground">
            {currentStep?.label}
          </span>
        </div>
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="p-2 rounded-md hover:bg-secondary text-muted-foreground"
          aria-label="Toggle step list"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 12h18M3 6h18M3 18h18" />
          </svg>
        </button>
      </div>

      {/* Mobile dropdown step list */}
      {sidebarOpen && (
        <div className="absolute inset-x-0 top-[52px] z-50 bg-card border-b border-border shadow-lg md:hidden">
          <nav className="flex flex-col py-2 px-3 gap-0.5 max-h-[60vh] overflow-y-auto">
            {visibleSteps.map((step, idx) => {
              const isCurrent = idx === currentStepIndex;
              const stepStatus = getStepStatus(step);
              return (
                <button
                  key={step.id}
                  onClick={() => { setCurrentStepIndex(idx); setSidebarOpen(false); }}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm text-left transition-colors",
                    isCurrent
                      ? "bg-primary/10 text-foreground font-medium"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent",
                  )}
                >
                  <StepIndicator status={stepStatus} isCurrent={isCurrent} />
                  <span>{step.label}</span>
                </button>
              );
            })}
          </nav>
        </div>
      )}

      {/* Desktop/Tablet sidebar */}
      <aside className="hidden md:flex w-56 lg:w-64 bg-card border-r border-border flex-col py-6 px-3 lg:px-4 gap-0.5 shrink-0">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-4 px-2">
          Setup
        </p>
        {visibleSteps.map((step, idx) => {
          const isCurrent = idx === currentStepIndex;
          const stepStatus = getStepStatus(step);
          return (
            <button
              key={step.id}
              onClick={() => setCurrentStepIndex(idx)}
              className={cn(
                "flex items-center gap-3 px-2 py-2 rounded-md text-[13px] text-left transition-colors",
                isCurrent
                  ? "bg-primary/10 text-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent",
              )}
            >
              <StepIndicator status={stepStatus} isCurrent={isCurrent} />
              <span className="truncate">{step.label}</span>
            </button>
          );
        })}
      </aside>

      {/* Content area */}
      <main className="flex-1 min-w-0 overflow-y-auto">
        <div className="px-4 py-6 sm:px-6 md:px-8 lg:px-12 max-w-2xl mx-auto md:mx-0 lg:mx-auto">
          {currentStep !== undefined && (
            <div key={currentStep.id} className="onboard-animate-fade">
              <StepContent
                stepId={currentStep.id}
                state={state}
                onNext={handleNext}
                onSkip={handleSkip}
                onComplete={handleComplete}
              />
            </div>
          )}
        </div>

        {/* Mobile: progress dots at bottom */}
        <MobileProgressDots
          steps={visibleSteps as unknown as (typeof ALL_STEPS extends readonly (infer T)[] ? T[] : never)}
          currentIndex={currentStepIndex}
          state={state}
          onSelect={setCurrentStepIndex}
        />
      </main>
    </div>
  );
}
