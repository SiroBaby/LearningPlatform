import { HomeActions, SystemStatePage, buildSystemMetadata } from "@/components/shared/system-state";
import { hasSignedInSession } from "@/lib/auth/session";

export const metadata = buildSystemMetadata(
  "Đang bảo trì",
  "Hệ thống đang bảo trì ngắn. Bạn vui lòng quay lại sau ít phút.",
);

export default async function MaintenancePage(): Promise<React.JSX.Element> {
  const isAuthenticated = await hasSignedInSession();

  return (
    <SystemStatePage
      badge="Bảo trì"
      title="Hệ thống đang bảo trì"
      description="Hệ thống đang bảo trì ngắn. Bạn vui lòng quay lại sau ít phút."
      icon="warning"
      tone="brand"
      primaryAction={<HomeActions isAuthenticated={isAuthenticated} />}
      isAuthenticated={isAuthenticated}
    />
  );
}
