import { ResetPasswordForm } from "@/components/auth/mock-auth-forms";
import { AuthShell } from "@/components/layout";

export default function ResetPasswordPage() {
  return (
    <AuthShell
      title="Đặt lại mật khẩu"
      description="Chọn mật khẩu mới để quay lại review queue, quiz đang làm dở và các tài liệu bạn vừa xử lý. Luồng này chỉ mô phỏng UX, chưa gọi backend thật."
    >
      <ResetPasswordForm />
    </AuthShell>
  );
}
