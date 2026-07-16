import { SignupForm } from "@/components/auth/mock-auth-forms";
import { AuthShell } from "@/components/layout";

export default function SignupPage() {
  return (
    <AuthShell
      title="Tạo tài khoản và tới first value thật nhanh"
      description="Bắt đầu với PDF mẫu hoặc tài liệu của riêng bạn. Sau signup, hệ thống sẽ đưa bạn qua xác minh email và onboarding ngắn để sớm thấy quiz, feedback và citation nguồn hoạt động ra sao."
    >
      <SignupForm />
    </AuthShell>
  );
}
