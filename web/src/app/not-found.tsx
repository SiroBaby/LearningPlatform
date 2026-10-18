import { HomeActions, SystemStatePage, buildSystemMetadata } from "@/components/shared/system-state";
import { LinkButton } from "@/components/ui";
import { hasSignedInSession } from "@/lib/auth/session";
import { routes } from "@/lib/routes";

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
          ? "Trang này không tồn tại hoặc đã bị xóa. Hãy về trang chủ hoặc mở Thư viện để tìm lại."
          : "Trang này không tồn tại hoặc đã bị xóa. Hãy về trang chủ để tìm lại."
      }
      icon="warning"
      tone="warning"
      primaryAction={<HomeActions isAuthenticated={isAuthenticated} canRetry={false} />}
      secondaryAction={isAuthenticated ? <LinkButton href={routes.library} variant="outline">Mở Thư viện</LinkButton> : undefined}
      isAuthenticated={isAuthenticated}
    />
  );
}
