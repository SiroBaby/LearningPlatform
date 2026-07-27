import { AccessActions, SystemStatePage, buildSystemMetadata } from "@/components/shared/system-state";

export const metadata = buildSystemMetadata(
  "Access denied",
  "Bạn không có quyền mở tài nguyên này hoặc tính năng hiện chưa khả dụng với plan hiện tại.",
);

export default function AccessDeniedPage() {
  return (
    <SystemStatePage
      badge="Access denied"
      title="Bạn chưa có quyền vào màn hình này"
      description="Tài nguyên này có thể thuộc workspace khác, yêu cầu role khác, hoặc đang bị giới hạn bởi plan / quota hiện tại."
      detail="Trong production, trạng thái này thường xuất hiện khi mở route teacher/admin không đúng role hoặc khi dùng feature cần upgrade plan."
      icon="access"
      tone="warning"
      primaryAction={<AccessActions />}
    />
  );
}
