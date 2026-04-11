import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard.js";
import { PageScroll } from "@/components/PageScroll.js";

export function GatewayOnboardingPage() {
  return (
    <PageScroll>
    <div>
      <h1 className="text-2xl font-bold mb-6">Onboarding</h1>
      <p className="text-muted-foreground mb-6">
        Re-run any onboarding step to update your configuration.
      </p>
      <OnboardingWizard isFirstboot={false} />
    </div>
    </PageScroll>
  );
}
