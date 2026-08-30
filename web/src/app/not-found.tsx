import { AccessActions, SystemStatePage, buildSystemMetadata } from "@/components/shared/system-state";
import { hasAuthenticatedSession } from "@/lib/auth/session";

export const metadata = buildSystemMetadata(
  "Not found",
  "Không tìm thấy trang hoặc tài nguyên bạn đang mở trong LearningPlatform.",
);

export default async function NotFound() {
  const isAuthenticated = await hasAuthenticatedSession();

  return (
    <SystemStatePage
      badge="404"
      title="Không tìm thấy trang bạn đang tìm"
      description="Liên kết này có thể đã hết hạn, route chưa tồn tại, hoặc tài nguyên đã bị xóa khỏi workspace học của bạn."
      detail="Nếu bạn đang tìm một tài liệu, bài kiểm tra hoặc kết quả cụ thể, hãy quay lại Thư viện hoặc Trang chủ để mở từ luồng điều hướng chính."
      icon="warning"
      tone="warning"
      primaryAction={<AccessActions />}
      isAuthenticated={isAuthenticated}
    />
  );
}
