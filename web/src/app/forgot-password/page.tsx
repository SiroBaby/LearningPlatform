import { ForgotPasswordForm } from "@/components/auth/mock-auth-forms";
import { AuthShell } from "@/components/layout";

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title="Quên mật khẩu"
      description="Nhập email đăng ký để nhận liên kết đặt lại. Trong sản phẩm thật, bạn sẽ quay lại đúng flow học đang dở thay vì bắt đầu lại từ đầu."
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
