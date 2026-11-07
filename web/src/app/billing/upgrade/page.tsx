import { LearnerShell } from "@/components/layout";
import { UpgradeScreen } from "@/components/billing/upgrade-screen";

export default function UpgradePage() {
  return (
    <LearnerShell
      title="Chọn gói phù hợp"
      subtitle="So sánh credit, giới hạn video và quyền lợi của từng gói."
    >
      <UpgradeScreen />
    </LearnerShell>
  );
}
