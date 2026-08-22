import { LearnerShell } from "@/components/layout";
import { SettingsScreen } from "@/components/settings/settings-screen";

export default function SettingsPage() {
  return (
    <LearnerShell
      title="Settings"
      subtitle="Quản lý tài khoản, learning preferences, quyền riêng tư, thông báo và accessibility preferences trong cùng một nơi rõ ràng."
    >
      <SettingsScreen />
    </LearnerShell>
  );
}
