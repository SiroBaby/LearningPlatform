import { HomeActions, SystemStatePage, buildSystemMetadata } from "@/components/shared/system-state";
import { hasAuthenticatedSession } from "@/lib/auth/session";

export const metadata = buildSystemMetadata(
  "Offline",
  "Thiết bị của bạn đang mất kết nối. Một số màn hình mock vẫn xem được, nhưng các thao tác mạng sẽ bị trì hoãn.",
);

export default async function OfflinePage(): Promise<React.JSX.Element> {
  const isAuthenticated = await hasAuthenticatedSession();

  return (
    <SystemStatePage
      badge="Offline"
      title="Thiết bị của bạn đang offline"
      description="Bạn vẫn có thể xem lại một số nội dung đã tải sẵn, nhưng upload, thông báo và các tác vụ cần mạng sẽ chờ cho đến khi kết nối quay lại."
      detail="Trên mobile, đây là trạng thái quan trọng vì người học thường mở review queue nhanh khi đang di chuyển hoặc kết nối không ổn định."
      icon="offline"
      tone="neutral"
      primaryAction={<HomeActions />}
      isAuthenticated={isAuthenticated}
    />
  );
}
