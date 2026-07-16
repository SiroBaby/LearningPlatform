import { LearnerShell } from "@/components/layout";
import { UpgradeScreen } from "@/components/billing/upgrade-screen";

export default function UpgradePage() {
  return (
    <LearnerShell
      title="Upgrade your plan"
      subtitle="So sánh rõ credits, giới hạn video, analytics và đường nâng cấp phù hợp với nhịp ôn tập hiện tại."
    >
      <UpgradeScreen />
    </LearnerShell>
  );
}
