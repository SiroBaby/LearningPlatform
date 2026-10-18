import { LinkButton } from "@/components/ui";
import { routes } from "@/lib/routes";
import { HomeActions, SystemStatePage, buildSystemMetadata } from "@/components/shared/system-state";
import { hasSignedInSession } from "@/lib/auth/session";

export const metadata = buildSystemMetadata(
  "Chưa có quyền truy cập",
  "Tài khoản của bạn chưa được cấp quyền vào trang này.",
);

export default async function AccessDeniedPage(): Promise<React.JSX.Element> {
  const isAuthenticated = await hasSignedInSession();

  return (
    <SystemStatePage
      badge="Chưa có quyền"
      title="Bạn chưa có quyền vào trang này"
      description="Tài khoản của bạn chưa được cấp quyền vào trang này. Nếu bạn nghĩ đây là nhầm lẫn, hãy xem Câu hỏi thường gặp."
      icon="access"
      tone="warning"
      primaryAction={<HomeActions isAuthenticated={isAuthenticated} canRetry={false} />}
      secondaryAction={<LinkButton href={routes.faq} variant="outline">Câu hỏi thường gặp</LinkButton>}
      isAuthenticated={isAuthenticated}
    />
  );
}
