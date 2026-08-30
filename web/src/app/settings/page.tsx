import { LearnerShell } from "@/components/layout";
import { SettingsScreen } from "@/components/settings/settings-screen";

export default function SettingsPage() {
  return (
    <LearnerShell
      title="Cài đặt"
      subtitle="Quản lý tài khoản, cách học, quyền riêng tư, thông báo và khả năng tiếp cận."
    >
      <SettingsScreen />
    </LearnerShell>
  );
}
