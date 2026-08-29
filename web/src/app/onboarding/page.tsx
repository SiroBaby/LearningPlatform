import { OnboardingFlow } from "@/components/auth/onboarding-flow";
import { AuthShell } from "@/components/layout";

export default function OnboardingPage() {
  return (
    <AuthShell
      title="Thiết lập nhanh để hệ thống hiểu cách bạn muốn học"
      description="Chỉ vài bước để LearningPlatform ưu tiên đúng mục tiêu học, ngôn ngữ giải thích và đường tới first value. Bạn có thể bỏ qua bây giờ và mở lại trong Settings bất kỳ lúc nào."
    >
      <OnboardingFlow />
    </AuthShell>
  );
}
