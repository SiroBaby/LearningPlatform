import { HomeActions, SystemStatePage, buildSystemMetadata } from "@/components/shared/system-state";
import { hasSignedInSession } from "@/lib/auth/session";

export const metadata = buildSystemMetadata(
  "Mất kết nối",
  "Thiết bị của bạn đang mất kết nối mạng.",
);

export default async function OfflinePage(): Promise<React.JSX.Element> {
  const isAuthenticated = await hasSignedInSession();

  return (
    <SystemStatePage
      badge="Mất kết nối"
      title="Bạn đang mất kết nối"
      description="Kiểm tra mạng rồi thử lại."
      icon="offline"
      tone="neutral"
      primaryAction={<HomeActions isAuthenticated={isAuthenticated} />}
      isAuthenticated={isAuthenticated}
    />
  );
}
