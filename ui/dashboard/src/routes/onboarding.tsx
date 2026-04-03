import { useCallback } from "react";
import { useNavigate } from "react-router";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard.js";
import { updateOnboardingState } from "@/api.js";

export function OnboardingPage() {
  const navigate = useNavigate();

  const handleComplete = useCallback(async () => {
    await updateOnboardingState({ firstbootCompleted: true, completedAt: new Date().toISOString() });
    navigate("/", { replace: true });
  }, [navigate]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <OnboardingWizard isFirstboot={true} onComplete={handleComplete} />
    </div>
  );
}
