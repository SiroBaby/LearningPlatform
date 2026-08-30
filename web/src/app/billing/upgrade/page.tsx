import { LearnerShell } from "@/components/layout";
import { UpgradeScreen } from "@/components/billing/upgrade-screen";

export default function UpgradePage() {
  return (
    <LearnerShell
      title="Chọn gói phù hợp"
      subtitle="So sánh lượt dùng, giới hạn video và các quyền lợi phù hợp với nhịp ôn tập hiện tại."
    >
      <UpgradeScreen />
    </LearnerShell>
  );
}
