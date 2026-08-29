import { HomeActions, SystemStatePage, buildSystemMetadata } from "@/components/shared/system-state";
import { hasAuthenticatedSession } from "@/lib/auth/session";

export const metadata = buildSystemMetadata(
  "Maintenance",
  "Một phần hệ thống đang được bảo trì tạm thời để ổn định xử lý tài liệu, quiz hoặc Tutor.",
);

export default async function MaintenancePage(): Promise<React.JSX.Element> {
  const isAuthenticated = await hasAuthenticatedSession();

  return (
    <SystemStatePage
      badge="Maintenance"
      title="Hệ thống đang được bảo trì ngắn hạn"
      description="Chúng tôi đang tối ưu pipeline hoặc ổn định các dịch vụ nền. Bạn có thể quay lại sau ít phút để tiếp tục học."
      detail="Các surface nên giải thích rõ đây là sự cố tạm thời của hệ thống, không phải lỗi do tài liệu hay thao tác của người dùng."
      icon="warning"
      tone="brand"
      primaryAction={<HomeActions />}
      isAuthenticated={isAuthenticated}
    />
  );
}
