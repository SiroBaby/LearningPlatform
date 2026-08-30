import { OnboardingFlow } from "@/components/auth/onboarding-flow";
import { AuthShell } from "@/components/layout";

export default function OnboardingPage() {
  return (
    <AuthShell
      layout="wide"
      title="Thiết lập cách bạn muốn học"
      description="Chọn vài điều để bài học và lời giải phù hợp hơn với bạn. Bạn có thể bỏ qua và quay lại trong Cài đặt bất cứ lúc nào."
    >
      <OnboardingFlow />
    </AuthShell>
  );
}
