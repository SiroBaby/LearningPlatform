import { HomeActions, SystemStatePage, buildSystemMetadata } from "@/components/shared/system-state";
import { hasSignedInSession } from "@/lib/auth/session";

export const metadata = buildSystemMetadata(
  "Không tìm thấy trang",
  "Trang này không tồn tại hoặc đã bị xóa.",
);

export default async function NotFound() {
  const isAuthenticated = await hasSignedInSession();

  return (
    <SystemStatePage
      badge="404"
      title="Không tìm thấy trang bạn đang tìm"
      description={
        isAuthenticated
          ? "Trang này không tồn tại hoặc đã bị xóa. Hãy về trang chủ hoặc Thư viện để tìm lại."
          : "Trang này không tồn tại hoặc đã bị xóa. Hãy về trang chủ để tìm lại."
      }
      icon="warning"
      tone="warning"
      primaryAction={<HomeActions isAuthenticated={isAuthenticated} canRetry={false} />}
      isAuthenticated={isAuthenticated}
    />
  );
}
