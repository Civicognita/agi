/**
 * Onboarding State — persistence for data/onboarding-state.json.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OnboardingState {
  firstbootCompleted: boolean;
  steps: {
    hosting: "pending" | "completed" | "skipped";
    aionimaId: "pending" | "completed" | "skipped";
    aiKeys: "pending" | "completed" | "skipped";
    ownerProfile: "pending" | "completed" | "skipped";
    channels: "pending" | "completed" | "skipped";
    federation: "pending" | "completed" | "skipped";
    zeroMeMind: "pending" | "completed" | "skipped";
    zeroMeSoul: "pending" | "completed" | "skipped";
    zeroMeSkill: "pending" | "completed" | "skipped";
  };
  /** Whether the ID service runs locally or centrally. */
  idMode?: "central" | "local";
  aionimaIdServices?: Array<{ provider: string; role: string; accountLabel?: string }>;
  completedAt?: string;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_STATE: OnboardingState = {
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

// ---------------------------------------------------------------------------
// Read / Write
// ---------------------------------------------------------------------------

export function readOnboardingState(dataDir?: string): OnboardingState {
  const dir = dataDir ?? join(process.cwd(), "data");
  const filePath = join(dir, "onboarding-state.json");
  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const steps = (parsed.steps ?? {}) as Record<string, string>;

    // Migrate old state files that may not have hosting/federation keys
    return {
      firstbootCompleted: parsed.firstbootCompleted === true,
      steps: {
        hosting: (steps.hosting as OnboardingState["steps"]["hosting"]) ?? "pending",
        aionimaId: (steps.aionimaId as OnboardingState["steps"]["aionimaId"]) ?? "pending",
        aiKeys: (steps.aiKeys as OnboardingState["steps"]["aiKeys"]) ?? "pending",
        ownerProfile: (steps.ownerProfile as OnboardingState["steps"]["ownerProfile"]) ?? "pending",
        channels: (steps.channels as OnboardingState["steps"]["channels"]) ?? "pending",
        federation: (steps.federation as OnboardingState["steps"]["federation"]) ?? "pending",
        zeroMeMind: (steps.zeroMeMind as OnboardingState["steps"]["zeroMeMind"]) ?? "pending",
        zeroMeSoul: (steps.zeroMeSoul as OnboardingState["steps"]["zeroMeSoul"]) ?? "pending",
        zeroMeSkill: (steps.zeroMeSkill as OnboardingState["steps"]["zeroMeSkill"]) ?? "pending",
      },
      idMode: (parsed.idMode as OnboardingState["idMode"]) ?? undefined,
      aionimaIdServices: Array.isArray(parsed.aionimaIdServices)
        ? (parsed.aionimaIdServices as OnboardingState["aionimaIdServices"])
        : undefined,
      completedAt: parsed.completedAt as string | undefined,
    };
  } catch {
    return { ...DEFAULT_STATE, steps: { ...DEFAULT_STATE.steps } };
  }
}

export function writeOnboardingState(state: OnboardingState, dataDir?: string): void {
  const dir = dataDir ?? join(process.cwd(), "data");
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, "onboarding-state.json");
  writeFileSync(filePath, JSON.stringify(state, null, 2), "utf8");
}
