import { AuthShell } from "@/components/layout";
import { GoogleAuthEntry } from "@/components/auth/google-auth-entry";

export default function LoginPage() {
  return (
    <AuthShell
      title="Đăng nhập để tiếp tục vòng học đang dở"
      description="Tiếp tục review queue, quiz đang làm dở và tutor theo đúng tài liệu của bạn. Mọi lời giải vẫn giữ citation nguồn để bạn kiểm chứng khi cần."
    >
      <GoogleAuthEntry />
    </AuthShell>
  );
}
