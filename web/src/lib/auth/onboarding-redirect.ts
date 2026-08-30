export interface OnboardingState {
  readonly onboardingCompletedAt?: string | null;
  readonly onboardingSkippedAt?: string | null;
}

/** Sends a first-time user to onboarding while preserving completed or skipped state. */
export function getPostLoginRedirectPath(state: OnboardingState): "/home" | "/onboarding" {
  return state.onboardingCompletedAt || state.onboardingSkippedAt ? "/home" : "/onboarding";
}
