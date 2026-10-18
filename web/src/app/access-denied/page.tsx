import { HomeActions, SystemStatePage, buildSystemMetadata } from "@/components/shared/system-state";
import { hasSignedInSession } from "@/lib/auth/session";

export const metadata = buildSystemMetadata(
  "Không có quyền truy cập",
  "Tài khoản của bạn chưa được vào trang này.",
);

export default async function AccessDeniedPage(): Promise<React.JSX.Element> {
  const isAuthenticated = await hasSignedInSession();

  return (
    <SystemStatePage
      badge="Không có quyền"
      title="Bạn chưa có quyền vào trang này"
      description="Tài khoản của bạn chưa được vào trang này. Nếu bạn nghĩ đây là nhầm lẫn, hãy liên hệ hỗ trợ."
      icon="access"
      tone="warning"
      primaryAction={<HomeActions isAuthenticated={isAuthenticated} canRetry={false} />}
      isAuthenticated={isAuthenticated}
    />
  );
}
