import { VerifyEmailPanel } from "@/components/auth/mock-auth-forms";
import { AuthShell } from "@/components/layout";

export default function VerifyEmailPage() {
  return (
    <AuthShell
      title="Xác minh email trước khi bắt đầu upload"
      description="Bước xác minh giúp bảo vệ tài khoản và đảm bảo bạn nhận được thông báo khi document sẵn sàng hoặc khi review queue đến hạn."
    >
      <VerifyEmailPanel />
    </AuthShell>
  );
}
