import type { Metadata } from "next";

import { OnboardingFlow } from "@/components/auth/onboarding-flow";
import { AuthShell } from "@/components/layout";

export const metadata: Metadata = {
  title: "Thiết lập học tập",
};

export default function OnboardingPage() {
  return (
    <AuthShell
      layout="wide"
      title="Thiết lập cách bạn muốn học"
      description="Chọn vài điều để bài học phù hợp hơn với bạn."
    >
      <OnboardingFlow />
    </AuthShell>
  );
}
